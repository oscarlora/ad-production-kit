#!/usr/bin/env node
// generate-image.mjs — generate image ads on kie.ai (models: tools/lib/providers.mjs MODELS).
// Saved files are stripped of metadata (C2PA, EXIF, XMP) and get a <stem>.gen.json sidecar.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanImage } from './lib/clean-image.mjs';
import { die, imageFitCmd, parseArgs, runAsync, usage } from './lib/catalog.mjs';
import {
  blocked, envHelp, errorText, gatewayClient, kieJob, logGatewayWarnings, pickModel, runHelp, runOpts, runProviders, saveResults,
  sunraJob, sunraUpload, times, uploadAll, userError, workspaceKeys, writeSidecars,
} from './lib/providers.mjs';

const HELP = `generate-image.mjs — image ad generator (kie.ai)

  node tools/generate-image.mjs --record workspaces/<WS>/Acme/outputs/json/3.json
  node tools/generate-image.mjs --prompt "<text>" --ref "<img>" --out "<path>.png"

Required (or --record):
  --prompt "<text>"        Inline prompt (max 20,000 characters), OR
  --prompt-file <path>     Prompt from a file
  --out <path>             Output image path
  --record <path>          Per-ad record (outputs/json/<id>.json): supplies prompt/refs/params and is
                           stamped with what was sent + the output

Optional:
  --model <name>           gpt-image-2.6 (default; GPT Image 2.6 Flare) | nano-banana-2.1 (its fallback)
  --ref <path|url>         Reference image (repeatable, order kept: --ref N = reference image N).
                           Max 16 on gpt-image-2.6, 10 on nano-banana-2.1 (jpeg/png/webp, 30 MB);
                           extras are dropped with a WARN
  --aspect <ratio>         4:5 (default; 4x5 also works)
                           gpt-image-2.6: 1:1 3:2 2:3 4:3 3:4 5:4 4:5 16:9 9:16 2:1 1:2 21:9 9:21 3:1 1:3 auto
                           nano-banana-2.1: 1:1 2:3 3:2 1:4 4:1 3:4 4:3 4:5 5:4 1:8 8:1 9:16 16:9 21:9 auto
  --resolution <res>       1K (default) | 2K | 4K
  --background <b>         gpt-image-2.6 at 1K: auto (default) | opaque | transparent
  --format <ext>           png (default) | jpg, and on gpt-image-2.6 also webp | gif
                           gif: an animated GIF, from the prompt only (no --ref), kie only; 1K comes out 512 px
  --frames <n>             gif: auto (default) | 4 | 9 | 16 | 25 | 36 | 64
  --frame-ms <ms>          gif: each frame's duration, 20-2000 (default: the model picks)
${runHelp(300)}

${envHelp('the --out/--record path')}`;

// kie request limits per model, from the docs linked in MODELS.
const LIMITS = {
  'gpt-image-2.6': {
    refs: 16, formats: ['png', 'jpg', 'webp', 'gif'],
    aspects: ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '21:9', '9:21', '3:1', '1:3', 'auto'],
  },
  'nano-banana-2.1': {
    refs: 10, formats: ['png', 'jpg'],
    aspects: ['1:1', '2:3', '3:2', '1:4', '4:1', '3:4', '4:3', '4:5', '5:4', '1:8', '8:1', '9:16', '16:9', '21:9', 'auto'],
  },
};
const TIERS = ['1K', '2K', '4K'];
const FRAMES = ['auto', '4', '9', '16', '25', '36', '64'];

// Why kie can't take this aspect, or null.
function kieBlocker(shape, aspect) {
  const { aspects } = LIMITS[shape];
  return aspects.includes(aspect) ? null : `takes --aspect ${aspects.join(' ')}, not ${aspect}`;
}

// Drops are named loudly: the prompt numbers its references.
function checkRefs(shape, refs) {
  const max = LIMITS[shape].refs;
  if (refs.length <= max) return refs;
  const label = (p) => basename(String(p).split('?')[0]);
  console.error(`WARN: ${shape} accepts at most ${max} reference images, sending the first ${max} of ${refs.length}.`);
  console.error(`WARN: dropped ${refs.slice(max).map(label).join(', ')}. The prompt's "Reference image N" lines past ${max} now describe images the model never sees.`);
  return refs.slice(0, max);
}

