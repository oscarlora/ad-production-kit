'use client';
// The part of its source a media clip plays, in the inspector: the whole source as two strips (frames, waveform) with
// the part it plays as a selection over both to drag (its edges, or its middle to slide). A video's picture above them
// shows the frame under the edge being dragged, and the part as it plays (looping, at the clip's speed). Letting go
// saves the new cut (onApply({ in, dur }): the server keeps what follows in sync) and plays it.
import { useEffect, useRef, useState } from 'react';
import { clock } from '../../lib/client/format.js';
import { IcPause, IcPlay } from '../icons.js';
import Film from '../Film.js';
import Wave from '../Wave.js';

const MIN = 0.1;

export default function Trim({ clip, src, saved, onApply }) {
  const mediaRef = useRef(null), barRef = useRef(null), loop = useRef(null), held = useRef(false);
  const [len, setLen] = useState(0); // the source's length (s)
  const out0 = clip.in + (clip.end - clip.at) * clip.rate;
  const [sel, setSel] = useState([clip.in, out0]);
  const [playing, setPlaying] = useState(false);
  const selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => { if (!held.current) setSel([clip.in, out0]); }, [clip.in, out0]); // changed elsewhere (a trim on the timeline, undo)

  // Plays from `from` to b, then loops a–b, until paused.
  const playRange = (a, b, from = a) => {
    const m = mediaRef.current;
    if (!m) return;
    m.playbackRate = clip.rate || 1;
    m.currentTime = from;
    loop.current = [a, b];
    m.play().then(() => setPlaying(true)).catch(() => {});
  };
  const show = (t) => { const m = mediaRef.current; if (m) { m.pause(); m.currentTime = t; } };
  const drag = (mode) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const r = barRef.current.getBoundingClientRect(), x0 = e.clientX, [a0, b0] = sel;
    held.current = true;
    mediaRef.current?.pause();
    const onMove = (ev) => {
      const dt = ((ev.clientX - x0) / r.width) * len;
      let a = a0, b = b0;
      if (mode === 'start') a = Math.min(Math.max(0, a0 + dt), b0 - MIN);
      if (mode === 'end') b = Math.max(Math.min(len, b0 + dt), a0 + MIN);
      if (mode === 'move') { const d = Math.min(Math.max(dt, -a0), len - b0); a = a0 + d; b = b0 + d; }
      setSel([a, b]);
      show(mode === 'end' ? b : a);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      held.current = false;
      const [a, b] = selRef.current;
      if (Math.abs(a - a0) < 1e-3 && Math.abs(b - b0) < 1e-3) return;
      onApply({ in: +a.toFixed(3), dur: +((b - a) / clip.rate).toFixed(3) });
      playRange(a, b, mode === 'end' ? Math.max(a, b - 1.5) : a);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const play = () => { if (playing) { mediaRef.current?.pause(); setPlaying(false); } else playRange(sel[0], sel[1]); };
  const onTime = () => { const m = mediaRef.current, l = loop.current; if (l && !m.paused && m.currentTime >= l[1]) m.currentTime = l[0]; };

  const pct = (t) => `${(len ? t / len : 0) * 100}%`;
  const isVideo = clip.type === 'video';
  return (
    <div className="trim insp__wide">
      {isVideo
        ? <video ref={mediaRef} className="trim__pic" src={src} preload="auto" playsInline muted={!!clip.mute} onLoadedMetadata={(e) => { setLen(e.currentTarget.duration); e.currentTarget.currentTime = sel[0]; }} onTimeUpdate={onTime} onPause={() => setPlaying(false)} />
        : <audio ref={mediaRef} src={src} preload="auto" onLoadedMetadata={(e) => setLen(e.currentTarget.duration)} onTimeUpdate={onTime} onPause={() => setPlaying(false)} />}
      <div className="trim__bar" ref={barRef} data-video={isVideo || undefined}>
        {isVideo && <Film className="trim__film" src={src} sprites={saved?.sprites} />}
        <Wave className="trim__wave" src={src} peaks={saved?.peaks} />
        {len > 0 && (
          <div className="trim__sel" style={{ left: pct(sel[0]), width: pct(sel[1] - sel[0]) }} onPointerDown={drag('move')} title="Drag to slide">
            <span className="trim__edge trim__edge--start" onPointerDown={drag('start')} title="Drag to change where it starts" />
            <span className="trim__edge trim__edge--end" onPointerDown={drag('end')} title="Drag to change where it ends" />
          </div>
        )}
      </div>
      <div className="trim__row">
        <button type="button" className="btn btn--mini btn--icon" onClick={play} aria-label={playing ? 'Pause' : 'Play this part'}>{playing ? <IcPause /> : <IcPlay />}</button>
        <span className="trim__meta">{clock(sel[0], true)}–{clock(sel[1], true)} of {clock(len, true)}</span>
      </div>
    </div>
  );
}
