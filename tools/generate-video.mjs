#!/usr/bin/env node
// generate-video.mjs — generate video ads with Seedance 2.5 on kie.ai (tools/lib/providers.mjs MODELS).
// Each saved file gets a gen/<stem>.gen.json sidecar.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { die, mimeOf, parseArgs, usage } from './lib/catalog.mjs';
import {
  blocked, brandRel, envHelp, errorText, findSidecar, gatewayClient, kieJob, kieUpload, kieUrls, logGatewayWarnings, pickModel, presignRef, runHelp, runOpts,
  runProviders, saveResults, sunraJob, sunraUpload, times, uploadAll, userError, workspaceKeys, writeSidecars,
} from './lib/providers.mjs';

const HELP = `generate-video.mjs — video ad generator, Seedance 2.5 (kie.ai)

  node tools/generate-video.mjs --prompt-file <prompt.txt> --first-frame <img> --out <clip.mp4>
  node tools/generate-video.mjs --image <a.png> --image <b.png> --prompt-file <p.txt> --out <clip.mp4>
  node tools/generate-video.mjs --upgrade <480p-clip.mp4> [--out <clip-1080p.mp4>]

Required:
  --prompt "<text>"        Inline prompt, OR
  --prompt-file <path>     Prompt from a file
  --out <path>             Output video path

Inputs (local files or http(s) URLs). A clip takes frames OR references, never both:
  --first-frame <path|url> Lock the opening frame
  --last-frame <path|url>  Lock the closing frame (needs --first-frame)
  --image <path|url>       Reference image (repeatable; prompts cite them in order): 30 at most,
                           300-6000 px, ratio 0.4-2.5, 30 MB
  --video <path|url>       Reference video (repeatable): 10 at most, mp4/mov/mkv, 480p/720p, 2-30 s,
                           30 s total, 200 MB; billed per input second too
  --audio <path|url>       Reference audio (repeatable; needs an --image or --video too): 10 at most,
                           wav/mp3/aac/ogg, 2-30 s, 30 s total

Optional:
  --resolution <res>       480p (default) | 720p | 1080p
  --duration <seconds>     4-30 (default 5), or auto (the model picks)
  --aspect <ratio>         1:1 4:3 3:4 16:9 9:16 21:9 adaptive (default)
  --no-audio               No generated sound (otherwise it adds its own)
  --upgrade <clip>         Remake a 480p take at 1080p as the same take (same motion, timing and
                           voice), within 7 days of it, at the 1080p rate. --out defaults to
                           <clip>-1080p.mp4
${runHelp(600)}

${envHelp()}`;

// kie's limits, from the doc linked in MODELS. res = our name -> kie's value.
const L = {
  res: { '480p': '480p', '720p': '720p', '1080p': '1080p' }, durations: [4, 30], aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'],
  images: 30, videos: 10, audios: 10,
};

// The input, with hosted URLs in o. A 480p take is a draft: same price and look as a normal 480p one, and it keeps
// --upgrade open.
function input(o) {
  const lists = { reference_image_urls: o.imageUrls, reference_video_urls: o.videoUrls, reference_audio_urls: o.audioUrls };
  return {
    prompt: o.prompt, duration: o.duration, resolution: o.res, generate_audio: o.audio, aspect_ratio: o.aspect,
    first_frame_url: o.firstFrameUrl, last_frame_url: o.lastFrameUrl, ...Object.fromEntries(Object.entries(lists).filter(([, v]) => v.length)),
    ...(o.res === '480p' && { draft: true }),
  };
}

// [operation, input] on sunra (the model's API tab on sunra.ai). o as above.
function sunraInput(o) {
  const op = o.refs ? 'reference-to-video' : o.firstFrameUrl || o.lastFrameUrl ? 'image-to-video' : 'text-to-video';
  const lists = { reference_images: o.imageUrls, reference_videos: o.videoUrls, reference_audios: o.audioUrls };
  return [op, {
    prompt: o.prompt, duration: o.duration, resolution: o.res, start_image: o.firstFrameUrl, end_image: o.lastFrameUrl, generate_audio: o.audio,
    ...Object.fromEntries(Object.entries(lists).filter(([, v]) => v.length)),
    ...(op !== 'image-to-video' && o.aspect && { ratio: o.aspect }), ...(o.res === '480p' && { draft: true }),
  }];
}

