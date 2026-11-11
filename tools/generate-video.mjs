#!/usr/bin/env node
// generate-video.mjs — generate video ads on kie.ai (models: tools/lib/providers.mjs MODELS).
// Each saved file gets a <stem>.gen.json sidecar.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { die, ffprobeJson, mimeOf, parseArgs, usage } from './lib/catalog.mjs';
import {
  blocked, brandRel, envHelp, errorText, gatewayClient, kieJob, kieUpload, kieUrls, logGatewayWarnings, pickModel, presignRef, runHelp, runOpts,
  runProviders, saveResults, sunraJob, sunraUpload, times, uploadAll, userError, workspaceKeys, writeSidecars,
} from './lib/providers.mjs';

const HELP = `generate-video.mjs — video ad generator (kie.ai)

  node tools/generate-video.mjs --prompt-file <prompt.txt> --first-frame <img> --out <clip.mp4>
  node tools/generate-video.mjs --model seedance-2.5 --image <a.png> --image <b.png> --prompt-file <p.txt> --out <clip.mp4>
  node tools/generate-video.mjs --upgrade <seedance-480p-clip.mp4> [--out <clip-1080p.mp4>]

Required:
  --prompt "<text>"        Inline prompt (max 7,000 characters on minimax-h3), OR
  --prompt-file <path>     Prompt from a file
  --out <path>             Output video path

Model:
  --model <name>           minimax-h3 (default) | gemini-omni-1.2-flash (its fallback) | seedance-2.5
                           (omni's fallback). Every model adds its own sound; only seedance-2.5 can
                           turn it off (--no-audio)

Inputs (local files or http(s) URLs). A clip takes frames OR references, never both:
  --first-frame <path|url> Lock the opening frame
  --last-frame <path|url>  Lock the closing frame. minimax-h3 takes it alone too; the others need
                           --first-frame
  --image <path|url>       Reference image (repeatable; prompts cite them in order)
  --video <path|url>       Reference video (repeatable)
  --audio <path|url>       Reference audio (repeatable; needs an --image or --video too)
  minimax-h3:   9 images (256-5760 px, ratio 0.4-2.5, 30 MB), 3 videos (mp4/mov, 2-15 s each, 15 s
                total, 50 MB; billed as extra seconds), 3 audios (wav/mp3, 2-15 s, 15 s total, free).
                The first 5 images are free, then 4 credits each
  omni:         6 images (20 MB) and 1 video, 7 slots: an image takes 1, the video 2. A --video is
                edited (mp4, max 15 s; 10 s on sunra), and the clip length follows it. No --audio
  seedance-2.5: 30 images (300-6000 px, ratio 0.4-2.5, 30 MB), 10 videos (mp4/mov/mkv, 480p/720p,
                2-30 s, 30 s total, 200 MB; billed per input second too), 10 audios (wav/mp3/aac/ogg,
                2-30 s, 30 s total)

Optional:
  --resolution <res>       minimax-h3: 768p (default) | 2k
                           omni: 720p (default; same price as 360p) | 360p | 1080p | 4k
                           seedance-2.5: 480p (default) | 720p | 1080p
  --duration <seconds>     5 (default). minimax-h3: 4-15. omni: 3-15 (3-10 with both frames).
                           seedance-2.5: 4-30, or auto (the model picks)
  --aspect <ratio>         minimax-h3: 21:9 16:9 4:3 1:1 3:4 9:16 (default 9:16), or adaptive with
                             references (their default); frames set the shape (no --aspect)
                           omni: 9:16 (default, frames too) | 16:9
                           seedance-2.5: 1:1 4:3 3:4 16:9 9:16 21:9 adaptive (default)
  --no-audio               seedance-2.5 only: no generated sound
  --upgrade <clip>         seedance-2.5: remake a 480p take at 1080p as the same take (same motion,
                           timing and voice), within 7 days of it, at the 1080p rate. --out defaults
                           to <clip>-1080p.mp4
${runHelp(600, { providers: 'sunra: every model. Gateway: seedance-2.5' })}

${envHelp()}`;

// kie limits per model, from the docs linked in MODELS. res = our name -> kie's value.
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const LIMITS = {
  'minimax-h3': {
    res: { '768p': '768P', '2k': '2K' }, durations: range(4, 15), aspects: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    images: 9, videos: 3, audios: 3, lastAlone: true,
  },
  'gemini-omni-1.2-flash': { res: { '720p': '720p', '360p': '360p', '1080p': '1080p', '4k': '4k' }, durations: range(3, 15), aspects: ['9:16', '16:9'], images: 6, videos: 1, audios: 0 },
  'seedance-2.5': {
    res: { '480p': '480p', '720p': '720p', '1080p': '1080p' }, durations: range(4, 30), aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'],
    images: 30, videos: 10, audios: 10, audioSwitch: true,
  },
};

