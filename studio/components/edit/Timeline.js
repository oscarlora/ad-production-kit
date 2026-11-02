'use client';
// The edit's tracks over time: clips, video frames, sound waveforms, cuts with transitions, caption lines, volume moves, keyframes and comments.
// Click or drag along the ruler to move the playhead; drag above it to pick a stretch to comment on, its edges snapping
// to a block edge within SNAP px. With Shift held, the playhead and both edges jump to the nearest block edge.
// Clicking a media clip opens its trim panel. A track's eye hides its picture in the preview only; its speaker mutes or
// unmutes it in the edit. simple hides the tracks, leaving the ruler and comments. A track with no clips isn't shown.
import { memo, useMemo, useRef } from 'react';
import { hasSound, keyed, tin } from '../../engine/doc.js';
import { clock } from '../../lib/client/format.js';
import { IcEye, IcEyeOff, IcMute, IcSound } from '../icons.js';
import Film from '../Film.js';
import Wave from '../Wave.js';

const pct = (x, dur) => `${(x / dur) * 100}%`;
const base = (src) => String(src).split('/').pop().replace(/\.[^.]+$/, '');
// A text block shows its words (accent marks {…|color} dropped), anything else its name or file.
const labelOf = (c) => (c.type === 'text' ? String(c.text).replace(/\{([^}|]*)(\|[^}]*)?\}/g, '$1').replace(/\s*\n\s*/g, ' ') : c.name || (c.src ? base(c.src) : c.type === 'custom' ? [c.draw, c.n].filter((x) => x != null).join(' ') : c.type));
const SNAP = 8;
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

const Track = memo(function Track({ tr, dur, hide, onToggle, onMute, onClip, url, lib }) {
  const picture = tr.clips.some((c) => c.type !== 'audio'), sound = tr.clips.some(canSound);
  const mute = !!tr.mute || !tr.clips.some(hasSound);
  const hideLabel = `${hide ? 'Show' : 'Hide'} ${tr.name} (preview only)`, muteLabel = `${mute ? 'Unmute' : 'Mute'} ${tr.name}`;
  return (
    <div className="tl-track" data-video={tr.clips.some((c) => c.type === 'video') || undefined}>
      <div className="tl-name" title={tr.name}>
        {picture && <button type="button" className="tl-toggle" aria-pressed={!hide} aria-label={hideLabel} title={hideLabel} onClick={() => onToggle(tr.name)}>{hide ? <IcEyeOff /> : <IcEye />}</button>}
        {sound && <button type="button" className="tl-toggle" aria-pressed={!mute} aria-label={muteLabel} title={muteLabel} onClick={() => onMute(tr.name, !mute)}>{mute ? <IcMute /> : <IcSound />}</button>}
        {tr.name}
      </div>
      <div className="tl-lane" data-muted={tr.hidden || (mute && !picture) || undefined} data-silent={mute || undefined}>
        {tr.clips.map((c) => c.type === 'captions'
          ? (c.lines || []).map((l, i) => ( // one block per caption line
            <div key={`${c.id}-${i}`} className="tl-clip" data-type="captions" style={{ left: pct(l.at, dur), width: pct(l.end - l.at, dur) }}>
              <span className="tl-label">{l.text}</span>
              <Pop text={l.text} at={l.at} end={l.end} />
            </div>
          ))
          : (
          <div key={c.id} className="tl-clip" data-type={c.type} data-id={c.src ? c.id : undefined} onClick={c.src ? () => onClip(c.id) : undefined} style={{ left: pct(c.at, dur), width: pct(c.end - c.at, dur) }} title={c.type === 'text' ? undefined : `${labelOf(c)} · ${clock(c.at, true)}–${clock(c.end, true)}`}>
            {c.type === 'video' && c.src in lib && <Film className="tl-film" src={url(c.src)} sprites={lib[c.src]?.sprites} from={c.in} to={c.in + (c.end - c.at) * c.rate} />}
            {(c.type === 'audio' || c.type === 'video') && c.src in lib && <Wave className="tl-wave" src={url(c.src)} peaks={lib[c.src]?.peaks} dur={lib[c.src]?.dur} from={c.in} to={c.in + (c.end - c.at) * c.rate} bottom />}
            <span className="tl-label">{labelOf(c)}</span>
            {c.type === 'text' && <Pop text={labelOf(c)} at={c.at} end={c.end} />}
            {tin(c) > 0 && <span className="tl-tr" title={c.transition.type} />}
            {keyed(c.volume) && <Volume keys={c.volume.map(([k, v]) => [k - c.at, v])} dur={c.end - c.at} />}
          </div>
        ))}
        {tr.clips.flatMap((c) => keyTimes(c).map((k) => <span key={`${c.id}-${k}`} className="tl-key" style={{ left: pct(k, dur) }} />))}
        {keyed(tr.volume) && <Volume keys={tr.volume} dur={dur} />}
        {keyTimes({ ...tr.transform, grade: tr.grade }).map((k) => <span key={k} className="tl-key" style={{ left: pct(k, dur) }} />)}
      </div>
    </div>
  );
});

const rulerStep = (dur) => (dur > 120 ? 30 : dur > 40 ? 10 : dur > 15 ? 5 : 1);
function Ruler({ dur }) {
  const step = rulerStep(dur), marks = [];
  for (let s = 0; s < dur; s += step) marks.push(s);
  return (
    <div className="tl-ruler">
      {marks.map((s) => <span key={s} style={{ left: pct(s, dur) }}>{clock(s)}</span>)}
      {Array.from({ length: Math.ceil(dur) }, (_, s) => (s % step ? <i key={s} className="tl-tick" style={{ left: pct(s, dur) }} /> : null))}
    </div>
  );
}

// children: the transport (play and time), in the corner above the track names.
// range: the stretch being picked, [from, to]; onRange(range, done) reports it as it's dragged and when let go.
export default function Timeline({ doc, t, comments, nums, lib, lit, range, onRange, onSeek, onPick, onHover, off, onToggle, onMute, onClip, url, simple, children }) {
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
  return (
    <div className="tl">
      <div className="tl-track tl-track--head">
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
          <Ruler dur={dur} />
          {comments.filter((n) => n.to > n.t).map((n) => <span key={`${n.id}-span`} className="tl-span" data-status={n.status} style={{ left: pct(n.t, dur), width: pct(n.to - n.t, dur) }} />)}
          {comments.map((n) => (
            <button key={n.id} type="button" className="tl-comment" data-status={n.status} data-lit={n.id === lit || undefined} style={{ left: pct(n.t, dur) }} title={n.text} aria-label={n.text} onClick={() => onPick(n)} onPointerEnter={() => onHover(n.id)} onPointerLeave={() => onHover(null)}>{nums.get(n.id)}</button>
          ))}
        </div>
      </div>
      {!simple && doc.tracks.map((tr, i) => tr.clips.length > 0 && <Track key={i} tr={tr} dur={dur} hide={off.has(tr.name)} onToggle={onToggle} onMute={onMute} onClip={onClip} url={url} lib={lib} />)}
      <div className="tl-play">
        {range && <div className="tl-range" style={{ left: pct(range[0], dur), width: pct(range[1] - range[0], dur) }} />}
        <div className="tl-head" style={{ left: pct(t, dur) }} />
      </div>
    </div>
  );
}
