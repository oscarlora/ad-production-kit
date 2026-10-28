'use client';
// A video's frames as a strip of tiles (each the frame's center, cropped to 3:5) across the canvas, redrawn on resize.
// Frames come from the library's sprite sheet when `sprites` is given ({ url, cols, rows, interval, dur }), else by
// seeking `src` in the browser (one shared video per file). `from`/`to` (seconds of the source) show only that stretch; by default the whole video.
import { useEffect, useRef } from 'react';

const sheets = new Map();
const sheet = (url) => {
  if (!sheets.has(url)) sheets.set(url, new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; }));
  return sheets.get(url);
};

// { dur, frame(t) → [image, sx, sy, sw, sh] (a promise) }; null when it can't load.
async function fromSheet(sp) {
  const img = await sheet(sp.url);
  const fw = img.naturalWidth / sp.cols, fh = img.naturalHeight / sp.rows, n = sp.cols * sp.rows;
  return {
    dur: sp.dur,
    frame: async (t) => { const i = Math.max(0, Math.min(n - 1, Math.round(t / (sp.interval || 1)))); return [img, (i % sp.cols) * fw, Math.floor(i / sp.cols) * fh, fw, fh]; },
  };
}
// Frames are read by seeking a hidden video, one file open at a time across every strip, let go of once reading
// stops: an open video holds one of the browser's 6 connections to Studio, and a timeline's worth of them stalls
// every other request (playback, the page's data). Each frame is kept as a small bitmap (a tile's width).
const TILE_W = 160;
let queue = Promise.resolve(), current = null, idle = 0;
const release = () => { if (current) { current.v.removeAttribute('src'); current.v.load(); current = null; } };
function withVideo(src, job) {
  const p = queue.then(async () => {
    clearTimeout(idle);
    if (current?.src !== src) {
      release();
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.src = src;
      current = { src, v };
      try { await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = no; }); } catch (e) { release(); throw e; }
    }
    return job(current.v);
  });
  queue = p.catch(() => {}).then(() => { idle = setTimeout(release, 1000); });
  return p;
}

const files = new Map();
function fromVideo(src) {
  if (!files.has(src)) {
    const frames = new Map();
    const frame = (t) => {
      const key = Math.round(t * 10);
      if (!frames.has(key)) {
        const job = withVideo(src, async (v) => {
          v.currentTime = Math.min(v.duration - 0.05, key / 10);
          await new Promise((ok) => { v.onseeked = ok; });
          const bm = await createImageBitmap(v, { resizeWidth: TILE_W, resizeHeight: Math.round((TILE_W * v.videoHeight) / v.videoWidth) });
          return [bm, 0, 0, bm.width, bm.height];
        });
        job.catch(() => frames.delete(key));
        frames.set(key, job);
      }
      return frames.get(key);
    };
    const p = withVideo(src, (v) => ({ dur: v.duration, frame }));
    p.catch(() => files.delete(src));
    files.set(src, p);
  }
  return files.get(src);
}

export default function Film({ src, sprites = null, from = 0, to = null, ...props }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    const source = (sprites ? fromSheet(sprites) : fromVideo(src)).catch(() => null);
    let run = 0, timer = 0;
    const draw = async () => {
      const me = ++run, s = await source;
      if (!s || me !== run) return;
      const k = window.devicePixelRatio || 1;
      cv.width = Math.max(1, Math.round(cv.clientWidth * k)); cv.height = Math.max(1, Math.round(cv.clientHeight * k));
      const th = cv.height, tw = Math.max(1, Math.round(th * 0.6)), n = Math.ceil(cv.width / tw), g = cv.getContext('2d');
      const b = to ?? s.dur;
      const shots = Array.from({ length: n }, (_, i) => s.frame(from + ((i * tw + tw / 2) / cv.width) * (b - from))); // queued together: one read of the file
      for (let i = 0; i < n; i++) {
        const [img, x, y, w, h] = await shots[i];
        if (me !== run) return;
        const sw = Math.min(w, h * 0.6), sh = sw / 0.6;
        g.drawImage(img, x + (w - sw) / 2, y + (h - sh) / 2, sw, sh, i * tw, 0, tw, th);
      }
    };
    const ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(draw, run ? 150 : 0); }); // fires once on start
    ro.observe(cv);
    return () => { run++; clearTimeout(timer); ro.disconnect(); };
  }, [src, sprites, from, to]);
  return <canvas ref={ref} aria-hidden="true" {...props} />;
}
