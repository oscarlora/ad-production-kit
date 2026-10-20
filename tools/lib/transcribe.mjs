// transcribe.mjs — speech for the media catalog and for captions.
//   transcribeAudio — ANALYSIS_MODEL on a mono 16 kHz track → sentence transcript (speakers S1, S2…) plus
//     an account of the sound: an audio file's analysis, a clip outside the library, or a video's track
//     when its picture call can't transcribe it (past LONG s, or looped). Sentence times are ±1 s: fine for
//     search, not captions.
//   alignWords — local Whisper (whisper.cpp) words replace that sentence text (they are the more
//     accurate), keeping its sentences and speakers; each word edge snapped to speech energy.
//
// Shapes:
//   catalog transcript  { language, text, segments:[{start,end,speaker,text}], model }
//   + alignWords        words:[{start,end,word,speaker}], words_model; segments re-written from the words
import { mkdtempSync, mkdirSync, readFileSync, existsSync, renameSync, rmSync, statSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir, availableParallelism } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { have, run, ffprobeJson, readRoster, inferBrand, loudness, round, FFMPEG_FIX } from './catalog.mjs';
import { generateJSON, filePart, ANALYSIS_MODEL, INLINE_MAX } from './analyze.mjs';
import { buildAudioPrompt, buildAudioSchema, buildMergePrompt, buildMergeSchema } from './analysis-prompt.mjs';

const SILENT_DB = -50; // a track whose loudest peak is below this is silence (digital silence reads -91)

// ---------- audio track ----------
// Mono 16 kHz mp3 in a temp dir: { path, dir, silent, duration }, or null without audio. `made` = an
// mp3 the probe already extracted. Caller removes `dir`.
export function audioTrack(src, made = null) {
  if (!have('ffmpeg')) throw new Error(`ffmpeg is required for audio. To get it, ${FFMPEG_FIX}`);
  const p = ffprobeJson(src);
  if (!(p.streams || []).some((s) => s.codec_type === 'audio')) return null;
  const dir = made && existsSync(made) ? dirname(made) : mkdtempSync(join(tmpdir(), 'track-'));
  const path = made && existsSync(made) ? made : join(dir, 'track.mp3');
  for (const ab of path === made ? [] : ['32k', '16k']) {
    // Pad to the file's own clock: a video's audio can start after its first frame (often ~0.5 s), and
    // without the lead every time would run that much early against the picture.
    run('ffmpeg', ['-y', '-v', 'error', '-copyts', '-i', src, '-vn', '-af', 'aresample=async=1:first_pts=0', '-ac', '1', '-ar', '16000', '-b:a', ab, path], { allowFail: true });
    if (existsSync(path) && statSync(path).size <= INLINE_MAX) break;
  }
  if (!existsSync(path) || statSync(path).size > INLINE_MAX) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(existsSync(path) ? 'audio too long to send inline (trim it into parts)' : 'could not extract the audio track');
  }
  const v = run('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'], { allowFail: true });
  const peak = +(/max_volume:\s*(-?[\d.]+) dB/.exec(v.stderr || '')?.[1] ?? 0);
  return { path, dir, silent: peak < SILENT_DB, duration: +p.format?.duration || null };
}

// ---------- the sound call ----------
// Names to spell right: brand, products (+ aliases), known people, and products.json `vocabulary`
// (e.g. 'Acme (said "Ack-mee")').
export function vocabulary(mediaDir) {
  const { products, vocabulary: extra, people } = readRoster(mediaDir);
  const names = [inferBrand(mediaDir), ...extra, ...products.flatMap((p) => [p.name, ...(p.aliases || [])]), ...people.map((p) => p.name)];
  return [...new Set(names.filter(Boolean).map(String))];
}

