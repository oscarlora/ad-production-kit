#!/usr/bin/env node
// remove-background.mjs — cut a person out of their footage: a matte video per clip, which an edit's video clip
// takes as `matte` (edit-video) to draw only the person, over whatever sits on the tracks below.
// MODNet portrait matting via transformers.js, on this computer; no key. The model (~25 MB) downloads once.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { die, parseArgs, run, usage } from './lib/catalog.mjs';

const HELP = `remove-background.mjs — cut a person out of their footage (MODNet, local, no key).

  node tools/remove-background.mjs <clip>... --out <dir> [--force]
      Each clip → <dir>/<name>.mp4: a matte video (white = the person), frame for frame with the clip.
      In the edit, the clip takes "matte": "<dir>/<name>.mp4" and draws only the person.
      About 0.3 s a frame on a laptop CPU (a minute of footage ≈ 9 min); clips with a matte are skipped
      unless --force.`;

const a = parseArgs(process.argv.slice(2), { flags: ['force'], help: HELP });
if (!a._.length || !a.out) usage(HELP);
const OUT = resolve(a.out);
mkdirSync(OUT, { recursive: true });

const W = 512, H = 896; // the model's input (multiples of 32); the matte is stretched back to the clip when drawn
const CACHE = join(homedir(), '.cache', 'adpk', 'huggingface');

let model;
async function load() {
  let T;
  try { T = await import('@huggingface/transformers'); } catch { die('needs npm deps — run `npm install` in the repo root'); }
  T.env.cacheDir = CACHE;
  return { T, model: await T.AutoModel.from_pretrained('Xenova/modnet', { device: 'cpu', dtype: 'fp32' }) };
}

// Frames of a clip, upright and scaled to the model's input, one rgb24 buffer at a time.
async function* frames(src) {
  const p = spawn('ffmpeg', ['-v', 'error', '-i', src, '-an', '-vf', `scale=${W}:${H}`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const size = W * H * 3;
  let buf = Buffer.alloc(0);
  for await (const chunk of p.stdout) {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= size) { yield buf.subarray(0, size); buf = buf.subarray(size); }
  }
}

async function matte(src) {
  const name = basename(src, extname(src)), out = join(OUT, `${name}.mp4`);
  if (existsSync(out) && !a.force) return console.log(`= ${name} (has a matte)`);
  const [rate, start, count] = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate,start_time,nb_frames', '-of', 'csv=p=0', src]).stdout.trim().split(',');
  model ||= await load();
  const { T } = model;
  const tmp = `${out}.part.mp4`;
  // Same frame count, rate and start as the clip, so its frame at time t is the clip's frame at t.
  const enc = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${W}x${H}`, '-framerate', rate, '-i', '-',
    '-output_ts_offset', String(+start || 0), '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp]);
  const done = new Promise((ok, no) => enc.on('close', (c) => (c ? no(new Error(`${name}: ffmpeg exited ${c}`)) : ok())));
  const input = new Float32Array(3 * W * H), mask = Buffer.alloc(W * H);
  let n = 0;
  for await (const rgb of frames(src)) {
    for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) input[c * W * H + i] = rgb[i * 3 + c] / 127.5 - 1;
    const r = await model.model({ input: new T.Tensor('float32', input, [1, 3, H, W]) });
    const m = Object.values(r)[0].data;
    for (let i = 0; i < W * H; i++) mask[i] = Math.round(Math.min(1, Math.max(0, m[i])) * 255);
    if (!enc.stdin.write(mask)) await new Promise((ok) => enc.stdin.once('drain', ok));
    if (++n % 60 === 0) process.stdout.write(`\r  ${name}: ${n}/${count || '?'} frames`);
  }
  enc.stdin.end();
  await done;
  renameSync(tmp, out);
  console.log(`\r✓ ${name}: ${n} frames → ${out}`);
}

for (const src of a._) await matte(resolve(src));
