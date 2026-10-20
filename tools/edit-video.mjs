#!/usr/bin/env node
// edit-video.mjs — an ad's edit.json: check it, export it, grab stills, and build its captions, color match, tracking,
// ducking and review comments. Export and stills run Studio's own engine (studio/engine) in a headless browser,
// so they match Studio's preview frame for frame.

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync, writeSync, closeSync, watch } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { brandDirFrom, die, ffprobeJson, loudness, markEditing, mimeOf, parseArgs, readEditing, round, run, sessionId, typeOf, usage } from './lib/catalog.mjs';
import { compose, eachKeyed, endOf, keyed, r3, val } from '../studio/engine/doc.js';
import { atempo, soundRate, stretched } from './lib/stretch.mjs';
import { fetchMissing } from './lib/r2.mjs';
import { hear, vocabulary } from './lib/transcribe.mjs';

const HELP = `edit-video.mjs — an ad's edit document (outputs/<ad>/edit.json)

  check    <edit.json>                            summary + problems (missing files, black: no picture on any track,
                                                  a cut into someone's sound, a sound effect left marking no move or text);
                                                  export refuses black unless --allow-black
  place    <edit.json> --shots <shots.json> [--track Video] [--scene 0.25] [--max-rate 1] [--sfx <wav>]
                                                  shots on their lines: shots.json = {"clips":[{"file",
                                                  "starts":[timeline s of each shot], "end"}]}; finds each
                                                  clip's cuts and fits every shot to its slot (slowed, or sped
                                                  up to --max-rate and trimmed). --sfx also writes the
                                                  shots' own sound, cut the same way, as one WAV
  cut      <edit.json> --from s --to s            remove that stretch of time from every track: clips trimmed or
                                                  split, everything after it (clips, captions, keyframes) moves up
  tighten  <edit.json> [--track Voice] [--detect <dir>] [--gap 0.15] [--keep 0.08]
                                                  cut the speaker's dead air: lead-ins, tails, pauses over --gap (to
                                                  --keep), by waveform, guarded by each clip's word timings (cached in
                                                  .tighten/); --track: the speaker's track(s), comma-separated (default: a track named
                                                  voice/dialog/vo); --detect: noise-free copies (fix-voice isolate's
                                                  isolated/) to find speech on, named like the source or the clip
  track    <edit.json> --clip <name> --at s --box x,y,w,h [--follow <clip,…>] [--zoom 3 [--from s] [--ramp 0.25]
           [--to x,y]] [--radius 80]   follow an object (a label, a jar, a hand) through a video clip, frame by
                                                  frame: --box is it at --at, in frame px; --follow clips keep their offset
                                                  from it; --zoom keyframes the clip onto it (ease out over --ramp from
                                                  --from, default the clip's start), sliding it to --to (default center)
  reframe  <edit.json> --size 1080x1350 --out <edit-v2.json>   the edit in another frame size (positions and
                                                  sizes scaled; media still fills the frame)
  export   <edit.json> [--out <mp4>] [--scale 0.5] [--from s] [--to s] [--timeout 1800] [--allow-black]
                                                  H.264 + AAC; default out: the doc's "output", else
                                                  final/<id>_V<n>_<rest of folder>.mp4 (n from edit-v<n>.json)
  audio    <edit.json> [--from s] [--to s] [--out <wav>] [--transcribe]   the mix alone, no picture: check a change
                                                  by ear; --transcribe prints its words on the timeline clock (local Whisper)
  frames   <edit.json> --at 1,4.5,9 [--out <png>] [--scale 0.5]   a contact sheet of those moments
  captions <edit.json> --words <transcript.json|timing.json> [--max 3] [--track Captions] [--from s] [--to s]
                                                  word-timed caption lines into the track's captions clip
                                                  (breaks at punctuation, pauses and a song's lyric lines)
  match    <edit.json> [--track Video] [--ref <clip src>] [--strength 0.75]   per-clip color match
                                                  (grade.match) toward the reference clip (default: the median look)
  moves    <edit.json> [--from s] [--to s] [--track Video]   timeline times where the picture moves most
                                                  (to place sound effects on actions)
  duck     <edit.json> --track Music --words <transcript.json> [--speaker S1] [--db -10]
                                                  volume keyframes: the track dips while they speak
  comments <ad folder> [--wait] [--take] [--done <id> --reply "…" --span 12.4-15]   review comments left in Studio:
                                                  open ones print as JSON with what was on screen and a contact
                                                  sheet of their moments (marked spots outlined; one on a stretch has
                                                  to, with what's on screen across it and its first and last frame), and turn "seen"
                                                  (a comment on a .md brief or footage.json has file and quote instead, plus check on a footage comment; one the user's
                                                  own edit made in Studio also has edit: { where, from, to });
                                                  a comment the user sent back keeps its earlier rounds in history;
                                                  --wait blocks until there is one. They go only to the session
                                                  editing the ad (lib/catalog.mjs markEditing); any command that changes
                                                  an ad another session holds stops: --take takes it, on the user's yes.
                                                  --done marks one done with the changed stretch, which Studio's
                                                  Watch change button plays; an edit comment done with no --reply (nothing
                                                  else changed) goes straight to the history

Document (times are seconds on the timeline clock; any number marked * also takes keyframes
[[t, value, easing?], …], easing: linear | in | out | ease (default) | back | bounce | elastic | hold):
  { size: [1080, 1920], fps: 30, background, loudness: -14 (LUFS; null = untouched), fonts: { family: file },
    fx: "fx.js" (the ad's own layers / transitions / animations, see studio/engine/draw.js), output,
    tracks: [ { name, hidden, mute, volume* (dB), opacity*, grade,
                transform: { scale*, x*, y*, rotate*, origin: [x, y] }, clips: [...] } ] }
  The first track draws on top. Paths are relative to the document.
  A version that only changes the hook: { base: "edit.json", from: "Body1", tracks: [its hook's clips] } plays them,
  then the base from its first clip named "from" (compose in studio/engine/doc.js). Commands that change a document
  refuse it: body changes go in the base, hook changes in the version's own clips.
  Every clip: type (else from src), at, end (or dur; media default to the source's end), name.
    video  src, in (source s), rate, mute, volume* (dB), fit (cover | contain | fill), grade,
           transition: { type, dur (0.4), dir, ease, color } into it from the clip before it on its track,
           centered on the cut: cut | fade | dip | slide | push | wipe (dir left|right|up|down) | zoom | blur | flip
    audio  src, in, rate, volume* (dB), fadeIn, fadeOut, loop
    image  src, fit, grade
    text   text ("line\\nwith {accent} words and {any color|#FF3B30}"), style
    captions  lines: [{ text, at, end, words: [[word, start, end, color?], …] }], style,
           active: { color, scale, ease, dur } (the spoken word), upcoming: { color, opacity } (0 = reveal word by word)
    rect   color*, radius*
    custom draw (a layer in fx), any params
  Visual clips: x*, y* (center), w*, h* (box; media default the frame), scale*, rotate*, opacity*, blur*,
    origin: [x, y] (scale/rotate pivot), radius*, enter / exit: type or { type, dur }:
    fade | pop | bounce | zoom | blur | slide-up | slide-down | slide-left | slide-right
  style: font (Google Fonts family or doc.fonts), size, weight, italic, color, accent, stroke, strokeWidth,
    shadow { color, blur, x, y, opacity }, background { color, padX, padY, radius, opacity }, maxWidth,
    lineHeight, letterSpacing, case (upper | lower)
  grade: exposure* (stops), contrast*, saturation*, gamma* (1 = as shot), temperature*, tint* (-1..1),
    vignette*, grain* (0..1), match ([gL, ga, gb, oL, oa, ob]: Lab × g + o, from \`match\`)`;