// keys = analysisKeys(). → { has_speech, language, sentences, sound, model (, descriptor) }. Tracks past LONG s go in ~PART s
// parts (one long call loops until its JSON is cut off), split at quiet moments, with OVERLAP s either
// side; a text-only merge call unifies speaker numbering and portraits.
export const LONG = 180;
const PART = 150, OVERLAP = 2, SNAP_WINDOW = 15;
export async function transcribeAudio(keys, track, { brand, vocab = [], standalone = false } = {}) {
  const dur = track.duration;
  const call = (path, duration, part) => soundCall(keys, path, { brand, vocab, standalone, duration, part });
  if (!dur || dur <= LONG) return call(track.path, dur, null);

  const cuts = splitPoints(track.path, dur, Math.ceil(dur / PART));
  const parts = cuts.slice(0, -1).map((own, k) => {
    const from = round(Math.max(0, own - OVERLAP)), to = round(Math.min(dur, cuts[k + 1] + OVERLAP));
    const path = join(track.dir, `part${k + 1}.mp3`);
    run('ffmpeg', ['-y', '-v', 'error', '-ss', String(from), '-t', String(to - from), '-i', track.path, '-c', 'copy', path]);
    return { index: k + 1, of: cuts.length - 1, from, to, own: [own, cuts[k + 1]], path };
  });
  const outs = await Promise.all(parts.map((p) => call(p.path, p.to - p.from, p)));

  // Keep each sentence once, in the part that holds its midpoint. A time past the part's length that
  // fits the whole track is read as absolute; others are held at the part's end.
  const kept = outs.map((o, k) => {
    const { from, to } = parts[k];
    const at = (x) => { x = +x || 0; return round(Math.min(to, x > to - from + 1 && x >= from && x <= to ? x : x + from)); };
    return (o.sentences || []).map((x) => ({ ...x, start: at(x.start), end: at(x.end) }))
      .filter((x) => { const mid = (x.start + x.end) / 2; return mid >= parts[k].own[0] && (mid < parts[k].own[1] || k === parts.length - 1); });
  });
  const merged = await mergeParts(keys, parts, outs, kept, standalone);
  const langs = outs.filter((o) => o.has_speech && o.language).map((o) => o.language);
  return {
    unreadable: false,
    has_speech: outs.some((o) => o.has_speech),
    language: langs.sort((a, b) => langs.filter((l) => l === b).length - langs.filter((l) => l === a).length)[0] || '',
    sentences: numberSpeakers(kept.flatMap((ss, k) => ss.map((x) => ({ ...x, speaker: merged.map.get(`${k + 1}:${x.speaker}`) || `part${k + 1}:${x.speaker}` })))),
    sound: merged.sound,
    model: [...new Set(outs.map((o) => o.model))].join(' + '),
    ...(standalone ? { descriptor: merged.descriptor } : {}),
  };
}

// A cut-off or looping reply is retried once with a repetition limit at temperature 1; loops left
// after that are collapsed.
async function soundCall(keys, path, { brand, vocab, standalone, duration, part }) {
  const secs = duration ? round(duration, 1) : null;
  const ask = async (strict) => {
    const { out, model } = await generateJSON(keys, {
      parts: [filePart(path, 'audio/mpeg'), { text: buildAudioPrompt({ brand, vocab, duration: secs, standalone, part, strict }) }],
      schema: buildAudioSchema({ standalone, part: !!part }),
      maxOutputTokens: 8000 + Math.round(25 * (secs || PART)), // thinking counts too; a loop hits this in seconds, not minutes
      ...(strict ? { temperature: 1 } : {}),
    });
    return { ...out, model };
  };
  let out = null;
  try { out = await ask(false); } catch (e) { if (!/NoObjectGenerated|unparseable/i.test(`${e?.name} ${e?.message}`)) throw e; }
  if (!out || loops(out.sentences)) {
    console.error(`sound call ${out ? 'looped on a word' : 'returned unparseable JSON'}${part ? ` (part ${part.index}/${part.of})` : ''} — retrying with a repetition limit`);
    out = await ask(true);
    if (loops(out.sentences)) out.sentences = out.sentences.map((x) => ({ ...x, text: collapseLoops(x.text) }));
  }
  if (out.unreadable) throw new Error('Gemini could not decode the audio');
  return out;
}

// A runaway loop: one word repeated 12+ times in a row, a 2–4 word phrase 8+ times, or the same
// sentence 6+ times in a row.
const SEP = '[\\s,.;:!?¡¿…"-]+', WORD = "[\\p{L}\\p{N}']+", EDGE = "(?![\\p{L}\\p{N}'])", START = "(?<![\\p{L}\\p{N}'])";
const LOOPS = [new RegExp(`${START}(${WORD})(?:${SEP}\\1${EDGE}){11,}`, 'iu'), new RegExp(`${START}(${WORD}(?:${SEP}${WORD}){1,3})(?:${SEP}\\1${EDGE}){7,}`, 'iu')];
const loopIn = (text) => LOOPS[0].exec(text) || LOOPS[1].exec(text);
export function loops(sentences = []) {
  let same = 1;
  for (let i = 0; i < sentences.length; i++) {
    if (loopIn(String(sentences[i].text || ''))) return true;
    same = i && norm(sentences[i].text || '') === norm(sentences[i - 1].text || '') ? same + 1 : 1;
    if (same >= 6) return true;
  }
  return false;
}
const collapseLoops = (text) => { let t = String(text); for (let m; (m = loopIn(t));) t = t.replace(m[0], `${Array(5).fill(m[1]).join(' ')}…`); return t; };