// The 1080p version of a Seedance 480p take, from the draft task in its sidecar.
async function upgrade(args) {
  const clip = String(args.upgrade);
  const side = findSidecar(clip);
  const gen = side ? JSON.parse(await readFile(side, 'utf8')) : {};
  if (!gen.draftTask) die(`${clip} has no draft to upgrade (only 480p takes made on kie or sunra have one): make a fresh 1080p take instead.`);
  if (Date.now() - Date.parse(gen.at) > 7 * 864e5) die(`${clip}'s draft is over 7 days old: make a fresh 1080p take instead.`);
  const out = String(args.out || clip.replace(/(\.[^./]+)?$/, '-1080p.mp4'));
  const { W, keys } = workspaceKeys(out);
  const entry = pickModel({ model: gen.model }, 'video', 'seedance-2.5');
  const { timeout } = runOpts(args, 600);
  // A draft upgrades only on the provider that made it.
  if (gen.provider === 'sunra' && !keys.sunra) die(`${clip} was made on sunra: add ${W}_SUNRA_API_KEY to .env to upgrade it.`);
  const results = gen.provider === 'sunra'
    ? [(await sunraJob(`${entry.sunra}/draft-to-video`, { draft_task_id: gen.draftTask, output_format: 'mp4' }, timeout)).video.url]
    : await kieJob(`${entry.kie}-draft`, { draft_task_id: gen.draftTask, resolution: '1080p', output_format: 'mp4' }, timeout);
  const saved = await saveResults(results, out, { fallbackExt: 'mp4' });
  await writeSidecars(saved, { ...gen, params: { ...gen.params, resolution: '1080p' }, each: [{ upgradedFrom: brandRel(clip) }] });
}

// AI Gateway sizes for Seedance (vercel.com/docs/ai-gateway/modalities/video-generation).
const GATEWAY_RESOLUTION = { '480p': '854x480', '720p': '1280x720', '1080p': '1920x1080' };

