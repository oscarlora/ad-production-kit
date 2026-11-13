// The edit document (an ad's edit.json): defaults, timing and keyframes. Schema: tools/edit-video.mjs --help.

// Easing curves, x in 0..1.
const back = (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
function bounceOut(x) {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}
const EASE = {
  linear: (x) => x,
  in: (x) => x * x * x,
  out: (x) => 1 - (1 - x) ** 3,
  ease: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  back,
  bounce: bounceOut,
  elastic: (x) => (x === 0 || x === 1 ? x : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI / 3)) + 1),
  hold: (x) => (x < 1 ? 0 : 1),
};
export const ease = (name, x) => (EASE[name] || EASE.ease)(Math.min(1, Math.max(0, x)));

// A number, or keyframes [[t, value, easing?], …] on the timeline clock; the easing shapes the move to the next key.
export function val(v, t, dflt) {
  if (v == null) return dflt;
  if (!Array.isArray(v) || !Array.isArray(v[0])) return v;
  if (t <= v[0][0]) return v[0][1];
  for (let i = 0; i < v.length - 1; i++) {
    const [t0, a, e] = v[i], [t1, b] = v[i + 1];
    if (t < t1) return typeof a === 'number' ? a + (b - a) * ease(e, (t - t0) / (t1 - t0)) : a;
  }
  return v[v.length - 1][1];
}
export const keyed = (v) => Array.isArray(v) && Array.isArray(v[0]);

const VISUAL = new Set(['video', 'image', 'text', 'captions', 'rect', 'hide', 'custom']);
export const isVisual = (c) => VISUAL.has(c.type);
export const hasSound = (c) => c.type === 'audio' || (c.type === 'video' && !c.mute);
// A raw clip's type: its own, else from its file, lines or text.
export const clipType = (c) => c.type || (c.src && /\.(mp3|wav|m4a|aac|ogg|opus|flac)$/i.test(c.src) ? 'audio' : c.src && /\.(png|jpe?g|webp|gif|avif)$/i.test(c.src) ? 'image' : c.src ? 'video' : c.lines ? 'captions' : 'text');

// Defaults filled in, clips sorted, each clip linked to its track and neighbours. Times are seconds.
export function normalize(raw) {
  const [W, H] = raw.size || [1080, 1920];
  const fps = raw.fps || 30;
  let end = 0;
  const tracks = (raw.tracks || []).map((tr, ti) => {
    const clips = (tr.clips || []).map((c, ci) => {
      const type = clipType(c);
      const at = c.at ?? 0;
      let stop = c.end ?? (c.dur != null ? at + c.dur : null);
      if (type === 'captions' && stop == null) stop = Math.max(at, ...(c.lines || []).map((l) => l.end ?? 0));
      return { ...c, type, at, end: stop, rate: c.rate ?? 1, in: c.in ?? 0, id: c.id || `${ti}.${ci}` };
    }).sort((a, b) => a.at - b.at);
    return { ...tr, name: tr.name || `Track ${ti + 1}`, clips };
  });
  for (const tr of tracks) {
    tr.clips.forEach((c, i) => {
      c.track = tr;
      c.prev = tr.clips[i - 1] || null;
      c.next = tr.clips[i + 1] || null;
      if (c.end != null) end = Math.max(end, c.end);
    });
  }
  return { ...raw, W, H, fps, background: raw.background || '#000000', tracks, duration: raw.duration ?? end, raw };
}

// Media end for clips without one (set once the source duration is known).
export function settle(doc, durations) {
  let end = 0;
  for (const tr of doc.tracks) for (const c of tr.clips) {
    if (c.end == null) { const d = durations.get(c.src); c.end = d ? c.at + (d - c.in) / c.rate : c.at + 5; }
    end = Math.max(end, c.end);
  }
  if (doc.raw.duration == null) doc.duration = end;
  return doc;
}

// A transition belongs to the incoming clip and is centered on its cut; both clips play through it.
export const tin = (c) => (c.transition && c.prev && c.transition.type !== 'cut' ? c.transition.dur ?? 0.4 : 0);
const tout = (c) => (c.next ? tin(c.next) : 0);
export const live = (c, t) => t >= c.at - tin(c) / 2 && t < c.end + tout(c) / 2;