// Split near each even boundary at the quietest half second within ±SNAP_WINDOW s. → [0, …cuts, duration]
function splitPoints(path, dur, n) {
  const db = loudness(path) || [];
  const cuts = [0];
  for (let k = 1; k < n; k++) {
    const target = (dur * k) / n, W = 50; // 50 frames of 10 ms
    let best = target, bestDb = Infinity;
    const lo = Math.max(0, Math.round((target - SNAP_WINDOW) * 100)), hi = Math.min(db.length - W, Math.round((target + SNAP_WINDOW) * 100));
    let sum = 0;
    for (let f = lo; f < lo + W && f < db.length; f++) sum += db[f];
    for (let f = lo; f <= hi; f++) {
      const avg = sum / W + Math.abs(f + W / 2 - target * 100) * 1e-4; // tie-break toward the target
      if (avg < bestDb) { bestDb = avg; best = (f + W / 2) / 100; }
      sum += (db[f + W] ?? 0) - db[f];
    }
    cuts.push(round(best));
  }
  cuts.push(dur);
  return cuts;
}

// Whatever voice keys the merge produced → S1, S2… in order of first appearance.
function numberSpeakers(sentences) {
  const ids = new Map();
  return sentences.map((x) => ({ ...x, speaker: ids.get(x.speaker) || ids.set(x.speaker, `S${ids.size + 1}`).get(x.speaker) }));
}

// Falls back to the parts' own labels and joined portraits when the merge call fails.
async function mergeParts(keys, parts, outs, kept, standalone) {
  const input = parts.map((p, k) => {
    const lines = {};
    for (const x of kept[k]) { const l = (lines[x.speaker] ||= []); if (l.length < 3) l.push(String(x.text).slice(0, 160)); }
    const speakers = outs[k].speakers?.length ? outs[k].speakers : Object.keys(lines).map((label) => ({ label, voice: '' }));
    return { index: p.index, from: p.from, to: p.to, speakers, lines, sound: outs[k].sound };
  });
  try {
    const { out: m } = await generateJSON(keys, { parts: [{ text: buildMergePrompt({ parts: input, standalone }) }], schema: buildMergeSchema({ standalone }) });
    return { map: new Map((m.speakers || []).map((x) => [`${x.part}:${x.label}`, x.speaker])), sound: m.sound, descriptor: m.descriptor };
  } catch (e) {
    console.error(`merge call failed (${e.message}) — keeping each part's own speaker labels`);
    return { map: new Map(), sound: outs.map((o) => o.sound).filter(Boolean).join(' '), descriptor: outs[0].descriptor };
  }
}

// The sound call's sentences → the catalog transcript (times clamped to the clip), or null.
export function toTranscript(out, duration) {
  const cl = (x) => round(Math.min(duration || Infinity, Math.max(0, +x || 0)));
  const segments = (out.sentences || []).filter((s) => String(s.text || '').trim())
    .map((s) => ({ start: cl(s.start), end: Math.max(cl(s.start), cl(s.end)), speaker: String(s.speaker || 'S1').trim(), text: s.text.trim() }));
  if (!out.has_speech || !segments.length) return null;
  return { language: String(out.language || '').toLowerCase(), text: segments.map((s) => s.text).join(' '), segments, model: out.model || ANALYSIS_MODEL };
}

// ---------- word timings ----------
// LCS on normalized words; unmatched runs spread evenly between matched neighbours.
const norm = (w) => w.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
function mapTimings(words, timed) {
  const a = words.map(norm), b = timed.map((w) => norm(w.word));
  const n = a.length, m = b.length, W = m + 1, L = new Int32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * W + j] = a[i] && a[i] === b[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  const out = new Array(n).fill(null);
  out.pairs = []; // [i, j] of each word both agree on
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] && a[i] === b[j]) { out[i] = { start: timed[j].start, end: timed[j].end }; out.pairs.push([i, j]); i++; j++; }
    else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) i++; else j++;
  }
  const t0 = timed[0]?.start ?? 0, t1 = timed[m - 1]?.end ?? t0;
  for (let i = 0; i < n;) {
    if (out[i]) { i++; continue; }
    let k = i; while (k < n && !out[k]) k++;
    const from = i ? out[i - 1].end : t0, to = k < n ? out[k].start : t1, step = Math.max(0, to - from) / (k - i);
    for (let x = i; x < k; x++) out[x] = { start: from + step * (x - i), end: from + step * (x - i + 1) };
    i = k;
  }
  return out;
}

