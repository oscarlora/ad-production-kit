'use client';
// The edit's tracks over time: clips, video frames, sound waveforms, cuts with transitions, caption lines, volume moves, keyframes and comments.
// Click or drag along the ruler to move the playhead; drag above it to pick a stretch to comment on, its edges snapping
// to a block edge within SNAP px. With Shift held, the playhead and both edges jump to the nearest block edge.
// The pointer over the lanes skims: the preview shows that moment, and a click on an empty lane moves the playhead there.
// A click picks a clip or caption line; dragging it moves it (onto another track's row too, or the ruler's for a new
// top track), dragging an edge trims it (both snap to block edges and
// the playhead), a double click opens a media clip's trim panel. Pinch or ⌘-scroll zooms on the pointer, + and - on
// the playhead, Shift+Z fits the whole edit, from the whole edit in view down to single frames; zoomed in, the timeline scrolls sideways and follows the playhead.
// A track's name drags up or down to reorder the tracks and renames on a double click (onRename); hovered, it shows a bin that deletes the track (onRemove). Its eye hides its picture in the preview only; its speaker mutes or unmutes it in the edit. simple hides the
// tracks, leaving the ruler and comments. A track with no clips isn't shown.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { hasSound, keyed, tin } from '../../engine/doc.js';
import { clock } from '../../lib/client/format.js';
import { isTyping } from '../../lib/client/hooks.js';
import { IcEye, IcEyeOff, IcMute, IcSound, IcTrash } from '../icons.js';
import Film from '../Film.js';
import Wave from '../Wave.js';

const pct = (x, dur) => `${(x / dur) * 100}%`;
const base = (src) => String(src).split('/').pop().replace(/\.[^.]+$/, '');
// A text block shows its words (accent marks {…|color} dropped), anything else its name or file.
export const labelOf = (c) => (c.type === 'text' ? String(c.text).replace(/\{([^}|]*)(\|[^}]*)?\}/g, '$1').replace(/\s*\n\s*/g, ' ') : c.name || (c.src ? base(c.src) : c.type === 'custom' ? [c.draw, c.n].filter((x) => x != null).join(' ') : c.type));
const SNAP = 8;
const EDGE = 7; // px from a block's end that grab its edge
const PX_PER_FRAME = 12; // the closest zoom: every frame a tick
// Every block edge (clips and caption lines), for a dragged stretch to snap to.
const edgesOf = (doc) => [0, doc.duration || 0, ...doc.tracks.flatMap((tr) => tr.clips.flatMap((c) => (c.lines ? c.lines.flatMap((l) => [l.at, l.end]) : [c.at, c.end])))];
const KEYED = ['x', 'y', 'w', 'h', 'scale', 'rotate', 'opacity', 'blur'];

// Keyframe times of a clip's visual properties and grade.
function keyTimes(c) {
  const ts = new Set();
  for (const v of [...KEYED.map((k) => c[k]), ...Object.values(c.grade || {})]) if (keyed(v)) for (const [k] of v) ts.add(k);
  return [...ts];
}

