// Studio's manual edits to a raw edit document, each in place. ref: a clip [track, clip] or a caption line
// [track, clip, line] (indices in the file). Times are on the document's clock; every clip has its end written in.
import { clipType, cutDoc, endOf, isBed, mapTimes, r3 } from './doc.js';

export const MIN = 0.1; // the shortest a clip or line gets (s)
const same = (a, b) => Math.abs(a - b) < 1e-3;
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
const clipOf = (doc, ref) => doc.tracks[ref[0]].clips[ref[1]];
const named = (x, i) => x.name || `Track ${i + 1}`;
export const get = (doc, ref) => (ref.length === 3 ? clipOf(doc, ref).lines[ref[2]] : clipOf(doc, ref));
const timed = (c) => ['video', 'audio'].includes(clipType(c)) && !c.loop; // plays a stretch of its source
// The clip with its link: a media clip of the same name starting with it on another track (a take's picture and voice).
function group(doc, ref) {
  const c = clipOf(doc, ref), at = c.at ?? 0;
  return !c.src || !c.name ? [c] : [c, ...doc.tracks.flatMap((tr, i) => (i === ref[0] ? [] : (tr.clips || []).filter((x) => x.src && x.name === c.name && same(x.at ?? 0, at))))];
}
const shift = (clips, d) => mapTimes({ tracks: [{ clips }] }, (t) => r3(t + d));
// A video or sound with another clip on its track starting where it ends: a sequence, whose clips stay touching when
// its speed or source changes. (Text and graphics over it just stop at their neighbours.)
const followed = (doc, ref, c) => timed(c) && doc.tracks[ref[0]].clips.some((x) => x !== c && same(x.at ?? 0, endOf(c)));

// The shift nearest d that leaves each clip in g clear of the others on its track, and none before 0: a track plays
// one clip at a time.
function clear(doc, g, d) {
  const pairs = doc.tracks.flatMap((tr) => { const mine = (tr.clips || []).filter((c) => g.includes(c)); return mine.flatMap((m) => (tr.clips || []).filter((x) => !g.includes(x) && !x.lines).map((x) => [m, x])); });
  const min = -Math.min(...g.map((c) => c.at ?? 0));
  const ok = (by) => by >= min - 1e-6 && pairs.every(([m, x]) => endOf(m) + by <= (x.at ?? 0) + 1e-3 || (m.at ?? 0) + by >= endOf(x) - 1e-3);
  return [d, min, ...pairs.flatMap(([m, x]) => [(x.at ?? 0) - endOf(m), endOf(x) - (m.at ?? 0)])].filter(ok).sort((a, b) => Math.abs(a - d) - Math.abs(b - d))[0];
}
// Where the next clip on its track starts, and the one before it ends.
const nextAt = (doc, ref, c) => Math.min(Infinity, ...doc.tracks[ref[0]].clips.filter((x) => x !== c && !x.lines && (x.at ?? 0) >= endOf(c) - 1e-3).map((x) => x.at ?? 0));
const prevEnd = (doc, ref, c) => Math.max(0, ...doc.tracks[ref[0]].clips.filter((x) => x !== c && !x.lines && endOf(x) <= (c.at ?? 0) + 1e-3).map(endOf));
const nextOf = (doc, ref) => { const c = clipOf(doc, ref); return doc.tracks[ref[0]].clips.find((x) => x !== c && !x.lines && same(x.at ?? 0, endOf(c))); };

