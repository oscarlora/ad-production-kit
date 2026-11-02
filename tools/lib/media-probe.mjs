// media-probe.mjs — catalog-media's probe step (library only): hash new files, skip exact and
// near-duplicates, allocate ids, extract technical fields, make derivatives, place each original into
// media/ and write its skeleton record. analyze-media fills the descriptions.
//
// Images use `sips` on macOS, ffmpeg elsewhere; video/audio use ffmpeg. A missing tool still yields a
// record, without derivatives. A video is decoded once (videoPass), on VideoToolbox where possible; at
// most MEDIA_JOBS videos (default 2) are worked at once.
// Near-duplicates (re-exports) are skipped conservatively:
//   image — perceptual hash close in any rotation AND the pixels match.
//   video — duration within 0.05 s AND (same original name, or matching frame hashes).
//
// Derivatives (keyed by id, under _catalog/):
//   image → thumbs/<id>.jpg (~400px)  proxies/<id>.jpg (~1536px, what Gemini analyzes)
//   video → thumbs/<id>.jpg (poster)  keyframes/<id>_NN.jpg (one per scene)  sprites/<id>.jpg
//   audio → peaks/<id>.json (waveform)
import { statSync, writeFileSync, existsSync, copyFileSync, readdirSync, readFileSync, mkdirSync, mkdtempSync, rmSync, renameSync, constants } from 'node:fs';
import { join, basename, extname, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { catalogPaths, ensureDirs, typeOf, mimeOf, hashFile, readRecords, writeRecord, mergeRecord, isMedia, slugify, have, run, runAsync, ffprobeJson, imageFitCmd, pcm, round, FFMPEG_FIX } from './catalog.mjs';
import { readDriveSources } from './drive.mjs';
import { INLINE_MAX } from './analyze.mjs';

const HAS_FFMPEG = have('ffmpeg') && have('ffprobe');
const HAS_SIPS = have('sips');
const RESERVED = new Set(['brand', '_catalog']); // folders the catalog never reads (see lib/catalog.mjs)

// ---------- heavy-work pool + hardware decoding ----------
const jobLimit = () => Math.max(1, parseInt(process.env.MEDIA_JOBS, 10) || 2);
let active = 0;
const waiting = [];
// At most MEDIA_JOBS heavy video jobs at once, shared by probe and analyze.
export async function heavy(fn) {
  if (active < jobLimit()) active++; else await new Promise((r) => waiting.push(r));
  try { return await fn(); } finally { const next = waiting.shift(); if (next) next(); else active--; }
}

let VT = null;
const hasVT = () => (VT ??= process.platform === 'darwin' && HAS_FFMPEG && /videotoolbox/.test(run('ffmpeg', ['-hide_banner', '-hwaccels'], { allowFail: true }).stdout || ''));
const HW = ['-hwaccel', 'videotoolbox'];
// One frame at t s; `post` = the ffmpeg args after the input. Returns run()'s result, or null.
function grab(file, t, post, opts = {}) {
  for (const hw of hasVT() ? [HW, []] : [[]]) {
    const r = run('ffmpeg', ['-y', '-v', 'error', ...hw, '-ss', String(t), '-i', file, '-frames:v', '1', ...post], { allowFail: true, ...opts });
    if (r.status === 0) return r;
  }
  return null;
}

// ---------- image (sips on macOS, ffmpeg elsewhere) ----------
function imageDims(file) {
  if (HAS_SIPS) {
    const r = run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { allowFail: true });
    return { width: +(r.stdout?.match(/pixelWidth:\s*(\d+)/)?.[1] || 0), height: +(r.stdout?.match(/pixelHeight:\s*(\d+)/)?.[1] || 0) };
  }
  const v = (ffprobeJson(file).streams || []).find((s) => s.codec_type === 'video') || {}; // ffprobe reports a still image as one video stream
  return { width: +v.width || 0, height: +v.height || 0 };
}
function imageFit(file, px, out) {
  const [bin, args] = imageFitCmd(file, px, out);
  run(bin, args, { allowFail: true });
  return existsSync(out);
}
function imageDerivatives(file, paths, id) {
  imageFit(file, 400, join(paths.thumbs, `${id}.jpg`));
  return imageFit(file, 1536, join(paths.proxies, `${id}.jpg`));
}