// Words the two hear differently: runs of the same length between words they agree on, paired one to one
// (numbers left out: "14" and "fourteen" are the same word). → [{ at, whisper, gemini }]
function disagreements(words, heard, pairs) {
  const out = [], ends = [[-1, -1], ...pairs, [words.length, heard.length]];
  for (let p = 1; p < ends.length; p++) {
    const [i0, j0] = ends[p - 1], [i1, j1] = ends[p];
    if (i1 - i0 !== j1 - j0 || i1 - i0 > 4) continue;
    for (let k = 1; k < i1 - i0; k++) {
      const g = words[i0 + k], h = heard[j0 + k];
      if (norm(g) !== norm(h.word) && !/\d/.test(g + h.word)) out.push({ at: Math.round(h.start * 100) / 100, whisper: h.word, gemini: g });
    }
  }
  return out;
}

// Move each of Whisper's word edges within ±SNAP s to where sustained (≥50 ms) speech within 30 dB of
// the peak starts/stops (10 ms frames), never across a neighbouring word.
const SNAP = 0.25, RUN = 5;
function tidyTimes(times, db) {
  const dur = db.length / 100, F = (s) => Math.round(s * 100), thr = Math.max(...db) - 30, loud = (f) => db[f] > thr;
  const w = [];
  for (const t of times) {
    const start = Math.min(dur, Math.max(0, t.start, w.length ? w[w.length - 1].start : 0));
    if (w.length && w[w.length - 1].end > start) w[w.length - 1].end = start;
    w.push({ start, end: Math.min(dur, Math.max(start, t.end)) });
  }
  w.forEach((x, i) => {
    const prev = w[i - 1], next = w[i + 1];
    for (let f = Math.max(F(x.start - SNAP), prev ? F(prev.end) : 0), hi = Math.min(F(x.start + SNAP), F(x.end)), n = 0; f < hi; f++) {
      n = loud(f) ? n + 1 : 0;
      if (n === RUN) { x.start = (f - RUN + 1) / 100; break; }
    }
    for (let f = Math.min(F(x.end + SNAP), next ? F(next.start) : db.length) - 1, lo = F(x.start), n = 0; f >= lo; f--) {
      n = loud(f) ? n + 1 : 0;
      if (n === RUN) { x.end = Math.min(next ? next.start : dur, Math.max(x.start + 0.05, (f + RUN) / 100)); break; }
    }
  });
  return w;
}

// ---------- whisper.cpp ----------
const WORDS_MODEL = 'whisper-large-v3-turbo';
const WHISPER_FILE = 'ggml-large-v3-turbo-q5_0.bin';
const WHISPER_DIR = join(homedir(), '.cache', 'adpk', 'whisper');