// A track's volume (dB) as a line over the lane: 0 dB at the top, -30 dB at the bottom.
function Volume({ keys, dur }) {
  const y = (v) => Math.min(100, Math.max(0, (-v / 30) * 100));
  const pts = [[0, keys[0][1]], ...keys.map(([k, v]) => [k, v]), [dur, keys[keys.length - 1][1]]];
  return (
    <svg className="tl-vol" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts.map(([k, v]) => `${(k / dur) * 100},${y(v)}`).join(' ')} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const canSound = (c) => c.type === 'audio' || (c.type === 'video' && !((c.rate ?? 1) < 0.1)); // not a freeze frame

// A text or caption block's whole text and times, shown above it on hover (in place of the browser's title).
const Pop = ({ text, at, end }) => <span className="tl-pop">{text} · {clock(at, true)}–{clock(end, true)}</span>;

// drag: the block being dragged on this track, { id, li, mode, d }: it draws where the drag has it.
// ghost: a clip dragged here from another track, { at, end, text }.
// onLift: its name grabbed to reorder the tracks; over: the edge ('top' | 'bottom') a dragged track will land on.
const Track = memo(function Track({ tr, dur, hide, onToggle, onMute, onRemove, onRename, onGrab, onOpen, onLift, over, sel, drag, ghost, url, lib }) {
  const picture = tr.clips.some((c) => c.type !== 'audio'), sound = tr.clips.some(canSound);
  const [naming, setNaming] = useState(false); // its name being typed over (a double click)
  const mute = !!tr.mute || !tr.clips.some(hasSound);
  const hideLabel = `${hide ? 'Show' : 'Hide'} ${tr.name} (preview only)`, muteLabel = `${mute ? 'Unmute' : 'Mute'} ${tr.name}`;
  // A block's props: where it sits (as dragged), whether it is picked, and its grab.
  const block = (c, li, at, end) => {
    const on = (x) => x && x.id === c.id && (x.li ?? null) === li, d = on(drag) ? drag : null;
    if (d) { if (d.mode !== 'end') at += d.d; if (d.mode !== 'start') end += d.d; }
    return {
      style: { left: pct(at, dur), width: pct(end - at, dur) }, 'aria-selected': on(sel) || undefined, 'data-drag': d ? '' : undefined,
      onPointerDown: (e) => onGrab(e, c, li), onPointerMove: d ? undefined : edgeCursor, onPointerLeave: d ? undefined : edgeCursor,
    };
  };
  return (
    <div className="tl-track" data-track={tr.name} data-drop={ghost ? '' : undefined} data-over={over} data-video={tr.clips.some((c) => c.type === 'video') || undefined}>
      <div className="tl-name" title={`${tr.name} · drag to reorder, double-click to rename`} onPointerDown={(e) => onLift(e, tr.name)}>
        {picture && <button type="button" className="tl-toggle" aria-pressed={!hide} aria-label={hideLabel} title={hideLabel} onClick={() => onToggle(tr.name)}>{hide ? <IcEyeOff /> : <IcEye />}</button>}
        {sound && <button type="button" className="tl-toggle" aria-pressed={!mute} aria-label={muteLabel} title={muteLabel} onClick={() => onMute(tr.name, !mute)}>{mute ? <IcMute /> : <IcSound />}</button>}
        {naming
          ? <input className="tl-rename" autoFocus defaultValue={tr.name} onFocus={(e) => e.currentTarget.select()} onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => { setNaming(false); const to = e.currentTarget.value.trim(); if (to && to !== tr.name) onRename(tr.name, to); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = tr.name; e.currentTarget.blur(); } }} />
          : <span className="tl-title" onDoubleClick={() => setNaming(true)}>{tr.name}</span>}
        <button type="button" className="tl-toggle tl-del" aria-label={`Delete ${tr.name}`} title={`Delete ${tr.name} and its clips`} onClick={() => onRemove(tr.name)}><IcTrash /></button>
      </div>
      <div className="tl-lane" data-muted={tr.hidden || (mute && !picture) || undefined} data-silent={mute || undefined}>
        {tr.clips.map((c) => c.type === 'captions'
          ? (c.lines || []).map((l, i) => ( // one block per caption line
            <div key={`${c.id}-${i}`} className="tl-clip" data-type="captions" {...block(c, i, l.at, l.end)}>
              <span className="tl-label">{l.text}</span>
              <Pop text={l.text} at={l.at} end={l.end} />
            </div>
          ))
          : (
          <div key={c.id} className="tl-clip" data-type={c.type} {...block(c, null, c.at, c.end)} onDoubleClick={c.src && c.type !== 'image' ? () => onOpen(c.id) : undefined} title={c.type === 'text' ? undefined : `${labelOf(c)} · ${clock(c.at, true)}–${clock(c.end, true)}`}>
            {c.type === 'video' && c.src in lib && <Film className="tl-film" src={url(c.src)} sprites={lib[c.src]?.sprites} from={c.in} to={c.in + (c.end - c.at) * c.rate} />}
            {(c.type === 'audio' || c.type === 'video') && c.src in lib && <Wave className="tl-wave" src={url(c.src)} peaks={lib[c.src]?.peaks} dur={lib[c.src]?.dur} from={c.in} to={c.in + (c.end - c.at) * c.rate} bottom />}
            <span className="tl-label">{labelOf(c)}</span>
            {c.type === 'text' && <Pop text={labelOf(c)} at={c.at} end={c.end} />}
            {tin(c) > 0 && <span className="tl-tr" title={c.transition.type} />}
            {keyed(c.volume) && <Volume keys={c.volume.map(([k, v]) => [k - c.at, v])} dur={c.end - c.at} />}
          </div>
        ))}
        {ghost && <div className="tl-clip" data-drag="" style={{ left: pct(ghost.at, dur), width: pct(ghost.end - ghost.at, dur) }}><span className="tl-label">{ghost.text}</span></div>}
        {tr.clips.flatMap((c) => keyTimes(c).map((k) => <span key={`${c.id}-${k}`} className="tl-key" style={{ left: pct(k, dur) }} />))}
        {keyed(tr.volume) && <Volume keys={tr.volume} dur={dur} />}
        {keyTimes({ ...tr.transform, grade: tr.grade }).map((k) => <span key={k} className="tl-key" style={{ left: pct(k, dur) }} />)}
      </div>
    </div>
  );
});

