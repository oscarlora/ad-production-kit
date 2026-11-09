// extend-to-story.mjs — turn an approved 4:5 static into its 9:16 Story version: the image model
// fills bars above and below (via generate-image.mjs, 2K).
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
    --paste  put the original back over the middle (60 px feathered seam), so only the bars are new;
             without it the model re-renders the middle and small text can drift
    --dry    print the prompt and write the padded canvas, no generation`;

const args = parseArgs(process.argv.slice(2), { flags: ['paste', 'dry'], help: HELP });
if (['in', 'out', 'above', 'below'].some((k) => !args[k] || args[k] === true)) usage(HELP);
await fetchMissing(args.in);

const tmp = mkdtempSync(join(tmpdir(), 'story-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
// The canvas sits next to --out.
const padded = join(dirname(args.out), `.${basename(args.out, '.png')}.canvas.png`);
const bar = args.paste ? 'white' : 'grey'; // with --paste, grey bars would read as content and leak into a grey subject
run('ffmpeg', ['-v', 'error', '-y', '-i', args.in, '-vf', `pad=iw:trunc(iw*16/9/2)*2:0:(oh-ih)/2:color=${args.paste ? '0xFFFFFF' : '0x808080'}`, padded]);

const prompt = `Create 1 2K, 9:16 image by extending the reference image.

The reference is a 9:16 canvas: a finished 4:5 ad sits in the middle, with flat ${bar} bars above and below it.

- Keep the middle ad exactly as it is, in the same position and size: nothing moved, redrawn, or restyled, and every word of text identical.
- Fill only the ${bar} bars by continuing the image naturally: above, ${args.above}; below, ${args.below}. Match the light, color, grain, and perspective so there is no visible seam.
- Add nothing new to the bars: no text, stickers, logos, or new objects.

Constraints: one single image. Natural, undistorted proportions.`;
const promptFile = join(tmp, 'prompt.txt');
writeFileSync(promptFile, prompt);
if (args.dry) { console.log(prompt + `\n\npadded canvas: ${padded}`); process.exit(0); }

const gen = join(dirname(fileURLToPath(import.meta.url)), 'generate-image.mjs');
const r = spawnSync(process.execPath, [gen, '--prompt-file', promptFile, '--ref', padded, '--aspect', '9:16', '--resolution', '2K',
  '--timeout', String(args.timeout || 600), '--out', args.out], { stdio: 'inherit' });
if (r.status !== 0 || !args.paste) { rmSync(padded, { force: true }); process.exit(r.status ?? 1); }

// Paste the original back over the middle, feathered at its top and bottom edges.
const { width: w, height: h } = (ffprobeJson(args.in).streams || []).find((s) => s.codec_type === 'video') || {};
if (!w || !h) { console.error(`Could not read the size of ${args.in}.`); process.exit(1); }
const H = Math.trunc(w * 16 / 9 / 2) * 2, top = Math.trunc((H - h) / 2), f = 60;
const pasted = join(tmp, 'pasted.png');
run('ffmpeg', ['-v', 'error', '-y', '-i', args.out, '-i', args.in, '-filter_complex',
  `[0]scale=${w}:${H}[b];[1]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*min(1,min(Y,H-1-Y)/${f})'[o];[b][o]overlay=0:${top}`,
  '-frames:v', '1', pasted]);
copyFileSync(pasted, args.out);
rmSync(padded, { force: true });