async function viaKie({ entry, prompt, refs, aspect, resolution, background, format, frames, frameMs, num, timeout }) {
  const refUrls = await uploadAll(refs);
  const input = { prompt, aspect_ratio: aspect, resolution };
  let id = entry.kie;
  if ((entry.shape || entry.name) === 'gpt-image-2.6') {
    if (background) input.background = background;
    if (format !== 'png') input.output_format = format;
    if (frames) input.frame_count = frames;
    if (frameMs) input.frame_duration_ms = frameMs;
    if (refUrls.length) input.input_urls = refUrls;
    if (!entry.unlisted) id += refUrls.length ? '-image-to-image' : '-text-to-image';
  } else {
    input.output_format = format;
    if (refUrls.length) input.image_input = refUrls;
  }
  return times(num, () => kieJob(id, input, timeout, { pollMs: 2000 }));
}

// sunra: GPT Image takes a pixel size; Nano Banana its own aspect list, PNG only. No GIFs.
async function viaSunra({ entry, prompt, refs, aspect, resolution, background, format, num, timeout }) {
  const gpt = entry.name === 'gpt-image-2.6';
  if (format === 'gif') throw userError('GIFs are made on kie only.');
  if (!gpt && (aspect === 'auto' || format !== 'png')) throw blocked(`${entry.name} on sunra takes no --aspect auto and makes PNG only.`);
  const images = await uploadAll(refs, sunraUpload);
  const input = { prompt, ...(images.length ? { images } : {}) };
  if (!gpt) Object.assign(input, { aspect_ratio: aspect, resolution });
  else {
    if (aspect !== 'auto') [input.width, input.height] = sizeForTier(aspect, resolution).split('x').map(Number);
    input.output_format = format === 'jpg' ? 'jpeg' : format;
    if (background) input.background = background;
  }
  const path = `${entry.sunra}/${images.length ? 'image-editing' : 'text-to-image'}`;
  return times(num, async () => (await sunraJob(path, input, timeout, { pollMs: 2000 })).images.map((im) => im.url));
}

// Long edge from the tier, short edge from the aspect, both multiples of 16 (GPT Image needs it).
function sizeForTier(aspect, tier) {
  const [a, b] = aspect.split(':').map(Number);
  const long = { '1K': 1280, '2K': 2048, '4K': 3840 }[tier];
  const r16 = (n) => Math.max(16, Math.round(n / 16) * 16);
  return b >= a ? `${r16(long * a / b)}x${long}` : `${long}x${r16(long * b / a)}`;
}

