// extend-to-story.mjs — turn an approved 4:5 static into its 9:16 Story version: the image model
// fills the space above and below (via generate-image.mjs, 2K), from the ad already placed on the 9:16 canvas.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffprobeJson, parseArgs, run, usage } from './lib/catalog.mjs';
import { fetchMissing } from './lib/r2.mjs';

const HELP = `extend-to-story.mjs — an approved 4:5 static → its 9:16 Story version

  node tools/extend-to-story.mjs --in <approved 4:5.png> --out <story.png> \\
    --above "<what continues above>" --below "<what continues below>" [--timeout 600] [--paste] [--dry]
  node tools/extend-to-story.mjs --in <approved 4:5.png> --out <story.png> --smear
    --paste  put the original back over the middle (60 px feathered seam), so only the bars are new;
             without it the model re-renders the middle and small text can drift. With --paste, --above or
             --below "plain" keeps that bar the flat edge color (no model pixels there)
    --dry    print the prompt, no generation
    --smear  no generation: fill above and below with the color of the ad's top and bottom edges. For a plain
             background above and below (flat color, no photo or texture at the edges): free and pixel-exact`;

const args = parseArgs(process.argv.slice(2), { flags: ['paste', 'dry', 'smear'], help: HELP });
if ((args.smear ? ['in', 'out'] : ['in', 'out', 'above', 'below']).some((k) => !args[k] || args[k] === true)) usage(HELP);
await fetchMissing(args.in);

const tmp = mkdtempSync(join(tmpdir(), 'story-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
const { width: w, height: h } = (ffprobeJson(args.in).streams || []).find((s) => s.codec_type === 'video') || {};
if (!w || !h) { console.error(`Could not read the size of ${args.in}.`); process.exit(1); }
const H = Math.trunc(w * 16 / 9 / 2) * 2, top = Math.trunc((H - h) / 2), f = 60;
// The ad on the 9:16 canvas, each bar the most common color of the ad's edge row (so a thin line or speck there isn't
// stretched): the --smear result, and the generation's reference (it sits next to --out).
const rowColor = (y) => {
  const px = spawnSync('ffmpeg', ['-v', 'error', '-i', args.in, '-vf', `crop=iw:1:0:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).stdout;
  const n = new Map();
  for (let i = 0; i < px.length; i += 3) { const c = px.readUIntBE(i, 3); n.set(c, (n.get(c) || 0) + 1); }
  return `0x${[...n].sort((a, b) => b[1] - a[1])[0][0].toString(16).padStart(6, '0')}`;
};
const canvas = args.smear ? args.out : join(dirname(args.out), `.${basename(args.out, '.png')}.canvas.png`);
run('ffmpeg', ['-v', 'error', '-y', '-i', args.in, '-filter_complex',
  `pad=iw:${H}:0:${top}:color=${rowColor(0)},drawbox=x=0:y=${top + h}:w=iw:h=${H - h - top}:color=${rowColor(h - 1)}:t=fill`, canvas]);
if (args.smear) { console.log(`Saved: ${args.out}`); process.exit(0); }
process.on('exit', () => rmSync(canvas, { force: true }));

const plain = (k) => /^plain$/i.test(args[k]);
const prompt = `Create 1 2K, 9:16 image: the ad in the reference image, finished as a 9:16 Story.

Above the ad's content, ${plain('above') ? 'the plain background color' : args.above}. Below it, ${plain('below') ? 'the plain background color' : args.below}. Everything else stays exactly as it is in the reference: same position, size, text, product and colors.

Don't redraw, move or restyle anything, and don't add text, logos or objects.`;
const promptFile = join(tmp, 'prompt.txt');
writeFileSync(promptFile, prompt);
if (args.dry) { console.log(prompt); process.exit(0); }

const gen = join(dirname(fileURLToPath(import.meta.url)), 'generate-image.mjs');
const r = spawnSync(process.execPath, [gen, '--prompt-file', promptFile, '--ref', canvas, '--aspect', '9:16', '--resolution', '2K',
  '--timeout', String(args.timeout || 600), '--out', args.out], { stdio: 'inherit' });
if (r.status !== 0 || !args.paste) process.exit(r.status ?? 1);

// The model can scale or shift the ad a little; find that (the best match of its middle to the canvas, on small grey
// copies) and undo it, so the pasted original lines up with what the model drew around it.
const gray = (file, gw, gh) => spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${gw}:${gh},format=gray`, '-f', 'rawvideo', '-']).stdout;
const gw = 128, gh = Math.round(gw * H / w), want = gray(canvas, gw, gh), got = gray(args.out, gw, gh);
const y0 = Math.round(top * gh / H), y1 = Math.round((top + h) * gh / H);
let best = { e: Infinity, s: 1, dx: 0, dy: 0 };
for (let s = 0.9; s <= 1.1; s += 0.005) for (let dx = -10; dx <= 10; dx++) for (let dy = -16; dy <= 16; dy++) {
  let e = 0;
  for (let y = y0; y < y1; y += 2) for (let x = 0; x < gw; x += 2) {
    const sx = Math.round((x - gw / 2 - dx) / s + gw / 2), sy = Math.round((y - gh / 2 - dy) / s + gh / 2);
    e += sx < 0 || sy < 0 || sx >= gw || sy >= gh ? 255 : Math.abs(got[sy * gw + sx] - want[y * gw + x]);
  }
  if (e < best.e) best = { e, s, dx, dy };
}
const sw = Math.round(w * best.s / 2) * 2, sh = Math.round(H * best.s / 2) * 2;
const ox = Math.round((w - sw) / 2 + best.dx * w / gw), oy = Math.round((H - sh) / 2 + best.dy * H / gh);

// Paste the original back over the middle, feathered at its top and bottom edges; a bar given as "plain" keeps the
// canvas's flat color there (and over the seam beside it).
const bars = [plain('above') && `[2]crop=iw:${top + f}:0:0[ca];[b][ca]overlay=0:0[b]`, plain('below') && `[2]crop=iw:${H - top - h + f}:0:${top + h - f}[cb];[b][cb]overlay=0:${top + h - f}[b]`]
  .filter(Boolean).map((x) => `;${x}`).join('');
const pasted = join(tmp, 'pasted.png');
run('ffmpeg', ['-v', 'error', '-y', '-i', args.out, '-i', args.in, '-i', canvas, '-filter_complex',
  `[2]copy[bg];[0]scale=${w}:${H},scale=${sw}:${sh}[g];[bg][g]overlay=${ox}:${oy}[b]${bars};[1]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*min(1,min(Y,H-1-Y)/${f})'[o];[b][o]overlay=0:${top}`,
  '-frames:v', '1', pasted]);
copyFileSync(pasted, args.out);
