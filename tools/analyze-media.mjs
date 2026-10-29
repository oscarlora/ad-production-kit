#!/usr/bin/env node
// analyze-media.mjs — analyze each cataloged file with ANALYSIS_MODEL (the analysis, products, people,
// transcript), fill its record, and rename the original to <id>_<descriptor>.<ext>.
// One call per file: an image; a video's proxy with its sound (its track gets its own sound call past
// LONG s, or when the speech looped); an audio file, whole (past LONG s its speech is transcribed apart). Local Whisper then replaces the transcript's words and timings (lib/transcribe.mjs, alignWords).
// Reads inputs/products.json and _catalog/people.json.
import { existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogPaths, readRecords, readRecord, mergeRecord, readRoster, parseArgs, mediaDirFrom, inferBrand, slugify, ffprobeJson, round, run, have, usage, relinkEdits } from './lib/catalog.mjs';
import { videoPass, videoMeta, workDir, heavy } from './lib/media-probe.mjs';
import { requireKeys, filePart, generateJSON, spendText, ANALYSIS_MODEL, INLINE_MAX } from './lib/analyze.mjs';
import { buildPrompt, buildSchema } from './lib/analysis-prompt.mjs';
import { fetchMissing } from './lib/r2.mjs';
import { audioTrack, describeAudio, transcribeAudio, toTranscript, vocabulary, alignWords, loops, LONG } from './lib/transcribe.mjs';

const HELP = `analyze-media.mjs — describe cataloged media with ${ANALYSIS_MODEL} on kie.ai and fill their records
(key: <WS>_KIE_API_KEY; optional fallback when kie fails: <WS>_AI_GATEWAY_API_KEY)

  node tools/analyze-media.mjs --media <media dir> [--ids 00001,00002 | --all] [--force] [--concurrency 4]
    --all    every record not analyzed yet
    --force  redo analyzed ones too`;

// The proxy the probe left in the work dir (else a fresh pass), with the sound track muxed in.
async function videoProxy(src, work, track) {
  let proxy = join(work, 'picture.mp4');
  if (!existsSync(proxy)) ({ proxy } = await heavy(() => videoPass(src, videoMeta(src), { work })));
  if (!proxy) throw new Error('could not make a proxy under the inline limit (trim the clip into parts)');
  if (!track || track.silent) return proxy;
  const out = join(work, 'proxy.mp4');
  run('ffmpeg', ['-y', '-v', 'error', '-i', proxy, '-i', track.path, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '32k', out]);
  if (statSync(out).size > INLINE_MAX) throw new Error('proxy with sound is over the inline limit (trim the clip into parts)');
  return out;
}

const joinSections = (sections) => sections.map((s) => `${s.label}: ${s.text}`).join('\n\n');

// The probe's cuts take the model's descriptions by index; without cuts, the model's own scenes.
function cleanScenes(scenes, duration) {
  const cl = (x) => round(Math.min(duration || Infinity, Math.max(0, +x || 0)), 1);
  return (scenes || []).map((s) => ({ ...s, start: cl(s.start), end: cl(s.end) })).filter((s) => s.end > s.start);
}
function mergeScenes(detected, got, duration) {
  if (detected.length) return detected.map((s, i) => ({ ...s, description: (got.find((g) => g.index === i) || got[i] || {}).description || s.description || '' }));
  return cleanScenes(got.map((g) => ({ start: g.start, end: g.end, description: g.description })), duration).sort((a, b) => a.start - b.start);
}

const soundOf = (track, snd) => (!track ? 'No audio track.' : track.silent ? 'Silent — no audible sound.' : joinSections(snd.sections || []));
const timed = (scenes) => scenes.map((s) => `[${s.start}–${s.end}s] ${s.description}`).join('\n\n');

