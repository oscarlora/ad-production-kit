// The edit engine: one drawing and mixing path for Studio's preview and the headless export (tools/edit-video.mjs).
import { AudioBufferSource, CanvasSource, Mp4OutputFormat, Output, Quality, StreamTarget, canEncodeAudio, canEncodeVideo } from 'mediabunny';
import { limit, mixdown, normalizeGain, schedule, soundClips } from './audio.js';
import { normalize, settle } from './doc.js';
import { drawFrame, needs } from './draw.js';
import { Grader } from './grade.js';
import { Media, loadFonts } from './media.js';
import { mgKit } from './mg.js';
import { motionKit } from './motion.js';

// canvas: where frames are drawn (its width sets the scale). url(src): fetchable URL of a doc path.
// load(doc, fxUrl): fxUrl is the URL of the doc's fx module (custom layers, transitions, animations), if any.
// light (Studio's preview): sound decoded mono at 24 kHz, a quarter of the memory; exports keep 48 kHz stereo.
export async function createEngine({ canvas, url, light = false }) {
  const ctx = canvas.getContext('2d');
  const media = new Media(url, { mono: light });
  const decodeAt = () => new OfflineAudioContext(2, 1, light ? 24000 : 48000);
  let grader = null;
  let doc = null, env = null, sounds = null, gain = 1, audioKey = '';
  let chain = Promise.resolve();

  async function load(raw, fxUrl) {
    const d = normalize(raw);
    settle(d, await media.durations(d));
    await loadFonts(d, url);
    const fx = fxUrl ? await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ fxUrl).catch((e) => { media.errors.push(`fx: ${e.message}`); return null; }) : null;
    grader ??= new Grader();
    doc = d;
    env?.motion.dispose();
    env = { W: d.W, H: d.H, fps: d.fps, k: canvas.width / d.W, cw: canvas.width, ch: canvas.height, grader, fx, scratch: {}, motion: motionKit(), mg: mgKit() };
    const key = JSON.stringify([d.loudness, d.sounds, d.tracks.map((tr) => [tr.mute, tr.volume, tr.clips.map((c) => [c.type, c.src && url(c.src), c.at, c.end, c.in, c.rate, c.mute, c.volume, c.fadeIn, c.fadeOut, c.loop, c.beats])])]);
    if (key !== audioKey) { sounds = null; audioKey = key; audio().catch(() => {}); } // decode ahead of play
    return d;
  }

  // Decoded sounds and the loudness gain, once per change to what is heard.
  let pending = null;
  function audio() {
    if (sounds) return Promise.resolve(sounds);
    const key = audioKey;
    pending = pending?.key === key ? pending : { key, p: (async () => {
      const s = await soundClips(doc, media, decodeAt());
      const g = await normalizeGain(doc, s);
      if (key === audioKey) { gain = g; if (!s.incomplete) sounds = s; }
      if (s.incomplete) pending = null; // a file failed to load: try again on the next play
      return s;
    })() };
    return pending.p;
  }

  // Draw time t. Serialized: decode every frame the moment needs, then draw in one go. ahead (s): also start
  // decoding the clips that begin within that time (playback).
  function render(t, ahead = 0) {
    const run = chain.then(async () => {
      const frames = new Map();
      for (const { c, ts, soon } of needs(doc, t, ahead)) {
        if (soon) { (c.type === 'image' ? media.image(c.src) : media.frame(c.id, c.src, ts)).catch(() => {}); continue; }
        frames.set(c.id, c.type === 'image' ? await media.image(c.src) : await media.frame(c.id, c.src, ts));
      }
      drawFrame(ctx, doc, t, frames, env);
      await media.sweep();
    });
    chain = run.catch(() => {});
    return run;
  }

  // Start the mix at timeline t on a live AudioContext: { at (the context time it starts), stop }.
  async function play(actx, t) {
    const s = await audio();
    const at = actx.currentTime + 0.05;
    const nodes = schedule(actx, doc, s, { from: t, when: at, gain });
    return { at, stop: () => nodes.forEach((n) => { try { n.stop(); } catch {} }) };
  }

  // After the canvas changes size: draw at its new resolution.
  function resize() {
    if (env) Object.assign(env, { k: canvas.width / doc.W, cw: canvas.width, ch: canvas.height, scratch: {} });
  }

  return {
    load, render, play, resize,
    get doc() { return doc; },
    errors: media.errors,
    async mix() { await audio(); return limit(await mixdown(doc, sounds, gain)); },
    close: () => { env?.motion.dispose(); return media.close(); },
  };
}

// MP4 export: H.264 + AAC, streamed out through write(data, position) (later writes patch earlier bytes).
export async function exportVideo({ engine, canvas, from = 0, to, bitrate = 12e6, onProgress, write }) {
  const doc = engine.doc, fps = doc.fps;
  to ??= doc.duration;
  if (!(await canEncodeVideo('avc', { width: canvas.width, height: canvas.height, bitrate }))) throw new Error('this browser cannot encode H.264');
  if (!(await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: 192e3 }))) { // e.g. Chromium on Linux
    (await import('@mediabunny/aac-encoder')).registerAacEncoder();
  }
  const target = new StreamTarget(new WritableStream({ write: (c) => write(c.data, c.position) }), { chunked: true });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
  const video = new CanvasSource(canvas, { codec: 'avc', quality: new Quality({ bitrate }), keyFrameInterval: 2 });
  const sound = new AudioBufferSource({ codec: 'aac', quality: new Quality({ bitrate: 192e3 }) });
  output.addVideoTrack(video, { frameRate: fps });
  output.addAudioTrack(sound);
  await output.start();
  await sound.add(slice(await engine.mix(), from, to));
  sound.close();
  const first = Math.round(from * fps), last = Math.round(to * fps);
  for (let f = first; f < last; f++) {
    await engine.render(f / fps);
    await video.add((f - first) / fps, 1 / fps);
    if (onProgress && f % 15 === 0) onProgress((f - first) / (last - first));
  }
  video.close();
  await output.finalize();
}

function slice(buf, a, b) {
  const s = Math.round(a * buf.sampleRate), e = Math.min(buf.length, Math.round(b * buf.sampleRate));
  if (s === 0 && e >= buf.length) return buf;
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: Math.max(1, e - s), sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(s, e), c);
  return out;
}