// ---------- video (ffmpeg) ----------
// Display size with rotation applied (iPhone clips are stored landscape with a rotate flag).
export function videoMeta(file) {
  const p = ffprobeJson(file);
  const v = (p.streams || []).find((s) => s.codec_type === 'video') || {};
  const flag = (v.side_data_list || []).find((d) => d.rotation != null)?.rotation ?? -(+v.tags?.rotate || 0);
  const rot = ((-flag % 360) + 360) % 360; // clockwise turn needed for display
  const turned = rot === 90 || rot === 270, exact = +p.format?.duration || 0;
  return {
    width: +(turned ? v.height : v.width) || 0, height: +(turned ? v.width : v.height) || 0,
    duration: exact ? round(exact, 1) : null, exact, rot, pixFmt: v.pix_fmt, codedW: +v.width || 0, codedH: +v.height || 0,
    hasAudio: (p.streams || []).some((s) => s.codec_type === 'audio'),
  };
}

// Proxy rungs for analyze-media (short side px, fps, crf): the first that fits the inline budget.
// fps null = 2, or 1 past 90 s (the model samples ~1 fps anyway).
const RUNGS = [[480, null, 30], [360, 1, 34], [240, 0.5, 38]];
const SHORT = (px) => `scale='if(gt(iw,ih),-2,min(${px},iw))':'if(gt(iw,ih),min(${px},ih),-2)'`;
const DOWNLOAD = { yuv420p: 'nv12', yuvj420p: 'nv12', nv12: 'nv12', yuv420p10le: 'p010le', p010le: 'p010le' };
const TURN = { 90: ',transpose=clock', 180: ',hflip,vflip', 270: ',transpose=cclock' };

