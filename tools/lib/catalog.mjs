// catalog.mjs — shared helpers: .env, arg parsing, binaries, downloads, workspace inference, and the
// media catalog (hashing, paths, records).
//
// Layout:
//   workspaces/<WS>/<Brand>/inputs/media/
//     brand/                      reserved — brand kit, skipped by the catalog
//     _catalog/                   reserved — generated catalog (json, thumbs, sprites, proxies, keyframes, peaks)
//     <id>_<descriptor>.<ext>     the media, flat
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdirSync, createReadStream, createWriteStream, writeFileSync, openSync, readSync, closeSync, rmSync, renameSync, statSync } from 'node:fs';
import { homedir, hostname, setPriority, tmpdir } from 'node:os';
import { join, resolve, basename, extname, delimiter, dirname, relative } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function die(message) { console.error(`ERROR: ${message}`); process.exit(1); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- external binaries ----------
// Extend PATH once so spawned tools find binaries in ~/.local/bin and brew dirs too.
process.env.PATH = [process.env.PATH || '', join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'].join(delimiter);

// Scans PATH ourselves (Windows has no /bin/sh) and tries <name>.exe there, since spawn() won't
// append it without a shell.
const BIN_CACHE = {};
export function findBin(name) {
  if (name in BIN_CACHE) return BIN_CACHE[name];
  const candidates = process.platform === 'win32' ? [`${name}.exe`, name] : [name];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const c of candidates) {
      const p = join(dir, c);
      if (existsSync(p)) return (BIN_CACHE[name] = p);
    }
  }
  return (BIN_CACHE[name] = null);
}
export const have = (name) => !!findBin(name);

// Setup doesn't check ffmpeg (only media work needs it), so the first ffmpeg/ffprobe call notes
// once when it's missing or older than 8.
export const FFMPEG_FIX = { darwin: 'run: bash tools/setup.sh', win32: 'run: winget install Gyan.FFmpeg' }[process.platform]
  || 'put an ffmpeg 8 static build (https://ffmpeg.org/download.html) in ~/.local/bin';
let ffmpegNoted = false;
function noteFfmpeg(bin) {
  if (ffmpegNoted || (bin !== 'ffmpeg' && bin !== 'ffprobe')) return;
  ffmpegNoted = true;
  const path = findBin('ffmpeg');
  const major = path && Number(spawnSync(path, ['-version'], { encoding: 'utf8' }).stdout?.match(/version n?(\d+)/)?.[1]);
  if (!path) console.error(`Note: ffmpeg isn't installed, and video and audio work needs it. To get it, ${FFMPEG_FIX}`);
  else if (major < 8) console.error(`Note: ffmpeg ${major} is older than 8, so video work may misbehave. To update, ${FFMPEG_FIX}`);
}

