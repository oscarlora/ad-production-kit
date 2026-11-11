#!/usr/bin/env node
// transcribe-media.mjs — any audio/video clip -> transcript JSON (lib/transcribe.mjs).
// A file in the brand's library (same bytes, anywhere under the brand) reuses its catalog transcript.
// --words: local Whisper's words (whisper.cpp) replace Gemini's text, the final transcript, written back
// to the file's record when it has none yet. Without a kie key for a transcript it exits 3 (SKIP).

import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { typeOf, inferWorkspace, inferBrand, brandDirFrom, catalogPaths, readRecords, mergeRecord, hashFile, parseArgs, die, usage, REPO_ROOT } from './lib/catalog.mjs';
import { analysisKeys, spend, spendText, ANALYSIS_MODEL } from './lib/analyze.mjs';
import { audioTrack, transcribeAudio, toTranscript, vocabulary, alignWords } from './lib/transcribe.mjs';

const HELP = `transcribe-media.mjs — audio/video clip -> transcript JSON

  node tools/transcribe-media.mjs --in <clip> [--out <json>] [--words] [--workspace <WS>]

Required:
  --in <path>              Audio or video file to transcribe

Optional:
  --out <path>             Output JSON (default: alongside the input as <name>.transcript.json)
  --words                  Words and their timings from local Whisper (for captions and cuts),
                           replacing Gemini's text
  --workspace <WS>         Workspace whose kie key to use when the input isn't under workspaces/<WS>/

Transcripts: Gemini on kie.ai (<WS>_KIE_API_KEY; optional fallbacks when kie fails: <WS>_SUNRA_API_KEY,
then <WS>_AI_GATEWAY_API_KEY).

Output: { model, language, text, segments:[{start,end,speaker,text}],
          words?:[{start,end,word,speaker}], words_model?, disagree?:[{at,whisper,gemini}] (words to check) }`;

async function libraryRecord(input, paths) {
  const recs = readRecords(paths);
  if (!recs.length) return null;
  const sha = await hashFile(input);
  return recs.find((r) => r.sha256 === sha) || null;
}

async function main() {
  const a = parseArgs(process.argv.slice(2), { flags: ['words'], help: HELP });
  if (!a.in) usage(HELP);

  const input = resolve(String(a.in));
  if (!existsSync(input)) die(`input not found: ${input}`);
  const kind = typeOf(input);
  if (kind !== 'audio' && kind !== 'video') die(`not an audio/video file: ${input}`);
  const out = a.out ? resolve(String(a.out)) : input.replace(/\.[^./]+$/, '') + '.transcript.json';

  const ws = a.workspace ? String(a.workspace) : inferWorkspace(input);
  const keys = analysisKeys(a.workspace ? join(REPO_ROOT, 'workspaces', ws, '_') : input);
  const paths = catalogPaths(join(brandDirFrom(input), 'inputs', 'media'));

  let result;
  const rec = await libraryRecord(input, paths);
  if (rec?.transcript?.segments?.length) {
    console.error(`transcript from catalog record ${rec.id}`);
    result = rec.transcript;
  } else {
    if (!keys.kie && !keys.sunra) { console.error(`SKIP: no kie key — add ${(ws || '<WS>').toUpperCase()}_KIE_API_KEY to .env (or pass --workspace)`); process.exit(3); }
    const track = audioTrack(input);
    try {
      if (!track || track.silent) result = { model: ANALYSIS_MODEL, language: '', text: '', segments: [] };
      else {
        const snd = await transcribeAudio(keys, track, { brand: inferBrand(input), vocab: vocabulary(paths.media) });
        result = toTranscript(snd, track.duration) || { language: snd.language || '', text: '', segments: [], model: snd.model };
      }
    } finally { if (track) rmSync(track.dir, { recursive: true, force: true }); }
  }

  if (a.words) {
    if (!result.segments.length) result = { ...result, words: [], words_model: null };
    else if (result.words?.length) console.error('words from the catalog record');
    else result = await alignWords({ file: input, transcript: result });
    if (rec && result.words.length && !rec.transcript?.words?.length) {
      mergeRecord(paths, { id: rec.id, transcript: result });
      console.error(`record ${rec.id}: transcript replaced with Whisper's`);
    }
  }

  if (result.disagree?.length) console.error(`check these words (Whisper's kept): ${result.disagree.map((d) => `${d.at}s "${d.whisper}" (Gemini: "${d.gemini}")`).join(', ')}`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.error(`segments  ${result.segments.length}${result.words ? `  words ${result.words.length} (${result.words_model || 'none'})` : ''}  [${result.language || '—'}]${spend.credits || spend.usd ? `  ${spendText()}` : ''}`);
  console.log('Saved: ' + out);
}

main().catch((e) => die(e?.stack || String(e)));