// How far (s) a move, or a start or end edge, can go: a clip keeps MIN, stays clear of the other clips on its track
// (loose: it is leaving for another track) and, trimmed, inside its source (len s, when known); stretched (an edge
// changing its speed, `stretch`), between 0.25× and 4×. A roll moves the cut to the clip starting where it ends: both
// keep MIN and stay inside their sources. A caption line stays between its neighbours.
export const RATES = [0.25, 4];
export function limit(doc, ref, mode, d, len, loose, stretch) {
  if (ref.length === 3) {
    const { lines } = clipOf(doc, ref), l = lines[ref[2]], lo = (lines[ref[2] - 1]?.end ?? 0) - l.at, hi = (lines[ref[2] + 1]?.at ?? Infinity) - l.end;
    return mode === 'start' ? clamp(d, lo, l.end - l.at - MIN) : mode === 'end' ? clamp(d, MIN - (l.end - l.at), hi) : clamp(d, lo, hi);
  }
  const c = clipOf(doc, ref), at = c.at ?? 0, dur = endOf(c) - at, rate = c.rate ?? 1;
  if (mode === 'roll') { // the cut between it and the clip starting where it ends
    const n = nextOf(doc, ref), nDur = endOf(n) - (n.at ?? 0), nRate = n.rate ?? 1;
    return clamp(d, Math.max(MIN - dur, timed(n) ? -(n.in ?? 0) / nRate : -Infinity), Math.min(nDur - MIN, timed(c) && len ? (len - (c.in ?? 0)) / rate - dur : Infinity));
  }
  if (mode === 'move') return loose ? Math.max(d, -Math.min(...group(doc, ref).map((x) => x.at ?? 0))) : clear(doc, group(doc, ref), d);
  const sp = stretch && timed(c), grow = sp ? [(dur * rate) / RATES[1] - dur, (dur * rate) / RATES[0] - dur] : [-Infinity, Infinity]; // how much longer it may get
  if (mode === 'end') return clamp(d, Math.max(MIN - dur, grow[0]), Math.min(!sp && timed(c) && len ? (len - (c.in ?? 0)) / rate - dur : Infinity, nextAt(doc, ref, c) - endOf(c), grow[1]));
  return clamp(d, Math.max(!sp && timed(c) ? -(c.in ?? 0) / rate : -Infinity, prevEnd(doc, ref, c) - at, -grow[1]), Math.min(dur - MIN, -grow[0]));
}

// A clip's (and its link's) new source start, start and end; in a sequence (followed) with `ripple`, everything after
// its old end moves with the new one.
function respan(doc, ref, { in: inS, at, end }, ripple = followed(doc, ref, clipOf(doc, ref))) {
  const c = clipOf(doc, ref), g = group(doc, ref), oldEnd = endOf(c);
  if (!ripple) end = Math.min(end, nextAt(doc, ref, c)); // never over the next clip
  const delta = r3(end - oldEnd);
  for (const x of g) { if (inS != null) x.in = r3(inS); if (at != null) x.at = r3(at); x.end = r3(end); delete x.dur; }
  if (ripple && delta) mapTimes(doc, (t) => (t >= oldEnd - 1e-3 ? r3(t + delta) : delta < 0 && t > end ? r3(end) : t), new Set(g));
}

// Move a clip or line (mode 'move'), its 'start' or 'end' edge, or the cut after it ('roll': its end and the next clip's
// start move together, each playing more or less of its source), by d seconds. An edge trims the clip, leaving any
// gap open; with `stretch`, a media clip keeps the same stretch of its source and its speed changes to fit.
export function retime(doc, ref, mode, d, len, loose, stretch) {
  d = limit(doc, ref, mode, d, len, loose, stretch);
  const x = get(doc, ref);
  if (ref.length === 3) {
    if (mode !== 'end') x.at = r3(x.at + d);
    if (mode !== 'start') x.end = r3(x.end + d);
    if (mode === 'move' && x.words) x.words = x.words.map(([w, s, e, ...rest]) => [w, s == null ? s : r3(s + d), e == null ? e : r3(e + d), ...rest]);
    return;
  }
  if (mode === 'move') return shift(group(doc, ref), d);
  const at = x.at ?? 0, end = endOf(x), dur = end - at;
  if (mode === 'roll') { // the next clip first, so this one's end never runs over it
    const n = nextOf(doc, ref), nRef = [ref[0], doc.tracks[ref[0]].clips.indexOf(n)];
    for (const y of group(doc, nRef)) { if (timed(y)) y.in = r3((y.in ?? 0) + d * (y.rate ?? 1)); y.at = r3((y.at ?? 0) + d); }
    return respan(doc, ref, { end: end + d }, false);
  }
  if (stretch && timed(x)) {
    const rate = Math.round((((x.rate ?? 1) * dur) / (dur + (mode === 'end' ? d : -d))) * 1000) / 1000;
    for (const y of group(doc, ref)) y.rate = rate;
    return respan(doc, ref, mode === 'end' ? { end: end + d } : { at: at + d, end }, false);
  }
  if (mode === 'end') return respan(doc, ref, { end: end + d }, false);
  respan(doc, ref, { in: timed(x) ? (x.in ?? 0) + d * (x.rate ?? 1) : null, at: at + d, end }, false);
}

// The speed a stretch of d on that edge would give the clip (for the timeline to show while dragging).
export const stretchRate = (doc, ref, mode, d) => { const c = clipOf(doc, ref), dur = endOf(c) - (c.at ?? 0); return ((c.rate ?? 1) * dur) / (dur + (mode === 'end' ? d : -d)); };

