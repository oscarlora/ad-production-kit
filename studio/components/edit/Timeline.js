'use client';
// The edit's tracks over time: clips, video frames, sound waveforms, cuts with transitions, caption lines, volume moves, keyframes and comments.
// Click or drag along the ruler to move the playhead; commenting (picking), a drag there picks a stretch to comment on,
// its edges snapping to a block edge within SNAP px. Comments sit on the ruler as small numbered dots. With Shift held, the playhead and both edges jump to the nearest block edge.
// The pointer over the lanes skims: the preview shows that moment, and a click on an empty lane moves the playhead there.
// A click picks a clip or caption line (Shift or ⌘: several, to change together) and opens its settings over it
// (onInspect(where it was clicked)); dragging it moves it (onto another track's row too, or the ruler's for a new
// top track), dragging an edge trims it, leaving a gap (by its name bar: changes its speed to fill the space) (both snap to block edges and
// the playhead). Pinch or ⌘-scroll zooms on the pointer, + and - on
// the playhead, Shift+Z fits the whole edit, from the whole edit in view down to single frames; zoomed in, the timeline scrolls sideways and follows the playhead.
// A track's name drags up or down to reorder the tracks and renames on a double click (onRename); hovered, it shows a bin that deletes the track (onRemove). Its eye hides its picture in the preview only; its speaker mutes or unmutes it in the edit. A track with no clips isn't shown.
// A click on a track's name picks it (Shift or ⌘: several); ⌘G groups the picked tracks, ⇧⌘G takes them out of their group.
// A group shows as a folder row over its tracks (indented): its chevron folds them into its row, its eye and speaker
// act on all of them, its name drags the whole group and renames on a double click.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { hasSound, keyed, tin } from '../../engine/doc.js';
import { clock } from '../../lib/client/format.js';
import { isTyping, useStored } from '../../lib/client/hooks.js';
import { IcEye, IcEyeOff, IcMute, IcRight, IcSound, IcTrash, IcUngroup } from '../icons.js';
import Film from '../Film.js';
import Wave from '../Wave.js';