export function run(bin, args, { allowFail = false, binary = false, cwd } = {}) {
  noteFfmpeg(bin);
  const r = spawnSync(findBin(bin) || bin, args, { encoding: binary ? 'buffer' : 'utf8', maxBuffer: 1 << 30, cwd });
  if (r.status !== 0 && !allowFail) throw new Error(`${bin} ${args.join(' ')} failed: ${r.stderr || r.error}`);
  return r;
}
// run() without blocking the event loop: { status, stdout, stderr }. `low` runs it at the lowest CPU priority
// (nice 19 / Windows idle class), so the computer stays usable while it encodes.
export function runAsync(bin, args, { allowFail = false, cwd, low = false } = {}) {
  noteFfmpeg(bin);
  return new Promise((res, rej) => {
    const p = spawn(findBin(bin) || bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    if (low) try { setPriority(p.pid, 19); } catch {}
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr = (stderr + d).slice(-20000); });
    p.on('error', (e) => (allowFail ? res({ status: -1, stdout, stderr: String(e) }) : rej(e)));
    p.on('close', (status) => (status !== 0 && !allowFail ? rej(new Error(`${bin} ${args.join(' ')} failed: ${stderr}`)) : res({ status, stdout, stderr })));
  });
}
// A file made from `src` once per version of it (path, mtime, size) and `key`, kept in <OS temp>/<cache>, or with
// `beside` in a hidden .previews folder next to src (survives restarts; sync skips dot folders): make(tmp) writes it
// to tmp, renamed into place so concurrent requests never see half a file. → its path.
export function cachedPath(src, { cache, key = '', ext, beside = false }) {
  const st = statSync(src);
  return beside
    ? join(dirname(src), '.previews', `${basename(src)}.${key}.${ext}`)
    : join(tmpdir(), cache, `${createHash('sha1').update(`${src}|${st.mtimeMs}|${st.size}|${key}`).digest('hex')}.${ext}`);
}
// Whether cachedFile has already made it.
export const isCached = (src, opts) => { const out = cachedPath(src, opts); return existsSync(out) && (!opts.beside || statSync(out).mtimeMs >= statSync(src).mtimeMs); };
export async function cachedFile(src, { cache, key = '', ext, beside = false }, make) {
  const out = cachedPath(src, { cache, key, ext, beside });
  if (isCached(src, { cache, key, ext, beside })) return out;
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out.slice(0, -ext.length - 1)}.${process.pid}.${Date.now()}.${ext}`;
  await make(tmp);
  renameSync(tmp, out);
  return out;
}
// The command that writes a JPEG (PNG when `out` ends in .png) of an image fit within px on its
// longest edge, never upscaled: [bin, args] for run()/runAsync(). sips on macOS, ffmpeg elsewhere
// (even dims for its encoder).
export function imageFitCmd(file, px, out) {
  if (have('sips')) return ['sips', ['-s', 'format', extOf(out) === 'png' ? 'png' : 'jpeg', '-Z', String(px), file, '--out', out]];
  const fit = `scale=w='min(iw,${px})':h='min(ih,${px})':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  return ['ffmpeg', ['-y', '-v', 'error', '-i', file, '-frames:v', '1', '-vf', fit, '-q:v', '3', out]];
}
// Whether ffmpeg can decode and encode H.264 on the Mac's media engine (VideoToolbox), which spares the CPU.
let vt;
export const videoToolbox = () => (vt ??= process.platform === 'darwin' && /h264_videotoolbox/.test(run('ffmpeg', ['-hide_banner', '-encoders'], { allowFail: true }).stdout || ''));
// Studio's editor plays every video from a light copy this wide (Editor.js PREVIEW_W), kept beside it in .previews.
export const PREVIEW_PX = 720;
export const videoPreviewOpts = (px = PREVIEW_PX) => ({ cache: 'ad-production-kit-previews', key: px, ext: 'mp4', beside: true });
// Make Studio's preview files for these edits, files or folders in a detached background process
// (`edit-video.mjs previews`), so playback never waits on them.
export const warmPreviews = (targets) => spawn(process.execPath, [join(REPO_ROOT, 'tools', 'edit-video.mjs'), 'previews', ...targets], { detached: true, stdio: 'ignore' }).unref();
// The command that writes a light preview copy of a video (H.264 within px wide, a keyframe every half second
// for quick seeking, AAC sound), never upscaled: [bin, args] for run()/runAsync(). On VideoToolbox when there is
// one, else libx264 on 4 threads.
export function videoPreviewCmd(file, px, out) {
  const [dec, enc] = videoToolbox() ? [['-hwaccel', 'videotoolbox'], ['-c:v', 'h264_videotoolbox', '-q:v', '55']]
    : [['-threads', '4'], ['-c:v', 'libx264', '-threads', '4', '-preset', 'veryfast', '-crf', '24']];
  return ['ffmpeg', ['-y', '-v', 'error', ...dec, '-i', file, '-vf', `scale='min(iw,${px})':-2`, ...enc,
    '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]];
}
// Note on an ad's record (outputs/json/<id>.json, beside the upload spec) where it was uploaded: sentTo[dest] = url.
// The id is the leading number of the spec's name (the ad folder), else of its _upload_<id>.json file name.
export function markSent(specPath, spec, dest, url) {
  const id = String(spec.name || '').match(/^(\d+)/)?.[1] || basename(specPath).match(/_upload_(\d+)/)?.[1];
  const file = id && join(dirname(specPath), 'json', `${id}.json`);
  if (!file || !existsSync(file)) return;
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  rec.sentTo = { ...rec.sentTo, [dest]: url };
  writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
}
export function ffprobeJson(file) {
  const r = run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file], { allowFail: true });
  try { return JSON.parse(r.stdout || '{}'); } catch { return {}; }
}
// A file's audio as mono 16-bit samples at `rate` Hz, or null, on the file's own clock: a video's audio can start
// after its first frame (often ~0.5 s), so that lead is padded with silence, as the editor and audioTrack do.
export function pcm(file, rate) {
  const r = run('ffmpeg', ['-v', 'quiet', '-copyts', '-i', file, '-vn', '-af', 'aresample=async=1:first_pts=0', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], { allowFail: true, binary: true });
  return r.stdout?.length ? new Int16Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 2)) : null;
}
// Loudness of a file's audio in 10 ms frames (dB), or null.
export function loudness(file) {
  const samples = pcm(file, 16000);
  if (!samples) return null;
  const hop = 160, db = [];
  for (let i = 0; i + hop <= samples.length; i += hop) { let s = 0; for (let j = i; j < i + hop; j++) s += (samples[j] / 32768) ** 2; db.push(10 * Math.log10(s / hop + 1e-12)); }
  return db;
}
export const round = (n, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

const EXT = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'avif'],
  video: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'],
};
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp', avif: 'image/avif',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/opus',
  json: 'application/json', js: 'text/javascript', mjs: 'text/javascript', md: 'text/markdown', pdf: 'application/pdf', html: 'text/html', vtt: 'text/vtt', txt: 'text/plain',
};