async function analyzeOne({ media, id, keys, roster, brand, vocab }) {
  const paths = catalogPaths(media);
  const rec = readRecord(paths, id);
  if (!rec) throw new Error(`no record ${id}`);
  const type = rec.file?.type;
  const original = join(media, rec.file.name);
  const temps = [];

  try {
    if (type !== 'image') await fetchMissing(original);
    if (type !== 'image' && !existsSync(original)) throw new Error(`original missing: ${rec.file.name}, here and in the cloud`);
    const duration = rec.file.duration ?? (type === 'image' ? null : +ffprobeJson(original).format?.duration || null);
    const patch = { id, status: 'cataloged' };
    let pic = null, snd = null, track = null, picModel = null;

    const work = workDir(rec.sha256);
    if (type === 'video') temps.push(work);
    if (type !== 'image') { track = audioTrack(original, type === 'video' ? join(work, 'track.mp3') : null); if (track) temps.push(track.dir); }

    if (type === 'image') {
      const proxy = join(paths.proxies, `${id}.jpg`);
      const part = existsSync(proxy) ? filePart(proxy, 'image/jpeg') : filePart(original, rec.file.mime);
      ({ out: pic, model: picModel } = await generateJSON(keys, { parts: [part, { text: buildPrompt('image', { brand, roster }) }], schema: buildSchema('image') }));
    } else if (type === 'video') {
      const detected = cleanScenes(rec.scenes, duration);
      const proxy = await videoProxy(original, work, track);
      const sound = !!track && !track.silent, long = duration > LONG;
      ({ out: pic, model: picModel } = await generateJSON(keys, { parts: [filePart(proxy, 'video/mp4'), { text: buildPrompt('video', { brand, scenes: detected, roster, duration, sound, vocab, transcribe: !long }) }], schema: buildSchema('video') }));
      patch.scenes = mergeScenes(detected, pic.scenes || [], duration);
      if (sound) snd = long || loops(pic.sentences) ? await transcribeAudio(keys, track, { brand, vocab }) : { ...pic, model: picModel };
    } else if (track && !track.silent) {
      snd = await describeAudio(keys, track, { brand, vocab });
    }
    if (pic?.unreadable) throw new Error('Gemini could not decode the file');
    // The model that actually answered (the Gateway fallback when kie failed).
    patch.analyzed_by = { model: picModel || snd?.model || ANALYSIS_MODEL, at: new Date().toISOString() };
    patch.analysis = type === 'video' ? timed(patch.scenes) : type === 'image' ? joinSections(pic.sections || []) : soundOf(track, snd);
    if (pic) Object.assign(patch, { products: pic.products || [], people: pic.people || [], unknown_people: pic.unknown_people || [] });
    // undefined drops a stale transcript when the file has no speech. Whisper's words replace Gemini's.
    if (type !== 'image') {
      patch.transcript = (snd && toTranscript(snd, duration)) || undefined;
      if (patch.transcript && have('whisper-cli')) patch.transcript = await alignWords({ file: original, transcript: patch.transcript });
      // Each scene's SPEECH quotes Whisper's words in its range, not Gemini's.
      const words = patch.transcript?.words || [];
      if (type === 'video' && words.length) {
        for (const s of patch.scenes) {
          const said = words.filter((w) => (w.start + w.end) / 2 >= s.start && (w.start + w.end) / 2 < s.end).map((w) => w.word).join(' ');
          s.description = s.description.replace(/\bSPEECH\s*(?::|[—–]|-\s)[\s\S]*$/, said ? `SPEECH: "${said}"` : 'SPEECH: none.');
        }
        patch.analysis = timed(patch.scenes);
      }
    }

    const descriptor = (type === 'audio' ? snd?.descriptor || 'silent audio' : pic.descriptor);
    const name = `${id}_${slugify(descriptor)}${extname(rec.file.name).toLowerCase()}`;
    if (name !== rec.file.name && existsSync(original) && !existsSync(join(media, name))) {
      renameSync(original, join(media, name)); patch.file = { name };
      relinkEdits(original, join(media, name));
    }

    mergeRecord(paths, patch);
    return { id, type, name: patch.file?.name || rec.file.name, model: patch.analyzed_by.model };
  } finally {
    for (const d of temps) rmSync(d, { recursive: true, force: true });
  }
}

const isAnalyzed = (r) => r.status === 'cataloged' && typeof r.analysis === 'string' && !!r.analysis;

export async function analyzeMany({ media, ids, all, force, concurrency = 4 }) {
  const keys = requireKeys(media);
  const roster = readRoster(media);
  const vocab = vocabulary(media);
  const brand = inferBrand(media);
  const recs = readRecords(catalogPaths(media));
  const queue = (ids?.length ? recs.filter((r) => ids.includes(r.id)) : all ? recs : []).filter((r) => force || !isAnalyzed(r)).map((r) => r.id);
  const done = [], failed = [];
  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const id = queue[i++];
      try { const r = await analyzeOne({ media, id, keys, roster, brand, vocab }); done.push(r); console.log(`analyzed ${id} → ${r.name} (${r.model})`); }
      catch (e) { failed.push({ id, error: e.message }); console.log(`FAILED ${id}: ${e.message}`); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return { done, failed, queued: queue.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = parseArgs(process.argv.slice(2), { flags: ['all', 'force'], help: HELP });
  if (!a.media || (!a.ids && !a.all)) usage(HELP);
  const res = await analyzeMany({ media: mediaDirFrom(a.media), ids: a.ids ? String(a.ids).split(',') : null, all: !!a.all, force: !!a.force, concurrency: a.concurrency ? +a.concurrency : 4 });
  console.log(`${res.done.length}/${res.queued} analyzed${res.failed.length ? `, ${res.failed.length} failed` : ''} · ${spendText()}`);
  if (res.failed.length) process.exit(1);
}