const args = parseArgs(process.argv.slice(2), { flags: ['wait', 'take', 'transcribe', 'allow-black'], help: HELP });
const [cmd, target] = args._;
if (!cmd) usage(HELP);

const readJson = (p) => {
  if (!p || !existsSync(p)) die(`not found: ${p || '(none given)'}`);
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { die(`${p}: ${e.message}`); }
};
// A hook version reads as the whole edit; one about to be changed (write) must be a full document.
const readDoc = (p, write = false) => {
  const doc = readJson(p);
  if (!doc.base) return doc;
  if (write) die(`${basename(p)} takes everything after its hook from ${doc.base}: run this on ${doc.base}, or change the hook's own clips in ${basename(p)}`);
  try { return compose(doc, readJson(resolve(dirname(p), doc.base))); } catch (e) { die(`${basename(p)}: ${e.message}`); }
};
// Another session's ad is left alone unless the user says to take it over (--take).
const saveDoc = (p, doc) => {
  const holder = markEditing(dirname(p), sessionId(), !!args.take);
  if (holder !== sessionId()) die(`session ${holder} is editing ad ${basename(dirname(p)).split('_')[0]}: ask the user before changing it; on their yes, rerun with --take`);
  writeFileSync(p, JSON.stringify(doc, null, 1) + '\n');
};
const trackNamed = (doc, name) => (doc.tracks || []).find((tr) => tr.name === name) || die(`no track named "${name}" (tracks: ${(doc.tracks || []).map((t) => t.name).join(', ')})`);

// ---------- check ----------
// Stretches where no shown track has a full-frame picture (video or image without a box): they export black.
function blackGaps(doc) {
  const pic = (c) => c.src && (c.type || 'video') !== 'audio' && typeOf(c.src) !== 'audio' && c.w == null && c.h == null;
  const spans = (doc.tracks || []).filter((tr) => !tr.hidden).flatMap((tr) => (tr.clips || []).filter(pic).map((c) => [c.at ?? 0, endOf(c) ?? Infinity]))
    .sort((a, b) => a[0] - b[0]);
  const end = doc.duration ?? Math.max(0, ...(doc.tracks || []).flatMap((tr) => (tr.clips || []).map((c) => endOf(c) ?? Math.max(0, ...(c.lines || []).map((l) => l.end ?? 0))))); // caption lines run the timeline too
  const gaps = [];
  let t = 0;
  for (const [a, b] of spans) { if (a > t + 0.001) gaps.push([t, Math.min(a, end)]); t = Math.max(t, b); }
  if (end > t + 0.001) gaps.push([t, end]);
  return gaps.filter(([a, b]) => b - a > 0.001);
}

// Sound effects (clips under 3 s on a sound-only track) with no move (a picture keyframe) or text, box or image
// coming in from 0.15 s before to 0.6 s after them: left behind when what they marked moved or went.
const MOVES = ['x', 'y', 'w', 'h', 'scale', 'rotate', 'opacity', 'blur'];
function orphanSfx(doc) {
  const marks = [];
  for (const tr of doc.tracks || []) {
    for (const v of [...MOVES.map((k) => tr.transform?.[k]), ...Object.values(tr.grade || {})]) if (keyed(v)) marks.push(...v.map(([t]) => t));
    for (const c of tr.clips || []) {
      if (['text', 'rect', 'image'].includes(c.type) || (c.src && typeOf(c.src) === 'image')) marks.push(c.at ?? 0);
      for (const v of [...MOVES.map((k) => c[k]), ...Object.values(c.grade || {})]) if (keyed(v)) marks.push(...v.map(([t]) => t));
    }
  }
  return (doc.tracks || []).filter((tr) => tr.clips?.length && tr.clips.every((c) => c.src && typeOf(c.src) === 'audio'))
    .flatMap((tr) => tr.clips.filter((c) => (endOf(c) ?? Infinity) - (c.at ?? 0) < 3 && !marks.some((t) => t >= (c.at ?? 0) - 0.15 && t <= (c.at ?? 0) + 0.6)));
}

// Cuts that land in someone's speech: a video or voice clip starting or ending inside sound that runs into their
// speech (within 24 dB of its level) without a pause (30 dB down): a word cut in two, a soft ending clipped.
function cutsIntoSpeech(doc, dir) {
  const out = [];
  for (const tr of doc.tracks || []) {
    if (tr.mute) continue;
    for (const c of tr.clips || []) {
      if (!c.src || c.mute || (c.rate ?? 1) < 0.1) continue;
      if (!(typeOf(c.src) === 'video' || (typeOf(c.src) === 'audio' && /voice|dialog|\bvo\b/i.test(tr.name || '')))) continue; // not music or effects
      const file = resolve(dir, c.src);
      if (!speechCache.has(file)) speechCache.set(file, existsSync(file) ? loudness(file) || [] : []);
      const e = speechCache.get(file);
      if (!e.length) continue;
      const level = [...e].sort((x, y) => x - y)[Math.floor(e.length * 0.9)], thr = level - 24, soft = level - 30, f = (s) => Math.round(s * 100);
      // the cut at s has sound on both sides that runs (dir -1 back, 1 on) into speech without dropping to a pause
      const inWord = (s, dir) => {
        if (!(e[f(s)] > soft && e[f(s) - 1] > soft)) return false;
        for (let i = f(s) + (dir < 0 ? -1 : 0), k = 0; k < 40; k++, i += dir) { if (!(e[i] > soft)) return false; if (e[i] > thr) return true; }
        return false;
      };
      const i0 = c.in ?? 0, i1 = i0 + ((endOf(c) ?? 0) - (c.at ?? 0)) * (c.rate ?? 1);
      for (const [s, t, dir] of [[i0, c.at ?? 0, 1], [i1, endOf(c), -1]]) if (s > 0.05 && inWord(s, dir)) out.push(`${tr.name}: ${c.name || basename(c.src)} cuts into sound at ${round(t)}s (source ${round(s)}s): a word cut short?`);
    }
  }
  return out;
}

function check(p) {
  const doc = readDoc(p), dir = dirname(p), problems = [];
  const lines = [];
  let end = 0;
  for (const tr of doc.tracks || []) {
    const clips = [...(tr.clips || [])].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    lines.push(`${tr.name}${tr.mute ? ' (muted)' : ''}${tr.hidden ? ' (hidden)' : ''}: ${clips.length} clip(s)`);
    clips.forEach((c) => {
      if (c.src && !existsSync(resolve(dir, c.src))) problems.push(`${tr.name}: missing ${c.src}`);
      const stop = endOf(c);
      if (stop != null) end = Math.max(end, stop);
    });
  }
  for (const [a, b] of blackGaps(doc)) problems.push(`${round(b - a)}s of black at ${round(a)}s`);
  problems.push(...cutsIntoSpeech(doc, dir));
  for (const c of orphanSfx(doc)) problems.push(`sound effect "${c.name || c.src}" at ${round(c.at ?? 0)}s marks no move or text: move it with what it marked, or remove it`);
  console.log(`${(doc.size || [1080, 1920]).join('x')} @ ${doc.fps || 30} fps · ${round(doc.duration ?? end)}s`);
  for (const l of lines) console.log('  ' + l);
  for (const pr of problems) console.log('PROBLEM: ' + pr);
  if (!problems.length) console.log('ok');
}

