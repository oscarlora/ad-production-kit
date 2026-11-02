// Sound: one mixing graph for preview (AudioContext) and export (OfflineAudioContext), so both hear the same mix.
// Per clip: volume (dB, keyframable), fadeIn/fadeOut (s), loop · per track: volume (dB, keyframable), mute ·
// master: loudness target (LUFS, default -14) and a limiter.
import { hasSound, keyed, val } from './doc.js';

const db = (x) => 10 ** (x / 20);
const STEP = 1 / 50; // automation resolution, s

// Drive param from fn(t) over timeline [a, b), starting at context time `when` (timeline a).
function automate(param, fn, a, b, when, keyedValue) {
  if (!keyedValue) { param.value = fn(a); return; }
  const n = Math.max(2, Math.ceil((b - a) / STEP) + 1);
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = fn(a + ((b - a) * i) / (n - 1));
  param.setValueCurveAtTime(curve, when, Math.max(STEP, b - a));
}

// A clip's beats, { name: [t (s into the clip), sound, dB?] }, play doc.sounds[sound] (a path, or { src, volume, dur })
// on its track from where the sound first gets loud, so the hit lands on the beat; fx layers read the same times.
const beatClips = (doc, tr) => tr.clips.flatMap((c) => Object.entries(c.beats || {}).flatMap(([name, [t, s, volume = 0]]) => {
  const def = s && doc.sounds?.[s], snd = typeof def === 'string' ? { src: def } : def;
  if (!snd?.src) return [];
  const at = c.at + t;
  return [{ id: `${c.id}~${name}`, type: 'audio', src: snd.src, at, end: at + (snd.dur ?? 30), in: 0, rate: 1, volume: (snd.volume ?? 0) + volume, fadeOut: snd.dur ? 0.1 : 0, track: tr, onset: true }];
}));
const onsets = new WeakMap();
function onsetOf(buf) {
  if (!onsets.has(buf)) {
    const x = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
    const i = x.findIndex((v) => Math.abs(v) > peak * 0.1);
    onsets.set(buf, Math.max(0, i - buf.sampleRate * 0.005) / buf.sampleRate); // 5 ms before, to keep the attack
  }
  return onsets.get(buf);
}

// Clips that sound, with their decoded buffers; `incomplete` when a file failed to load (worth another try).
export async function soundClips(doc, media, ctx) {
  const clips = doc.tracks.filter((tr) => !tr.mute).flatMap((tr) => [...tr.clips.filter(hasSound), ...beatClips(doc, tr)]);
  const bufs = await Promise.all(clips.map((c) => media.sound(c.src, ctx, c.rate)));
  clips.forEach((c, i) => { if (c.onset && bufs[i]) c.in = onsetOf(bufs[i]); });
  const out = clips.map((c, i) => ({ c, buf: bufs[i] })).filter((x) => x.buf);
  out.incomplete = bufs.includes(undefined);
  return out;
}

// Schedule the mix of timeline [from, to) on ctx, starting at ctx time `when`. Returns the source nodes (to stop).
export function schedule(ctx, doc, sounds, { from = 0, to = doc.duration, when = ctx.currentTime, gain = 1 } = {}) {
  const master = ctx.createGain();
  master.gain.value = gain;
  const limiter = ctx.createDynamicsCompressor();
  for (const [k, v] of [['threshold', -1.5], ['knee', 0], ['ratio', 20], ['attack', 0.002], ['release', 0.1]]) limiter[k].value = v;
  master.connect(limiter).connect(ctx.destination);
  const buses = new Map();
  const bus = (tr) => {
    if (!buses.has(tr)) {
      const g = ctx.createGain();
      automate(g.gain, (t) => db(val(tr.volume, t, 0)), from, to, when, keyed(tr.volume));
      g.connect(master);
      buses.set(tr, g);
    }
    return buses.get(tr);
  };
  const nodes = [];
  for (const { c, buf } of sounds) {
    const a = Math.max(c.at, from), b = Math.min(c.end, to);
    if (b <= a) continue;
    // buf is the source already at the clip's speed (media.sound), so source time t sits at t / rate.
    const in0 = c.in / c.rate;
    let offset = in0 + (a - c.at);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (c.loop) { // repeats its source from `in` to the end until the clip ends
      src.loop = true;
      src.loopStart = in0;
      src.loopEnd = buf.duration;
      offset = in0 + ((offset - in0) % (buf.duration - in0));
    } else if (offset >= buf.duration) continue;
    const g = ctx.createGain();
    const fi = c.fadeIn || 0, fo = c.fadeOut || 0;
    const env = (t) => db(val(c.volume, t, 0)) * (fi ? Math.min(1, (t - c.at) / fi) : 1) * (fo ? Math.min(1, (c.end - t) / fo) : 1);
    automate(g.gain, env, a, b, when + (a - from), keyed(c.volume) || fi > 0 || fo > 0);
    src.connect(g).connect(bus(c.track));
    src.start(when + (a - from), offset, b - a);
    nodes.push(src);
  }
  return nodes;
}