const pct = (x, dur) => `${(x / dur) * 100}%`;
const base = (src) => String(src).split('/').pop().replace(/\.[^.]+$/, '');
// A text block shows its words (accent marks {…|color} dropped), anything else its name or file.
export const labelOf = (c) => (c.type === 'text' ? String(c.text).replace(/\{([^}|]*)(\|[^}]*)?\}/g, '$1').replace(/\s*\n\s*/g, ' ') : c.src ? base(c.src) : c.name || (c.type === 'custom' ? [c.draw, c.n].filter((x) => x != null).join(' ') : c.type));
const SNAP = 8;
const EDGE = 12; // px from a block's end that grab its edge (a cut's handle, .tl-cut, takes the outer 5 of it)
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
const Track = memo(function Track({ tr, dur, hide, onToggle, onMute, onRemove, onRename, onGrab, onLift, over, sel, drag, ghost, gap, onCloseGap, member, picked, onGroup, url, lib }) {
  const picture = tr.clips.some((c) => c.type !== 'audio'), sound = tr.clips.some(canSound);
  const [naming, setNaming] = useState(false); // its name being typed over (a double click)
  const mute = !!tr.mute || !tr.clips.some(hasSound);
  const hideLabel = `${hide ? 'Show' : 'Hide'} ${tr.name} (preview only)`, muteLabel = `${mute ? 'Unmute' : 'Mute'} ${tr.name}`;
  // A block's props: where it sits (as dragged), whether it is picked, and its grab.
  const block = (c, li, at, end) => {
    const d = drag && drag.id === c.id && (drag.li ?? null) === li ? drag : null;
    if (d) { if (d.mode !== 'end' && d.mode !== 'roll') at += d.d; if (d.mode !== 'start') end += d.d; }
    if (drag?.mode === 'roll' && drag.next === c.id && li == null) at += drag.d; // the clip after a rolled cut starts with it
    return {
      style: { left: pct(at, dur), width: pct(end - at, dur) }, 'data-key': `${c.id}:${li ?? ''}`, 'aria-selected': sel.split('|').includes(`${c.id}:${li ?? ''}`) || undefined, 'data-drag': d ? '' : undefined,
      onPointerDown: (e) => onGrab(e, c, li), onPointerMove: d ? undefined : edgeCursor, onPointerLeave: d ? undefined : edgeCursor,
    };
  };
  return (
    <div className="tl-track" data-track={tr.name} data-row={tr.name} data-member={member || undefined} data-picked={picked || undefined} data-drop={ghost ? '' : undefined} data-over={over} data-video={tr.clips.some((c) => c.type === 'video') || undefined}>
      <div className="tl-name" title={`${tr.name} · click to pick, drag to reorder, double-click to rename`} onPointerDown={(e) => onLift(e, tr.name)}>
        {picture && <button type="button" className="tl-toggle" aria-pressed={!hide} aria-label={hideLabel} title={hideLabel} onClick={() => onToggle(tr.name)}>{hide ? <IcEyeOff /> : <IcEye />}</button>}
        {sound && <button type="button" className="tl-toggle" aria-pressed={!mute} aria-label={muteLabel} title={muteLabel} onClick={() => onMute(tr.name, !mute)}>{mute ? <IcMute /> : <IcSound />}</button>}
        {naming
          ? <input className="tl-rename" autoFocus defaultValue={tr.name} onFocus={(e) => e.currentTarget.select()} onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => { setNaming(false); const to = e.currentTarget.value.trim(); if (to && to !== tr.name) onRename(tr.name, to); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = tr.name; e.currentTarget.blur(); } }} />
          : <span className="tl-title" onDoubleClick={() => setNaming(true)}>{tr.name}</span>}
        {onGroup
          ? <button type="button" className="tl-gbtn" title="Group the picked tracks (⌘G)" onClick={onGroup}>Group</button>
          : <button type="button" className="tl-toggle tl-del" aria-label={`Delete ${tr.name}`} title={`Delete ${tr.name} and its clips`} onClick={() => onRemove(tr.name)}><IcTrash /></button>}
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
          <div key={c.id} className="tl-clip" data-type={c.type} {...block(c, null, c.at, c.end)} title={c.type === 'text' ? undefined : `${labelOf(c)} · ${clock(c.at, true)}–${clock(c.end, true)}${c.type === 'video' || c.type === 'audio' ? ' · drag an edge to trim it; drag it by the name bar to change the speed' : ''}`}>
            {c.type === 'video' && c.src in lib && <Film className="tl-film" src={url(c.src)} sprites={lib[c.src]?.sprites} from={c.in} to={c.in + (c.end - c.at) * c.rate} />}
            {(c.type === 'audio' || c.type === 'video') && c.src in lib && <Wave className="tl-wave" src={url(c.src)} peaks={lib[c.src]?.peaks} dur={lib[c.src]?.dur} from={c.in} to={c.in + (c.end - c.at) * c.rate} bottom />}
            {(() => { // its name and, off 1×, its speed (live while a bar edge is dragged): a bar over a video's frames, else on the block
              const r = drag?.id === c.id && drag.rate ? drag.rate : c.rate !== 1 && c.rate;
              const info = <><span className="tl-label">{labelOf(c)}</span>{r ? <span className="tl-speed" data-live={drag?.id === c.id && drag.rate ? '' : undefined}>{Math.round(r * 100) / 100}×</span> : null}</>;
              return c.type === 'video' ? <div className="tl-bar">{info}</div> : info;
            })()}
            {c.type === 'text' && <Pop text={labelOf(c)} at={c.at} end={c.end} />}
            {tin(c) > 0 && <span className="tl-tr" title={c.transition.type} />}
            {keyed(c.volume) && <Volume keys={c.volume.map(([k, v]) => [k - c.at, v])} dur={c.end - c.at} />}
          </div>
        ))}
        {cutsOf(tr.clips).map(([a, b]) => { // a cut between two touching clips: drag it to move both sides together
          const on = drag?.mode === 'roll' && drag.id === a.id;
          return <div key={`cut-${a.id}`} className="tl-cut" data-drag={on ? '' : undefined} style={{ left: pct(a.end + (on ? drag.d : 0), dur) }}
            title="Drag the cut: right, the left clip plays on and the right one starts later; left, the opposite" onPointerDown={(e) => onGrab(e, a, null, b)} />;
        })}
        {gap && (
          <div className="tl-gap" style={{ left: pct(gap[0], dur), width: pct(gap[1] - gap[0], dur) }}>
            <button type="button" className="tl-gap__close" title="Close the gap: everything after it moves up (Delete)" onPointerDown={(e) => e.stopPropagation()} onClick={onCloseGap}>Close gap</button>
          </div>
        )}
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
// Over a video's name bar, an edge changes its speed; below it, it trims.
const inBar = (e) => { const bar = e.currentTarget.querySelector(':scope > .tl-bar'); return !!bar && e.clientY < bar.getBoundingClientRect().bottom; };
// Lights the edge a drag would change: data-edge says which, data-zone whether it trims or changes the speed.
const edgeCursor = (e) => {
  const el = e.currentTarget, edge = e.type !== 'pointerleave' && edgeAt(e);
  if (edge) { el.dataset.edge = edge; el.dataset.zone = inBar(e) ? 'speed' : 'trim'; } else { delete el.dataset.edge; delete el.dataset.zone; }
};
// The cuts on a track: pairs of clips (not caption lines) where one starts as the other ends.
const cutsOf = (clips) => {
  const cs = clips.filter((c) => c.type !== 'captions').sort((x, y) => x.at - y.at);
  return cs.flatMap((a, i) => cs.slice(i + 1).filter((b) => Math.abs(b.at - a.end) < 1e-3).slice(0, 1).map((b) => [a, b]));
};

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

