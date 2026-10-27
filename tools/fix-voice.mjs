#!/usr/bin/env node
// fix-voice.mjs — clean a speaker's voice and re-say mumbled words, with ElevenLabs (<WS>_ELEVENLABS_API_KEY)
// or, for isolate, locally with DeepFilterNet 3 (no key; Mac arm64/x64 and Windows x64).
// When to use it: generate-voice (Isolate or re-voice).
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { die, inferWorkspace, parseArgs, round, run, sleep, usage, wsKey } from './lib/catalog.mjs';

const HELP = `fix-voice.mjs — clean a speaker's voice and re-say mumbled words (ElevenLabs).

  node tools/fix-voice.mjs isolate <clip>... --out <dir> [--bed -18] [--lufs -16] [--local] [--remux]
      Each clip (video or audio) → <dir>/raw/<name>.wav (its own audio), <dir>/isolated/<name>.wav
      (voice isolation) and <dir>/<name>.wav: the isolated voice with the raw audio --bed dB
      under it, EQ'd, compressed and leveled to --lufs LUFS. Use when background noise gets in the way.
      Engine: ElevenLabs when <WS>_ELEVENLABS_API_KEY is set; --local (or no key) uses DeepFilterNet 3
      on this computer (free, private, ~1 min per 10 min of audio). Local is great on room noise, hum
      and hiss; weak on music, other voices and heavy reverb (use ElevenLabs for those).
      --remux: for a video clip, also write <dir>/<name>.mp4 with the clean audio (video stream copied).
  node tools/fix-voice.mjs install-local
      Downloads DeepFilterNet's deep-filter 0.5.6 for this OS/chip into tools/bin/ (gitignored).
      isolate --local does this by itself the first time.
  node tools/fix-voice.mjs enhance <clip>... --out <dir> [--lufs -14] [--nfe 32] [--remux]
      "Pro mic" restoration with Resemble Enhance (local, Mac and Windows, Python 3.10/3.11): denoises,
      removes room tone and rebuilds a full-band 44.1 kHz studio voice → <dir>/<name>.wav at --lufs LUFS.
      Heavy: ~2x real time on 8 CPU cores, faster on Apple MPS / CUDA. Run it when the computer is idle,
      or on a spare machine. First run creates tools/.venv-enhance and downloads the model (~1 GB).
      --remux: for a video clip, also write <dir>/<name>.mp4 (video stream copied).
  node tools/fix-voice.mjs clone --name "<speaker>" <clip>... [--out <dir>]
      Instant voice clone from the speaker's clearest clips (same room as the patch). Prints the voice id;
      keep it in the brand's memory.md so later fixes reuse it.
  node tools/fix-voice.mjs patch <dir> <name> --voice <id> --from <s> --to <s> --text "<words>"
      [--before "<words>"] [--after "<words>"] [--takes 3] [--bed -18] [--video <clip>]
      Re-says <words> in the cloned voice where the mouth moves (--from/--to: seconds in the clip): slow
      takes, each fitted onto that span, level-matched and spliced into <dir>/isolated/<name>.wav (or
      raw/<name>.wav when not isolated) with the raw audio 32 dB under the patch, then finished like
      isolate → <dir>/<name>-fix-a.wav, -b, -c (+ .mp4 previews with --video). The user picks by ear.
      --before/--after: the words around the patch, so the take's intonation fits.`;