// [model id, input] for kie. o = the request with hosted URLs.
function minimaxInput(base, o) {
  const input = { prompt: o.prompt, duration: o.duration, resolution: o.res };
  if (o.imageUrls.length || o.videoUrls.length) {
    if (o.aspect) input.aspect_ratio = o.aspect;
    if (o.imageUrls.length) input.reference_image_urls = o.imageUrls;
    if (o.videoUrls.length) input.reference_video_urls = o.videoUrls;
    if (o.audioUrls.length) input.reference_audio_urls = o.audioUrls;
    return [`${base}/reference-to-video`, input];
  }
  if (o.firstFrameUrl || o.lastFrameUrl) {
    if (o.firstFrameUrl) input.first_frame_url = o.firstFrameUrl;
    if (o.lastFrameUrl) input.last_frame_url = o.lastFrameUrl;
    return [`${base}/image-to-video`, input];
  }
  return [`${base}/text-to-video`, { ...input, aspect_ratio: o.aspect }];
}

// No duration with a video: the clip follows it.
function omniInput(base, o) {
  const input = { prompt: o.prompt, resolution: o.res, aspect_ratio: o.aspect };
  if (!o.videoUrls.length) input.duration = o.duration;
  if (o.firstFrameUrl) input.first_frame_url = o.firstFrameUrl;
  if (o.lastFrameUrl) input.last_frame_url = o.lastFrameUrl;
  if (o.imageUrls.length) input.image_urls = o.imageUrls;
  if (o.videoUrls.length) input.video_list = o.videoUrls;
  return [base, input];
}

function seedanceInput(base, o) {
  const input = { prompt: o.prompt, duration: o.duration, resolution: o.res, generate_audio: o.audio };
  if (o.aspect) input.aspect_ratio = o.aspect;
  if (o.firstFrameUrl) input.first_frame_url = o.firstFrameUrl;
  if (o.lastFrameUrl) input.last_frame_url = o.lastFrameUrl;
  if (o.imageUrls.length) input.reference_image_urls = o.imageUrls;
  if (o.videoUrls.length) input.reference_video_urls = o.videoUrls;
  if (o.audioUrls.length) input.reference_audio_urls = o.audioUrls;
  if (o.res === '480p') input.draft = true; // same price and look as a normal 480p take; keeps --upgrade open
  return [base, input];
}
const INPUT = { 'minimax-h3': minimaxInput, 'gemini-omni-1.2-flash': omniInput, 'seedance-2.5': seedanceInput };

// [operation, input] on sunra (each model's API tab on sunra.ai); omni edits a --video. o as above.
function sunraInput(shape, o) {
  const lists = { reference_images: o.imageUrls, reference_videos: o.videoUrls, reference_audios: o.audioUrls };
  const op = o.videoUrls.length && shape === 'gemini-omni-1.2-flash' ? 'video-to-video'
    : o.refs ? 'reference-to-video' : o.firstFrameUrl || o.lastFrameUrl ? 'image-to-video' : 'text-to-video';
  if (shape === 'gemini-omni-1.2-flash') {
    const images = o.imageUrls.length ? { image_urls: o.imageUrls } : {};
    if (op === 'video-to-video') return [op, { prompt: o.prompt, video: o.videoUrls[0], ...images }];
    return [op, { prompt: o.prompt, duration: o.duration, resolution: o.res, aspect_ratio: o.aspect, image: o.firstFrameUrl, last_image: o.lastFrameUrl, ...images }];
  }
  const input = {
    prompt: o.prompt, duration: o.duration, resolution: o.res, start_image: o.firstFrameUrl, end_image: o.lastFrameUrl,
    ...Object.fromEntries(Object.entries(lists).filter(([, v]) => v.length)),
  };
  if (op !== 'image-to-video' && o.aspect) input[shape === 'seedance-2.5' ? 'ratio' : 'aspect_ratio'] = o.aspect;
  if (shape === 'seedance-2.5') Object.assign(input, { generate_audio: o.audio }, o.res === '480p' ? { draft: true } : {}); // as on kie
  return [op, input];
}