// The part of its source a media clip plays (the trim panel): from inS, for dur seconds of timeline.
export const source = (doc, ref, inS, dur) => respan(doc, ref, { in: inS, end: (clipOf(doc, ref).at ?? 0) + dur });

// A media clip's speed: it plays the same stretch of its source, so its length changes.
export function speed(doc, ref, rate) {
  const c = clipOf(doc, ref), at = c.at ?? 0, dur = ((endOf(c) - at) * (c.rate ?? 1)) / rate;
  for (const x of group(doc, ref)) x.rate = rate;
  respan(doc, ref, { end: at + dur });
}

// Split the clips under t in two (ref: only that clip and its link; else all but a sound bed). The second part plays
// on from t; captions and custom layers stay whole. → whether any split.
export function split(doc, t, ref) {
  const only = ref && new Set(group(doc, ref));
  let any = false;
  for (const tr of doc.tracks) tr.clips = (tr.clips || []).flatMap((c) => {
    const at = c.at ?? 0, end = endOf(c);
    if (c.lines || clipType(c) === 'custom' || (only ? !only.has(c) : isBed(c)) || t - at < MIN / 2 || end - t < MIN / 2) return [c];
    any = true;
    const { enter, transition, reveal, fadeIn, dur, ...rest } = structuredClone(c);
    const { exit, fadeOut, dur: _d, ...head } = c;
    return [{ ...head, end: r3(t) }, { ...rest, at: r3(t), end, ...(timed(c) && { in: r3((c.in ?? 0) + (t - at) * (c.rate ?? 1)) }) }];
  });
  return any;
}

// Delete a clip (with its link) or a caption line.
export function remove(doc, ref) {
  if (ref.length === 3) return void clipOf(doc, ref).lines.splice(ref[2], 1);
  const g = new Set(group(doc, ref));
  for (const tr of doc.tracks) tr.clips = (tr.clips || []).filter((c) => !g.has(c));
}

// The empty stretch around time t on track ti, to close with cutDoc: from the block before it (or 0) to the next one,
// and only where no video or sound plays on another track (a sound bed aside). null on a block, past the last one, or
// under a frame long.
export function gapAt(doc, ti, t) {
  const spans = (doc.tracks[ti]?.clips || []).flatMap((c) => c.lines || [c]).map((b) => [b.at ?? 0, b.end ?? endOf(b) ?? Infinity]);
  doc.tracks.forEach((tr, i) => { if (i !== ti) for (const c of tr.clips || []) if (timed(c) && !isBed(c)) spans.push([c.at ?? 0, endOf(c) ?? Infinity]); });
  if (spans.some(([a, e]) => t >= a - 1e-3 && t < e - 1e-3)) return null;
  const a = Math.max(0, ...spans.map(([, e]) => e).filter((e) => e <= t + 1e-3)), next = spans.map(([s]) => s).filter((s) => s > t);
  if (!next.length || Math.min(...next) - a < 1 / (doc.fps || 30)) return null;
  return [r3(a), r3(Math.min(...next))];
}

// Delete a clip or caption line and its time from every track: what follows moves up.
export function rippleRemove(doc, ref) {
  const x = get(doc, ref);
  cutDoc(doc, x.at ?? 0, ref.length === 3 ? x.end : endOf(x));
}

// A copy of a clip (and its link) right after it. → the copy's ref.
export function duplicate(doc, ref) {
  const g = new Set(group(doc, ref)), c = clipOf(doc, ref), d = endOf(c) - (c.at ?? 0), copies = [];
  for (const tr of doc.tracks) tr.clips = (tr.clips || []).flatMap((x) => {
    if (!g.has(x)) return [x];
    const { transition, ...copy } = structuredClone(x);
    shift([copy], d);
    copies.push(copy);
    return [x, copy];
  });
  shift(copies, clear(doc, copies, 0)); // into the nearest free stretch
  return [ref[0], ref[1] + 1];
}

