// Media access: frame-exact video decode (WebCodecs via mediabunny), images, decoded audio, fonts.
import { ALL_FORMATS, Input, UrlSource, VideoSampleSink } from 'mediabunny';

const EPS = 1e-6;

// Sequential frames for one clip: an open decode iterator walked forward, restarted on a backward or long jump.
class Cursor {
  constructor(sink) { this.sink = sink; this.it = null; this.cur = null; this.done = false; }
  async at(ts) {
    ts += EPS;
    const c = this.cur;
    if (!this.it || !c || ts < c.timestamp || ts > c.timestamp + 1.5) await this.reset(ts);
    while (this.cur && !this.done && ts >= this.cur.timestamp + this.cur.duration) {
      const n = await this.it.next();
      if (n.done) { this.done = true; break; }
      this.cur.close();
      this.cur = n.value;
    }
    return this.cur;
  }
  async reset(ts) {
    await this.release();
    this.it = this.sink.samples(Math.max(0, ts));
    const n = await this.it.next();
    this.cur = n.done ? await this.sink.getSample(ts) : n.value; // past the end: the last frame
    this.done = n.done;
  }
  async release() {
    await this.it?.return();
    this.it = null;
    this.cur?.close();
    this.cur = null;
    this.done = false;
  }
}

export class Media {
  // url(src) -> fetchable URL of a doc path; caches key on url(src), which carries the file's version.
  constructor(url) {
    this.url = url;
    this.videos = new Map(); // url -> Promise<{ track, half, duration }>
    this.cursors = new Map(); // clip id -> Cursor
    this.queue = new Map(); // clip id -> its last pending decode
    this.images = new Map();
    this.audio = new Map();
    this.used = new Set();
    this.errors = [];
  }