// One decode, every derivative asked for: { scenes } → cut times; { sprite: { path, interval, frameH } }
// → a 10×10 sheet; { work } → work/picture.mp4 (silent proxy) + work/track.mp3 (mono 16 kHz).
// Tries VideoToolbox decode + scale, then hardware decode only, then all software.
// Returns { cuts, proxy, track } (null = not made).
export async function videoPass(file, meta, { scenes = false, sprite = null, work = null, rung = 0 }) {
  if (!HAS_FFMPEG) throw new Error(`ffmpeg is required for video. To get it, ${FFMPEG_FIX}`);
  const tmp = mkdtempSync(join(tmpdir(), 'pass-'));
  try {
    const rungs = work ? RUNGS.slice(rung, rung + (meta.exact > 90 ? 2 : 1)) : [];
    const base = rungs[0]?.[0] || 480;
    const outs = []; // [filter chain from the base-scaled frames, output args]
    rungs.forEach(([px, f, crf], i) => outs.push([`fps=${f ?? (meta.exact > 90 ? 1 : 2)}${px < base ? `,${SHORT(px)}` : ''}`,
      ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(tmp, `p${i}.mp4`)]]));
    if (sprite) outs.push([`fps=1/${sprite.interval},scale=192:${sprite.frameH},tile=10x10`, ['-frames:v', '1', sprite.path]]);
    if (scenes) outs.push(["select='eq(n,0)+gt(scene,0.3)',metadata=print:file=scenes.txt", ['-f', 'null', '-']]); // frame 0 keeps the sink fed (no cut at 0 survives MIN_SCENE)
    const audio = work && rung === 0 && meta.hasAudio ? ['-map', '0:a:0', '-vn', '-af', 'aresample=async=1:first_pts=0', '-ac', '1', '-ar', '16000', '-b:a', '32k', join(tmp, 'track.mp3')] : [];
    const graph = (pre) => `[0:v]${pre}${outs.length > 1 ? `,split=${outs.length}${outs.map((_, i) => `[s${i}]`).join('')};` : '[s0];'}`
      + outs.map(([chain], i) => `[s${i}]${chain}[o${i}]`).join(';');
    const maps = outs.flatMap(([, args], i) => ['-map', `[o${i}]`, ...args]);

    // The engine path scales to the base size in coded orientation, then turns the small frames.
    const short = Math.min(meta.codedW, meta.codedH), k = short > base ? base / short : 1;
    const even = (n) => Math.max(2, Math.round(n / 2) * 2);
    const attempts = [];
    if (hasVT() && DOWNLOAD[meta.pixFmt] && short) attempts.push([[...HW, '-hwaccel_output_format', 'videotoolbox_vld', '-noautorotate'], `scale_vt=w=${even(meta.codedW * k)}:h=${even(meta.codedH * k)},hwdownload,format=${DOWNLOAD[meta.pixFmt]},format=yuv420p${TURN[meta.rot] || ''}`]);
    if (hasVT()) attempts.push([HW, SHORT(base)]);
    attempts.push([[], SHORT(base)]);
    let r;
    for (const [hw, pre] of attempts) {
      r = await runAsync('ffmpeg', ['-y', '-v', 'error', ...hw, '-i', file, '-filter_complex', graph(pre), ...maps, ...audio], { allowFail: true, cwd: tmp });
      if (r.status === 0) break;
      console.error(`  ${basename(file)}: ${hw.length ? 'hardware' : 'software'} decode failed (${String(r.stderr).trim().split('\n').pop()})${hw.length ? ' — falling back' : ''}`);
    }
    if (r.status !== 0) throw new Error(`ffmpeg could not decode ${basename(file)}: ${String(r.stderr).trim().split('\n').pop()}`);

    const res = { cuts: [], proxy: null, track: null };
    if (scenes && existsSync(join(tmp, 'scenes.txt'))) res.cuts = [...readFileSync(join(tmp, 'scenes.txt'), 'utf8').matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]);
    if (work) {
      mkdirSync(work, { recursive: true });
      if (existsSync(join(tmp, 'track.mp3'))) renameSync(join(tmp, 'track.mp3'), (res.track = join(work, 'track.mp3')));
      const fit = rungs.findIndex((_, i) => existsSync(join(tmp, `p${i}.mp4`)) && statSync(join(tmp, `p${i}.mp4`)).size <= INLINE_MAX);
      if (fit >= 0) renameSync(join(tmp, `p${fit}.mp4`), (res.proxy = join(work, 'picture.mp4')));
      else if (rung + rungs.length < RUNGS.length) res.proxy = (await videoPass(file, meta, { work, rung: rung + rungs.length })).proxy;
    }
    return res;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
// Where the probe leaves a video's analysis inputs for analyze-media (keyed by content).
export const workDir = (sha) => join(tmpdir(), 'ad-production-kit-work', String(sha).slice(0, 16));