const DF_VERSION = '0.5.6';
const DF_ASSETS = { 'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin', 'win32-x64': 'x86_64-pc-windows-msvc.exe' };
const BIN_DIR = join(dirname(fileURLToPath(import.meta.url)), 'bin');
const dfPath = () => join(BIN_DIR, process.platform === 'win32' ? 'deep-filter.exe' : 'deep-filter');
// Install once: the release binary for this OS/chip → tools/bin/deep-filter(.exe), executable, unquarantined.
async function installLocal() {
  const bin = dfPath();
  if (existsSync(bin)) return bin;
  const asset = DF_ASSETS[`${process.platform}-${process.arch}`]
    || die(`no DeepFilterNet build for ${process.platform}-${process.arch} (Mac arm64/x64 and Windows x64 only): use ElevenLabs`);
  const url = `https://github.com/Rikorose/DeepFilterNet/releases/download/v${DF_VERSION}/deep-filter-${DF_VERSION}-${asset}`;
  console.log(`installing deep-filter ${DF_VERSION} (${asset}) → ${bin}`);
  const r = await fetch(url);
  if (!r.ok) die(`download ${url}: ${r.status}`);
  mkdirSync(BIN_DIR, { recursive: true });
  const tmp = `${bin}.part`;
  writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  renameSync(tmp, bin);
  if (process.platform !== 'win32') chmodSync(bin, 0o755);
  if (process.platform === 'darwin') spawnSync('xattr', ['-d', 'com.apple.quarantine', bin]);
  return bin;
}
const wsKeyOrNull = (p) => { const ws = inferWorkspace(p); return ws ? wsKey(ws, 'ELEVENLABS_API_KEY') : null; };
const hasVideo = (f) => /video/.test(run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', f], { allowFail: true }).stdout || '');

const args = parseArgs(process.argv.slice(2), { help: HELP });
const [cmd, ...rest] = args._;
const SR = 44100;
const LUFS = () => +(args.lufs ?? -16);
const FINISH = () => 'highpass=f=90,equalizer=f=300:t=q:w=1:g=-2.5,equalizer=f=3500:t=q:w=1.2:g=3,'
  + 'acompressor=threshold=-24dB:ratio=2.5:attack=5:release=120:makeup=2,loudnorm=I=' + LUFS() + ':TP=-1.5:LRA=7';

function key(p) {
  const ws = inferWorkspace(p) || die(`can't tell the workspace from ${p} (expected workspaces/<WS>/...)`);
  return wsKey(ws, 'ELEVENLABS_API_KEY') || die(`${ws.toUpperCase()}_ELEVENLABS_API_KEY missing in .env`);
}
const nameOf = (f) => basename(f, extname(f));
const db = (x) => 10 ** (x / 20);
const ff = (a) => run('ffmpeg', ['-v', 'error', '-y', ...a]);
const readF32 = (f) => { const b = run('ffmpeg', ['-v', 'quiet', '-i', f, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { binary: true }).stdout; return new Float32Array(b.buffer, b.byteOffset, b.length >> 2).slice(); };
function writeWav(out, x, filter) {
  const tmp = join(tmpdir(), `fix-voice-${process.pid}-${Date.now()}.f32`);
  writeFileSync(tmp, Buffer.from(x.buffer));
  ff(['-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', tmp, ...(filter ? ['-af', filter] : []), '-ar', String(SR), '-ac', '1', out]);
  rmSync(tmp);
}
const rms = (x) => { let s = 0, n = 0; for (const v of x) if (Math.abs(v) > 0.01) { s += v * v; n++; } return Math.sqrt(s / Math.max(1, n)); };

async function eleven(k, path, body, accept = 'audio/mpeg') {
  for (let i = 0; ; i++) { // the plan allows a few requests at a time: wait and retry when it says too many
    const r = await fetch(`https://api.elevenlabs.io${path}`, { method: 'POST', headers: { 'xi-api-key': k, accept, ...(typeof body === 'string' && { 'Content-Type': 'application/json' }) }, body });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    const text = await r.text();
    if (r.status === 429 && i < 6) { await sleep(3000 * (i + 1)); continue; }
    die(`ElevenLabs ${path}: ${r.status} ${text.slice(0, 300)}`);
  }
}
const form = (fields, files) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); for (const [k, f] of files) fd.append(k, new Blob([readFileSync(f)]), basename(f)); return fd; };
const finish = (iso, raw, bedDb, out) => { const x = new Float32Array(iso.length); for (let i = 0; i < x.length; i++) x[i] = iso[i] + (raw[i] || 0) * db(bedDb); writeWav(out, x, FINISH()); };

async function isolate() {
  const out = resolve(args.out || usage(HELP)), bed = +(args.bed ?? -18);
  if (!rest.length) usage(HELP);
  const local = args.local || !wsKeyOrNull(out);
  if (local) return isolateLocal(out, bed);
  const k = key(out);
  for (const d of ['raw', 'isolated']) mkdirSync(join(out, d), { recursive: true });
  const queue = [...rest];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let f; (f = queue.shift());) {
      const n = nameOf(f), raw = join(out, 'raw', `${n}.wav`), iso = join(out, 'isolated', `${n}.wav`);
      ff(['-i', f, '-vn', '-ac', '1', '-ar', String(SR), raw]);
      const mp3 = join(out, 'isolated', `${n}.mp3`);
      writeFileSync(mp3, await eleven(k, '/v1/audio-isolation', form({}, [['audio', raw]])));
      ff(['-i', mp3, '-ac', '1', '-ar', String(SR), iso]); rmSync(mp3);
      finish(readF32(iso), readF32(raw), bed, join(out, `${n}.wav`));
      console.log(`isolated  ${n}`);
    }
  }));
}