// Takes a Content-Type header as is; first extension wins (jpg, tif); undefined if unknown.
const EXT_FOR_MIME = {
  ...Object.fromEntries(Object.entries(MIME).reverse().map(([e, m]) => [m, e])),
  'image/jpg': 'jpg', 'audio/mp3': 'mp3', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
};
export const extForMime = (ct) => EXT_FOR_MIME[String(ct || '').split(';')[0].trim().toLowerCase()];

const extOf = (p) => extname(p).slice(1).toLowerCase();
export const mimeOf = (p) => MIME[extOf(p)] || 'application/octet-stream';
export function typeOf(p) {
  const e = extOf(p);
  for (const t of ['image', 'video', 'audio']) if (EXT[t].includes(e)) return t;
  return null;
}
export const isMedia = (p) => typeOf(p) !== null && !basename(p).startsWith('.');

// ---------- .env ----------
// The repo-root .env (found from this file, so any cwd works), else one in the cwd.
export function loadEnv() {
  for (const f of [...new Set([join(REPO_ROOT, '.env'), resolve('.env')])]) {
    if (existsSync(f)) {
      return Object.fromEntries(
        readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#'))
          .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
      );
    }
  }
  return {};
}
// A workspace's key <WS>_<name>; the shell's environment wins over .env.
export const wsKey = (ws, name) => ({ ...loadEnv(), ...process.env })[`${ws.toUpperCase()}_${name}`];

// ---------- downloads ----------
// Up to 3 tries. A web page in place of the file (not shared, quota, virus-scan wall) counts as failure.
// Returns { bytes, filename } (filename from Content-Disposition).
export async function downloadFile(url, dest, headers = {}) {
  mkdirSync(dirname(dest), { recursive: true });
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (/text\/html/i.test(r.headers.get('content-type') || '')) throw new Error('got a web page, not the file');
      await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
      const head = Buffer.alloc(64); const fd = openSync(dest, 'r'); readSync(fd, head, 0, 64, 0); closeSync(fd);
      if (/^\s*<(!doctype|html)/i.test(head.toString('latin1'))) throw new Error('got a web page, not the file');
      const cd = r.headers.get('content-disposition') || '';
      const filename = decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/i) || [])[1] || '') || (cd.match(/filename="([^"]+)"/i) || [])[1] || null;
      return { bytes: statSync(dest).size, filename };
    } catch (e) { last = e; rmSync(dest, { force: true }); if (i < 3) await sleep(2000 * i); }
  }
  throw last;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', rsquo: '\u2019' };