// Source time of a media clip at timeline time t.
export const srcTime = (c, t) => c.in + (t - c.at) * c.rate;

export const r3 = (x) => Math.round(x * 1000) / 1000;
export const endOf = (c) => c.end ?? (c.dur != null ? (c.at ?? 0) + c.dur : null);

// Every keyframed value in o and its nested objects (not in clips, caption lines or transitions): fn(holder, key, keys, path).
export function eachKeyed(o, fn, path = []) {
  for (const [k, v] of Object.entries(o || {})) {
    if (keyed(v)) fn(o, k, v, path);
    else if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'transition') eachKeyed(v, fn, [...path, k]);
  }
}

// Every timeline time in a raw document (clip spans, caption lines and words, keyframes) through f; clips in skip stay.
export function mapTimes(doc, f, skip = new Set()) {
  const keys = (o) => eachKeyed(o, (h, k, v) => { h[k] = v.map(([t, ...rest]) => [f(t), ...rest]); });
  for (const tr of doc.tracks || []) {
    keys(tr);
    for (const c of tr.clips || []) {
      if (skip.has(c)) continue;
      const e = endOf(c);
      c.at = f(c.at ?? 0);
      if (e != null) { c.end = f(e); delete c.dur; }
      keys(c);
      if (c.lines) c.lines = c.lines.map((l) => ({ ...l, at: f(l.at), end: f(l.end), ...(l.words && { words: l.words.map(([w, s, e2, ...x]) => [w, f(s), f(e2), ...x]) }) }));
    }
  }
}

// A version that only changes the hook: { base: "edit.json", from: "Body1", tracks: [its hook's clips, on tracks named
// like the base's] } plays its own clips, then the base from where the base's first clip named `from` starts, so body
// edits happen once, in the base. Track keyframes: its own before the body, the base's after. Its other fields
// override the base's; the base's output is dropped. Each clip carries ORIGIN: [own?, track, clip] (indices in the file it comes from).
export const ORIGIN = Symbol('origin');
const BED = Symbol('bed');
// A sound bed: audio that opens the edit and runs on (music from 0, not an opening whoosh), kept whole when the
// edit is rearranged.
export const isBed = (c) => !c.lines && (c.at ?? 0) <= 1e-3 && (endOf(c) ?? Infinity) > 5 &&
  (c.type === 'audio' || /\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(c.src || ''));
// Where a version joins its base: [the base time its body starts at, the version's own length before it].
export function joint(raw, base) {
  const starts = (base.tracks || []).flatMap((tr) => (tr.clips || []).filter((c) => c.name === raw.from).map((c) => c.at ?? 0));
  if (!starts.length) throw new Error(`${raw.base} has no clip named "${raw.from}" (the version's "from")`);
  return [Math.min(...starts), Math.max(0, ...(raw.tracks || []).flatMap((tr) => (tr.clips || []).map((c) => endOf(c) ?? 0)))];
}
export function compose(raw, base) {
  if (base.base) throw new Error(`${raw.base} has a base itself`);
  const doc = structuredClone(base), own = structuredClone(raw.tracks || []);
  const [start, head] = joint(raw, base);
  // A sound bed that opens the base opens the version too, from its own start, under the new hook.
  // The base before `from` goes: keyframes hold the value they had there, clips crossing it start there.
  const cutKeys = (h, k, v) => {
    const i = v.findLastIndex(([t]) => t <= start);
    if (i >= 0) h[k] = [[start, val(v, start), v[i][2]], ...v.slice(i + 1)];
  };
  (doc.tracks ||= []).forEach((tr, ti) => {
    eachKeyed(tr, cutKeys);
    tr.clips = (tr.clips || []).flatMap((c, ci) => {
      c[ORIGIN] = [false, ti, ci];
      const e = endOf(c), at = c.at ?? 0;
      if (e != null && e <= start + 1e-3) return [];
      if (isBed(c)) { c[BED] = true; return [c]; }
      if (at < start) {
        if (c.src) c.in = r3((c.in ?? 0) + (start - at) * (c.rate ?? 1));
        if (c.lines) c.lines = c.lines.filter((l) => l.end > start);
        c.at = start;
        eachKeyed(c, cutKeys);
      }
      return [c];
    });
  });
  mapTimes(doc, (t) => r3(t - start + head));
  for (const tr of doc.tracks) for (const c of tr.clips) if (c[BED]) { c.at = 0; delete c[BED]; }
  own.forEach((otr, oi) => {
    (otr.clips ||= []).forEach((c, ci) => { c[ORIGIN] = [true, oi, ci]; });
    let tr = doc.tracks.find((x) => x.name === otr.name);
    if (!tr) doc.tracks.unshift(tr = { ...otr, clips: [] });
    else eachKeyed(otr, (h, k, v, path) => {
      let o = tr;
      for (const p of path) o = o[p] ||= {};
      o[k] = [...v.filter(([t]) => t < head), ...(keyed(o[k]) ? o[k] : o[k] != null ? [[head, o[k]]] : [])];
    });
    tr.clips = [...otr.clips, ...tr.clips];
  });
  const { base: _b, from: _f, tracks: _t, ...rest } = raw;
  delete doc.output;
  if (doc.duration != null) doc.duration = r3(doc.duration - start + head);
  return Object.assign(doc, rest);
}