// DeepFilterNet only takes 48 kHz WAV; -D compensates its delay so the voice stays in sync.
async function isolateLocal(out, bed) {
  const df = await installLocal();
  for (const d of ['raw', 'isolated', 'df48']) mkdirSync(join(out, d), { recursive: true });
  for (const f of rest) {
    const n = nameOf(f), raw = join(out, 'raw', `${n}.wav`), iso = join(out, 'isolated', `${n}.wav`);
    const in48 = join(out, 'df48', `${n}.wav`), dfOut = join(out, 'df48', 'out');
    const t0 = Date.now();
    ff(['-i', f, '-vn', '-ac', '1', '-ar', String(SR), raw]);
    ff(['-i', f, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', in48]);
    mkdirSync(dfOut, { recursive: true });
    const r = spawnSync(df, ['-D', '-o', dfOut, in48], { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) die(`deep-filter failed on ${f}: ${r.stderr || r.error}`);
    ff(['-i', join(dfOut, `${n}.wav`), '-ac', '1', '-ar', String(SR), iso]);
    rmSync(join(out, 'df48'), { recursive: true, force: true });
    const wav = join(out, `${n}.wav`);
    finish(readF32(iso), readF32(raw), bed, wav);
    if (args.remux && hasVideo(f)) {
      const mp4 = join(out, `${n}.mp4`);
      ff(['-i', f, '-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', '-movflags', '+faststart', mp4]);
      console.log(`remuxed   ${mp4}`);
    }
    console.log(`isolated  ${n} (DeepFilterNet, ${round((Date.now() - t0) / 1000, 1)} s)`);
  }
}

// Resemble Enhance in its own venv (tools/.venv-enhance), weights from Hugging Face (no git-lfs needed).
const TOOLS = dirname(fileURLToPath(import.meta.url));
const VENV = join(TOOLS, '.venv-enhance');
const vpy = () => join(VENV, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function installEnhance() {
  if (existsSync(join(VENV, '.ok'))) return vpy();
  const py = ['python3.11', 'python3.10', 'py', 'python3', 'python'].find((p) => spawnSync(p, [...(p === 'py' ? ['-3.11'] : []), '--version']).status === 0)
    || die('Python 3.10 or 3.11 is needed for enhance');
  const sh = (c, a) => { const r = spawnSync(c, a, { stdio: 'inherit' }); if (r.status !== 0) die(`${c} ${a.join(' ')} failed`); };
  console.log(`creating ${VENV} (one time)`);
  sh(py, [...(py === 'py' ? ['-3.11'] : []), '-m', 'venv', VENV]);
  const pip = (a) => sh(vpy(), ['-m', 'pip', 'install', '-q', ...a]);
  pip(['torch', 'torchaudio', 'soundfile', 'huggingface_hub', 'scipy', 'librosa', 'omegaconf', 'tqdm', 'rich', 'resampy', 'tabulate', 'celluloid', 'matplotlib', 'pandas', 'ptflops']);
  pip(['--no-deps', 'resemble-enhance']);
  writeFileSync(join(VENV, '.ok'), '');
  return vpy();
}
async function enhance() {
  const out = resolve(args.out || usage(HELP));
  if (!rest.length) usage(HELP);
  const py = installEnhance(), helper = join(TOOLS, 'lib', 'enhance_voice.py');
  mkdirSync(join(out, 'raw'), { recursive: true });
  for (const f of rest) {
    const n = nameOf(f), raw = join(out, 'raw', `${n}.wav`), enh = join(out, 'raw', `${n}.enhanced.wav`), t0 = Date.now();
    ff(['-i', f, '-vn', '-ac', '1', '-ar', '44100', raw]);
    const r = spawnSync(py, [helper, raw, enh, String(args.nfe || 32), join(VENV, 'model')], { stdio: 'inherit' });
    if (r.status !== 0) die(`enhance failed on ${f}`);
    const wav = join(out, `${n}.wav`);
    ff(['-i', enh, '-af', `loudnorm=I=${+(args.lufs ?? -14)}:TP=-1.5:LRA=11`, '-ar', '48000', '-ac', '1', wav]);
    if (args.remux && hasVideo(f)) {
      const mp4 = join(out, `${n}.mp4`);
      ff(['-i', f, '-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', mp4]);
      console.log(`remuxed   ${mp4}`);
    }
    console.log(`enhanced  ${n} (Resemble Enhance, ${round((Date.now() - t0) / 1000, 1)} s)`);
  }
}

async function clone() {
  if (!args.name || !rest.length) usage(HELP);
  const k = key(resolve(args.out || rest[0]));
  const r = JSON.parse((await eleven(k, '/v1/voices/add', form({ name: args.name }, rest.map((f) => ['files', f])), 'application/json')).toString());
  console.log(`voice id  ${r.voice_id}  (${args.name})`);
}

async function patch() {
  const [dirArg, name] = rest;
  if (!dirArg || !name || !args.voice || args.from == null || args.to == null || !args.text) usage(HELP);
  const dir = resolve(dirArg), k = key(dir), from = +args.from, to = +args.to, bed = +(args.bed ?? -18);
  const rawF = join(dir, 'raw', `${name}.wav`), isoF = join(dir, 'isolated', `${name}.wav`);
  if (!existsSync(rawF)) die(`${rawF} missing: run isolate first (it also keeps the raw audio)`);
  const raw = readF32(rawF), isolated = existsSync(isoF);
  const base = isolated ? readF32(isoF) : raw;
  const a = Math.round(from * SR), b = Math.round(to * SR), fade = Math.round(0.02 * SR), ramp = Math.round(0.05 * SR);
  const ref = rms([...base.subarray(Math.max(0, a - SR / 2), a), ...base.subarray(b, b + SR / 2)]);
  const tags = 'abcdef'.slice(0, +(args.takes || 3));
  const settings = [[0.45, 0.15], [0.3, 0.3], [0.6, 0.05], [0.5, 0.1], [0.35, 0.2], [0.55, 0.0]];
  for (const [i, tag] of [...tags].entries()) {
    const body = JSON.stringify({
      text: args.text, model_id: 'eleven_multilingual_v2',
      ...(args.before && { previous_text: args.before }), ...(args.after && { next_text: args.after }),
      voice_settings: { stability: settings[i][0], similarity_boost: 0.9, style: settings[i][1], use_speaker_boost: true, speed: 0.7 },
    });
    const mp3 = join(dir, `${name}-take-${tag}.mp3`);
    writeFileSync(mp3, await eleven(k, `/v1/text-to-speech/${args.voice}?output_format=mp3_44100_192`, body));
    const trimmed = join(tmpdir(), `fix-voice-${process.pid}-${tag}.wav`);
    ff(['-i', mp3, '-af', 'silenceremove=start_periods=1:start_threshold=-40dB,areverse,silenceremove=start_periods=1:start_threshold=-40dB,areverse', '-ac', '1', '-ar', String(SR), trimmed]);
    const len = readF32(trimmed).length / SR, tempo = len / (to - from);
    const fitted = join(tmpdir(), `fix-voice-${process.pid}-${tag}-fit.wav`);
    ff(['-i', trimmed, '-af', `atempo=${Math.min(2, Math.max(0.5, tempo))}`, '-ac', '1', '-ar', String(SR), fitted]);
    const take = readF32(fitted).subarray(0, b - a), gain = ref / rms(take);
    const v = base.slice(), bedGain = new Float32Array(v.length).fill(isolated ? db(bed) : 0);
    for (let j = 0; j < fade; j++) { v[a - fade + j] *= 1 - j / fade; v[b + j] *= j / fade; }
    for (let j = a; j < b; j++) { const e = Math.min(1, (j - a) / fade, (b - j) / fade); v[j] = (take[j - a] || 0) * gain * e; }
    if (isolated) for (let j = a - ramp; j < b + ramp; j++) { // the original stays faintly under the patch
      const t = j < a ? (j - (a - ramp)) / ramp : j >= b ? 1 - (j - b) / ramp : 1;
      bedGain[j] = db(bed) + (db(-32) - db(bed)) * t;
    }
    const x = new Float32Array(v.length);
    for (let j = 0; j < x.length; j++) x[j] = v[j] + (raw[j] || 0) * bedGain[j];
    const out = join(dir, `${name}-fix-${tag}.wav`);
    writeWav(out, x, FINISH());
    rmSync(trimmed); rmSync(fitted);
    if (args.video) ff(['-i', args.video, '-i', out, '-map', '0:v', '-map', '1:a', '-vf', 'scale=540:-2', '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '192k', '-shortest', out.replace(/\.wav$/, '.mp4')]);
    console.log(`take ${tag}    ${out}  (played at ${round(tempo)}x its natural pace)`);
  }
}

const cmds = { isolate, enhance, clone, patch, 'install-local': async () => console.log(await installLocal()) };
if (!cmds[cmd]) usage(HELP);
await cmds[cmd]();