// Which of a block's edges the pointer is on ('start' | 'end'), or null: the middle, or a block too narrow to tell.
function edgeAt(e) {
  const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left;
  return r.width < 3 * EDGE ? null : x < EDGE ? 'start' : x > r.width - EDGE ? 'end' : null;
}
const edgeCursor = (e) => { const el = e.currentTarget; if (e.type !== 'pointerleave' && edgeAt(e)) el.dataset.edge = ''; else delete el.dataset.edge; };

// fn as one function that never changes, calling the latest: a memoized track given it doesn't redraw.
function useLatest(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return useRef((...a) => ref.current(...a)).current;
}

// The ruler follows the zoom like an editor's: labelled marks at the smallest step that leaves them LABEL px apart,
// and plain ticks between at the smallest step TICK px apart, from single frames (closest in) up to minutes. A
// mark off a whole second is named by its frame ("12f"). pps: px per second.
const LABEL = 64, TICK = 6;
const Ruler = memo(function Ruler({ dur, pps, fps }) {
  const steps = [1, 5, fps / 2].filter((f) => Number.isInteger(f) && fps % f === 0).map((f) => f / fps).concat([1, 2, 5, 10, 30, 60, 120, 300, 600]);
  const at = (px) => steps.find((x) => x * pps >= px) ?? steps.at(-1);
  const step = at(LABEL), tick = at(TICK), marks = [];
  for (let i = 0; i * step < dur; i++) marks.push(Math.round(i * step * fps) / fps);
  const name = (x) => (Math.abs(x - Math.round(x)) < 1e-6 ? clock(x) : `${Math.round((x % 1) * fps)}f`);
  return (
    <div className="tl-ruler" style={tick < step ? { backgroundSize: `${(tick / dur) * 100}% 6px` } : { backgroundImage: 'none' }}>
      {marks.map((x) => <span key={x} style={{ left: pct(x, dur) }}>{name(x)}</span>)}
    </div>
  );
});