async function main() {
  const args = parseArgs(process.argv.slice(2), { repeat: ['video', 'image', 'audio'], flags: ['no-audio'], help: HELP });
  for (const k of ['video', 'image', 'audio']) args[k] ||= [];
  if (args.upgrade) return upgrade(args);
  if (!args.prompt && !args['prompt-file']) usage(HELP);
  if (!args.out) die('--out is required');
  const { W } = workspaceKeys(args.out);

  const prompt = args['prompt-file'] ? (await readFile(resolve(args['prompt-file']), 'utf8')).trim() : String(args.prompt);
  if (!prompt) die('prompt is empty');

  const entry = pickModel(args, 'video', 'seedance-2.5');
  const firstFrame = args['first-frame'] ? String(args['first-frame']) : undefined;
  const lastFrame = args['last-frame'] ? String(args['last-frame']) : undefined;
  const frames = !!(firstFrame || lastFrame);
  const refs = args.image.length + args.video.length + args.audio.length;

  const resolution = String(args.resolution || Object.keys(L.res)[0]).toLowerCase();
  if (!L.res[resolution]) die(`--resolution is ${Object.keys(L.res).join(' | ')}, not ${resolution}.`);
  const durArg = String(args.duration || 5);
  const duration = durArg === 'auto' ? -1 : Number(durArg);
  if (duration !== -1 && !(Number.isInteger(duration) && duration >= L.durations[0] && duration <= L.durations[1])) die(`--duration is ${L.durations[0]}-${L.durations[1]} or auto, not ${durArg}.`);
  const aspect = args.aspect ? String(args.aspect).replace('x', ':') : undefined;
  if (aspect && !L.aspects.includes(aspect)) die(`--aspect is ${L.aspects.join(' ')}, not ${aspect}.`);

  if (frames && refs) die('A clip takes --first-frame/--last-frame OR --image/--video/--audio references, not both.');
  if (lastFrame && !firstFrame) die('--last-frame needs --first-frame.');
  for (const k of ['image', 'video', 'audio']) if (args[k].length > L[`${k}s`]) die(`At most ${L[`${k}s`]} --${k} references.`);
  if (args.audio.length && !args.image.length && !args.video.length) die('--audio references need an --image or --video reference too.');
  const audio = !args['no-audio'];

  const { num, timeout } = runOpts(args, 600);
  const base = { prompt, aspect, duration, audio, refs, res: L.res[resolution] };
  let each = []; // per saved file: its draft task, for --upgrade

  async function runKie() {
    const o = {
      ...base,
      imageUrls: await uploadAll(args.image), videoUrls: await uploadAll(args.video), audioUrls: await uploadAll(args.audio),
      firstFrameUrl: firstFrame && await kieUpload(firstFrame), lastFrameUrl: lastFrame && await kieUpload(lastFrame),
    };
    const req = input(o);
    const takes = await times(num, () => kieJob(entry.kie, req, timeout, {
      pick: (d, taskId) => kieUrls(d)?.map((url) => ({ url, taskId })),
    }));
    if (req.draft) each = takes.map((t) => ({ draftTask: t.taskId }));
    return takes.map((t) => t.url);
  }

  async function runSunra() {
    if (frames && args.aspect) throw blocked('sunra takes no --aspect with frames: the frame sets the shape.');
    const host = (list) => uploadAll(list, sunraUpload);
    const o = {
      ...base, imageUrls: await host(args.image), videoUrls: await host(args.video), audioUrls: await host(args.audio),
      firstFrameUrl: firstFrame && await sunraUpload(firstFrame), lastFrameUrl: lastFrame && await sunraUpload(lastFrame),
    };
    const [op, req] = sunraInput(o);
    const takes = await times(num, () => sunraJob(`${entry.sunra}/${op}`, req, timeout));
    if (req.draft) each = takes.map((t) => ({ draftTask: t.draft_task_id }));
    return takes.map((t) => t.video.url);
  }

  // The Gateway takes refs as URLs.
  async function runGateway() {
    if (args.audio.length) throw userError('reference audio (--audio) has no documented AI Gateway input.');
    if (duration === -1) throw userError('--duration auto has no AI Gateway equivalent.');
    const { ai, gw } = await gatewayClient(process.env.AI_GATEWAY_API_KEY, timeout + 300);
    const host = (p) => presignRef(p, args.out);
    const typed = async (p, fallback) => {
      const type = mimeOf(String(p).split('?')[0]);
      return { data: await host(p), mediaType: type === 'application/octet-stream' ? fallback : type };
    };
    const frameImages = [];
    if (firstFrame) frameImages.push({ image: await host(firstFrame), frameType: 'first_frame' });
    if (lastFrame) frameImages.push({ image: await host(lastFrame), frameType: 'last_frame' });
    const inputReferences = [];
    for (const im of args.image) inputReferences.push(await typed(im, 'image/png'));
    for (const v of args.video) inputReferences.push(await typed(v, 'video/mp4'));
    console.error(`gateway   ${entry.gateway}  ${resolution} ${aspect || 'adaptive'} ${duration}s  frames=${frameImages.length} refs=${inputReferences.length}`);
    return times(num, async () => {
      const r = await ai.experimental_generateVideo({
        model: gw.videoModel(entry.gateway), prompt, n: 1, duration, aspectRatio: aspect || 'adaptive',
        resolution: GATEWAY_RESOLUTION[resolution], generateAudio: audio,
        ...(frameImages.length ? { frameImages } : {}),
        ...(inputReferences.length ? { inputReferences } : {}),
        providerOptions: { bytedance: { pollTimeoutMs: timeout * 1000 } },
        maxRetries: 0,
      });
      logGatewayWarnings(r.warnings);
      return r.videos.map((v) => ({ bytes: v.uint8Array, mediaType: v.mediaType }));
    });
  }

  const { results, provider } = await runProviders({ entry, provider: args.provider, ws: W, kie: runKie, sunra: runSunra, gateway: runGateway });
  const saved = await saveResults(results, args.out, { fallbackExt: 'mp4' });
  const refList = [['first-frame', firstFrame], ['last-frame', lastFrame], ...['image', 'video', 'audio'].flatMap((k) => args[k].map((p) => [k, p]))];
  await writeSidecars(saved, {
    tool: 'generate-video', model: entry.name, provider, prompt,
    params: { aspect, resolution, duration: duration === -1 ? 'auto' : duration, audio },
    refs: refList.filter(([, p]) => p).map(([role, path]) => ({ role, path })),
    each,
  });
}

main().catch((e) => die(errorText(e)));