// ---------- place ----------
const probeDur = (f) => +ffprobeJson(f).format.duration;
const cutsIn = (f, thr) => [...(run('ffmpeg', ['-hide_banner', '-i', f, '-vf', `select='gt(scene,${thr})',showinfo`, '-an', '-f', 'null', '-'], { allowFail: true }).stderr || '')
  .matchAll(/pts_time:([0-9.]+)/g)].map((m) => +m[1]);

function placeCmd(p) {
  if (!args.shots) die('--shots <shots.json> is required');
  const doc = readDoc(p, true), dir = dirname(p), fps = doc.fps || 30, maxRate = +(args['max-rate'] || 1);
  const fr = (t) => Math.round(Math.round(t * fps) / fps * 1e4) / 1e4;
  const clips = [];
  for (const c of readJson(resolve(args.shots)).clips) {
    const f = resolve(dir, c.file), dur = probeDur(f);
    const b = [0, ...cutsIn(f, +(args.scene || 0.25)), dur], st = [...c.starts, c.end];
    if (b.length !== st.length) console.error(`WARN: ${c.file}: found ${b.length - 1} shots, planned ${c.starts.length} — check it by eye`);
    for (let k = 0; k < Math.min(b.length, st.length) - 1; k++) {
      const s0 = b[k] + (k ? 1 / fps : 0); // a frame past the cut, so it never shows the shot before
      const seg = b[k + 1] - s0, win = st[k + 1] - st[k];
      const rate = seg >= win ? Math.min(seg / win, maxRate) : (seg - 0.02) / win;
      if (rate < 0.8) console.error(`WARN: ${c.file} shot ${k + 1} slowed to ${rate.toFixed(2)}x`);
      clips.push({ src: c.file, at: fr(st[k]), end: fr(st[k + 1]), in: +s0.toFixed(3), rate: +rate.toFixed(4), mute: true });
    }
  }
  const tr = (doc.tracks ||= []).find((t) => t.name === (args.track || 'Video')) || (doc.tracks.push({ name: args.track || 'Video', clips: [] }), doc.tracks.at(-1));
  tr.clips = clips;
  saveDoc(p, doc);
  console.log(`${clips.length} shots -> ${tr.name}`);
  if (!args.sfx) return;
  // The shots' own sound, cut and tempo-matched like the picture (pitch kept), on a silent bed.
  const files = [...new Set(clips.map((c) => c.src))];
  const end = Math.max(...clips.map((c) => c.end));
  const graph = clips.map((c, k) => {
    const win = c.end - c.at;
    return `[${files.indexOf(c.src)}:a]atrim=${c.in}:${(c.in + win * c.rate).toFixed(3)},asetpts=PTS-STARTPTS,${atempo(c.rate)},atrim=0:${win.toFixed(3)},adelay=${Math.round(c.at * 1000)}:all=1[s${k}]`;
  });
  graph.push(`aevalsrc=0:d=${end.toFixed(3)}:s=48000[bed]`, `[bed]${clips.map((_, k) => `[s${k}]`).join('')}amix=inputs=${clips.length + 1}:normalize=0:duration=first[out]`);
  const out = resolve(dir, args.sfx);
  mkdirSync(dirname(out), { recursive: true });
  run('ffmpeg', ['-v', 'error', '-y', ...files.flatMap((f) => ['-i', resolve(dir, f)]), '-filter_complex', graph.join(';'), '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_s16le', out]);
  console.log(`Saved: ${out}`);
}

// ---------- cut ----------
// Keyframes on the timeline clock after removing [a, b): keys inside drop, later ones move up.
const cutKeys = (v, a, b) => v.filter(([t]) => t < a || t >= b).map(([t, ...rest]) => [t >= b ? round(t - (b - a)) : t, ...rest]);
const cutValues = (o, a, b) => eachKeyed(o, (h, k, v) => { h[k] = cutKeys(v, a, b); });

// Remove [a, b] from every track of a document (times to the millisecond, so cut edges meet exactly).
function cutDoc(doc, a, b) {
  const d = b - a, shift = (t) => (t >= b ? r3(t - d) : t > a ? a : t);
  for (const tr of doc.tracks || []) {
    cutValues(tr, a, b);
    const out = [];
    for (const c of tr.clips || []) {
      const at = c.at ?? 0, end = endOf(c) ?? Infinity, rate = c.rate ?? 1;
      if (c.dur != null) { c.end = end; delete c.dur; } // the branches below move `end`
      cutValues(c, a, b);
      if (c.lines) c.lines = c.lines.filter((l) => l.at < a || l.at >= b).map((l) => ({ ...l, at: shift(l.at), end: shift(l.end), ...(l.words && { words: l.words.map(([w, s, e, ...x]) => [w, shift(s), shift(e), ...x]) }) }));
      if (end <= a || at >= b) { if (at >= b) { c.at = r3(at - d); if (c.end != null) c.end = r3(end - d); } out.push(c); continue; }
      if (at >= a && end <= b) continue; // wholly inside: gone
      if (at < a && end > b && c.src && !c.lines) { // spans the cut: split, the second part skips the cut's source
        out.push({ ...c, end: a });
        out.push({ ...c, at: a, in: r3((c.in ?? 0) + (b - at) * rate), ...(c.end != null && { end: r3(end - d) }), transition: undefined });
        continue;
      }
      if (at < a) { if (c.end != null || c.dur != null) { c.end = r3(Math.max(a, end - d)); delete c.dur; } } // trims its tail (or the cut, inside it)
      else { c.in = r3((c.in ?? 0) + (b - at) * rate); c.at = a; if (c.end != null) c.end = r3(end - d); } // trims its head
      out.push(c);
    }
    const kept = [];
    for (const c of out) { // slivers left by rounding: the clip before them holds over their time, so no frame goes black
      if (c.end == null || c.end - (c.at ?? 0) >= 1 / (doc.fps || 30)) { kept.push(c); continue; }
      const prev = kept.at(-1);
      if (prev?.end != null && Math.abs(prev.end - (c.at ?? 0)) < 1e-3) prev.end = c.end;
    }
    tr.clips = kept;
  }
  if (doc.duration != null) doc.duration = r3(doc.duration - d);
}

// ---------- tighten ----------
// Speech in [a, b] of an audio file: 10 ms frames within 24 dB of the stretch's speech level (breaths and room
// tone fall below it), dips under 0.12 s bridged, clicks under 0.06 s dropped. Each stretch then widens by up to
// SOFT s while the sound stays within 34 dB, so a soft start or ending ("-mend", "crash") stays in. .heard(s, t)
// says whether a stretch has any sound that loud (a word placed over silence has none).
const speechCache = new Map(), SOFT = 0.3;
function speechIn(file, a, b) {
  if (!speechCache.has(file)) speechCache.set(file, loudness(file) || []);
  const e = speechCache.get(file), i0 = Math.max(0, Math.round(a * 100)), i1 = Math.min(e.length, Math.round(b * 100));
  if (i1 <= i0) return [];
  const seg = e.slice(i0, i1).sort((p, q) => p - q), thr = seg[Math.floor(seg.length * 0.9)] - 24, out = [];
  for (let i = i0; i < i1; i++) {
    if (e[i] <= thr) continue;
    let j = i; while (j < i1 && e[j] > thr) j++;
    const s = i / 100, t = j / 100;
    if (out.length && s - out.at(-1)[1] < 0.12) out.at(-1)[1] = t; else out.push([s, t]);
    i = j;
  }
  const soft = thr - 10, wide = [];
  for (const [s, t] of out.filter(([s, t]) => t - s >= 0.06)) {
    let x = Math.round(s * 100), y = Math.round(t * 100);
    while (x > i0 && s * 100 - x < SOFT * 100 && e[x - 1] > soft) x--;
    while (y < i1 && y - t * 100 < SOFT * 100 && e[y] > soft) y++;
    if (wide.length && x / 100 <= wide.at(-1)[1]) wide.at(-1)[1] = y / 100; else wide.push([x / 100, y / 100]);
  }
  wide.heard = (s, t) => e.slice(Math.round(s * 100), Math.round(t * 100)).some((v) => v > soft);
  return wide;
}