// Scene boundaries (s) from the pass's cuts, or PySceneDetect's when installed. Cuts within MIN_SCENE
// of the previous boundary or the end are dropped (no flash-frame scenes).
const MIN_SCENE = 0.3;
function sceneBounds(file, passCuts, duration) {
  let cuts = passCuts;
  if (have('scenedetect')) {
    const r = run('scenedetect', ['-i', file, 'detect-adaptive', 'list-scenes', '-q'], { allowFail: true });
    const sd = [...(r.stdout || '').matchAll(/^\s*\d+\s+[\d:.]+\s+(\d+)\s/gm)].map((m) => +m[1] / 1000);
    if (sd.length) cuts = sd;
  }
  const end = duration || Infinity, bounds = [0];
  for (const c of [...cuts].sort((a, b) => a - b)) if (c - bounds[bounds.length - 1] >= MIN_SCENE && end - c >= MIN_SCENE) bounds.push(c);
  if (duration) bounds.push(duration);
  return bounds;
}
async function videoDerivatives(file, paths, id, meta, work) {
  const dur = meta.duration || 0;
  grab(file, Math.min(1, dur / 10), ['-vf', 'scale=400:-1', join(paths.thumbs, `${id}.jpg`)]);
  const cols = 10, rows = 10;
  const interval = dur ? Math.max(0.25, dur / (cols * rows)) : 1; // sample across the whole clip; floor avoids absurd fps on very short ones
  const sheet = join(paths.sprites, `${id}.jpg`), frameH = Math.round(192 * (meta.height / meta.width || 0.5625));
  const pass = await heavy(() => videoPass(file, meta, { scenes: true, sprite: { path: sheet, interval, frameH }, work }));
  // scenes → one keyframe each
  const cuts = sceneBounds(file, pass.cuts, dur);
  const scenes = [];
  for (let i = 0; i < Math.max(1, cuts.length - 1); i++) {
    const start = cuts[i] ?? 0, end = cuts[i + 1] ?? dur;
    const mid = start + Math.min(0.5, (end - start) / 2);
    const kf = join(paths.keyframes, `${id}_${String(i + 1).padStart(2, '0')}.jpg`);
    grab(file, mid, ['-vf', 'scale=1536:-1', kf]);
    if (existsSync(kf)) scenes.push({ start: round(start, 1), end: round(end, 1), keyframe: `_catalog/keyframes/${basename(kf)}`, description: '' });
  }
  const sprites = existsSync(sheet) ? { sheet: `_catalog/sprites/${id}.jpg`, cols, rows, interval: round(interval, 1), frameW: 192, frameH } : null;
  return { scenes, sprites };
}
// ~400 max-amplitude samples from low-rate PCM.
function audioPeaks(file, paths, id) {
  const N = 400;
  const samples = pcm(file, 4000) || [];
  const peaks = [], per = Math.max(1, Math.floor(samples.length / N));
  for (let i = 0; i < samples.length; i += per) { let m = 0; for (let j = i; j < i + per && j < samples.length; j++) m = Math.max(m, Math.abs(samples[j])); peaks.push(round(m / 32768)); }
  if (peaks.length) writeFileSync(join(paths.peaks, `${id}.json`), JSON.stringify(peaks));
}

// ---------- near-duplicates ----------
// Fingerprints come from a 256×256 grayscale (aspect ignored). phash = aHash (16×16 block means
// above their mean, 256 bits) + dHash (each block brighter than its left neighbour, 240 bits), hex.
const S = 256, B = S / 16;
const HASH_MAX = 40;      // of 496 bits: candidates for the pixel check (re-exports ≤5, unrelated ≥57)
const PIXELS_MAX = 0.015; // share of pixels off by >18/255 (re-exports ≤0.01, burst shots ≥0.035)
const FRAMES_MAX = 40;    // mean bits apart over a video's sampled frames
const DUR_TOL = 0.05;
const GRAY = ['-vf', `scale=${S}:${S}:flags=area,format=gray`, '-f', 'rawvideo', '-'];
const asGray = (r) => (r?.stdout?.length === S * S ? new Uint8Array(r.stdout) : null);
const grayImage = (jpg) => (existsSync(jpg) ? asGray(run('ffmpeg', ['-v', 'error', '-i', jpg, '-frames:v', '1', ...GRAY], { allowFail: true, binary: true })) : null);
const grayFrame = (file, t) => asGray(grab(file, t, GRAY, { binary: true }));
function phashOf(g) {
  const b = new Float64Array(256);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) b[Math.floor(y / B) * 16 + Math.floor(x / B)] += g[y * S + x];
  const mean = b.reduce((s, v) => s + v, 0) / 256, bits = [];
  for (let i = 0; i < 256; i++) bits.push(b[i] > mean);
  for (let r = 0; r < 16; r++) for (let c = 0; c < 15; c++) bits.push(b[r * 16 + c + 1] > b[r * 16 + c]);
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
  return hex;
}
const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
const hamming = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)]; return d; };
const turn = (g) => { const o = new Uint8Array(S * S); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) o[x * S + (S - 1 - y)] = g[y * S + x]; return o; };
const pixelsOff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) n += Math.abs(a[i] - b[i]) > 18; return n / a.length; };
// Frame times a new video is hashed at: the poster's time and two more across the clip.
const sampleTimes = (d) => [Math.min(1, round(d, 1) / 10), d * 0.5, d * 0.9].map((t) => round(t, 3));
const nameKey = (n) => String(n || '').toLowerCase().trim();