async function whisperModel() {
  const path = join(WHISPER_DIR, WHISPER_FILE);
  if (existsSync(path)) return path;
  console.error(`Downloading the Whisper model (574 MB, once) to ${WHISPER_DIR}…`);
  mkdirSync(WHISPER_DIR, { recursive: true });
  const res = await fetch(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_FILE}`);
  if (!res.ok) throw new Error(`Whisper model download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${path}.part`));
  renameSync(`${path}.part`, path);
  return path;
}

// → [{ word, start, end }]. DTW token times (t_dtw, 10 ms units; DTW needs flash attention off) mark
// where each token ENDS. A word ends at its last letter/digit token and starts where the previous token
// ended (punctuation tokens hold the pauses), or at whisper's own token start when that is later and
// still before the end.
async function whisperWords(wav, language) {
  if (!have('whisper-cli')) throw new Error(`whisper-cli is missing (word timings for captions): run setup again (bash tools/setup.sh; Windows: tools\\setup.ps1; Linux: build it from github.com/ggml-org/whisper.cpp into ~/.local/bin)`);
  const out = join(dirname(wav), 'words');
  run('whisper-cli', ['-m', await whisperModel(), '-f', wav, '-l', language || 'auto', '-ojf', '-of', out, '-np', '-nfa', '--dtw', 'large.v3.turbo', '-t', String(Math.min(8, availableParallelism()))]);
  return tokenWords(JSON.parse(readFileSync(`${out}.json`, 'utf8')).transcription.flatMap((s) => s.tokens));
}

// The words local Whisper hears in a file, on its clock: [{ word, start, end }]. No transcript, no cloud call.
export async function hear(file, language) {
  const dir = mkdtempSync(join(tmpdir(), 'hear-')), wav = join(dir, 'h.wav');
  try {
    run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
    return await whisperWords(wav, language);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// A piece without a leading space joins the word before it; punctuation joins it too, except opening
// marks (¿ ¡ « “ ( [), which go on the next word.
const OPENING = '¿¡«“‘([';
function tokenWords(tokens) {
  const words = [];
  let prev = null, open = '';
  for (const t of tokens) {
    if (/^\[_.*\]$/.test(t.text)) continue; // special tokens
    const end = (t.t_dtw >= 0 ? t.t_dtw * 10 : t.offsets.to) / 1000;
    const text = t.text.trim();
    if (/[\p{L}\p{N}]/u.test(text)) {
      const from = t.offsets.from / 1000, lead = prev ?? end - (t.offsets.to - t.offsets.from) / 1000;
      const start = Math.min(end, from < end ? Math.max(from, lead) : lead);
      if (/^\s/.test(t.text) || !words.length || open || OPENING.includes(text[0])) words.push({ word: open + text, start, end });
      else Object.assign(words.at(-1), { word: words.at(-1).word + text, end });
      open = '';
    } else if (text) { // punctuation
      const close = text.replace(new RegExp(`[${OPENING}]+$`), '');
      if (words.length) words.at(-1).word += close; else open += close;
      open += text.slice(close.length);
    }
    prev = end;
  }
  return words;
}

export async function alignWords({ file, transcript }) {
  // Gemini's words, punctuation-only tokens riding on their neighbour.
  const words = [];
  transcript.segments.forEach((s, si) => {
    for (const w of String(s.text).split(/\s+/).filter(Boolean)) {
      if (!/[\p{L}\p{N}]/u.test(w) && words.length && words[words.length - 1].si === si) words[words.length - 1].word += ` ${w}`;
      else words.push({ word: w, si });
    }
  });
  if (!words.length) return { ...transcript, words: [], words_model: null };

  const track = audioTrack(file);
  if (!track) throw new Error('no audio stream');
  let heard, db;
  try {
    const wav = join(track.dir, 'words.wav');
    run('ffmpeg', ['-y', '-v', 'error', '-i', track.path, '-c:a', 'pcm_s16le', wav]);
    heard = await whisperWords(wav, transcript.language);
    db = loudness(file);
  } finally { rmSync(track.dir, { recursive: true, force: true }); }
  if (!heard.length) return { ...transcript, words: [], words_model: null };

  // Whisper's words are the final text: Gemini's sentences only lend each word its sentence and speaker,
  // by where Gemini's own words land on Whisper's timeline.
  const at = mapTimings(words.map((w) => w.word), heard);
  const disagree = disagreements(words.map((w) => w.word), heard, at.pairs);
  const span = transcript.segments.map((_, si) => {
    const t = at.filter((_, i) => words[i].si === si);
    return t.length ? [t[0].start, t[t.length - 1].end] : null;
  });
  const segOf = (w) => {
    const mid = (w.start + w.end) / 2;
    let best = 0, gap = Infinity;
    span.forEach((s, si) => { if (!s) return; const d = mid < s[0] ? s[0] - mid : mid > s[1] ? mid - s[1] : 0; if (d < gap) { gap = d; best = si; } });
    return best;
  };
  const times = db?.length ? tidyTimes(heard, db) : heard;
  const out = heard.map((w, i) => ({ si: segOf(w), start: round(times[i].start), end: round(times[i].end), word: w.word }));
  const segments = transcript.segments.flatMap((s, si) => {
    const ws = out.filter((w) => w.si === si);
    return ws.length ? [{ ...s, start: ws[0].start, end: ws[ws.length - 1].end, text: ws.map((w) => w.word).join(' ') }] : [];
  });
  return {
    ...transcript, text: segments.map((s) => s.text).join(' '), segments,
    words: out.map(({ si, ...w }) => ({ ...w, speaker: transcript.segments[si].speaker ?? null })), words_model: WORDS_MODEL,
    ...(disagree.length && { disagree }), // Whisper's word is kept; these are for a person to check
  };
}