// A group's folder row: open, a faint bar over the stretch its tracks cover; folded, their blocks in its one lane (a box
// dragged over them still picks them).
const GroupRow = memo(function GroupRow({ name, members, open, dur, off, sel, over, picked, onOpen, onToggle, onMute, onRename, onUngroup, onLift }) {
  const [naming, setNaming] = useState(false);
  const pics = members.filter((tr) => tr.clips.some((c) => c.type !== 'audio')), sounds = members.filter((tr) => tr.clips.some(canSound));
  const hidden = pics.length > 0 && pics.every((tr) => off.has(tr.name));
  const muted = sounds.length > 0 && sounds.every((tr) => tr.mute || !tr.clips.some(hasSound));
  const blocks = members.flatMap((tr) => tr.clips.flatMap((c) => (c.lines ? c.lines.map((l, i) => [c, i, l.at, l.end, l.text]) : [[c, null, c.at, c.end, labelOf(c)]])));
  const from = Math.min(...blocks.map((b) => b[2])), to = Math.max(...blocks.map((b) => b[3]));
  return (
    <div className="tl-track tl-track--group" data-row={members[0].name} data-open={open || undefined} data-picked={picked || undefined} data-over={over}>
      <div className="tl-name" title={`${name} · click to pick its tracks, drag to move the group, double-click to rename`} onPointerDown={(e) => onLift(e, name, true)}>
        <button type="button" className="tl-toggle tl-fold" aria-expanded={open} aria-label={open ? `Fold ${name}` : `Open ${name}`} onClick={() => onOpen(name)}><IcRight /></button>
        {pics.length > 0 && <button type="button" className="tl-toggle" aria-pressed={!hidden} title={`${hidden ? 'Show' : 'Hide'} ${name} (preview only)`} onClick={() => pics.forEach((tr) => off.has(tr.name) === hidden && onToggle(tr.name))}>{hidden ? <IcEyeOff /> : <IcEye />}</button>}
        {sounds.length > 0 && <button type="button" className="tl-toggle" aria-pressed={!muted} title={`${muted ? 'Unmute' : 'Mute'} ${name}`} onClick={() => onMute(sounds.map((tr) => tr.name), !muted)}>{muted ? <IcMute /> : <IcSound />}</button>}
        {naming
          ? <input className="tl-rename" autoFocus defaultValue={name} onFocus={(e) => e.currentTarget.select()} onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => { setNaming(false); const to = e.currentTarget.value.trim(); if (to && to !== name) onRename(name, to); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = name; e.currentTarget.blur(); } }} />
          : <span className="tl-title" onDoubleClick={() => setNaming(true)}>{name}</span>}
        <button type="button" className="tl-toggle tl-del" title={`Ungroup ${name} (⇧⌘G)`} aria-label={`Ungroup ${name}`} onClick={() => onUngroup(members.map((tr) => tr.name))}><IcUngroup /></button>
      </div>
      <div className="tl-lane">
        {open
          ? blocks.length > 0 && <div className="tl-gspan" style={{ left: pct(from, dur), width: pct(to - from, dur) }} />
          : blocks.map(([c, li, at, end, text]) => (
            <div key={`${c.id}-${li}`} className="tl-clip tl-clip--mini" data-type={c.type} data-key={`${c.id}:${li ?? ''}`} aria-selected={sel.split('|').includes(`${c.id}:${li ?? ''}`) || undefined} style={{ left: pct(at, dur), width: pct(end - at, dur) }}><span className="tl-label">{text}</span></div>
          ))}
      </div>
    </div>
  );
});