// Local refs are downscaled to <=2048 and sent inline (the original when that fails); URLs pass through.
async function inlineRefs(refs) {
  const tmp = mkdtempSync(join(tmpdir(), 'gwref-'));
  try {
    const images = [];
    for (const [i, r] of refs.entries()) {
      if (/^https?:\/\//i.test(r)) { images.push(r); continue; }
      const abs = resolve(r), small = join(tmp, `${i}.png`);
      if (!existsSync(abs)) throw userError(`reference not found: ${r}`);
      const [bin, args] = imageFitCmd(abs, 2048, small);
      const ok = (await runAsync(bin, args, { allowFail: true })).status === 0 && existsSync(small);
      images.push(await readFile(ok ? small : abs));
    }
    return images;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// Gemini (Nano Banana) is a language model on the Gateway: generateText with image output.
async function viaGateway({ entry, prompt, refs, aspect, resolution, format, num, timeout }) {
  if (format === 'gif') throw userError('GIFs are made on kie only.');
  const { ai, gw } = await gatewayClient(process.env.AI_GATEWAY_API_KEY, timeout);
  const images = await inlineRefs(refs);
  const blobs = []; // { bytes, mediaType }
  if (entry.gateway.startsWith('google/')) {
    console.error(`gateway   ${entry.gateway}  aspect=${aspect}  size=${resolution}  refs=${images.length}`);
    const content = [...images.map((image) => ({ type: 'image', image })), { type: 'text', text: prompt }];
    const runs = await times(num, () => ai.generateText({
      model: gw(entry.gateway),
      messages: [{ role: 'user', content }],
      providerOptions: { google: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect, imageSize: resolution } } },
      maxRetries: 0,
    }));
    for (const r of runs) {
      logGatewayWarnings(r.warnings);
      const files = r.files.filter((f) => f.mediaType?.startsWith('image/'));
      if (!files.length) throw new Error(`${entry.gateway} returned no image${r.text ? `: ${r.text.slice(0, 200)}` : ''}`);
      for (const f of files) blobs.push({ bytes: f.uint8Array, mediaType: f.mediaType });
    }
  } else {
    const size = sizeForTier(aspect, resolution);
    console.error(`gateway   ${entry.gateway}  size=${size}  refs=${images.length}`);
    const res = await ai.generateImage({
      model: gw.imageModel(entry.gateway),
      prompt: images.length ? { images, text: prompt } : prompt,
      n: num, size, maxRetries: 0,
    });
    logGatewayWarnings(res.warnings);
    for (const im of res.images) blobs.push({ bytes: Buffer.from(im.base64, 'base64'), mediaType: im.mediaType });
  }
  return blobs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { repeat: ['ref'], help: HELP });
  args.ref ||= [];
  if (!args.prompt && !args['prompt-file'] && !args.record) usage(HELP);

  let record = null, recordPath = null;
  if (args.record) { recordPath = resolve(args.record); record = JSON.parse(await readFile(recordPath, 'utf8')); }
  const g = (record && record.generation) || {};

  const out = args.out || g.output;
  if (!out) die('--out is required (or record.generation.output)');

  const { W } = workspaceKeys([out, recordPath, args['prompt-file'], ...args.ref], '--out/--record');

  const prompt = args['prompt-file'] ? (await readFile(resolve(args['prompt-file']), 'utf8')).trim()
    : args.prompt != null ? String(args.prompt)
    : g.prompt != null ? String(g.prompt) : '';
  if (!prompt) die('prompt is empty (pass --prompt/--prompt-file or a record with generation.prompt)');

  const entry = pickModel({ model: args.model || g.model, 'unlisted-model': args['unlisted-model'] }, 'image', 'gpt-image-2.6');
  const shape = entry.shape || entry.name;
  const aspect = String(args.aspect || g.aspect || '4:5').replace('x', ':');
  const resolution = String(args.resolution || g.resolution || '1K').toUpperCase();
  if (!TIERS.includes(resolution)) die(`--resolution must be ${TIERS.join(' | ')} (got "${resolution}")`);
  const background = args.background || g.background ? String(args.background || g.background).toLowerCase() : null;
  if (background && (shape !== 'gpt-image-2.6' || resolution !== '1K' || !['auto', 'opaque', 'transparent'].includes(background)))
    die('--background is auto | opaque | transparent, on gpt-image-2.6 at 1K only.');
  const format = String(args.format || g.format || 'png').toLowerCase().replace('jpeg', 'jpg');
  const { formats } = LIMITS[shape];
  if (!formats.includes(format)) die(`--format on ${shape} is ${formats.join(' | ')} (got "${format}").`);
  const frames = args.frames || g.frames ? String(args.frames || g.frames) : null;
  const frameMs = args['frame-ms'] || g.frameMs ? Number(args['frame-ms'] || g.frameMs) : null;
  if ((frames || frameMs) && format !== 'gif') die('--frames and --frame-ms need --format gif.');
  if (frames && !FRAMES.includes(frames)) die(`--frames is ${FRAMES.join(' | ')} (got "${frames}").`);
  if (frameMs != null && !(Number.isInteger(frameMs) && frameMs >= 20 && frameMs <= 2000)) die('--frame-ms is a whole number from 20 to 2000.');
  const { num, timeout } = runOpts(args, 300);
  const refsIn = args.ref.length ? args.ref : (Array.isArray(g.refs) ? g.refs : []);
  const refs = checkRefs(shape, refsIn);
  if (format === 'gif' && refs.length) die('--format gif works from the prompt only: kie\'s image-to-image has no GIF output. Describe the product in the prompt, or make a video ad instead.');

  const opts = { entry, prompt, refs, aspect, resolution, background, format, frames, frameMs, num, timeout };
  const ran = await runProviders({
    entry, provider: args.provider, ws: W, kie: () => viaKie(opts), sunra: () => viaSunra(opts), gateway: () => viaGateway(opts),
    blocker: entry.unlisted ? null : kieBlocker(shape, aspect),
  });
  const saved = await saveResults(ran.results, out, { fallbackExt: format, transform: cleanImage });
  await writeSidecars(saved, {
    tool: 'generate-image', model: entry.name, provider: ran.provider, prompt,
    params: { aspect, resolution, background, format: format === 'png' ? null : format, frames, frameMs },
    refs: refs.map((path) => ({ role: 'ref', path })),
  });

  if (record) {
    record.generation = {
      ...g, provider: ran.provider, model: entry.name, aspect, resolution, ...(background ? { background } : {}),
      ...(format !== 'png' ? { format } : {}), ...(frames ? { frames } : {}), ...(frameMs ? { frameMs } : {}),
      prompt, refs: refsIn, output: saved[0], outputs: saved, generatedAt: new Date().toISOString(),
    };
    record.status = 'pending-review';
    await writeFile(recordPath, JSON.stringify(record, null, 2) + '\n');
    console.error('record    updated ' + recordPath);
  }
}

main().catch((e) => die(errorText(e)));