// HTML entities (numeric, and the named ones pages use) decoded in one pass.
export const decodeHtml = (s) => String(s).replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] !== '#' ? ENTITIES[e.toLowerCase()] ?? m
  : String.fromCodePoint(/x/i.test(e[1]) ? parseInt(e.slice(2), 16) : +e.slice(1))));

// ---------- editing lock ----------
// <ad folder>/.editing.json { session, at }: the ad is being edited and not pushed yet. sync-brand's pull leaves the
// folder alone, push releases it (and leaves out a folder another session holds), and its review notes go to that
// session. Studio's own edits mark it "studio", which any session may take.
export const EDITING = '.editing.json';
export const sessionId = () => process.env.CLAUDE_CODE_SESSION_ID || process.env.ADPK_SESSION || hostname();
// After a media file is renamed: every edit document in every workspace that pointed at the old file points at
// the new one (the shared library is used across brands). Returns how many documents changed.
export function relinkEdits(oldAbs, newAbs) {
  const sub = (d) => { try { return readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(d, e.name)); } catch { return []; } };
  let n = 0;
  for (const ws of sub(join(REPO_ROOT, 'workspaces'))) for (const brand of sub(ws)) for (const ad of sub(join(brand, 'outputs'))) {
    for (const f of readdirSync(ad).filter((x) => /^edit.*\.json$/.test(x))) {
      const p = join(ad, f);
      let doc; try { doc = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
      let hit = false;
      for (const tr of doc.tracks || []) for (const c of tr.clips || []) if (c.src && resolve(ad, c.src) === oldAbs) { c.src = relative(ad, newAbs); hit = true; }
      if (hit) { writeFileSync(p, JSON.stringify(doc, null, 1) + '\n'); n++; }
    }
  }
  return n;
}

export function readEditing(adDir) {
  try { return JSON.parse(readFileSync(join(adDir, EDITING), 'utf8')); } catch { return null; }
}
// Marks the ad as edited by `session` (null: Studio) and returns who holds it: the first session keeps it, its lock
// untouched, unless take.
export function markEditing(adDir, session = sessionId(), take = false) {
  const cur = readEditing(adDir)?.session;
  const holder = take || !cur || cur === 'studio' ? session || cur || 'studio' : cur;
  if (holder === cur && holder !== (session || 'studio')) return holder;
  writeFileSync(join(adDir, EDITING), JSON.stringify({ session: holder, at: new Date().toISOString() }) + '\n');
  return holder;
}