// children: the transport (play and time), in the corner above the track names.
// range: the stretch being picked, [from, to]; onRange(range, done) reports it as it's dragged and when let go.
// sel: the picked blocks, "<clip id>:<caption line's index, if one>" joined by |; onSelect(clip, li, add) picks one
// (null: none; add: with Shift or ⌘, one more or one fewer); onSelectMany([{ c, li }]) picks a box's worth at once, whose
// settings then open over it (onInspect).
// onDrag(clip, li) → limit(mode, d, leaving its track, stretch): how far a drag may go, with limit.rate(mode, d) the speed a
// stretch gives; onRetime(clip, li, mode, d, to, stretch) when it is let go
// (to: the track a clip was dragged onto, by name; '' the ruler's row, for a new top track).
// onMoveStretch(clip, t): a talking clip's stretch of the edit moved to the cut at t.
// onOrder(name, before): a track dragged by its name to just above the track `before` (null: the bottom).
// gap: the picked empty stretch, { track (name), range }; onGap(track, t) reports a click on an empty spot (null track:
// none); onCloseGap closes the picked one.
export default function Timeline({ doc, t, playing, comments, nums, lib, lit, range, picking, onRange, onSeek, onPick, onHover, off, onToggle, onMute, sel, onSelect, onSelectMany, gap, onGap, onCloseGap, onGroup, onUngroup, onRenameGroup, onOrderGroup, onMoveStretch, onInspect, onDrag, onRetime, onOrder, onRemove, onRename, onSkim, url, children }) {
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
    if (!scroller.current) return;
    const { el, w } = view();
    el.scrollLeft = (k.time / dur) * w * zoom - k.x;
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps -- runs once per zoom step
  const [wide, setWide] = useState(800); // the lanes' width on screen (px)
  useEffect(() => {
    const ro = new ResizeObserver(() => scroller.current && setWide(view().w));
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
  useEffect(() => { // ⌘G groups the picked tracks, ⇧⌘G ungroups them; Esc lets go of them
    if (!picks.length) return undefined;
    const onKey = (e) => {
      if (isTyping(e)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g') { e.preventDefault(); (e.shiftKey ? ungroup : onGroup)(picks); setPicks([]); }
      if (e.key === 'Escape') setPicks([]);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  useEffect(() => { // zoomed in, the playhead stays in view
    if (zoom === 1) return;
    if (!scroller.current) return;
    const { el, w } = view(), x = (t / dur) * w * zoom - el.scrollLeft;
    if (x < 0 || x > w - 24) el.scrollLeft += x - (playing ? 48 : w / 2);
  }, [t, zoom, dur, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dragging a block: its middle moves it, an edge trims it (leaving any gap open), an edge of a video's name bar changes
// its speed to fit (shown on it as it goes); the moving edges snap to the other blocks' and the playhead.
  const [drag, setDrag] = useState(null); // { id, li, mode, d, to (the track it is over), ghost (the block drawn there) }
  const grab = (e, c, li, next) => { // next: the clip after a cut grabbed between them (a roll)
    if (e.button !== 0) return;
    e.stopPropagation();
    setPicks([]);
    const add = e.shiftKey || e.metaKey; // with Shift or ⌘: one more picked (or one fewer), nothing dragged
    const clicked = { rect: e.currentTarget.getBoundingClientRect(), x: e.clientX, side: 'above' }; // where its settings open
    onSelect(c, li, add);
    if (add) return onInspect(clicked);
    const mode = next ? 'roll' : edgeAt(e) || 'move', x0 = e.clientX, y0 = e.clientY, lane = e.currentTarget.parentElement.getBoundingClientRect();
    const b = li == null ? c : c.lines[li], limit = onDrag(c, li), tol = (SNAP / lane.width) * dur;
    const stops = [t, ...edges.filter((s) => s !== b.at && s !== b.end)];
    const home = e.currentTarget.closest('.tl-track');
    const stretch = (mode === 'start' || mode === 'end') && li == null && inBar(e); // an edge of the name bar changes the speed to fit
    // A video or sound in a run of touching clips, dragged along its own track, moves its whole stretch of the edit
    // (every track's layers over it) to the cut nearest the pointer (onMoveStretch): lines swap places.
    const own = doc.tracks.find((tr) => tr.clips.some((x) => x.id === c.id))?.clips || [], run = [own.find((x) => x.id === c.id) || c];
    if (mode === 'move' && li == null && (c.type === 'video' || c.type === 'audio')) {
      for (let x; (x = own.find((y) => Math.abs(y.end - run[0].at) < 1e-3));) run.unshift(x);
      for (let x; (x = own.find((y) => Math.abs(y.at - run.at(-1).end) < 1e-3));) run.push(x);
    }
    const cuts = run.length > 1 ? [...run.map((x) => x.at), run.at(-1).end].filter((x) => Math.abs(x - c.at) > 1e-3 && Math.abs(x - c.end) > 1e-3) : [];
    let d = 0, moved = false, to, insert;
    const onMove = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      moved = true;
      d = ((ev.clientX - x0) / lane.width) * dur;
      let best = tol;
      for (const edge of mode === 'move' ? [b.at, b.end] : [mode === 'start' ? b.at : b.end]) for (const s of stops) { // a roll moves the end
        if (Math.abs(s - edge - d) < best) { best = Math.abs(s - edge - d); d = s - edge; }
      }
      // a clip dragged over another track's row, or the ruler's, lands there
      const row = mode === 'move' && li == null && document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tl-track');
      to = row && row !== home ? row.dataset.track ?? '' : undefined;
      if (cuts.length && to == null) {
        const p = ((ev.clientX - lane.left) / lane.width) * dur;
        d = ((ev.clientX - x0) / lane.width) * dur;
        insert = cuts.reduce((best, x) => (Math.abs(x - p) < Math.abs(best - p) ? x : best));
        return setDrag({ id: c.id, li, mode, d, insert });
      }
      insert = undefined;
      d = limit(mode, d, to != null, stretch);
      setDrag({ id: c.id, li, mode, d, to, next: next?.id, rate: stretch ? limit.rate(mode, d) : null, ghost: to != null && { at: b.at + d, end: b.end + d, text: labelOf(c) } });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      setDrag(null);
      if (!moved) onInspect(clicked);
      else if (insert != null) onMoveStretch(c, insert);
      else if (Math.abs(d) > 1e-3 || to != null) onRetime(c, li, mode, d, to, stretch);
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
  const [order, setOrder] = useState(null); // { name, before (the track it lands above; null: the bottom), group }
  const [picks, setPicks] = useState([]); // the picked tracks' names
  const [closed, setClosed] = useStored('ad-production-kit-studio:folded-groups', []); // groups folded into their row
  const fold = useLatest((g) => setClosed((c) => (c.includes(g) ? c.filter((x) => x !== g) : [...c, g])));
  const lift = useLatest((e, name, group) => {
    if (e.button !== 0 || e.target.closest('button, input')) return;
    e.preventDefault();
    const y0 = e.clientY;
    let before, moved = false;
    const onMove = (ev) => {
      if (!moved && Math.abs(ev.clientY - y0) < 4) return;
      moved = true;
      const row = [...scroller.current.querySelectorAll('.tl-track[data-row]')].find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
      before = row ? row.dataset.row : null;
      setOrder({ name, before, group });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      setOrder(null);
      if (!moved) { // a click picks the track (a group: its tracks)
        const names = group ? doc.tracks.filter((tr) => tr.group === name).map((tr) => tr.name) : [name], add = e.shiftKey || e.metaKey;
        return setPicks((p) => { const next = !add ? names : names.every((n) => p.includes(n)) ? p.filter((n) => !names.includes(n)) : [...p, ...names]; return shownTracks.map((tr) => tr.name).filter((n) => next.includes(n)); });
      }
      if (group) onOrderGroup(name, before);
      else if (before !== name) onOrder(name, before);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
  const shownTracks = doc.tracks.filter((tr) => tr.clips.length > 0);
  // The rows, top down: each group's folder row, then its tracks unless folded. row: the track a drop above it lands
  // above (a group's row: its first track, so its own first track shows no line); under: a group's first track.
  const rows = [];
  shownTracks.forEach((tr, k) => {
    const g = tr.group, first = g && shownTracks[k - 1]?.group !== g;
    if (first) rows.push({ group: g, row: tr.name, members: shownTracks.filter((x) => x.group === g) });
    if (!g || !closed.includes(g)) rows.push({ track: tr, i: doc.tracks.indexOf(tr), row: tr.name, under: first });
  });

  // A drag from an empty spot of the lanes draws a box and picks every block it touches (with Shift or ⌘, on top of the
  // picked ones); a click there lets go of them and moves the playhead to the skimmed moment.
  const [box, setBox] = useState(null);
  const lasso = (e) => {
    if (e.button !== 0 || !e.target.matches('.tl-lane:not(.tl-scrub)')) return;
    setPicks([]);
    const area = e.currentTarget, r0 = area.getBoundingClientRect(), x0 = e.clientX - r0.left, y0 = e.clientY - r0.top, at = skim;
    const lr = e.target.getBoundingClientRect(), track = e.target.closest('.tl-track')?.dataset.track, tAt = ((e.clientX - lr.left) / lr.width) * dur;
    const base = e.shiftKey || e.metaKey ? sel.split('|').filter(Boolean) : [];
    const byId = new Map(doc.tracks.flatMap((tr) => tr.clips.map((c) => [c.id, c])));
    const parse = (k) => { const i = k.lastIndexOf(':'), li = k.slice(i + 1); return { c: byId.get(k.slice(0, i)), li: li === '' ? null : Number(li) }; };
    let moved = false, got = 0, last = null; // how many it picks, and where it was let go (screen)
    const onMove = (ev) => {
      const r = area.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (!moved && Math.hypot(x - x0, y - y0) < 4) return;
      moved = true;
      const b = { left: Math.min(x, x0), top: Math.min(y, y0), right: Math.max(x, x0), bottom: Math.max(y, y0) };
      setBox(b);
      const hit = [...area.querySelectorAll('.tl-clip[data-key]')].filter((el) => {
        const c = el.getBoundingClientRect();
        return c.right - r.left > b.left && c.left - r.left < b.right && c.bottom - r.top > b.top && c.top - r.top < b.bottom;
      }).map((el) => el.dataset.key);
      const list = [...new Set([...base, ...hit])].map(parse).filter((p) => p.c);
      got = list.length;
      last = { rect: { left: r.left + b.left, right: r.left + b.right, top: r.top + b.top, bottom: r.top + b.bottom, width: b.right - b.left, height: b.bottom - b.top }, x: ev.clientX, side: 'above' };
      onSelectMany(list);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setBox(null);
      if (!moved) { onSelect(null); onGap(track, tAt); if (at != null) onSeek(at); }
      else if (got) onInspect(last); // the picked ones' settings, over the box
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const onGrab = useLatest(grab), mute = useLatest(onMute), remove = useLatest(onRemove), rename = useLatest(onRename), closeGap = useLatest(onCloseGap);
  const regroup = useLatest(() => { onGroup(picks); setPicks([]); }), ungroup = useLatest((names) => { onUngroup(names); const gone = new Set(names.map((n) => doc.tracks.find((x) => x.name === n)?.group)); setClosed((c) => c.filter((g) => !gone.has(g))); }), renameGroup = useLatest((g, to) => { onRenameGroup(g, to); setClosed((c) => c.map((x) => (x === g ? to : x))); });

  // The playhead, the skimmed moment and a stretch being picked: drawn over the tracks, and again in the ruler row,
  // which stays pinned on top as the tracks scroll under it.
  const marks = <>
    {range && <div className="tl-range" style={{ left: pct(range[0], dur), width: pct(range[1] - range[0], dur) }} />}
    {skim != null && <div className="tl-skim" style={{ left: pct(skim, dur) }} />}
    <div className="tl-head" style={{ left: pct(t, dur) }} />
    {drag?.insert != null && <div className="tl-insert" style={{ left: pct(drag.insert, dur) }} />}
  </>;

  return (
    <div className="tl" ref={scroller} style={{ '--tl-zoom': zoom }}>
      <div className="tl-in" onPointerMove={onSkimMove} onPointerLeave={() => skim != null && skimTo(null)} onPointerDown={lasso}>
      <div className="tl-track tl-track--head" data-drop={drag?.to === '' || undefined}>
        <div className="tl-name tl-transport">{children}</div>
        <div
          className="tl-lane tl-scrub"
          onPointerDown={(e) => {
            if (e.button !== 0 || e.target.closest('.tl-comment')) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            pick.current = picking ? snapped(e) : null; // commenting, a drag picks a stretch; else it scrubs
            onRange(null);
            onSeek(picking ? pick.current : scrubbed(e));
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
          {marks}
          {comments.filter((n) => n.to > n.t).map((n) => <span key={`${n.id}-span`} className="tl-span" data-status={n.status} style={{ left: pct(n.t, dur), width: pct(n.to - n.t, dur) }} />)}
          {comments.map((n) => (
            <button key={n.id} type="button" className="tl-comment" data-id={n.id} data-pop data-status={n.status} data-lit={n.id === lit || undefined} style={{ left: pct(n.t, dur) }} title={n.text} aria-label={n.text} onClick={(e) => onPick(n, e.currentTarget.getBoundingClientRect())} onPointerEnter={() => onHover(n.id)} onPointerLeave={() => onHover(null)}>{nums.get(n.id)}</button>
          ))}
        </div>
      </div>
      {rows.map((r, i) => {
        const over = !order ? undefined : order.before === r.row && !r.under ? 'top' : order.before == null && i === rows.length - 1 ? 'bottom' : undefined;
        if (r.group) return <GroupRow key={`g:${r.group}`} name={r.group} members={r.members} open={!closed.includes(r.group)} dur={dur} off={off} sel={sel} over={over} picked={r.members.every((m) => picks.includes(m.name))} onOpen={fold} onToggle={onToggle} onMute={mute} onRename={renameGroup} onUngroup={ungroup} onLift={lift} />;
        const tr = r.track, has = (x) => (x && tr.clips.some((c) => c.id === x.id) ? x : null);
        return <Track key={r.i} tr={tr} dur={dur} hide={off.has(tr.name)} onToggle={onToggle} onMute={mute} onRemove={remove} onRename={rename} onGrab={onGrab} sel={sel.split('|').filter((k) => tr.clips.some((c) => k.startsWith(`${c.id}:`))).join('|')} drag={has(drag)} ghost={drag?.to === tr.name ? drag.ghost : null} gap={gap?.track === tr.name ? gap.range : null} onCloseGap={closeGap} onLift={lift} over={over} member={!!tr.group} picked={picks.includes(tr.name)} onGroup={picks.length > 1 && picks[0] === tr.name && !picks.every((n) => tr.group && doc.tracks.find((x) => x.name === n)?.group === tr.group) ? regroup : undefined} url={url} lib={lib} />;
      })}
      <div className="tl-play">{marks}</div>
      {box && <div className="tl-box" style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }} />}
      </div>
    </div>
  );
}