// Fingerprint one new file (before any probing): { type, name, duration?, phash, gray?, frames? }.
function fingerprint(file, tmp) {
  const type = typeOf(file), fp = { type, name: nameKey(basename(file)) };
  if (!HAS_FFMPEG) return fp;
  if (type === 'image') {
    const thumb = join(tmp, `${Math.random().toString(36).slice(2)}.jpg`);
    fp.gray = imageFit(file, 400, thumb) ? grayImage(thumb) : null; // the same thumb the record would get
    if (fp.gray) fp.phash = phashOf(fp.gray);
  } else if (type === 'video') {
    fp.duration = +ffprobeJson(file).format?.duration || 0;
    if (fp.duration) {
      const frames = sampleTimes(fp.duration).map((t) => ({ t, g: grayFrame(file, t) })).filter((f) => f.g);
      fp.phash = { duration: fp.duration, frames: frames.map((f) => ({ t: f.t, h: phashOf(f.g) })) };
    }
  }
  return fp;
}

// Matches new files against the catalog and each other. Older records get their hash on first need.
function nearDupFinder(paths, records) {
  const names = new Map(); // original name → catalog ids (records + tracked Drive files)
  const addName = (n, id) => { if (n && id) (names.get(nameKey(n)) || names.set(nameKey(n), new Set()).get(nameKey(n))).add(id); };
  for (const r of records) addName(r.file?.original, r.id);
  for (const src of Object.values(readDriveSources(paths))) for (const f of Object.values(src.files || {})) addName(f.name, f.catalogId);
  const cands = records.filter((r) => r.file?.type === 'image' || r.file?.type === 'video')
    .map((r) => ({ id: r.id, type: r.file.type, rec: r, duration: r.phash?.duration ?? r.file.duration, exact: r.phash?.duration != null }));

  const at = (rel) => join(paths.media, rel);
  function hashOf(c) { // lazily: image → hex; video → { frames:[{t,h}] }
    if (c.rec?.phash !== undefined) return c.rec.phash;
    let ph = null;
    if (c.type === 'image') { const g = grayImage(join(paths.thumbs, `${c.id}.jpg`)); ph = g && phashOf(g); }
    else {
      const d = c.rec.file.duration || 0;
      const shots = [{ t: Math.min(1, d / 10), path: join(paths.thumbs, `${c.id}.jpg`) }];
      const sc = c.rec.scenes || [];
      for (const s of [sc[0], sc[Math.floor(sc.length / 2)]]) if (s?.keyframe && !shots.some((x) => x.path === at(s.keyframe))) shots.push({ t: s.start + Math.min(0.5, (s.end - s.start) / 2), path: at(s.keyframe) });
      const frames = shots.map((x) => { const g = grayImage(x.path); return g && { t: round(x.t, 3), h: phashOf(g) }; }).filter(Boolean);
      ph = frames.length ? { frames } : null;
    }
    if (ph) { c.rec.phash = ph; mergeRecord(paths, { id: c.id, phash: ph }); }
    return ph;
  }

  // A new video's mean frame distance to a candidate, hashing the new file at the candidate's times.
  function frameDistance(file, fp, ph) {
    const ds = (ph?.frames || []).map((f) => {
      const own = fp.phash?.frames.find((x) => Math.abs(x.t - f.t) <= 0.06);
      const h = own?.h ?? (() => { const g = grayFrame(file, f.t); return g && phashOf(g); })();
      return h ? hamming(h, f.h) : null;
    }).filter((d) => d != null);
    return ds.length ? round(ds.reduce((s, d) => s + d, 0) / ds.length, 1) : null;
  }

  return {
    // → { id, reason } when `file` duplicates something already cataloged (or earlier in this batch).
    match(file, fp) {
      if (fp.type === 'image' && fp.gray) {
        const turns = [fp.gray]; for (let i = 0; i < 3; i++) turns.push(turn(turns[i]));
        const hs = turns.map(phashOf);
        const near = cands.filter((c) => c.type === 'image').map((c) => {
          const h = hashOf(c); if (!h) return null;
          const ds = hs.map((x) => hamming(x, h)), d = Math.min(...ds);
          return d <= HASH_MAX ? { c, d, k: ds.indexOf(d) } : null;
        }).filter(Boolean).sort((a, b) => a.d - b.d);
        for (const { c, d, k } of near.slice(0, 3)) {
          const g = c.gray || grayImage(join(paths.thumbs, `${c.id}.jpg`));
          if (!g) continue;
          const off = pixelsOff(turns[k], g);
          if (off <= PIXELS_MAX) return { id: c.id, reason: `same picture as ${c.id}${c.batch ? ` (${c.batch}, this batch)` : ''} — hash ${d}/496 bits, ${(off * 100).toFixed(1)}% pixels differ${k ? `, turned ${k * 90}°` : ''}` };
          console.error(`  ${basename(file)}: looks like ${c.id} (hash ${d}/496) but ${(off * 100).toFixed(1)}% of pixels differ — distinct shot, kept`);
        }
      } else if (fp.type === 'video' && fp.duration) {
        const near = cands.filter((c) => c.type === 'video' && c.duration && Math.abs(c.duration - fp.duration) <= DUR_TOL + (c.exact ? 0 : 0.05))
          .map((c) => ({ c, d: frameDistance(file, fp, hashOf(c)), named: names.get(fp.name)?.has(c.id) || nameKey(c.name) === fp.name }))
          .sort((a, b) => (a.d ?? 999) - (b.d ?? 999));
        for (const { c, d, named } of near) {
          const why = `${c.batch ? `${c.batch} (this batch)` : c.id}: duration ${fp.duration.toFixed(2)} s`;
          if (named && (d == null || d <= 2 * FRAMES_MAX)) return { id: c.id, reason: `same name + ${why}${d != null ? `, frames ${d}/496 bits apart` : ''}` };
          if (d != null && d <= FRAMES_MAX) return { id: c.id, reason: `${why}, frames ${d}/496 bits apart` };
        }
      }
      return null;
    },
    add(id, file, fp) {
      if (fp.type === 'image' && fp.phash) cands.push({ id, type: 'image', batch: basename(file), gray: fp.gray, rec: { phash: fp.phash } });
      if (fp.type === 'video' && fp.phash) cands.push({ id, type: 'video', batch: basename(file), name: fp.name, duration: fp.duration, exact: true, rec: { phash: fp.phash } });
    },
  };
}