// Keyframes on the timeline clock after removing [a, b): keys inside drop, later ones move up.
const cutKeys = (v, a, b) => {
  const k = v.filter(([t]) => t < a || t >= b).map(([t, ...rest]) => [t >= b ? r3(t - (b - a)) : t, ...rest]);
  return k.length ? k : val(v, a); // every key cut: hold the value it had there
};
const cutValues = (o, a, b) => eachKeyed(o, (h, k, v) => { h[k] = cutKeys(v, a, b); });
// A sound bed runs alone on its track; a voice track's first take (from 0, past 5 s) is not one.
export const bedOn = (tr, c) => isBed(c) && (tr.clips || []).length === 1;
// Remove [a, b] from every track of a document (times to the millisecond, so cut edges meet exactly).
export function cutDoc(doc, a, b) {
  const d = b - a, shift = (t) => (t >= b ? r3(t - d) : t > a ? a : t);
  for (const tr of doc.tracks || []) {
    cutValues(tr, a, b);
    const out = [];
    for (const c of tr.clips || []) {
      const at = c.at ?? 0, end = endOf(c) ?? Infinity, rate = c.rate ?? 1;
      if (c.dur != null) { c.end = end; delete c.dur; } // the branches below move `end`
      cutValues(c, a, b);
      // a caption line goes only when its words are all inside the cut (a lead-in cut often starts before its first word)
      if (c.lines) c.lines = c.lines.filter((l) => !(l.words?.length ? l.words.every(([, s, e]) => s >= a && e <= b) : l.at >= a && l.end <= b)).map((l) => ({ ...l, at: shift(l.at), end: shift(l.end), ...(l.words && { words: l.words.map(([w, s, e, ...x]) => [w, shift(s), shift(e), ...x]) }) }));
      if (end <= a || at >= b) { if (at >= b) { c.at = r3(at - d); if (c.end != null) c.end = r3(end - d); } out.push(c); continue; }
      if (at >= a && end <= b) continue; // wholly inside: gone
      if (at < a && end > b && bedOn(tr, c)) { c.end = r3(end - d); out.push(c); continue; } // a music bed plays on unbroken
      if (at < a && end > b && ['video', 'audio'].includes(clipType(c)) && !c.loop) { // a video or sound spanning the cut: split, the second part skips the cut's source
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

// A track plays one clip at a time: clips that overlap an earlier one on their track move to a copy of the track
// just above it ("<name> 2", …), where they still draw over it. A clip with no end written is taken to end before the
// next. → how many moved.
export function unstack(doc) {
  let moved = 0;
  for (let i = 0; i < (doc.tracks || []).length; i++) {
    const tr = doc.tracks[i], keep = [], over = [];
    let end = -Infinity;
    for (const c of [...(tr.clips || [])].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))) {
      if (c.lines || (c.at ?? 0) >= end - 1e-3) { keep.push(c); if (!c.lines) end = endOf(c) ?? -Infinity; } else over.push(c);
    }
    if (!over.length) continue;
    moved += over.length;
    const { clips: _c, ...rest } = tr, base = (tr.name || `Track ${i + 1}`).replace(/ \d+$/, ''), taken = new Set(doc.tracks.map((x) => x.name));
    let n = 2;
    while (taken.has(`${base} ${n}`)) n++;
    tr.clips = keep;
    doc.tracks.splice(i--, 0, { ...structuredClone(rest), name: `${base} ${n}`, clips: over }); // looked at next, for clips overlapping there
  }
  return moved;
}

// The edit in another frame size: positions and sizes scale with it (media still fills the frame).
export function reframe(doc, [nw, nh]) {
  const [W, H] = doc.size || [1080, 1920], sx = nw / W, sy = nh / H;
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
}

// Keyframes v over [a, b) alone, as the engine plays them there: a key on the value at a, one held on the value just
// before b, and a key every frame through an eased move the stretch holds only part of (cut short, it won't rescale).
// A jump (a hold key, then the next) within a frame of either edge stays outside, like the shot cut it marks.
function keysWithin(v, a, b, fps) {
  const jump = (x, y) => v.find(([t], i) => t > x && t < y && v[i - 1]?.[2] === 'hold')?.[0];
  a = jump(a, a + 1 / fps) ?? a; b = jump(b - 1 / fps, b) ?? b;
  const z = r3(b - 0.001), at = [a, ...v.map(([t]) => t).filter((t) => t > a && t < z), z], out = [];
  for (let j = 0; j < at.length - 1; j++) {
    const s = at[j], e = at[j + 1], i = v.findLastIndex(([t]) => t <= s), ez = v[i]?.[2];
    if (i < 0 || i === v.length - 1 || ['linear', 'hold'].includes(ez) || (v[i][0] === s && v[i + 1][0] === e)) out.push([s, val(v, s), ez]);
    else for (let t = s; t < e - 1e-6; t += 1 / fps) out.push([r3(t), val(v, t), 'linear']);
  }
  out.push([z, val(v, z), 'hold']);
  return out.map(([t, x, ez]) => [t, typeof x === 'number' ? r3(x) : x, ...(ez ? [ez] : [])]);
}

// The moves a picture clip (or a track's transform) can make: what recut carries over and the SFX check reads.
export const MOVES = ['x', 'y', 'w', 'h', 'scale', 'rotate', 'opacity', 'blur'];

// A new edit from stretches [a, b] of a document (every clip's end written in), in any order: each keeps its clips,
// in-points, captions, overlays and every keyframe (a sentence's zoom on a track transform) as the source showed them
// (keysWithin, cutDoc on a copy); a sound bed runs once under the whole new edit. edit-video's recut, and Studio's
// moves of a stretch.
export function rearrange(src, spans) {
  const clipsOf = (d) => d.tracks.flatMap((tr) => tr.clips || []), fps = src.fps || 30;
  const total = Math.max(...clipsOf(src).map((c) => endOf(c) ?? 0));
  const doc = { ...structuredClone(src), tracks: src.tracks.map((tr) => ({ ...structuredClone(tr), clips: [] })) };
  delete doc.output; delete doc.duration;
  let pos = 0;
  const trackKeys = src.tracks.map(() => new Map()); // per track: keyed path → its keys, stretch after stretch
  spans.forEach(([a, b]) => {
    const part = structuredClone(src);
    for (const tr of part.tracks) {
      tr.clips = (tr.clips || []).filter((c) => !bedOn(tr, c));
      for (const o of [tr, ...tr.clips]) eachKeyed(o, (h, k, v) => { h[k] = keysWithin(v, a, b, fps); });
    }
    for (const c of clipsOf(part)) {
      if ((c.at ?? 0) < a && (endOf(c) ?? Infinity) > a) delete c.transition; // it led in from a clip that's gone
      // A caption line the stretch cuts into keeps only its words inside it (a new first word capitalized).
      if (c.lines) c.lines = c.lines.flatMap((l) => {
        if (!l.words || (l.at >= a && l.end <= b) || l.end <= a || l.at >= b) return [l];
        const words = l.words.filter(([, s, e]) => e > a + 0.05 && s < b - 0.05).map(([w, s, e, ...x]) => [w, Math.max(s, a), Math.min(e, b), ...x]);
        if (!words.length) return [];
        if (l.at < a) words[0][0] = words[0][0][0].toUpperCase() + words[0][0].slice(1);
        return [{ ...l, text: words.map(([w]) => w).join(' '), at: words[0][1], end: Math.min(l.end, b), words }];
      });
    }
    if (b < total) cutDoc(part, b, total);
    if (a > 0) cutDoc(part, 0, a);
    // Scraps the cut left at its edges (the tail of a B-roll shot, a sound effect's last frames) go; the clip
    // next to one on its track stretches over its time.
    const near = (x, y) => Math.abs(x - y) < 1e-3;
    for (const tr of part.tracks) tr.clips = tr.clips.filter((c) => {
      const at = c.at ?? 0, end = endOf(c) ?? b - a;
      if (c.lines || end - at >= 0.25 || (at > 1e-3 && end < b - a - 1e-3)) return true;
      const after = tr.clips.find((x) => x !== c && near(x.at ?? 0, end)), before = tr.clips.find((x) => x !== c && near(endOf(x) ?? -1, at));
      if (near(at, 0) && after) { if (after.src) after.in = r3((after.in ?? 0) - (end - at) * (after.rate ?? 1)); after.at = at; }
      else if (before) before.end = end;
      return false;
    });
    // A shot the cut left starting a hair after the stretch starts (rounding) starts with it, so no frame flashes under it.
    for (const c of clipsOf(part)) if (c.at > 0 && c.at < 0.05 && !c.lines && (c.in ?? 0) >= c.at * (c.rate ?? 1)) { if (c.src) c.in = r3((c.in ?? 0) - c.at * (c.rate ?? 1)); c.at = 0; }
    mapTimes(part, (t) => r3(t + pos));
    part.tracks.forEach((tr, k) => {
      eachKeyed({ ...tr, clips: [] }, (h, key, v, path) => {
        const id = JSON.stringify([...path, key]); trackKeys[k].set(id, [...(trackKeys[k].get(id) || []), ...v]);
      });
      doc.tracks[k].clips.push(...tr.clips);
    });
    pos = r3(pos + b - a);
  });
  src.tracks.forEach((tr, k) => {
    const t = doc.tracks[k], caps = t.clips.filter((c) => c.lines);
    for (const [id, v] of trackKeys[k]) { const path = JSON.parse(id), key = path.pop(); let o = t; for (const x of path) o = o[x]; o[key] = v; }
    if (caps.length > 1) {
      const one = { ...caps[0], at: 0, end: pos, lines: caps.flatMap((c) => c.lines) };
      // A move (captions lifted off a label) carries over from every stretch, each opening on its own value.
      for (const k of MOVES) if (caps.some((c) => keyed(c[k]))) one[k] = caps.flatMap((c) => (keyed(c[k]) ? c[k] : c[k] != null ? [[c.at ?? 0, c[k], 'hold']] : []));
      t.clips = [...t.clips.filter((c) => !c.lines), one];
    }
    for (const c of (tr.clips || []).filter((c) => bedOn(tr, c))) t.clips.push({ ...structuredClone(c), end: pos });
    // A shot stretched back over a scrap past its source's first frame starts on that frame; the shot before holds on.
    for (const c of t.clips) if (c.src && c.in < 0) {
      const before = t.clips.find((x) => x !== c && Math.abs((endOf(x) ?? -1) - c.at) < 1e-3);
      c.at = r3(c.at - c.in / (c.rate ?? 1)); c.in = 0;
      if (before) before.end = c.at;
    }
  });
  return doc;
}

// The edit with its stretch [a, b] (every track's layers over it) moved to t, a cut outside it on the same clock;
// what lay between closes up. edit-video's move, and a talking clip dragged along its track in Studio.
export function moveStretch(doc, a, b, t) {
  const total = Math.max(...doc.tracks.flatMap((tr) => (tr.clips || []).map((c) => endOf(c) ?? 0)));
  const spans = (t <= a ? [[0, t], [a, b], [t, a], [b, total]] : [[0, a], [b, t], [a, b], [t, total]]).filter(([p, q]) => q - p > 1e-3);
  const out = rearrange(doc, spans);
  for (const k of ['output', 'duration']) if (doc[k] != null) out[k] = doc[k];
  return out;
}