export function inferWorkspace(p) {
  const m = resolve(p).replace(/\\/g, '/').match(/workspaces\/([^/]+)\//);
  return m ? m[1] : '';
}

export function inferBrand(p) {
  const m = resolve(p).replace(/\\/g, '/').match(/workspaces\/[^/]+\/([^/]+)(\/|$)/);
  return m ? m[1] : '';
}

export function brandDirFrom(p) {
  const m = resolve(p).replace(/\\/g, '/').match(/^(.*\/workspaces\/[^/]+\/[^/]+)(\/.*)?$/);
  return m ? m[1] : resolve(p);
}

// A brand folder by its name in another system ("Acme Skincare" → workspaces/<WS>/Acme), matched
// loosely; null when none.
export function findBrandDir(workspace, name) {
  const wsDir = join(REPO_ROOT, 'workspaces', workspace);
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(name || '');
  if (!target || !existsSync(wsDir)) return null;
  const dirs = readdirSync(wsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const hit = dirs.find((d) => norm(d) === target) || dirs.find((d) => norm(d).includes(target) || target.includes(norm(d)));
  return hit ? join(wsDir, hit) : null;
}

// inputs/uploads.json pins where a brand's ads upload: { drive: { folder }, notion: { board | boardId } }.
// `p` is any path inside the brand; {} when the file is missing.
export function readUploads(p) {
  const f = join(brandDirFrom(p), 'inputs', 'uploads.json');
  if (!existsSync(f)) return {};
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { die(`${f}: ${e.message}`); }
}

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
// What a media dir's brand knows: inputs/products.json ([{ name, aliases, look }] or { products,
// vocabulary }) and _catalog/people.json ([{ name, description }]).
export function readRoster(mediaDir) {
  const d = readJson(join(dirname(mediaDir), 'products.json'));
  const people = readJson(catalogPaths(mediaDir).people);
  return {
    products: Array.isArray(d) ? d : d?.products || [],
    vocabulary: Array.isArray(d?.vocabulary) ? d.vocabulary : [],
    people: Array.isArray(people) ? people : [],
  };
}

export function mediaDirFrom(p) {
  const norm = resolve(p).replace(/\\/g, '/');
  const m = norm.match(/^(.*\/inputs\/media)(\/.*)?$/);
  if (m) return m[1];
  return join(resolve(p), 'inputs', 'media');
}

export function catalogPaths(p) {
  const media = mediaDirFrom(p);
  const catalog = join(media, '_catalog');
  return {
    media, catalog,
    json: join(catalog, 'json'), thumbs: join(catalog, 'thumbs'), sprites: join(catalog, 'sprites'),
    proxies: join(catalog, 'proxies'), keyframes: join(catalog, 'keyframes'), peaks: join(catalog, 'peaks'),
    index: join(catalog, 'index.md'), people: join(catalog, 'people.json'),
    driveSources: join(catalog, 'drive-sources.json'), vectors: join(catalog, 'vectors.json'),
  };
}
export function ensureDirs(paths) {
  for (const k of ['json', 'thumbs', 'sprites', 'proxies', 'keyframes', 'peaks']) mkdirSync(paths[k], { recursive: true });
}

// ---------- hashing + ids ----------
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export async function hashFile(p, algo = 'sha256') { // streamed: videos can be huge
  const h = createHash(algo);
  for await (const chunk of createReadStream(p, { highWaterMark: 1 << 22 })) h.update(chunk);
  return h.digest('hex');
}
export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';

// ---------- records (one JSON file per item in paths.json; record-media.mjs owns the schema) ----------
export function readRecords(paths) {
  if (!existsSync(paths.json)) return [];
  return readdirSync(paths.json).filter((f) => f.endsWith('.json'))
    .map((f) => readJson(join(paths.json, f)))
    .filter(Boolean);
}
const recordFile = (paths, id) => join(paths.json, `${id}.json`);
export function readRecord(paths, id) {
  const p = recordFile(paths, id);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
export function writeRecord(paths, rec) {
  if (!rec.id) throw new Error('record needs an id');
  ensureDirs(paths);
  writeFileSync(recordFile(paths, rec.id), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}
// Shallow merge; file/source/sprites one level deep; a transcript is replaced whole; an undefined key
// is dropped.
export function mergeRecord(paths, patch) {
  const id = patch.id;
  if (!id) throw new Error('patch needs an id');
  const cur = readRecord(paths, id) || { id };
  const merged = { ...cur, ...patch };
  for (const k of ['file', 'source', 'sprites']) {
    if (cur[k] && patch[k] && typeof cur[k] === 'object' && !Array.isArray(cur[k])) merged[k] = { ...cur[k], ...patch[k] };
  }
  return writeRecord(paths, merged);
}

// A generated index.md: title, a "N <noun>s. Generated from <from>" line, and a table of rows.
export function indexMarkdown({ title, noun, from, cols, rows }) {
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [
    `# ${title}`, '',
    `${rows.length} ${noun}${rows.length === 1 ? '' : 's'}. Generated from \`${from}\` — do not edit by hand.`, '',
    `| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`), '',
  ].join('\n');
}

// --key value, repeated keys → arrays, bare --flag → true. `flags` never take a value, so the next
// word stays a positional (in `_`). `help`: the tool's usage text, printed on --help or -h (exit 0).
export function parseArgs(argv, { repeat = [], flags = [], help } = {}) {
  const out = {}; const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (help && (a === '--help' || a === '-h')) { console.log(help); process.exit(0); }
    if (!a.startsWith('--')) { positionals.push(a); continue; }
    const key = a.slice(2); const next = argv[i + 1];
    if (flags.includes(key) || next === undefined || next.startsWith('--')) { out[key] = true; continue; }
    if (repeat.includes(key)) { (out[key] ||= []).push(next); } else out[key] = next;
    i++;
  }
  out._ = positionals;
  return out;
}
// Bad usage: the usage text on stderr, exit 1.
export function usage(help) { console.error(help); process.exit(1); }