const orientationOf = (w, h) => (!w || !h ? 'unknown' : w > h ? 'landscape' : w < h ? 'portrait' : 'square');
const ASPECTS = [[1, 1], [4, 5], [5, 4], [2, 3], [3, 2], [3, 4], [4, 3], [9, 16], [16, 9], [9, 19.5], [1.91, 1]];
function snapAspect(w, h) {
  if (!w || !h) return null;
  const r = w / h;
  let best = null, bestD = Infinity;
  for (const [a, b] of ASPECTS) { const d = Math.abs(r - a / b); if (d < bestD) { bestD = d; best = [a, b]; } }
  return bestD / (w / h) < 0.04 ? `${best[0]}:${best[1]}` : `${Math.round(r * 100) / 100}:1`;
}

// analyze-media fills analysis / products / people / transcript. source: { kind: generated|link|upload, url? }.
function recordSkeleton({ id, sha256: hash, name, type, mime, bytes, width, height, duration, source = { kind: 'upload' } }) {
  const rec = {
    id, sha256: hash,
    file: { name, type, mime, bytes },
    source,
    products: [], people: [], unknown_people: [],
    analysis: '',
    status: 'probed',
  };
  if (width) rec.file.width = width;
  if (height) rec.file.height = height;
  if (width && height) { rec.file.orientation = orientationOf(width, height); rec.file.aspect = snapAspect(width, height); }
  if (duration != null) rec.file.duration = duration;
  return rec;
}