// The full mix, rendered offline.
export async function mixdown(doc, sounds, gain = 1, sampleRate = 48000) {
  const len = Math.max(1, Math.round(doc.duration * sampleRate));
  const ctx = new OfflineAudioContext(2, len, sampleRate);
  schedule(ctx, doc, sounds, { when: 0, gain });
  return ctx.startRendering();
}

// ITU-R BS.1770 integrated loudness (LUFS) of a 48 kHz buffer: K-weighting, 400 ms blocks, gating.
function loudness(buf) {
  const k = [[1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585],
    [1, -2, 1, -1.99004745483398, 0.99007225036621]];
  const chans = [];
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    let x = buf.getChannelData(ch);
    for (const [b0, b1, b2, a1, a2] of k) {
      const y = new Float32Array(x.length);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < x.length; i++) {
        const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
      }
      x = y;
    }
    chans.push(x);
  }
  const size = Math.round(0.4 * buf.sampleRate), hop = Math.round(0.1 * buf.sampleRate);
  const blocks = [];
  for (let s = 0; s + size <= buf.length; s += hop) {
    let z = 0;
    for (const x of chans) { let m = 0; for (let i = s; i < s + size; i++) m += x[i] * x[i]; z += m / size; }
    blocks.push(z);
  }
  const L = (z) => -0.691 + 10 * Math.log10(z);
  const abs = blocks.filter((z) => L(z) > -70);
  if (!abs.length) return -Infinity;
  const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((z) => L(z) > rel);
  return L(gated.reduce((a, b) => a + b, 0) / gated.length);
}

// Brickwall limiter with 5 ms lookahead and 80 ms release: no sample above the ceiling (dBFS).
export function limit(buf, ceiling = -1.6) {
  const c = db(ceiling), n = buf.length, look = Math.round(0.005 * buf.sampleRate), rel = Math.exp(-1 / (0.08 * buf.sampleRate));
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const need = new Float32Array(n).fill(1);
  for (let i = 0; i < n; i++) { let m = 0; for (const x of chans) m = Math.max(m, Math.abs(x[i])); if (m > c) need[i] = c / m; }
  const env = new Float32Array(n);
  const q = []; // sliding minimum of need[j .. j + look]
  let g = 1, head = 0;
  for (let i = 0; i < n + look; i++) {
    if (i < n) { while (q.length > head && need[q[q.length - 1]] >= need[i]) q.pop(); q.push(i); }
    const j = i - look;
    if (j < 0) continue;
    while (q[head] < j) head++;
    env[j] = need[q[head]];
  }
  const att = Math.exp(-5 / look); // reaches the target within the lookahead, before the peak
  for (let i = 0; i < n; i++) { g = env[i] + (g - env[i]) * (env[i] < g ? att : rel); for (const x of chans) x[i] *= g; }
  return buf;
}

// Gain that brings the mix to the doc's loudness target (doc.loudness, default -14 LUFS; null = leave as is).
export async function normalizeGain(doc, sounds) {
  const target = doc.loudness === undefined ? -14 : doc.loudness;
  if (target == null || !sounds.length) return 1;
  const lufs = loudness(await mixdown(doc, sounds, 1));
  return Number.isFinite(lufs) ? db(target - lufs) : 1;
}