// children: the transport (play and time), in the corner above the track names.
// range: the stretch being picked, [from, to]; onRange(range, done) reports it as it's dragged and when let go.
// sel: the picked block, { id, li (a caption line's index, else null) }; onSelect(clip, li) picks one (null: none).
// onDrag(clip, li) → limit(mode, d, leaving its track): how far a drag may go; onRetime(clip, li, mode, d, to) when it is let go
// (to: the track a clip was dragged onto, by name; '' the ruler's row, for a new top track).
// onOrder(name, before): a track dragged by its name to just above the track `before` (null: the bottom).
export default function Timeline({ doc, t, playing, comments, nums, lib, lit, range, onRange, onSeek, onPick, onHover, off, onToggle, onMute, sel, onSelect, onDrag, onRetime, onOrder, onRemove, onRename, onOpen, onSkim, url, simple, children }) {
  const dur = doc.duration || 1;
  const edges = useMemo(() => edgesOf(doc), [doc]);
  const pick = useRef(null); // the dragged stretch's fixed end
  const timeAt = (e) => {
    const r = e.currentTarget.getBoundingClientRect(), x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur;
    const tol = (SNAP / r.width) * dur;
    return [x, edges.reduce((best, s) => (Math.abs(s - x) < Math.abs(best - x) ? s : best), x - 2 * tol), tol];
  };
  const nearest = (x) => edges.reduce((best, s) => (Math.abs(s - x) < Math.abs(best - x) ? s : best), edges[0]);
  const snapped = (e) => { const [x, s, tol] = timeAt(e); return e.shiftKey ? nearest(x) : Math.abs(s - x) <= tol ? s : x; };
  const scrubbed = (e) => (e.shiftKey ? nearest(timeAt(e)[0]) : timeAt(e)[0]);

  // Zoom: 1 fits the edit in the timeline's width. The time under `keep.x` (px into the lanes' view) stays there.
  const [zoom, setZoom] = useState(1);
  const scroller = useRef(null), keep = useRef(null), now = useRef({});
  now.current = { zoom, t, dur };
  const view = () => { const el = scroller.current, name = el.querySelector('.tl-name').offsetWidth; return { el, name, w: el.clientWidth - name }; };
  const zoomBy = (k, time, x) => {
    const { w } = view(), z = Math.min(Math.max(1, (dur * doc.fps * PX_PER_FRAME) / w), Math.max(1, now.current.zoom * k));
    keep.current = { time, x };
    setZoom(z);
  };
  useLayoutEffect(() => {
    const k = keep.current;
    if (!k) return;
    keep.current = null;
    const { el, w } = view();
    el.scrollLeft = (k.time / dur) * w * zoom - k.x;
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps -- runs once per zoom step
  const [wide, setWide] = useState(800); // the lanes' width on screen (px)
  useEffect(() => {
    const ro = new ResizeObserver(() => setWide(view().w));
    ro.observe(scroller.current);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const zoomRef = useRef(zoomBy);
  zoomRef.current = zoomBy;
  useEffect(() => {
    const el = scroller.current;
    const onWheel = (e) => { // a pinch arrives as a ctrl-wheel
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { name, w } = view(), x = e.clientX - el.getBoundingClientRect().left - name, { zoom: z, dur: d } = now.current;
      zoomRef.current(Math.exp(-e.deltaY * 0.01), ((el.scrollLeft + x) / (w * z)) * d, x);
    };
    const onKey = (e) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key === '=' || e.key === '+' ? 1.5 : e.key === '-' ? 1 / 1.5 : e.key === 'Z' ? 0 : null;
      if (k == null) return;
      e.preventDefault();
      const { w } = view(), { zoom: z, t: at, dur: d } = now.current, x = (at / d) * w * z - el.scrollLeft;
      zoomRef.current(k, at, x >= 0 && x <= w ? x : w / 2);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('wheel', onWheel); document.removeEventListener('keydown', onKey); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- reads the current values through refs
  useEffect(() => { // zoomed in, the playhead stays in view
    if (zoom === 1) return;
    const { el, w } = view(), x = (t / dur) * w * zoom - el.scrollLeft;
    if (x < 0 || x > w - 24) el.scrollLeft += x - (playing ? 48 : w / 2);
  }, [t, zoom, dur, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dragging a block: its middle moves it, an edge trims it; the moving edges snap to the other blocks' and the playhead.
  const [drag, setDrag] = useState(null); // { id, li, mode, d, to (the track it is over), ghost (the block drawn there) }
  const grab = (e, c, li) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(c, li);
    const mode = edgeAt(e) || 'move', x0 = e.clientX, y0 = e.clientY, lane = e.currentTarget.parentElement.getBoundingClientRect();
    const b = li == null ? c : c.lines[li], limit = onDrag(c, li), tol = (SNAP / lane.width) * dur;
    const stops = [t, ...edges.filter((s) => s !== b.at && s !== b.end)];
    const home = e.currentTarget.closest('.tl-track');
    let d = 0, moved = false, to;
    const onMove = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      moved = true;
      d = ((ev.clientX - x0) / lane.width) * dur;
      let best = tol;
      for (const edge of mode === 'move' ? [b.at, b.end] : [mode === 'start' ? b.at : b.end]) for (const s of stops) {
        if (Math.abs(s - edge - d) < best) { best = Math.abs(s - edge - d); d = s - edge; }
      }
      // a clip dragged over another track's row, or the ruler's, lands there
      const row = mode === 'move' && li == null && document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tl-track');
      to = row && row !== home ? row.dataset.track ?? '' : undefined;
      d = limit(mode, d, to != null);
      setDrag({ id: c.id, li, mode, d, to, ghost: to != null && { at: b.at + d, end: b.end + d, text: labelOf(c) } });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      setDrag(null);
      if (moved && (Math.abs(d) > 1e-3 || to != null)) onRetime(c, li, mode, d, to);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  // Skimming: with no button held and nothing playing, the pointer over the lanes shows that moment in the preview
  // (onSkim(time); null when it leaves) under a faint line; the playhead stays where it is.
  const [skim, setSkim] = useState(null);
  const skimTo = (x) => { setSkim(x); onSkim(x); };
  const onSkimMove = (e) => {
    if (e.buttons || playing) return skim != null && skimTo(null);
    const r = e.currentTarget.getBoundingClientRect(), name = view().name, x = ((e.clientX - r.left - name) / (r.width - name)) * dur;
    skimTo(x >= 0 && x <= dur && !e.target.closest('.tl-name') ? x : null);
  };
  // Dragging a track by its name reorders the tracks: a line marks where it will land.
  const [order, setOrder] = useState(null); // { name, before (the track it lands above; null: the bottom) }
  const lift = useLatest((e, name) => {
    if (e.button !== 0 || e.target.closest('button, input')) return;
    e.preventDefault();
    const y0 = e.clientY;
    let before, moved = false;
    const onMove = (ev) => {
      if (!moved && Math.abs(ev.clientY - y0) < 4) return;
      moved = true;
      const row = [...scroller.current.querySelectorAll('.tl-track[data-track]')].find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
      before = row ? row.dataset.track : null;
      setOrder({ name, before });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      setOrder(null);
      if (moved && before !== name) onOrder(name, before);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
  const shownTracks = doc.tracks.filter((tr) => tr.clips.length > 0);
  const onGrab = useLatest(grab), mute = useLatest(onMute), open = useLatest(onOpen), remove = useLatest(onRemove), rename = useLatest(onRename);

  return (
    <div className="tl" ref={scroller} style={{ '--tl-zoom': zoom }}>
      <div className="tl-in" onPointerMove={onSkimMove} onPointerLeave={() => skim != null && skimTo(null)} onPointerDown={(e) => { if (e.target.matches('.tl-lane:not(.tl-scrub)')) { onSelect(null); if (skim != null) onSeek(skim); } }}>
      <div className="tl-track tl-track--head" data-drop={drag?.to === '' || undefined}>
        <div className="tl-name tl-transport">{children}</div>
        <div
          className="tl-lane tl-scrub"
          onPointerDown={(e) => {
            if (e.button !== 0 || e.target.closest('.tl-comment')) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const r = e.currentTarget.getBoundingClientRect(), above = e.clientY - r.top < r.height - 26; // the comments half, above the ruler
            pick.current = above ? snapped(e) : null;
            onRange(null);
            onSeek(above ? pick.current : scrubbed(e));
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            if (pick.current == null) return onSeek(scrubbed(e));
            const b = snapped(e);
            onRange(Math.abs(b - pick.current) > 0.02 ? [Math.min(pick.current, b), Math.max(pick.current, b)] : null);
            onSeek(b);
          }}
          onPointerUp={() => { if (pick.current != null && range) onRange(range, true); pick.current = null; }}
        >
          <Ruler dur={dur} pps={(wide * zoom) / dur} fps={doc.fps} />
          {comments.filter((n) => n.to > n.t).map((n) => <span key={`${n.id}-span`} className="tl-span" data-status={n.status} style={{ left: pct(n.t, dur), width: pct(n.to - n.t, dur) }} />)}
          {comments.map((n) => (
            <button key={n.id} type="button" className="tl-comment" data-status={n.status} data-lit={n.id === lit || undefined} style={{ left: pct(n.t, dur) }} title={n.text} aria-label={n.text} onClick={() => onPick(n)} onPointerEnter={() => onHover(n.id)} onPointerLeave={() => onHover(null)}>{nums.get(n.id)}</button>
          ))}
        </div>
      </div>
      {!simple && doc.tracks.map((tr, i) => {
        const has = (x) => (x && tr.clips.some((c) => c.id === x.id) ? x : null);
        return tr.clips.length > 0 && <Track key={i} tr={tr} dur={dur} hide={off.has(tr.name)} onToggle={onToggle} onMute={mute} onRemove={remove} onRename={rename} onGrab={onGrab} onOpen={open} sel={has(sel)} drag={has(drag)} ghost={drag?.to === tr.name ? drag.ghost : null} onLift={lift} over={!order ? undefined : order.before === tr.name ? 'top' : order.before == null && tr === shownTracks.at(-1) ? 'bottom' : undefined} url={url} lib={lib} />;
      })}
      <div className="tl-play">
        {range && <div className="tl-range" style={{ left: pct(range[0], dur), width: pct(range[1] - range[0], dur) }} />}
        {skim != null && <div className="tl-skim" style={{ left: pct(skim, dur) }} />}
        <div className="tl-head" style={{ left: pct(t, dur) }} />
      </div>
      </div>
    </div>
  );
}