// Move a clip to the track named `name` (made when the document lacks it; '' makes a new top track, named after the
// clip's type), into the free stretch nearest its time there. → its new ref.
export function toTrack(doc, ref, name) {
  const [c] = doc.tracks[ref[0]].clips.splice(ref[1], 1), type = clipType(c);
  delete c.transition;
  let ti = name ? doc.tracks.findIndex((x, i) => named(x, i) === name) : -1;
  if (ti < 0) {
    const base = type[0].toUpperCase() + type.slice(1), taken = new Set(doc.tracks.map((x) => x.name));
    let n = 1;
    while (!name && taken.has(n > 1 ? `${base} ${n}` : base)) n++;
    doc.tracks[name ? 'push' : 'unshift']({ name: name || (n > 1 ? `${base} ${n}` : base), clips: [] });
    ti = name ? doc.tracks.length - 1 : 0;
  }
  const clips = doc.tracks[ti].clips ||= [];
  clips.push(c);
  shift([c], clear(doc, [c], 0));
  return [ti, clips.length - 1];
}

// Move the track named `name` to just above the one named `before` (null: to the bottom). → whether it moved.
// Dropped between two tracks of one group, a track joins it; dropped away from its own group, it leaves it.
export function orderTrack(doc, name, before) {
  const from = (doc.tracks || []).findIndex((x, i) => named(x, i) === name);
  const target = before == null ? null : doc.tracks.find((x, i) => named(x, i) === before);
  if (from < 0 || (before != null && !target) || target === doc.tracks[from]) return false;
  const [tr] = doc.tracks.splice(from, 1), to = target ? doc.tracks.indexOf(target) : doc.tracks.length;
  doc.tracks.splice(to, 0, tr);
  const g = tr.group, prev = doc.tracks[to - 1]?.group, next = doc.tracks[to + 1]?.group;
  if (prev && prev === next) tr.group = prev;
  else if (g && prev !== g && next !== g) delete tr.group;
  return to !== from || tr.group !== g;
}

// Groups: a track's `group` names the group it is in (a folder of tracks, as in design apps' layers); a group's tracks
// sit together, the first drawing on top. → whether the document changed.
// The named tracks go in one group (the first one's group among them, else a new "Group N"), together where the
// topmost of them was.
export function groupTracks(doc, names) {
  const tracks = doc.tracks || [], picked = tracks.filter((x, i) => names.includes(named(x, i)));
  if (!picked.length) return false;
  const taken = new Set(tracks.map((x) => x.group));
  let n = 1;
  while (taken.has(`Group ${n}`)) n++;
  const g = picked.find((x) => x.group)?.group || `Group ${n}`, members = tracks.filter((x) => picked.includes(x) || x.group === g);
  const at = tracks.slice(0, tracks.indexOf(members[0])).filter((x) => !members.includes(x)).length;
  for (const m of members) m.group = g;
  doc.tracks = tracks.filter((x) => !members.includes(x));
  doc.tracks.splice(at, 0, ...members);
  return true;
}
// The named tracks leave their groups: a whole group dissolves where it is; part of one moves out just above it.
export function ungroupTracks(doc, names) {
  const out = (doc.tracks || []).filter((x, i) => x.group && names.includes(named(x, i)));
  for (const g of new Set(out.map((x) => x.group))) {
    const members = doc.tracks.filter((x) => x.group === g), leaving = members.filter((x) => out.includes(x));
    for (const x of leaving) delete x.group;
    if (leaving.length === members.length) continue;
    doc.tracks = doc.tracks.filter((x) => !leaving.includes(x));
    doc.tracks.splice(doc.tracks.indexOf(members.find((x) => !leaving.includes(x))), 0, ...leaving);
  }
  return out.length > 0;
}
export function renameGroup(doc, group, to) {
  const tracks = doc.tracks || [];
  if (!to || to === group || tracks.some((x) => x.group === to) || !tracks.some((x) => x.group === group)) return false;
  for (const x of tracks) if (x.group === group) x.group = to;
  return true;
}
// A whole group dragged above the track `before` (null: the bottom); never into another group.
export function orderGroup(doc, group, before) {
  const tracks = doc.tracks || [], members = tracks.filter((x) => x.group === group);
  let target = before == null ? null : tracks.find((x, i) => named(x, i) === before);
  if (!members.length || members.includes(target)) return false;
  if (target?.group) target = tracks.find((x) => x.group === target.group); // into another group: above it instead
  const rest = tracks.filter((x) => !members.includes(x));
  rest.splice(target ? rest.indexOf(target) : rest.length, 0, ...members);
  const moved = rest.some((x, i) => x !== tracks[i]);
  doc.tracks = rest;
  return moved;
}