// Probe one new file and place the original as <id>_<slug>.<ext> (analyze-media renames it later).
async function probe({ file, media, id, sha256, phash, source }) {
  const paths = catalogPaths(media);
  ensureDirs(paths);
  const type = typeOf(file);
  if (!type) throw new Error(`not a media file: ${file}`);
  const ext = extname(file).slice(1).toLowerCase();
  const name = `${id}_${slugify(basename(file, extname(file)))}.${ext}`;
  const base = { id, sha256: sha256 || await hashFile(file), name, type, mime: mimeOf(file), bytes: statSync(file).size, source };
  const warnings = [];
  let dims = {}, video = null;

  if (type === 'image') {
    if (!HAS_SIPS && !HAS_FFMPEG) {
      warnings.push(`no image tool found — dimensions and thumbnails skipped (the record is still created). To enable them, ${FFMPEG_FIX}.`);
    } else {
      dims = imageDims(file);
      if (!imageDerivatives(file, paths, id)) warnings.push(`could not make derivatives for ${basename(file)} (format not supported by the installed tool) — analyze the original file instead.`);
    }
  } else if (!HAS_FFMPEG) {
    warnings.push(`ffmpeg not found — video/audio derivatives skipped (to enable scenes, sprites, waveform and transcription, ${FFMPEG_FIX}).`);
  } else if (type === 'video') {
    const meta = videoMeta(file);
    dims = { width: meta.width, height: meta.height, duration: meta.duration };
    try { video = await videoDerivatives(file, paths, id, meta, workDir(base.sha256)); }
    catch (e) { warnings.push(`${basename(file)}: ${e.message} — record created without scenes/sprites`); }
  } else {
    const d = ffprobeJson(file).format?.duration;
    if (d) dims = { duration: round(+d, 1) };
    audioPeaks(file, paths, id);
  }

  const rec = recordSkeleton({ ...base, ...dims });
  rec.file.original = basename(file);
  if (phash) rec.phash = phash;
  if (video?.scenes.length) rec.scenes = video.scenes;
  if (video?.sprites) rec.sprites = video.sprites;
  copyFileSync(file, join(media, name), constants.COPYFILE_FICLONE); // a clone on APFS: no second copy of a 500 MB clip
  writeRecord(paths, rec);
  return { id, type, name, warnings };
}

// The media files under dir, outside reserved and hidden folders (.previews), sorted.
const collect = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((e) => !e.isDirectory() && !relative(dir, e.parentPath).split(sep).some((d) => RESERVED.has(d) || d.startsWith('.')))
  .map((e) => join(e.parentPath, e.name)).filter(isMedia).sort();

// Planning (hash, dedupe, allocate ids) is sequential so ids never race; probing runs in parallel.
// Returns [{ id, src, existing, reason?, type?, name?, warnings? }]; skipped files give the id they
// duplicate. sourceOf(file) → the record's source.
export async function planAndProbe({ dir, media, sourceOf = () => ({ kind: 'upload' }) }) {
  const paths = catalogPaths(media);
  const records = readRecords(paths);
  const bySha = new Map(records.map((r) => [r.sha256, r.id]));
  const finder = nearDupFinder(paths, records);
  let next = records.reduce((m, r) => Math.max(m, parseInt(r.id, 10) || 0), 0);
  const tmp = mkdtempSync(join(tmpdir(), 'plan-'));
  const manifest = [], todo = [];
  try {
    for (const src of collect(dir)) {
      const sha256 = await hashFile(src);
      const same = bySha.get(sha256);
      if (same) { manifest.push({ id: same, src, existing: true, reason: `same bytes as ${same}` }); continue; }
      const fp = fingerprint(src, tmp);
      const hit = finder.match(src, fp);
      if (hit) { manifest.push({ id: hit.id, src, existing: true, reason: hit.reason }); console.log(`skip ${basename(src)} — near-duplicate: ${hit.reason}`); continue; }
      const id = String(++next).padStart(5, '0');
      bySha.set(sha256, id);
      finder.add(id, src, fp);
      todo.push({ src, id, sha256, phash: fp.phash });
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  await Promise.all(todo.map(async (f) => {
    const out = await probe({ file: f.src, media, id: f.id, sha256: f.sha256, phash: f.phash, source: sourceOf(f.src) });
    manifest.push({ ...out, src: f.src, existing: false });
  }));
  return manifest;
}
