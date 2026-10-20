'use client';
// A sound's waveform, in the canvas's CSS color (played part, up to `progress` 0–1, in --fg). Peaks come from the
// library's `_catalog/peaks/<id>.json` when `peaks` names one, else from decoding `src` in the browser.
// `from`/`to` (seconds of the source) draw only that stretch (stored peaks need the source's `dur` for it); `bottom` grows the bars up from the bottom.
import { useEffect, useReducer, useRef, useState } from 'react';
import { soundUrl } from '../lib/client/api.js';

const RATE = 50; // decoded peaks per second
const cache = new Map();
const once = (key, load) => { if (!cache.has(key)) cache.set(key, load().catch(() => null)); return cache.get(key); };

// { peaks: 0–1, dur: seconds or null }, or null when there's nothing to draw.
const decode = (src) => once(src, async () => {
  const u = soundUrl(src);
  const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await (await fetch(u)).arrayBuffer());
  const lead = await (await import('../engine/media.js')).audioLead(u); // so peak times are file times
  const d = audio.getChannelData(0), step = Math.max(1, Math.floor(audio.sampleRate / RATE)), peaks = Array(Math.round(lead * RATE)).fill(0);
  for (let i = 0; i < d.length; i += step) {
    let m = 0;
    for (let j = i; j < i + step && j < d.length; j += 16) m = Math.max(m, Math.abs(d[j]));
    peaks.push(m);
  }
  const top = peaks.reduce((a, b) => Math.max(a, b), 0) || 1;
  return { peaks: peaks.map((p) => p / top), dur: audio.duration + lead };
});
const stored = (url) => once(url, async () => {
  const r = await fetch(url);
  const peaks = r.ok ? await r.json() : [];
  return peaks.length ? { peaks, dur: null } : null;
});
const load = async (src, peaks) => (peaks && (await stored(peaks))) || (src ? decode(src) : null);

// 2px bars with 1px gaps, each the loudest peak under it.
function draw(canvas, peaks, dur, from, to, bottom, progress) {
  const css = getComputedStyle(canvas), k = window.devicePixelRatio || 1;
  const w = (canvas.width = Math.max(1, Math.round(canvas.clientWidth * k)));
  const h = (canvas.height = Math.max(1, Math.round(canvas.clientHeight * k)));
  const g = canvas.getContext('2d');
  const per = dur ? peaks.length / dur : 0;
  const a = from && per ? from * per : 0, b = to != null && per ? to * per : peaks.length;
  const bar = 2 * k, step = 3 * k, n = Math.max(1, Math.floor(w / step));
  for (let x = 0; x < n; x++) {
    let m = 0;
    for (let i = Math.floor(a + (x / n) * (b - a)), e = Math.max(i + 1, Math.floor(a + ((x + 1) / n) * (b - a))); i < e; i++) m = Math.max(m, peaks[i] || 0);
    const bh = Math.max(k, m * h * (bottom ? 1 : 0.8));
    g.fillStyle = progress >= 0 && x / n <= progress ? css.getPropertyValue('--fg') : css.color;
    g.fillRect(x * step, bottom ? h - bh : (h - bh) / 2, bar, bh);
  }
}

export default function Wave({ src, peaks: peaksUrl, dur = null, from = 0, to = null, bottom = false, progress = -1, ...props }) {
  const ref = useRef(null);
  const [data, setData] = useState(null);
  const [resized, onResize] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    let dead = false;
    load(src, peaksUrl).then((d) => { if (!dead) setData(d); });
    return () => { dead = true; };
  }, [src, peaksUrl]);
  useEffect(() => {
    const ro = new ResizeObserver(onResize);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (data) draw(ref.current, data.peaks, data.dur || dur, from, to, bottom, progress); }, [data, dur, resized, from, to, bottom, progress]);
  return <canvas ref={ref} aria-hidden="true" {...props} />;
}