// Rename the track named `name` (not to a name another track has). → whether it was renamed.
export function renameTrack(doc, name, to) {
  const tr = (doc.tracks || []).find((x, i) => named(x, i) === name);
  if (!tr || !to || doc.tracks.some((x, i) => named(x, i) === to)) return false;
  tr.name = to;
  return true;
}

// Delete the track named `name`, with its clips. → whether the document had it.
export function removeTrack(doc, name) {
  const i = (doc.tracks || []).findIndex((x, k) => named(x, k) === name);
  if (i >= 0) doc.tracks.splice(i, 1);
  return i >= 0;
}

// A text's look: what a style template sets. Its size, width, line height and anchor stay the clip's own.
export const LOOK = ['font', 'weight', 'italic', 'color', 'accent', 'case', 'letterSpacing', 'stroke', 'strokeWidth', 'background', 'shadow'];
// A picture's or shape's look: its corners, frame and shadow.
export const CLIP_LOOK = ['radius', 'border', 'shadow'];
export const lookKind = (c) => (['text', 'captions'].includes(clipType(c)) ? 'text' : ['image', 'video', 'rect'].includes(clipType(c)) ? 'clip' : null);
// Give a clip a look of its kind (a template's, or another clip's), in place of its own; a clip of another kind keeps its own.
export function restyle(doc, ref, look, kind = 'text') {
  const c = clipOf(doc, ref);
  if (lookKind(c) !== kind) return;
  if (kind === 'clip') {
    for (const k of CLIP_LOOK) if (look[k] == null) delete c[k]; else c[k] = structuredClone(look[k]);
    return;
  }
  c.style = { ...Object.fromEntries(Object.entries(c.style || {}).filter(([k]) => !LOOK.includes(k))), ...structuredClone(look) };
}

// Set a property of a clip or line (path: 'volume', 'style.size'); null clears it.
export function set(doc, ref, path, value) {
  const keys = path.split('.'), last = keys.pop();
  let o = get(doc, ref);
  for (const k of keys) o = o[k] ??= {};
  if (value == null) delete o[last]; else o[last] = value;
}

// A caption line's new text: its word times stay when the word count does (a typo fixed), else they spread over the
// same stretch by word length.
export function lineText(doc, ref, text) {
  const l = get(doc, ref), ws = text.trim().split(/\s+/).filter(Boolean), old = (l.words || []).filter((w) => w[1] != null);
  l.text = ws.join(' ');
  if (!old.length) return void delete l.words;
  if (ws.length === l.words.length) return void (l.words = l.words.map(([, ...rest], i) => [ws[i], ...rest]));
  const from = old[0][1], span = old.at(-1)[2] - from, total = ws.reduce((n, w) => n + w.length, 0);
  let t = from;
  l.words = ws.map((w) => [w, r3(t), r3(t += (span * w.length) / total)]);
}

// A text clip at t (3 s, inside the edit, which ends at `until`), styled and placed like the text nearest in time, on
// that text's track when it is free then (else a new top track). → its ref.
export function addText(doc, t, until) {
  t = Math.max(0, Math.min(t, until - 3));
  const texts = (doc.tracks ||= []).flatMap((tr, ti) => (tr.clips || []).filter((c) => clipType(c) === 'text').map((c) => ({ c, ti })));
  const near = texts.sort((a, b) => Math.abs((a.c.at ?? 0) - t) - Math.abs((b.c.at ?? 0) - t))[0];
  if (!near) doc.tracks.unshift({ name: 'Text', clips: [] });
  const like = near ? structuredClone(Object.fromEntries(['style', 'x', 'y', 'enter', 'exit'].filter((k) => near.c[k] != null && !Array.isArray(near.c[k])).map((k) => [k, near.c[k]]))) : {};
  const ti = near?.ti ?? 0, clips = doc.tracks[ti].clips ||= [];
  clips.push({ type: 'text', text: 'Text', at: r3(t), end: r3(Math.min(t + 3, until)), ...like });
  const ref = [ti, clips.length - 1];
  return clear(doc, [clips.at(-1)], 0) ? toTrack(doc, ref, '') : ref;
}

// Mute or unmute a track by name; unmuting also unmutes its clips, all but freeze frames (rate under 0.1). → whether
// the document has that track.
export function muteTrack(doc, name, mute) {
  const tr = (doc.tracks || []).find((x, i) => named(x, i) === name);
  if (!tr) return false;
  if (mute) tr.mute = true;
  else { delete tr.mute; for (const c of tr.clips || []) if (c.mute && !((c.rate ?? 1) < 0.1)) delete c.mute; }
  return true;
}