  video(src) {
    const key = this.url(src);
    if (!this.videos.has(key)) {
      const p = (async () => {
        const input = new Input({ source: new UrlSource(key), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error(`${src}: no video track`);
        const { averagePacketRate } = await track.computePacketStats(48);
        return { track, half: 0.5 / averagePacketRate, duration: await input.computeDuration() };
      })();
      p.catch(() => this.videos.delete(key));
      this.videos.set(key, p);
    }
    return this.videos.get(key);
  }

  // The frame a clip shows at source time ts (nearest frame). One call per clip at a time (a clip's decoder is
  // sequential), so calls queue per id.
  frame(id, src, ts) {
    this.used.add(id);
    const run = (this.queue.get(id) || Promise.resolve()).then(() => this.decode(id, src, ts));
    this.queue.set(id, run.catch(() => {}));
    return run;
  }

  // Decoders can fail transiently: retry, then fall back to software decoding.
  async decode(id, src, ts, attempt = 0) {
    const { track, half, duration } = await this.video(src);
    const key = this.url(src);
    let c = this.cursors.get(id);
    if (c && c.key !== key) { this.cursors.delete(id); await c.release().catch(() => {}); c = null; } // the file changed
    if (!c) {
      c = new Cursor(new VideoSampleSink(track, attempt >= 2 ? { hardwareAcceleration: 'prefer-software' } : {}));
      c.key = key;
      this.cursors.set(id, c);
    }
    try {
      return await c.at(Math.min(Math.max(0, ts) + half, duration - half));
    } catch (e) {
      this.errors.push(`${src} @${ts.toFixed(3)}s: ${e.message}`);
      await c.release().catch(() => {});
      this.cursors.delete(id);
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
      return this.decode(id, src, ts, attempt + 1);
    }
  }

  // Free the decoders no clip used since the last call.
  async sweep() {
    for (const [id, c] of this.cursors) if (!this.used.has(id)) { this.cursors.delete(id); this.queue.delete(id); await c.release(); }
    this.used.clear();
  }

  image(src) {
    const key = this.url(src);
    if (!this.images.has(key)) {
      const p = fetch(key).then((r) => { if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`); return r.blob(); }).then(createImageBitmap);
      p.catch(() => this.images.delete(key));
      this.images.set(key, p);
    }
    return this.images.get(key);
  }

  // Decoded sound of a file (an audio file or a video's track), shared by preview and export. At a rate other
  // than 1 it's the server's pitch-kept copy at that speed (tempo=), so source time t sits at t / rate.
  sound(src, ctx, rate = 1) {
    const u = this.url(src), key = rate === 1 ? u : `${u}${u.includes('?') ? '&' : '?'}tempo=${rate}`;
    if (!this.audio.has(key)) {
      const p = (async () => {
        const r = await fetch(key);
        if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
        const buf = await ctx.decodeAudioData(await r.arrayBuffer()).catch(() => null);
        if (!buf) return null; // a video without sound plays silent
        // Pad the lead decodeAudioData drops, so buffer time = file time, like the video frames.
        const lead = Math.round((await audioLead(key)) * buf.sampleRate);
        if (lead < buf.sampleRate / 100) return buf;
        const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: buf.length + lead, sampleRate: buf.sampleRate });
        for (let ch = 0; ch < buf.numberOfChannels; ch++) out.copyToChannel(buf.getChannelData(ch), ch, lead);
        return out;
      })().catch(() => { this.audio.delete(key); return undefined; }); // a failed fetch: undefined, retried next time
      this.audio.set(key, p);
    }
    return this.audio.get(key);
  }

  // Source durations of every media clip, for clips without an end.
  async durations(doc) {
    const out = new Map();
    await Promise.all(doc.tracks.flatMap((tr) => tr.clips).filter((c) => c.end == null && c.src).map(async (c) => {
      if (c.type === 'video') out.set(c.src, (await this.video(c.src)).duration);
      else if (c.type === 'audio') out.set(c.src, (await this.sound(c.src, new OfflineAudioContext(1, 1, 48000)))?.duration);
    }));
    return out;
  }

  async close() {
    await Promise.all([...this.cursors.values()].map((c) => c.release()));
    this.cursors.clear();
  }
}

// Families the doc uses: doc.fonts maps a family to a font file; any other loads from Google Fonts by name.
// Where a file's sound starts on its own clock (s). decodeAudioData drops it, and a video's audio often starts
// ~0.5 s after its first frame.
export const audioLead = async (url) => Math.max(0, (await new Input({ source: new UrlSource(url), formats: ALL_FORMATS })
  .getPrimaryAudioTrack().then((t) => t?.getFirstTimestamp()).catch(() => 0)) || 0);

export async function loadFonts(doc, url) {
  if (typeof document === 'undefined') return;
  const fams = new Map(); // family -> weights
  const add = (st) => { if (st?.font) fams.set(st.font, new Set([...(fams.get(st.font) || []), st.weight || 400])); };
  for (const tr of doc.tracks) for (const c of tr.clips) { add(c.style); add(c.active && { font: c.style?.font, ...c.active }); }
  await Promise.all([...fams].map(async ([fam, weights]) => {
    const file = doc.fonts?.[fam];
    if (file) {
      const face = new FontFace(fam, `url("${url(file)}")`);
      document.fonts.add(await face.load());
      return;
    }
    if ([...document.fonts].some((f) => f.family.replace(/"/g, '') === fam)) return; // loaded before
    const q = encodeURIComponent(fam).replace(/%20/g, '+');
    let css = '';
    for (const spec of [`${q}:wght@${[...weights].sort((a, b) => a - b).join(';')}`, q]) {
      const r = await fetch(`https://fonts.googleapis.com/css2?family=${spec}&display=block`).catch(() => null);
      if (r?.ok) { css = await r.text(); break; }
    }
    if (!css) return; // an installed font, or the browser's fallback
    const el = document.createElement('style');
    el.textContent = css;
    document.head.append(el);
    await Promise.all([...weights].map((w) => document.fonts.load(`${w} 64px "${fam}"`)));
  }));
}