// The 1080p version of a Seedance 480p take, from the draft task in its sidecar.
async function upgrade(args) {
  const clip = String(args.upgrade);
  const side = clip.replace(/\.[^./]+$/, '') + '.gen.json';
  const gen = existsSync(side) ? JSON.parse(await readFile(side, 'utf8')) : {};
  if (!gen.draftTask) die(`${clip} has no Seedance draft to upgrade (only 480p seedance-2.5 takes made on kie or sunra have one): make a fresh 1080p take instead.`);
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

  const entry = pickModel(args, 'video', 'minimax-h3');
  const shape = entry.shape || entry.name;
  const L = LIMITS[shape];
  const firstFrame = args['first-frame'] ? String(args['first-frame']) : undefined;
  const lastFrame = args['last-frame'] ? String(args['last-frame']) : undefined;
  const frames = !!(firstFrame || lastFrame);
  const refs = args.image.length + args.video.length + args.audio.length;

  const resolution = String(args.resolution || Object.keys(L.res)[0]).toLowerCase();
  if (!L.res[resolution]) die(`${shape} renders at ${Object.keys(L.res).join(' | ')}, not ${resolution}.`);
  const durArg = String(args.duration || 5);
  const duration = durArg === 'auto' && shape === 'seedance-2.5' ? -1 : Number(durArg);
  if (duration !== -1 && !L.durations.includes(duration)) die(`${shape} takes --duration ${L.durations[0]}-${L.durations.at(-1)}, not ${durArg}.`);
  let aspect = args.aspect ? String(args.aspect).replace('x', ':') : undefined;
  if (aspect && !L.aspects.includes(aspect) && !(shape === 'minimax-h3' && aspect === 'adaptive' && refs))
    die(`${shape} takes --aspect ${L.aspects.join(' ')}${shape === 'minimax-h3' ? ' (adaptive only with references)' : ''}, not ${aspect}.`);
  if (shape === 'minimax-h3' && frames && aspect) die('minimax-h3 takes no --aspect with frames: the frame sets the shape.');
  if (!aspect && ((shape === 'minimax-h3' && !frames && !refs) || shape === 'gemini-omni-1.2-flash')) aspect = '9:16'; // omni would crop a frame to its 16:9 default

  if (frames && refs) die('A clip takes --first-frame/--last-frame OR --image/--video/--audio references, not both.');
  if (lastFrame && !firstFrame && !L.lastAlone) die(`${shape} takes --last-frame only together with --first-frame.`);
  if (args.image.length > L.images) die(`${shape} takes at most ${L.images} --image references.`);
  if (args.video.length > L.videos) die(`${shape} takes at most ${L.videos} --video reference${L.videos === 1 ? '' : 's'}.`);
  if (args.audio.length > L.audios) die(`${shape} takes ${L.audios ? `at most ${L.audios}` : 'no'} --audio references.`);
  if (args.audio.length && !args.image.length && !args.video.length) die('--audio references need an --image or --video reference too.');
  if (shape === 'gemini-omni-1.2-flash' && args.image.length + 2 * args.video.length > 7) die('omni has 7 slots: each --image takes 1, the --video takes 2.');
  if (shape === 'gemini-omni-1.2-flash' && firstFrame && lastFrame && duration > 10) die('omni takes --duration 3-10 with both frames.');
  if (args['no-audio'] && !L.audioSwitch) die(`${shape} always adds sound (no switch in kie's docs): mute it in the edit, or ask the user about seedance-2.5 --no-audio.`);
  const audio = !args['no-audio'];

  let videoLen = 0;
  if (shape === 'gemini-omni-1.2-flash' && args.video.length) {
    videoLen = Number(ffprobeJson(args.video[0]).format?.duration);
    if (!videoLen) die(`Could not read the length of ${args.video[0]}.`);
    if (videoLen > 15.5) die(`omni edits a video of at most 15 s (${args.video[0]} is ${videoLen.toFixed(1)} s).`);
  }

  const { num, timeout } = runOpts(args, 600);
  const base = { prompt, aspect, duration, audio, refs, res: L.res[resolution] };
  let each = []; // per saved file: its draft task, for --upgrade

  async function runKie() {
    const o = {
      ...base,
      imageUrls: await uploadAll(args.image), videoUrls: await uploadAll(args.video), audioUrls: await uploadAll(args.audio),
      firstFrameUrl: firstFrame && await kieUpload(firstFrame), lastFrameUrl: lastFrame && await kieUpload(lastFrame),
    };
    const [model, input] = INPUT[shape](entry.kie, o);
    const takes = await times(num, () => kieJob(entry.unlisted ? entry.kie : model, input, timeout, {
      pick: (d, taskId) => kieUrls(d)?.map((url) => ({ url, taskId })),
    }));
    if (input.draft) each = takes.map((t) => ({ draftTask: t.taskId }));
    return takes.map((t) => t.url);
  }

  async function runSunra() {
    if (shape === 'minimax-h3' && prompt.length > 2000) throw blocked('minimax-h3 on sunra takes prompts up to 2,000 characters.');
    if (shape === 'seedance-2.5' && frames && args.aspect) throw blocked('seedance-2.5 on sunra takes no --aspect with frames: the frame sets the shape.');
    if (videoLen > 10.5) throw blocked('omni on sunra edits a video of at most 10 s.');
    const host = (list) => uploadAll(list, sunraUpload);
    const o = {
      ...base, imageUrls: await host(args.image), videoUrls: await host(args.video), audioUrls: await host(args.audio),
      firstFrameUrl: firstFrame && await sunraUpload(firstFrame), lastFrameUrl: lastFrame && await sunraUpload(lastFrame),
    };
    const [op, input] = sunraInput(shape, o);
    const takes = await times(num, () => sunraJob(`${entry.sunra}/${op}`, input, timeout));
    if (input.draft) each = takes.map((t) => ({ draftTask: t.draft_task_id }));
    return takes.map((t) => t.video.url);
  }

  // Seedance 2.5 only; the Gateway takes refs as URLs.
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