// A file's words with their timings (transcribe-media --words): its <stem>.transcript.json beside it, else one kept in <edit dir>/.tighten/.
function wordsOf(dir, file) {
  const beside = file.replace(/\.[^./]+$/, '.transcript.json');
  const out = existsSync(beside) && /"words"\s*:\s*\[\s*\{/.test(readFileSync(beside, 'utf8')) ? beside : join(dir, '.tighten', `${basename(file).replace(/\.[^.]+$/, '')}.words.json`);
  if (!existsSync(out)) {
    mkdirSync(dirname(out), { recursive: true });
    const r = run(process.execPath, [join(import.meta.dirname, 'transcribe-media.mjs'), '--in', file, '--out', out, '--words'], { allowFail: true });
    if (r.status !== 0) console.error(`WARN: no word timings for ${basename(file)} — cuts are waveform-only`);
  }
  try { return JSON.parse(readFileSync(out, 'utf8')).words || []; } catch { return []; }
}

// Cut the dead air out of the speaker's clips: the lead-in before the first word, the tail after the last, and every
// pause over --gap down to --keep. Speech is found in each clip's waveform (on --detect's noise-free copy of the
// source when there is one) and kept only where the transcript has a word; no cut reaches into a word's start, and the
// first clip (the hook) keeps the transcript's lead so its first sound never clips. Every track slides along.
function tightenCmd(p) {
  const doc = readDoc(p, true), dir = dirname(p), gap = +(args.gap ?? 0.15), keep = +(args.keep ?? 0.08), LEAD = 0.03, TAIL = 0.05;
  const names = String(args.track || '').split(',').filter(Boolean);
  const tracks = (doc.tracks || []).filter((tr) => (names.length ? names.includes(tr.name) : /voice|dialog|\bvo\b/i.test(tr.name || '')));
  if (!tracks.length) die('no speaker track: name it with --track (e.g. --track Voice)');
  const detect = args.detect ? resolve(args.detect) : null;
  const cuts = [];
  for (const tr of tracks) for (const c of tr.clips || []) {
    if (!c.src) continue;
    const src = resolve(dir, c.src), at = c.at ?? 0, end = endOf(c), rate = c.rate ?? 1, i0 = c.in ?? 0;
    if (end == null) continue;
    const i1 = i0 + (end - at) * rate, stem = basename(c.src).replace(/\.[^.]+$/, '');
    const det = [detect && join(detect, `${stem}.wav`), detect && c.name && join(detect, `${c.name}.wav`)].find((f) => f && existsSync(f)) || src;
    const words = wordsOf(dir, src).map((w) => ({ ...w, end: Math.min(w.end, w.start + 0.065 * String(w.word).length + 0.15) }));
    let sp = speechIn(det, i0, i1);
    const { heard } = sp;
    sp = sp.filter(([s, t]) => !words.length || words.some((w) => t > w.start - 0.05 && s < w.end + 0.05));
    // a quiet word the waveform missed still counts as speech, unless it's timed over silence
    for (const w of words) if (w.start >= i0 && w.start < i1 && !sp.some(([s, t]) => t > w.start - 0.05 && s < w.end + 0.05) && heard(w.start, w.end)) sp.push([w.start, w.end]);
    sp.sort((x, y) => x[0] - y[0]);
    if (!sp.length) continue;
    const T = (s) => at + (s - i0) / rate;
    const safe = (a, b) => !words.some((w) => b > w.start - 0.04 && a < w.end); // never into a word (its tail is padded by the waveform)
    let head = sp[0][0] - LEAD;
    if (at < 0.5) { const first = words.find((w) => w.start >= i0 - 0.05); if (first) head = Math.min(head, first.start - 0.06); }
    if (head > i0 + 0.02) cuts.push([at, T(head)]);
    const tail = sp.at(-1)[1] + TAIL;
    if (tail < i1 - 0.02 && safe(tail, i1)) cuts.push([T(tail), end]);
    for (let k = 1; k < sp.length; k++) {
      const a = sp[k - 1][1] + keep / 2, b = sp[k][0] - keep / 2;
      if (sp[k][0] - sp[k - 1][1] > gap && safe(a, b)) cuts.push([T(a), T(b)]);
    }
  }
  cuts.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [a, b] of cuts) { if (merged.length && a <= merged.at(-1)[1] + 0.1) merged.at(-1)[1] = Math.max(merged.at(-1)[1], b); else merged.push([a, b]); }
  const real = merged.filter(([a, b]) => b - a > 0.02).reverse();
  for (const [a, b] of real) cutDoc(doc, a, b);
  for (const tr of doc.tracks || []) { // where two shots should meet, hold the earlier over a hairline gap
    const cl = [...(tr.clips || [])].sort((x, y) => (x.at ?? 0) - (y.at ?? 0));
    for (let k = 1; k < cl.length; k++) {
      const e = endOf(cl[k - 1]), gapLen = (cl[k].at ?? 0) - e;
      if (e != null && cl[k - 1].src && cl[k].src && gapLen > 0 && gapLen < 0.05) { cl[k - 1].end = cl[k].at; delete cl[k - 1].dur; }
    }
  }
  saveDoc(p, doc);
  console.log(`tightened: ${real.length} cuts, ${round(real.reduce((s, [a, b]) => s + b - a, 0))}s of dead air removed`);
}

function cutCmd(p) {
  const a = +args.from, b = +args.to;
  if (!(b > a)) die('--from and --to (seconds, from < to) are required');
  const doc = readDoc(p, true);
  cutDoc(doc, a, b);
  saveDoc(p, doc);
  console.log(`cut ${round(a)}–${round(b)}s (${round(b - a)}s) from every track`);
}

// ---------- reframe ----------
function reframeCmd(p) {
  const m = /^(\d+)x(\d+)$/.exec(args.size || '');
  if (!m || !args.out) die('--size <W>x<H> and --out <file> are required');
  const doc = readDoc(p), [W, H] = doc.size || [1080, 1920], nw = +m[1], nh = +m[2], sx = nw / W, sy = nh / H;
  const scale = (v, f) => (keyed(v) ? v.map(([t, x, ...e]) => [t, Math.round(x * f), ...e]) : typeof v === 'number' ? Math.round(v * f) : v);
  const place = (o) => {
    for (const [k, f] of [['x', sx], ['w', sx], ['y', sy], ['h', sy]]) if (o[k] != null) o[k] = scale(o[k], f);
    if (o.origin) o.origin = [Math.round(o.origin[0] * sx), Math.round(o.origin[1] * sy)];
  };
  for (const tr of doc.tracks || []) {
    if (tr.transform) place(tr.transform);
    for (const c of tr.clips || []) {
      place(c);
      if (c.style?.maxWidth) c.style.maxWidth = Math.round(c.style.maxWidth * sx);
    }
  }
  doc.size = [nw, nh];
  delete doc.output;
  const out = resolve(args.out);
  saveDoc(out, doc);
  console.log(`${W}x${H} -> ${nw}x${nh}: ${out} (check text positions on a frames sheet)`);
}

// ---------- headless engine ----------
function engineBundle() {
  const out = join(tmpdir(), 'ad-production-kit-edit', 'headless.js');
  mkdirSync(dirname(out), { recursive: true });
  let esbuild;
  try { esbuild = import.meta.resolve('esbuild'); } catch { die('esbuild missing — run: bash tools/setup.sh'); }
  return import(esbuild).then((m) => m.build({
    entryPoints: [join(import.meta.dirname, '..', 'studio', 'engine', 'headless.js')],
    bundle: true, format: 'esm', target: 'es2022', outfile: out, logLevel: 'error',
    nodePaths: [join(import.meta.dirname, '..', 'studio', 'node_modules')],
  })).then(() => readFileSync(out));
}

async function browser() {
  let pw;
  try { pw = await import('playwright-core'); } catch { die('playwright-core missing — run: bash tools/setup.sh'); }
  const opts = { headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--ignore-gpu-blocklist'] };
  // An installed Chrome or Edge first (they carry H.264/AAC), else Playwright's Chromium, downloaded on the first export.
  const launch = async () => {
    for (const channel of ['chrome', 'msedge', 'chromium']) {
      try { return await pw.chromium.launch({ ...opts, channel }); } catch {}
    }
    return null;
  };
  let b = await launch();
  if (!b) {
    console.error('No Chrome or Edge found: downloading Chromium for the export (once)…');
    run(process.execPath, [join(import.meta.dirname, '..', 'node_modules', 'playwright-core', 'cli.js'), 'install', '--no-shell', 'chromium'], { allowFail: true });
    b = await launch();
  }
  return b || die(`no browser for the export: install Google Chrome${process.platform === 'linux' ? ', or run: sudo npx playwright-core install-deps chromium' : ''}`);
}

// Serve the plan's brand folder and the shared library + the engine page; collect the output; resolve when
// the page reports done.
async function runPage(planPath, query, outPath, { timeout = 1800, onProgress } = {}) {
  const brand = resolve(brandDirFrom(planPath));
  const inBrand = brand !== resolve(planPath);
  const root = inBrand ? dirname(dirname(brand)) : resolve(dirname(planPath)); // workspaces/, so ../ reaches the library
  const allowed = inBrand ? [brand, join(root, 'Shared', 'Library')] : [root];
  const app = await engineBundle();
  const fd = openSync(outPath, 'w');
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const body = (req) => new Promise((r) => { const parts = []; req.on('data', (d) => parts.push(d)); req.on('end', () => r(Buffer.concat(parts))); });
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST') {
      const b = await body(req);
      if (u.pathname === '/out') writeSync(fd, b, 0, b.length, +u.searchParams.get('offset'));
      else if (u.pathname === '/progress') onProgress?.(+b.toString());
      else if (u.pathname === '/done') resolveDone(JSON.parse(b.toString()));
      return res.end('ok');
    }
    if (u.pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><script type="module" src="/app.js"></script>');
    if (u.pathname === '/app.js') return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(app);
    let file = resolve(root, decodeURIComponent(u.pathname.replace(/^\/f\//, '')));
    if (!u.pathname.startsWith('/f/') || !allowed.some((d) => file === d || file.startsWith(d + sep))) return res.writeHead(403).end();
    let st;
    try { st = statSync(file); } catch { return res.writeHead(404).end(); }
    const rate = soundRate(u.searchParams); // the sound alone or at another speed: the same file Studio serves
    if (rate) { try { file = await stretched(file, rate); st = statSync(file); } catch (e) { return res.writeHead(500).end(String(e.message)); } }
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    const head = { 'Content-Type': mimeOf(file), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
    if (!m) return createReadStream(file).pipe(res.writeHead(200, { ...head, 'Content-Length': st.size }));
    const s = m[1] ? +m[1] : st.size - +m[2], e = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
    createReadStream(file, { start: s, end: e }).pipe(res.writeHead(206, { ...head, 'Content-Range': `bytes ${s}-${e}/${st.size}`, 'Content-Length': e - s + 1 }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await browser();
  const page = await b.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  const plan = relative(root, planPath).split(sep).map(encodeURIComponent).join('/');
  await page.goto(`http://127.0.0.1:${server.address().port}/?plan=${plan}&${new URLSearchParams(query)}`);
  const timer = setTimeout(() => resolveDone({ error: `timed out after ${timeout}s` }), timeout * 1000);
  const result = await done;
  clearTimeout(timer);
  closeSync(fd);
  await b.close();
  server.close();
  if (result.error) die(result.error);
  for (const e of result.errors || []) console.error('WARN: ' + e);
  return result;
}

function defaultOut(planPath, doc) {
  if (doc.output) return resolve(dirname(planPath), doc.output);
  const folder = basename(dirname(planPath));
  const [id, ...rest] = folder.split('_');
  const v = /^edit-v(\d+)\.json$/i.exec(basename(planPath))?.[1] || '1';
  return join(dirname(planPath), 'final', `${id}_V${v}_${rest.join('_')}.mp4`);
}

// Studio reads this to show the export's state.
const statusFile = (planPath) => join(dirname(planPath), '.export.json');
const setStatus = (planPath, s) => writeFileSync(statusFile(planPath), JSON.stringify({ plan: basename(planPath), pid: process.pid, at: Date.now(), ...s }));

async function exportCmd(p) {
  const doc = readDoc(p);
  const black = blackGaps(doc);
  if (black.length && !args['allow-black']) die(`black frames at ${black.map(([a, b]) => `${round(a)}s (${round(b - a)}s)`).join(', ')}: fix the edit, or --allow-black`);
  const out = args.out ? resolve(args.out) : defaultOut(p, doc);
  mkdirSync(dirname(out), { recursive: true });
  const query = { mode: 'export', scale: args.scale || 1, ...(args.from && { from: args.from }), ...(args.to && { to: args.to }) };
  setStatus(p, { state: 'running', progress: 0 });
  const t0 = Date.now();
  let shown = 0;
  try {
    await runPage(p, query, out, {
      timeout: +(args.timeout || 1800),
      onProgress: (x) => { setStatus(p, { state: 'running', progress: x }); if (x - shown >= 0.25) { shown = x; console.error(`${Math.round(x * 100)}%`); } },
    });
    const meta = ffprobeJson(out);
    const rel = relative(dirname(p), out).split(sep).join('/');
    setStatus(p, { state: 'done', out: rel, seconds: round((Date.now() - t0) / 1000) });
    console.error(`done      ${meta.format ? `${round(+meta.format.duration)}s ` : ''}in ${round((Date.now() - t0) / 1000)}s`);
    console.log('Saved: ' + out);
  } catch (e) {
    setStatus(p, { state: 'failed', error: String(e.message || e) });
    throw e;
  }
}

async function audioCmd(p) {
  const out = args.out ? resolve(args.out) : join(tmpdir(), 'ad-production-kit-edit', `mix-${Date.now()}.wav`);
  mkdirSync(dirname(out), { recursive: true });
  await runPage(p, { mode: 'audio', from: args.from || 0, ...(args.to && { to: args.to }) }, out);
  console.log('Saved: ' + out);
  if (!args.transcribe) return;
  const from = +(args.from || 0); // local Whisper alone: a check needs the words heard, not a transcript
  console.log((await hear(out)).map((w) => `${round(w.start + from)} ${w.word}`).join('\n'));
}

async function framesCmd(p) {
  if (!args.at) die('--at <seconds,seconds,…> is required');
  const out = args.out ? resolve(args.out) : join(tmpdir(), 'ad-production-kit-edit', `frames-${Date.now()}.png`);
  mkdirSync(dirname(out), { recursive: true });
  await runPage(p, { mode: 'frames', at: args.at, scale: args.scale || 0.5 }, out);
  console.log('Saved: ' + out);
}

// ---------- captions ----------
// Words from an ADPK transcript ({words:[{word,start,end}]}) or a song timing file ({lines:[{words}]}).
function readWords(file) {
  const d = readJson(file);
  // A song's lyric lines end a caption line too.
  const ws = d.words || (d.lines || []).flatMap((l) => (l.words || []).map((w, i, a) => ({ ...w, brk: i === a.length - 1 })));
  if (!ws.length) die(`${file}: no word timings (transcribe with --words, or a song .timing.json)`);
  return ws.map((w) => ({ word: String(w.word).trim(), start: +w.start, end: +w.end, speaker: w.speaker, brk: w.brk })).filter((w) => w.word);
}

function captionsCmd(p) {
  if (!args.words) die('--words <transcript.json> is required');
  const doc = readDoc(p, true), max = +(args.max || 3), from = +(args.from || 0), to = args.to ? +args.to : Infinity;
  const ws = readWords(resolve(args.words)).filter((w) => w.start >= from && w.start < to);
  // brand and product names spelled as the brand writes them ("acme bowl" → "Acme Bowl")
  const bare = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  for (const name of vocabulary(join(brandDirFrom(p), 'inputs', 'media')).map((v) => v.replace(/\s*\(.*\)$/, '').split(/[\s_-]+/).filter(Boolean))) {
    for (let i = 0; i + name.length <= ws.length; i++) {
      if (name.every((n, k) => bare(ws[i + k].word) === bare(n))) name.forEach((n, k) => { ws[i + k].word = ws[i + k].word.replace(/[\p{L}\p{N}][\p{L}\p{N}'’]*/u, n); });
    }
  }
  const groups = [];
  let g = [];
  ws.forEach((w, i) => {
    g.push(w);
    const next = ws[i + 1];
    if (!next || w.brk || g.length >= max || /[,.!?;:]$/.test(w.word) || next.start - w.end > 0.5) { groups.push(g); g = []; }
  });
  const clean = (s) => s.replace(/[,.;:]+$/, '');
  const lines = groups.map((grp, i) => {
    const next = groups[i + 1];
    const last = grp[grp.length - 1].end;
    const end = next && next[0].start - last < 1.2 ? next[0].start : last + 0.4;
    return { text: grp.map((w) => clean(w.word)).join(' '), at: round(grp[0].start), end: round(end), words: grp.map((w) => [clean(w.word), round(w.start), round(w.end)]) };
  });
  const tr = (doc.tracks ||= []).find((t) => t.name === (args.track || 'Captions')) || (doc.tracks.unshift({ name: args.track || 'Captions', clips: [] }), doc.tracks[0]);
  let clip = tr.clips.find((c) => c.type === 'captions' || c.lines);
  if (!clip) tr.clips.push(clip = { type: 'captions', style: { font: 'Inter', weight: 700, size: 72, color: '#FFFFFF', stroke: '#000000', strokeWidth: 6 }, y: Math.round((doc.size?.[1] || 1920) * 0.65) });
  if (args.from || args.to) clip.lines = [...(clip.lines || []).filter((l) => l.at < from || l.at >= to), ...lines].sort((a, b) => a.at - b.at);
  else clip.lines = lines;
  saveDoc(p, doc);
  console.log(`${lines.length} caption lines (≤${max} words) -> ${tr.name}`);
}

// ---------- color match ----------
// Reinhard transfer in CIELAB: each clip's Lab mean and spread moved to the reference's (the shader applies it).
const lab = (r, g, b) => {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [r, g, b].map(lin);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : (903.3 * t + 16) / 116);
  const x = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047), y = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B), z = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
// Lab mean and spread over 8 frames of the part of the source a clip uses (near-black and near-white pixels skipped).
function stats(file, a, b) {
  const acc = [[0, 0], [0, 0], [0, 0]];
  let n = 0;
  for (let i = 0; i < 8; i++) {
    const t = a + ((b - a) * (i + 0.5)) / 8;
    const px = run('ffmpeg', ['-v', 'quiet', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=64:-2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { allowFail: true, binary: true }).stdout;
    for (let j = 0; px && j + 2 < px.length; j += 3) {
      const L = lab(px[j] / 255, px[j + 1] / 255, px[j + 2] / 255);
      if (L[0] < 5 || L[0] > 95) continue;
      for (let c = 0; c < 3; c++) { acc[c][0] += L[c]; acc[c][1] += L[c] * L[c]; }
      n++;
    }
  }
  return n ? acc.map(([s, s2]) => ({ m: s / n, sd: Math.sqrt(Math.max(1e-6, s2 / n - (s / n) ** 2)) })) : null;
}

function matchCmd(p) {
  const doc = readDoc(p, true), dir = dirname(p), tr = trackNamed(doc, args.track || 'Video');
  const vids = tr.clips.filter((c) => c.src && (c.type || 'video') === 'video');
  const st = vids.map((c) => {
    const a = c.in ?? 0, b = a + ((c.end ?? c.at + 2) - (c.at ?? 0)) * (c.rate ?? 1);
    return stats(resolve(dir, c.src), a, Math.max(a + 0.1, b));
  });
  const ok = st.filter(Boolean);
  if (!ok.length) die('could not read any clip');
  const med = (xs) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const ref = args.ref ? st[vids.findIndex((c) => c.src === args.ref)] || die(`--ref ${args.ref} is not a clip on ${tr.name}`)
    : [0, 1, 2].map((ch) => ({ m: med(ok.map((x) => x[ch].m)), sd: med(ok.map((x) => x[ch].sd)) }));
  const k = +(args.strength ?? 0.75); // part of the way: a full transfer can flatten deliberate looks
  vids.forEach((c, i) => {
    if (!st[i]) return;
    const r = st[i].map((s, ch) => Math.min(1.6, Math.max(0.6, ref[ch].sd / s.sd)));
    const g = r.map((x) => 1 + k * (x - 1)), o = st[i].map((s, ch) => k * (ref[ch].m - s.m * r[ch]));
    c.grade = { ...c.grade, match: [...g, ...o].map((x) => +x.toFixed(3)) };
  });
  saveDoc(p, doc);
  console.log(`matched ${vids.length} clips on ${tr.name} to ${args.ref || 'their median look'}`);
}

// ---------- movement ----------
// Frame-difference energy of each shown frame (timeline clock); peaks = actions.
function movesCmd(p) {
  const doc = readDoc(p), dir = dirname(p), tr = trackNamed(doc, args.track || 'Video'), fps = doc.fps || 30;
  const from = +(args.from || 0), to = args.to ? +args.to : Infinity;
  const energy = [];
  for (const c of tr.clips.filter((x) => x.src && x.end > from && x.at < to)) {
    const a = Math.max(c.at, from), b = Math.min(c.end, to), rate = c.rate ?? 1;
    const s0 = (c.in ?? 0) + (a - c.at) * rate, len = (b - a) * rate;
    const raw = run('ffmpeg', ['-v', 'quiet', '-ss', s0.toFixed(3), '-t', len.toFixed(3), '-i', resolve(dir, c.src), '-vf', `fps=${fps / rate},scale=48:84,format=gray`, '-f', 'rawvideo', '-'], { allowFail: true, binary: true }).stdout;
    const n = 48 * 84;
    for (let f = 1; raw && (f + 1) * n <= raw.length; f++) {
      let d = 0;
      for (let i = 0; i < n; i++) d += Math.abs(raw[f * n + i] - raw[(f - 1) * n + i]);
      energy.push({ t: a + f / fps, e: d / n, cut: f === 1 || b - (a + f / fps) < 0.15 });
    }
  }
  const es = energy.filter((x) => !x.cut).map((x) => x.e).sort((x, y) => x - y);
  const floor = es[Math.floor(es.length * 0.6)] || 0;
  const peaks = [];
  energy.forEach((x, i) => {
    const win = energy.slice(Math.max(0, i - 6), i + 7);
    if (x.cut || x.e <= floor * 1.5 || x.e > floor * 10 || x.e < Math.max(...win.map((w) => w.e))) return; // > 10× is a cut inside the clip
    if (peaks.length && x.t - peaks[peaks.length - 1].t < 0.6) { if (x.e > peaks[peaks.length - 1].e) peaks[peaks.length - 1] = x; return; }
    peaks.push(x);
  });
  console.log(JSON.stringify(peaks.map((x) => ({ t: round(x.t), strength: round(x.e / (floor || 1)) }))));
}

// ---------- ducking ----------
function duckCmd(p) {
  if (!args.words || !args.track) die('--track <name> and --words <transcript.json> are required');
  const doc = readDoc(p, true), tr = trackNamed(doc, args.track), dip = +(args.db ?? -10), base = typeof tr.volume === 'number' ? tr.volume : 0;
  const ws = readWords(resolve(args.words)).filter((w) => !args.speaker || w.speaker === args.speaker);
  const spans = [];
  for (const w of ws) { const s = spans[spans.length - 1]; if (s && w.start - s[1] < 0.6) s[1] = Math.max(s[1], w.end); else spans.push([w.start, w.end]); }
  const keys = [[0, base]];
  for (const [a, b] of spans) keys.push([round(Math.max(0, a - 0.25)), base], [round(a), base + dip], [round(b), base + dip], [round(b + 0.4), base]);
  tr.volume = keys.filter((k, i) => !i || k[0] > keys[i - 1][0]);
  saveDoc(p, doc);
  console.log(`${tr.name}: ${dip} dB under ${spans.length} spoken stretch(es)${args.speaker ? ` of ${args.speaker}` : ''}`);
}

// ---------- review comments ----------
// One file per comment in <ad>/comments/ (written by Studio): { id, t, to? (a stretch from t to to), box?: [x, y, w, h]
// (fractions), text, plan, status, reply?, history?: [{ text, reply }] (earlier rounds of a comment the user sent back) }

// What shows at time t (or over t–to) in a document: per track, the clips live then (index, what it is, its span).
function onScreen(doc, t, to = t) {
  const live = (a, b) => (to > t ? a < to && b > t : t >= a && t < b);
  const out = {};
  for (const tr of doc.tracks || []) {
    const sorted = [...(tr.clips || [])].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    sorted.forEach((c, i) => {
      const end = endOf(c) ?? Infinity;
      if (!live(c.at ?? 0, end)) return;
      const items = c.lines ? c.lines.filter((l) => live(l.at, l.end)).map((l) => [`caption line "${l.text}"`, l.at, l.end])
        : [[c.text != null ? `text "${c.text}"` : c.src || c.draw || c.type, c.at ?? 0, end]];
      for (const [what, a, b] of items) (out[tr.name] ||= []).push(`#${i} ${what} (${round(a)}–${Number.isFinite(b) ? `${round(b)}s` : 'end'})`);
    });
  }
  return out;
}

async function commentsCmd(dir) {
  const ad = resolve(dir || '.'), cdir = join(ad, 'comments');
  const read = () => (existsSync(cdir) ? readdirSync(cdir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(readFileSync(join(cdir, f), 'utf8')); } catch { return null; } }).filter(Boolean) : []);
  const save = (c) => writeFileSync(join(cdir, `${c.id}.json`), JSON.stringify(c, null, 1) + '\n');
  if (args.done) {
    const c = read().find((x) => x.id === args.done) || die(`no comment ${args.done}`);
    const span = args.span && String(args.span).split('-').map(Number);
    if (span && (span.length !== 2 || !span.every(Number.isFinite))) die('--span is <from>-<to> in seconds');
    save({ ...c, status: c.edit && !args.reply ? 'approved' : 'done', ...(args.reply && { reply: String(args.reply) }), ...(span && { span }) });
    return console.log(`done: ${c.id}`);
  }
  // Comments go only to the session editing the ad.
  const me = sessionId(), holder = markEditing(ad, me, !!args.take);
  // Still ours, or free again (a push releases it): take it back; another session's: stop.
  const taken = (by) => die(`session ${by} is editing this ad and gets its comments: tell the user; take them over (--take) only on their yes`);
  const mine = () => markEditing(ad, me) === me || taken(readEditing(ad)?.session);
  if (holder !== me) taken(holder);
  let open = read().filter((c) => c.status === 'open');
  if (!open.length && args.wait) {
    mkdirSync(cdir, { recursive: true });
    open = await new Promise((res) => {
      const w = watch(cdir, () => { const o = read().filter((c) => c.status === 'open'); if (o.length && mine()) { w.close(); setTimeout(() => res(read().filter((c) => c.status === 'open')), 300); } });
    });
  }
  open.sort((a, b) => a.t - b.t);
  for (const c of open) save({ ...c, status: 'seen' });
  // Each comment with what was on screen, and one sheet of their frames with the marked spots outlined.
  // A comment on a .md (file, quote) needs no frame.
  const onVideo = open.filter((c) => !c.file);
  const plans = [...new Set(onVideo.map((c) => c.plan || 'edit.json'))].filter((f) => existsSync(join(ad, f)));
  for (const plan of plans) {
    const doc = readDoc(join(ad, plan)), mine = onVideo.filter((c) => (c.plan || 'edit.json') === plan);
    for (const c of mine) c.showing = onScreen(doc, c.t, c.to);
    const sheet = join(tmpdir(), 'ad-production-kit-edit', `comments-${basename(ad).split('_')[0]}-${plan.replace('.json', '')}.png`);
    mkdirSync(dirname(sheet), { recursive: true });
    const shots = mine.flatMap((c) => (c.to > c.t ? [[c.t, c.box], [c.to, null]] : [[c.t, c.box]])); // a stretch: its first and last frame
    await runPage(join(ad, plan), { mode: 'frames', at: shots.map(([x]) => x).join(','), boxes: JSON.stringify(shots.map(([, b]) => b || null)), scale: 0.4 }, sheet);
    for (const c of mine) c.sheet = sheet;
  }
  console.log(JSON.stringify(open, null, 1));
}

// ---------- track ----------
// The object in --box (frame px at --at) found in every frame of the clip, by normalized template matching
// in a window around where it was the frame before; half resolution, sub-pixel peak, 3-frame smoothing.
function findPath(dir, c, doc, at, [bx, by, bw, bh], radius) {
  const [W, H] = (doc.size || [1080, 1920]).map((v) => Math.round(v / 2)), fps = doc.fps || 30, rate = c.rate ?? 1, c0 = c.at ?? 0;
  const raw = run('ffmpeg', ['-v', 'quiet', '-ss', String(c.in ?? 0), '-t', ((endOf(c) - c0) * rate).toFixed(3), '-i', resolve(dir, c.src), '-vf',
    `fps=${fps / rate},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { binary: true }).stdout;
  const n = Math.floor(raw.length / (W * H)), px = (f, x, y) => raw[f * W * H + y * W + x];
  const k0 = Math.min(n - 1, Math.max(0, Math.round((at - c0) * fps)));
  const tw = Math.round(bw / 2), th = Math.round(bh / 2), R = Math.round(radius / 2);
  const tx0 = Math.round(bx / 2), ty0 = Math.round(by / 2);
  const T = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) T[y * tw + x] = px(k0, tx0 + x, ty0 + y);
  const tm = T.reduce((a, b) => a + b, 0) / T.length;
  let tv = 0; for (let i = 0; i < T.length; i++) { T[i] -= tm; tv += T[i] * T[i]; }
  const score = (f, x0, y0) => {
    let s = 0, s2 = 0, st = 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const v = px(f, x0 + x, y0 + y); s += v; s2 += v * v; st += v * T[y * tw + x]; }
    const v = s2 - (s * s) / T.length;
    return v > 1e-6 ? st / Math.sqrt(v * tv) : 0;
  };
  const pos = [], lost = [];
  pos[k0] = [tx0, ty0];
  for (const dirn of [1, -1]) {
    for (let f = k0 + dirn; f >= 0 && f < n; f += dirn) {
      const [px0, py0] = pos[f - dirn], sc = {};
      let best = -2, bxy = [px0, py0];
      for (let y = Math.max(0, Math.round(py0) - R); y <= Math.min(H - th, Math.round(py0) + R); y++)
        for (let x = Math.max(0, Math.round(px0) - R); x <= Math.min(W - tw, Math.round(px0) + R); x++) {
          const s = (sc[`${x},${y}`] = score(f, x, y));
          if (s > best) { best = s; bxy = [x, y]; }
        }
      if (best < 0.4) { pos[f] = [px0, py0]; lost.push(f); continue; }
      const sub = (a, b, m) => { const d = a - 2 * m + b; return a == null || b == null || d >= 0 ? 0 : (a - b) / (2 * d); };
      const [x, y] = bxy, m = sc[`${x},${y}`];
      pos[f] = [x + sub(sc[`${x - 1},${y}`], sc[`${x + 1},${y}`], m), y + sub(sc[`${x},${y - 1}`], sc[`${x},${y + 1}`], m)];
    }
  }
  const smooth = pos.map((_, f) => {
    const w = [pos[f - 1], pos[f], pos[f + 1]].filter(Boolean);
    return [0, 1].map((i) => w.reduce((a, q) => a + q[i], 0) / w.length);
  });
  if (lost.length) console.error(`WARN: lost the object in ${lost.length} of ${n} frames (held in place) — check it on a frames sheet`);
  // Object center in frame px, per timeline frame.
  return smooth.map(([x, y], f) => ({ t: round(c0 + f / fps), x: x * 2 + bw / 2, y: y * 2 + bh / 2 }));
}

function trackCmd(p) {
  if (!args.clip || args.at == null || !args.box) die('--clip <name> --at s --box x,y,w,h are required');
  const doc = readDoc(p, true), dir = dirname(p), [W, H] = doc.size || [1080, 1920], C = [W / 2, H / 2];
  const all = (doc.tracks || []).flatMap((tr) => tr.clips || []), named = (nm) => all.find((x) => x.name === nm) || die(`no clip named "${nm}"`);
  const c = named(args.clip);
  if (!c.src || endOf(c) == null) die(`"${c.name}" needs a src and an end (or dur)`);
  const at = +args.at, path = findPath(dir, c, doc, at, args.box.split(',').map(Number), +(args.radius || 80));
  // Where the object lands on screen: zoomed (scale S over --ramp from --from, sliding to --to) or under the clip's own transform.
  let screen;
  if (args.zoom) {
    const S = +args.zoom, from = args.from != null ? +args.from : (c.at ?? 0), ramp = +(args.ramp || 0.25);
    const [TX, TY] = args.to ? args.to.split(',').map(Number) : C;
    const sAt = (t) => 1 + (S - 1) * (1 - (1 - Math.min(1, Math.max(0, (t - from) / ramp))) ** 3);
    screen = path.map(({ t, x, y }) => { const s = sAt(t), q = (s - 1) / (S - 1 || 1); return { t, s, x: x + (TX - x) * q, y: y + (TY - y) * q, ox: x, oy: y }; });
    // engine: screen = origin + s·(box − origin + object − center), origin = center → box = 2·center − object + (screen − center)/s
    Object.assign(c, { origin: C, ...Object.fromEntries(['x', 'y', 'scale'].map((k) => [k, screen.map((q) => [q.t,
      k === 'scale' ? round(q.s) : round(k === 'x' ? 2 * C[0] - q.ox + (q.x - C[0]) / q.s : 2 * C[1] - q.oy + (q.y - C[1]) / q.s, 1), 'linear'])])) });
  } else {
    screen = path.map(({ t, x, y }) => {
      const s = val(c.scale, t, 1), bx = val(c.x, t, C[0]), by = val(c.y, t, C[1]), [ox, oy] = c.origin || [bx, by];
      return { t, s, x: ox + s * (bx - ox + x - C[0]), y: oy + s * (by - oy + y - C[1]) };
    });
  }
  // Followers keep their offset from the object at --at, scaling with the zoom.
  const ref = screen.reduce((a, q) => (Math.abs(q.t - at) < Math.abs(a.t - at) ? q : a));
  for (const nm of args.follow ? args.follow.split(',') : []) {
    const f = named(nm), dx = val(f.x, at, C[0]) - ref.x, dy = val(f.y, at, C[1]) - ref.y, s0 = typeof f.scale === 'number' ? f.scale : 1;
    f.x = screen.map((q) => [q.t, round(q.x + (dx * q.s) / ref.s, 1), 'linear']);
    f.y = screen.map((q) => [q.t, round(q.y + (dy * q.s) / ref.s, 1), 'linear']);
    if (args.zoom) f.scale = screen.map((q) => [q.t, round((s0 * q.s) / ref.s), 'linear']);
  }
  saveDoc(p, doc);
  console.log(`tracked ${path.length} frames of "${c.name}"${args.zoom ? `, zoomed to ${args.zoom}×` : ''}${args.follow ? `; following: ${args.follow}` : ''}`);
}

const p = target && resolve(target);
const cmds = { check, place: placeCmd, track: trackCmd, cut: cutCmd, tighten: tightenCmd, reframe: reframeCmd, export: exportCmd, audio: audioCmd, frames: framesCmd, captions: captionsCmd, match: matchCmd, moves: movesCmd, duck: duckCmd, comments: commentsCmd };
if (!cmds[cmd]) usage(HELP);
// Library originals left in the cloud (a light pull) download before anything reads them.
if (cmd !== 'comments' && existsSync(p || '')) await fetchMissing((readDoc(p).tracks || []).flatMap((tr) => (tr.clips || []).map((c) => c.src && resolve(dirname(p), c.src))));
Promise.resolve(cmds[cmd](cmd === 'comments' ? target : p)).catch((e) => die(e?.stack || String(e)));
