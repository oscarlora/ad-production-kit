'use client';
// Trim a media clip: drag the selection's edges or middle over the source's frames and waveform; letting go plays
// the new cut, and Apply writes it to the edit (the server keeps what follows in sync).
import { useEffect, useRef, useState } from 'react';
import { clock } from '../../lib/client/format.js';
import { IcPause, IcPlay } from '../icons.js';
import Film from '../Film.js';
import Wave from '../Wave.js';

const MIN = 0.1;

export default function Trim({ clip, src, saved, onApply, onClose }) {
  const mediaRef = useRef(null), barRef = useRef(null), stopAt = useRef(null);
  const [len, setLen] = useState(0); // the source's length (s)
  const out0 = clip.in + (clip.end - clip.at) * clip.rate;
  const [sel, setSel] = useState([clip.in, out0]);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const selRef = useRef(sel);
  selRef.current = sel;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const show = (t) => { const m = mediaRef.current; if (m) { m.pause(); setPlaying(false); m.currentTime = t; } };

  const drag = (mode) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const r = barRef.current.getBoundingClientRect(), x0 = e.clientX, [a0, b0] = sel;
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
      const [a, b] = selRef.current;
      playRange(mode === 'end' ? Math.max(a, b - 1.5) : a, b);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const playRange = (a, b) => {
    const m = mediaRef.current;
    if (!m) return;
    m.currentTime = a;
    stopAt.current = b;
    m.play().then(() => setPlaying(true)).catch(() => {});
  };
  const play = () => { if (playing) { mediaRef.current?.pause(); setPlaying(false); } else playRange(sel[0], sel[1]); };
  const onTime = () => { const m = mediaRef.current; if (stopAt.current != null && m.currentTime >= stopAt.current) { m.pause(); stopAt.current = null; setPlaying(false); } };

  const apply = () => {
    setBusy(true);
    onApply({ in: +sel[0].toFixed(3), dur: +((sel[1] - sel[0]) / clip.rate).toFixed(3) }).finally(() => setBusy(false));
  };

  const pct = (t) => `${(len ? t / len : 0) * 100}%`;
  const isVideo = clip.type === 'video';
  const changed = Math.abs(sel[0] - clip.in) > 1e-3 || Math.abs(sel[1] - out0) > 1e-3;
  return (
    <div className="trim" role="dialog" aria-label={`Trim ${clip.name || 'clip'}`}>
      <div className="trim__head">
        <span className="trim__name">{clip.name || clip.src.split('/').pop()}</span>
        <span className="trim__meta">
          {clock(sel[0], true)}–{clock(sel[1], true)} of {clock(len, true)} · {clock((sel[1] - sel[0]) / clip.rate, true)} on the timeline
        </span>
      </div>
      <div className="trim__body">
        {isVideo
          ? <video ref={mediaRef} className="trim__pic" src={src} preload="auto" playsInline muted={!!clip.mute} onLoadedMetadata={(e) => { setLen(e.currentTarget.duration); e.currentTarget.currentTime = sel[0]; }} onTimeUpdate={onTime} />
          : <audio ref={mediaRef} src={src} preload="auto" onLoadedMetadata={(e) => setLen(e.currentTarget.duration)} onTimeUpdate={onTime} />}
        <div className="trim__strip">
          <div className="trim__bar" ref={barRef} data-video={isVideo || undefined}>
            {isVideo && <Film className="trim__film" src={src} sprites={saved?.sprites} />}
            <Wave className="trim__wave" src={src} peaks={saved?.peaks} />
            <div className="trim__sel" style={{ left: pct(sel[0]), width: pct(sel[1] - sel[0]) }} onPointerDown={drag('move')} title="Drag to slide">
              <span className="trim__edge trim__edge--start" onPointerDown={drag('start')} title="Drag to change the start" />
              <span className="trim__edge trim__edge--end" onPointerDown={drag('end')} title="Drag to change the end" />
            </div>
          </div>
          <div className="trim__acts">
            <button type="button" className="btn btn--mini btn--icon" onClick={play} aria-label={playing ? 'Pause' : 'Play the selection'}>{playing ? <IcPause /> : <IcPlay />}</button>
            <div className="spacer" />
            <button type="button" className="btn btn--mini" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn--mini btn--primary" onClick={apply} disabled={!changed || busy || !len}>{busy ? 'Saving' : 'Apply'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
