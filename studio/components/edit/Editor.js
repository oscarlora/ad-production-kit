'use client';
// An ad's edit: the live preview (Studio's engine, the same one the export runs), its timeline, and review comments
// pinned to a moment and a spot on the frame. The agent edits the document and the preview follows the file; the
// user edits it here too (engine/ops.js): each change shows at once, is saved to the file, and can be undone.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiBase, editApi, fileUrl, mediaUrl, openFile } from '../../lib/client/api.js';
import { clock } from '../../lib/client/format.js';
import { isTyping, useStored, useUndo } from '../../lib/client/hooks.js';
import { ORIGIN, compose, isBed, joint, r3, reframe, unstack } from '../../engine/doc.js';
import * as ops from '../../engine/ops.js';
import { IcCursor, IcPause, IcPlay, IcQuote, IcSplit, IcType, IcUp } from '../icons.js';
import { Compose, Comments, commentNumbers } from '../workflow/parts.js';
import { SafeZones, useZones, ZoneButton } from '../Player.js';
import Inspector, { BrandColors, Settings } from './Inspector.js';
import Timeline, { labelOf } from './Timeline.js';
import Trim from './Trim.js';

const SIMPLE_KEY = 'ad-production-kit-studio:timeline-simple';
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const PREVIEW_W = 720;

// A doc path (relative to the ad folder, may climb with ../) as a brand-relative path; climbing past the
// brand keeps its ../ (the shared library).
function brandPath(ad, src) {
  const out = ['outputs', ad];
  for (const part of String(src).split('/')) {
    if (part === '..' && out.length && out.at(-1) !== '..') out.pop(); else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

const parse = (text) => { const doc = JSON.parse(text); unstack(doc); return doc; };

export default function Editor({ ws, brand, ad, edit }) {
  const [planFile, setPlanFile] = useState(edit.plans[0].file);
  const plan = edit.plans.find((p) => p.file === planFile) || edit.plans[0];
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [doc, setDoc] = useState(null); // the engine's normalized doc
  const [error, setError] = useState('');
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  // The frame and the side follow one mode: 'edit' picks and moves clips, with the picked one's properties beside;
  // 'comment' marks spots, with the comments beside. Picking a clip or a comment anywhere switches to its mode.
  const [mode, setMode] = useStored('ad-production-kit-studio:editor-mode', 'comment');
  const [boxes, setBoxes] = useState([]); // where the frame on screen drew each clip (engine.boxes), bottom first
  const [waiting, setWaiting] = useState(false); // a clip's footage is still opening (its preview copy being made)
  const [draft, setDraft] = useState(null); // a comment being written: { t, from (drag start), box, text }
  const [focus, setFocus] = useState(null); // comment id
  const [lit, setLit] = useState(null); // the comment id under the pointer, in the list or on the timeline
  const [add, setAdd] = useState(''); // the add-a-comment field's text
  const [range, setRange] = useState(null); // a stretch picked on the timeline for the next comment: [from, to]
  const addRef = useRef(null);
  const [off, setOff] = useState(() => new Set()); // track names hidden in the preview (never written to the doc)
  const [trimId, setTrimId] = useState(null); // the clip open in the trim panel
  const [sel, setSel] = useState(null); // the picked clip or caption line: { id, li (the line's index in its file) }
  const [also, setAlso] = useState([]); // more picked with it (Shift or ⌘ click), for one change to them all
  useEffect(() => { if (!sel) setAlso([]); }, [sel]);
  const api = editApi(ws, brand, ad);
  // The edit's documents as last read from disk or changed here: { own: { file, text, doc }, base (a version's) }.
  // text is what the file holds, or will once the saves under way land. doc has any clips that overlapped on a track
  // on tracks of their own (unstack), which the first change made here saves.
  const [raws, setRaws] = useState(null);
  const [reread, setReread] = useState(0);
  const saves = useRef({ chain: Promise.resolve(), n: 0, lost: false });
  const cur = raws;
  // Writes a document, one save at a time; when the file changed on disk since, what is there is read again.
  const write = (file, text, expect) => {
    const S = saves.current;
    S.n++;
    S.chain = S.chain.then(() => api({ save: { file, text, expect } })).then(() => { S.n--; }, (e) => { S.n--; S.lost = true; setError(e.message); setReread((n) => n + 1); });
  };
  // ⌘Z / ⌘⇧Z undo and redo the changes made here: each puts its document back as it was, unless it changed since.
  const recordUndo = useUndo(({ file, before, after }, redo) => {
    const text = redo ? after : before;
    setRaws((r) => r && Object.fromEntries(Object.entries(r).map(([k, f]) => [k, f?.file === file ? { file, text, doc: parse(text) } : f])));
    write(file, text, redo ? before : after);
  });
  // A change made here: shown at once, then saved. show(key, doc) alone previews one still being dragged.
  const show = (key, doc, from = cur) => setRaws({ ...from, [key]: { ...from[key], doc } });
  const commit = (key, doc, from = cur) => {
    const { file, text: before } = from[key], after = `${JSON.stringify(doc, null, 1)}\n`;
    setRaws({ ...from, [key]: { file, text: after, doc } });
    write(file, after, before);
    recordUndo({ file, before, after });
  };
  const rootRef = useRef(null), tlRef = useRef(null);
  // The fixed timeline's height sizes the preview above it, watched on whichever element the timeline is now (it
  // remounts), so the preview never runs under it.
  const tlSeen = useRef(null);
  const tlMount = useCallback((el) => {
    tlRef.current = el;
    tlSeen.current?.disconnect();
    tlSeen.current = el && new ResizeObserver(() => rootRef.current?.style.setProperty('--tl-h', `${el.offsetHeight}px`));
    tlSeen.current?.observe(el);
  }, []);
  // Dragging the timeline's top edge resizes it between its top row and all its tracks; let go, it snaps to the
  // nearer one; a double click snaps to the other. Snapped down is simplified mode (no tracks), remembered in this browser.
  const [simple, setSimple] = useState(() => { try { return localStorage.getItem(SIMPLE_KEY) === '1'; } catch { return false; } });
  const [tlDrag, setTlDrag] = useState(null); // { h, snap? }: the timeline's height while its edge is dragged or snapping
  const edge = useRef(null);
  const sizes = () => { // its top row's and all its tracks' heights (the tracks once tlDrag renders them)
    const el = tlRef.current, border = el.offsetHeight - el.clientHeight;
    return { min: el.querySelector('.tl-track--head').offsetHeight + border, max: el.querySelector('.tl').offsetHeight + border };
  };
  const snap = (down) => {
    const { min, max } = sizes();
    setTlDrag({ h: down ? min : max, snap: true });
    setTimeout(() => {
      setTlDrag(null);
      setSimple(down);
      try { localStorage.setItem(SIMPLE_KEY, down ? '1' : '0'); } catch {}
    }, 180);
  };
  const edgeDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    edge.current = { y: e.clientY, h: tlRef.current.offsetHeight, moved: false };
  };
  const edgeMove = (e) => {
    const d = edge.current;
    if (!d || Math.abs(e.clientY - d.y) < 3 && !d.moved) return;
    d.moved = true;
    if (!tlDrag) { setTlDrag({ h: d.h }); return; } // renders the tracks first, so they can be measured
    const { min, max } = sizes();
    setTlDrag({ h: Math.max(min, Math.min(max, d.h - (e.clientY - d.y))) });
  };
  const edgeUp = () => {
    const d = edge.current;
    edge.current = null;
    if (!d?.moved || !tlDrag) return setTlDrag(null);
    const { min, max } = sizes();
    snap(tlDrag.h < (min + max) / 2);
  };
  const edgeToggle = () => {
    setTlDrag({ h: tlRef.current.offsetHeight });
    requestAnimationFrame(() => snap(!simple));
  };
  const toggleTrack = useCallback((name) => setOff((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; }), []);
  const live = useRef({ t: 0, busy: false, pending: null, stop: null, until: null, starting: false, actx: null, c0: 0, t0: 0, raf: 0 });

  const versions = useRef({}); // src -> mtime, so a replaced file gets a new URL
  versions.current = plan.media || {};
  // Videos preview from a light copy (PREVIEW_W wide); the export reads the originals.
  const url = useCallback((src) => fileUrl(ws, brand, brandPath(ad, src), versions.current[src], VIDEO.test(src) ? PREVIEW_W : undefined), [ws, brand, ad]);
  // src -> what the media library saved for that file (its frames and waveform), or null when it isn't a library file;
  // the timeline draws a clip's frames and waveform once its src is here.
  const [lib, setLib] = useState({});
  const asked = useRef(new Set());
  const libKey = [...new Set((doc?.tracks || []).flatMap((tr) => tr.clips).map((c) => c.src).filter((s) => s && !asked.current.has(s)))].join('\n');
  useEffect(() => {
    if (!libKey) return;
    for (const src of libKey.split('\n')) {
      asked.current.add(src);
      const id = /^inputs\/media\/(\d+)_[^/]+$/.exec(brandPath(ad, src))?.[1];
      (id ? fetch(mediaUrl(ws, brand, `_catalog/json/${id}.json`)).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null)).then((rec) => {
        const dur = rec?.file?.duration;
        const saved = rec && {
          dur,
          sprites: rec.sprites && { ...rec.sprites, url: mediaUrl(ws, brand, rec.sprites.sheet), dur },
          peaks: rec.file?.type === 'audio' ? mediaUrl(ws, brand, `_catalog/peaks/${id}.json`) : null,
        };
        setLib((m) => ({ ...m, [src]: saved }));
      });
    }
  }, [libKey, ws, brand, ad]);

  // The canvas draws at the size it shows on screen (device pixels), up to the doc's own size.
  const stageRef = useRef(null);
  const fitCanvas = useCallback(([w, h]) => {
    const cv = canvasRef.current, box = stageRef.current?.getBoundingClientRect();
    if (!cv || !box?.width) return false;
    const cw = Math.min(w, 2 * Math.round((box.width * (window.devicePixelRatio || 1)) / 2));
    const ch = Math.round((cw * h) / w);
    if (cv.width === cw && cv.height === ch) return false;
    cv.width = cw;
    cv.height = ch;
    return true;
  }, []);

  // Draw the newest requested time; requests made while drawing collapse into one.
  const draw = useCallback(async (time) => {
    const L = live.current, eng = engineRef.current;
    L.pending = time;
    if (L.busy || !eng?.doc) return;
    L.busy = true;
    try {
      while (L.pending != null) {
        const x = L.pending;
        L.pending = null;
        await eng.render(x, L.stop ? 1 : 0);
        setWaiting(eng.waiting > 0);
        const key = JSON.stringify(eng.boxes);
        if (key !== L.boxes) { L.boxes = key; setBoxes(eng.boxes); }
      }
    } catch (e) { setError(String(e.message || e)); } finally { L.busy = false; }
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const d = engineRef.current?.doc;
      if (d && fitCanvas([d.W, d.H])) { engineRef.current.resize(); draw(live.current.t); }
    });
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [fitCanvas, draw]);

  const pause = useCallback(() => {
    const L = live.current;
    cancelAnimationFrame(L.raf);
    L.stop?.();
    L.stop = null;
    setPlaying(false);
  }, []);

  const seek = useCallback((time) => {
    const d = engineRef.current?.doc;
    const x = Math.max(0, Math.min(d ? d.duration - 1 / d.fps : 0, time));
    live.current.t = x;
    setT(x);
    if (live.current.stop) { pause(); }
    draw(x);
  }, [draw, pause]);

  // Plays from the playhead; with `until`, stops there (a comment's review).
  const play = useCallback(async (until = null) => {
    const L = live.current, eng = engineRef.current;
    if (!eng?.doc || L.stop || L.starting) return;
    L.starting = true;
    L.until = until;
    if (L.t >= eng.doc.duration - 0.05) L.t = 0;
    L.actx ??= new AudioContext({ latencyHint: 'playback' });
    await L.actx.resume();
    const { at, stop } = await eng.play(L.actx, L.t).finally(() => { L.starting = false; });
    L.stop = stop;
    L.c0 = at;
    L.t0 = L.t;
    setPlaying(true);
    setDraft(null);
    const tick = () => {
      if (!L.stop) return;
      const now = L.t0 + Math.max(0, L.actx.currentTime - L.c0);
      const end = Math.min(eng.doc.duration - 1 / eng.doc.fps, L.until ?? Infinity);
      if (now >= end) { L.t = end; setT(end); pause(); return; }
      L.t = now;
      setT(now);
      draw(now);
      L.raf = requestAnimationFrame(tick);
    };
    L.raf = requestAnimationFrame(tick);
  }, [draw, pause]);

  // One engine per mount; the AudioContext lives as long as the editor.
  const [engine, setEngine] = useState(null);
  useEffect(() => {
    let dead = false, eng = null;
    import('../../engine/index.js').then(async ({ createEngine }) => {
      eng = await createEngine({ canvas: canvasRef.current, url, light: true, onOpen: () => draw(live.current.t) });
      if (dead) { eng.close(); return; }
      engineRef.current = eng;
      setEngine(eng);
    }).catch((e) => setError(String(e.message || e)));
    return () => { dead = true; pause(); eng?.close(); engineRef.current = null; };
  }, [url, pause, draw]);
  useEffect(() => () => { const a = live.current.actx; live.current.actx = null; a?.close().catch(() => {}); }, []);

  // Read the documents whenever a file changes on disk; a read that matches what is here changes nothing.
  useEffect(() => {
    let dead = false;
    (async () => {
      // A file caught mid-write reads as broken JSON: read it again before calling it an error.
      const get = async (file) => { const text = await fetch(fileUrl(ws, brand, plan.p.replace(/[^/]+$/, file), plan.v), { cache: 'no-store' }).then((r) => r.text()); return { file, text, doc: parse(text) }; };
      const read = async () => { const own = await get(plan.file); return { own, base: own.doc.base ? await get(own.doc.base) : null }; };
      const next = await read().catch(() => new Promise((r) => setTimeout(r, 250)).then(read));
      const S = saves.current;
      if (dead || S.n) return; // a save under way lands as another change
      const lost = S.lost;
      S.lost = false;
      setRaws((r) => (!lost && r && r.own.file === next.own.file && r.own.text === next.own.text && r.base?.text === next.base?.text ? r : next));
    })().catch((e) => { if (!dead) setError(`${plan.file}: ${e.message || e}`); });
    return () => { dead = true; };
  }, [ws, brand, plan.p, plan.v, plan.file, reread]);

  // What plays: a version over its base. Each clip's id says where it sits: "o.<track>.<clip>" in the document
  // itself, "b.…" in its base.
  const plays = useMemo(() => {
    if (!cur) return null;
    try {
      if (!cur.base) return { ...cur.own.doc, tracks: (cur.own.doc.tracks || []).map((tr, ti) => ({ ...tr, clips: (tr.clips || []).map((c, ci) => ({ ...c, id: `o.${ti}.${ci}` })) })) };
      const d = compose(cur.own.doc, cur.base.doc);
      for (const c of d.tracks.flatMap((tr) => tr.clips)) c.id = `${c[ORIGIN][0] ? 'o' : 'b'}.${c[ORIGIN][1]}.${c[ORIGIN][2]}`;
      return d;
    } catch (e) { return e; }
  }, [cur]);

  // Load what plays into the engine, one load at a time.
  const loads = useRef(Promise.resolve());
  useEffect(() => {
    if (!engine || !plays) return undefined;
    if (plays instanceof Error) { setError(`${plan.file}: ${plays.message}`); return undefined; }
    let dead = false;
    loads.current = loads.current.then(async () => {
      if (dead) return;
      const wasPlaying = !!live.current.stop;
      if (wasPlaying) pause();
      fitCanvas(plays.size || [1080, 1920]);
      const d = await engine.load({ ...plays, tracks: plays.tracks.map((tr) => (off.has(tr.name) ? { ...tr, hidden: true } : tr)) }, plays.fx ? `${url(plays.fx)}&v=${plan.v}` : null); // fx.js re-imported when it changes
      if (dead) return;
      setDoc(d);
      setError('');
      await draw(Math.min(live.current.t, d.duration - 1 / d.fps));
      if (wasPlaying) play(live.current.until);
    }).catch((e) => { if (!dead) setError(`${plan.file}: ${e.message || e}`); });
    return () => { dead = true; };
  }, [engine, plays, plan.file, plan.v, off, url, draw, pause, play, fitCanvas]);

  // ---- Editing by hand ----
  const clips = doc?.tracks.flatMap((tr) => tr.clips) || [];
  // Where a shown clip (or its line li) lives: which document (key), its ref there, and how far that document's
  // clock runs ahead of the timeline's (a version shows its base from the join on; a sound bed from its start).
  const target = (c, li) => {
    const [k, ti, ci] = c.id.split('.'), key = k === 'o' ? 'own' : 'base', raw = cur[key].doc.tracks[ti].clips[ci];
    const [start, head] = key === 'base' ? joint(cur.own.doc, cur.base.doc) : [0, 0];
    return { key, ref: li == null ? [+ti, +ci] : [+ti, +ci, li + raw.lines.length - c.lines.length], shift: key === 'base' && !isBed(raw) ? start - head : 0 };
  };
  // The document a moment of the timeline belongs to (a version's own clips come before its base's).
  const where = (time) => {
    if (!cur.base) return { key: 'own', shift: 0 };
    const [start, head] = joint(cur.own.doc, cur.base.doc);
    return time < head ? { key: 'own', shift: 0 } : { key: 'base', shift: start - head };
  };
  // A copy of a document to change, each clip's end written in (a media clip without one plays to its source's end).
  const copyOf = (key, from = cur) => {
    const d = structuredClone(from[key].doc);
    for (const c of clips) {
      const tg = target(c), raw = tg.key === key && d.tracks[tg.ref[0]].clips[tg.ref[1]];
      if (raw && !raw.lines && raw.end == null && raw.dur == null) raw.end = r3(c.end + tg.shift);
    }
    return d;
  };
  const pickedClip = sel && cur ? clips.find((c) => c.id === sel.id) : null;
  const pickedLine = pickedClip?.lines && sel.li != null ? sel.li - target(pickedClip, 0).ref[2] : null; // its index as shown
  const picked = pickedClip && (sel.li == null || pickedClip.lines?.[pickedLine]) ? pickedClip : null;
  const line = picked && sel.li != null ? picked.lines[pickedLine] : null;
  // Every picked block as shown: the first (the one the inspector reads), then the rest.
  const picks = !picked ? [] : [{ c: picked, li: line ? pickedLine : null }, ...also.flatMap((a) => {
    const c = clips.find((x) => x.id === a.id), li = c?.lines && a.li != null ? a.li - target(c, 0).ref[2] : null;
    return c && (a.li == null || c.lines?.[li]) ? [{ c, li }] : [];
  })];
  const tlSel = picks.map((p) => `${p.c.id}:${p.li ?? ''}`).join('|');
  // A media clip's source length (s), for trims to stop at: the library's, else read from the file once.
  const lens = useRef(new Map());
  const lenOf = (c) => {
    if (c.type !== 'video' && c.type !== 'audio') return undefined;
    if (!lens.current.has(c.src)) {
      lens.current.set(c.src, undefined);
      const m = document.createElement(c.type);
      m.preload = 'metadata';
      m.onloadedmetadata = () => lens.current.set(c.src, m.duration);
      m.src = url(c.src);
    }
    return lens.current.get(c.src) ?? lib[c.src]?.dur;
  };
  // A click on nothing (not a control, the frame, the timeline's blocks and ruler, or the clip's own panels) lets go of it.
  const holding = !!sel;
  useEffect(() => {
    if (!holding) return undefined;
    const onDown = (e) => { if (!e.target.closest?.('button, a, input, select, textarea, label, .ed__stage, .insp, .trim, .tl-clip, .tl-scrub, .tl-name, .ed__edge')) setSel(null); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [holding]);
  // add (Shift or ⌘): one more picked, or one fewer when it already is.
  const select = (c, li, add) => {
    if (!c) return setSel(null);
    lenOf(c);
    setMode('edit');
    const one = { id: c.id, li: li == null ? null : target(c, li).ref[2] }, same = (x) => x.id === one.id && x.li === one.li;
    if (!add || !sel) { setAlso([]); return setSel(one); }
    if (same(sel)) { setSel(also[0] || null); return setAlso(also.slice(1)); }
    setAlso(also.some(same) ? also.filter((x) => !same(x)) : [...also, one]);
  };
  // Change a clip's document: fn(doc, ref, shift) may return the ref to pick next (null: nothing).
  const change = (c, li, fn, from = cur) => {
    const tg = target(c, li), d = copyOf(tg.key, from), next = fn(d, tg.ref, tg.shift);
    commit(tg.key, d, from);
    if (next !== undefined) setAlso([]);
    if (next !== undefined) setSel(next && { id: `${tg.key === 'own' ? 'o' : 'b'}.${next[0]}.${next[1]}`, li: next[2] ?? null });
  };
  const changeOne = (fn) => picked && change(picked, line ? pickedLine : null, fn); // the first picked block alone
  // The same change to every picked block (last in its document first, so a deletion leaves the others in place).
  // live: only shown, from the documents as they were when the changing began (a number being dragged), until a call
  // without it saves the last one.
  const dragged = useRef(null);
  const changePicked = (fn, live) => {
    if (!picked) return;
    const s = dragged.current ||= { from: cur, tgs: picks.map((p) => target(p.c, p.li)) };
    const docs = {};
    let next;
    for (const tg of [...s.tgs].sort((a, b) => b.ref[0] - a.ref[0] || b.ref[1] - a.ref[1] || (b.ref[2] ?? 0) - (a.ref[2] ?? 0))) {
      const r = fn(docs[tg.key] ||= copyOf(tg.key, s.from), tg.ref, tg.shift);
      if (tg === s.tgs[0]) next = r;
    }
    if (live) return setRaws({ ...s.from, ...Object.fromEntries(Object.entries(docs).map(([key, doc]) => [key, { ...s.from[key], doc }])) });
    dragged.current = null;
    let from = s.from;
    for (const [key, d] of Object.entries(docs)) { commit(key, d, from); from = { ...from, [key]: { ...from[key], text: `${JSON.stringify(d, null, 1)}\n`, doc: d } }; }
    if (next !== undefined) setSel(s.tgs.length > 1 || !next ? null : { id: `${s.tgs[0].key === 'own' ? 'o' : 'b'}.${next[0]}.${next[1]}`, li: next[2] ?? null });
  };
  const block = line || picked;
  const tools = {
    // S: the picked clip, else every clip under the playhead but a sound bed, splits there.
    split: () => {
      const time = live.current.t;
      if (picked && !line) return changeOne((d, ref, shift) => { ops.split(d, time + shift, ref); });
      const w = where(time), d = copyOf(w.key);
      if (ops.split(d, time + w.shift)) commit(w.key, d);
    },
    text: () => {
      const w = where(live.current.t), d = copyOf(w.key), [ti, ci] = ops.addText(d, live.current.t + w.shift, doc.duration + w.shift);
      commit(w.key, d);
      setSel({ id: `${w.key === 'own' ? 'o' : 'b'}.${ti}.${ci}`, li: null });
    },
    duplicate: () => !line && changeOne((d, ref) => ops.duplicate(d, ref)),
    remove: (ripple) => changePicked((d, ref) => { (ripple ? ops.rippleRemove : ops.remove)(d, ref); return null; }),
    retime: (mode, by) => changeOne((d, ref) => { ops.retime(d, ref, mode, by, lenOf(picked)); }),
  };

  // Space plays, arrows step a frame (with Shift, a second); N writes a comment, ↑ / ↓ move between comments, A approves
  // the picked one and W watches its change. Editing: S splits at the playhead, T adds text, ⌫ deletes the picked clip
  // (Shift: and its time), ⌘D duplicates it, [ and ] bring its start or end to the playhead, , and . nudge it a frame
  // (Shift: ten), Enter opens its trim panel, Esc lets go of it. V and C switch
  // to editing and commenting.
  useEffect(() => {
    const onKey = (e) => {
      if (isTyping(e) || !doc || !cur || e.altKey) return;
      const k = e.key.toLowerCase(), n = pending.find((x) => x.id === focus);
      if ((e.metaKey || e.ctrlKey) && k === 'd' && picked) { e.preventDefault(); tools.duplicate(); }
      if (e.metaKey || e.ctrlKey) return;
      if (k === 's') tools.split();
      if (k === 't') { e.preventDefault(); tools.text(); }
      if (picked) {
        if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); tools.remove(e.shiftKey); }
        if (e.key === '[' || e.key === ']') tools.retime(e.key === '[' ? 'start' : 'end', live.current.t - (e.key === '[' ? block.at : block.end));
        if (',.<>'.includes(e.key)) tools.retime('move', ((e.key === ',' || e.key === '<' ? -1 : 1) * (e.shiftKey ? 10 : 1)) / doc.fps);
        if (e.key === 'Escape' && !draft && !trimId) setSel(null);
        if (e.key === 'Enter' && !line && (picked.type === 'video' || picked.type === 'audio')) { pause(); setTrimId(picked.id); }
      }
      if (k === 'v') setMode('edit');
      if (k === 'c') setMode('comment');
      if (k === 'n') { e.preventDefault(); pause(); toComment(); }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && pending.length) {
        e.preventDefault();
        const byTime = [...pending].sort((a, b) => a.t - b.t), i = byTime.indexOf(n);
        pick(byTime[i < 0 ? 0 : Math.max(0, Math.min(byTime.length - 1, i + (e.key === 'ArrowUp' ? -1 : 1)))]);
      }
      if (n?.status === 'done' && k === 'a') commentAction({ approve: n.id });
      if (n?.status === 'done' && k === 'w') review(n);
      if (e.key === ' ' && !e.target.closest?.('button')) { e.preventDefault(); live.current.stop ? pause() : play(); } // a focused button takes Space
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        seek(live.current.t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / doc.fps));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }); // re-bound each render: it reads the current comments and focus

  // Drag on the frame to mark a spot (a click marks the moment), then write the comment.
  const at = (e) => {
    const r = stageRef.current.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  // Commenting, a click or drag on the frame marks a spot for a comment. Editing, it picks the top clip drawn there
  // (nothing: lets go), and a drag moves that clip: its center snaps to the frame's and to the other clips' on
  // screen, a guide line showing each.
  const [guides, setGuides] = useState(null); // [x, y] the drag is snapped to (frame px), null where it isn't
  const moving = useRef(null); // { from (the documents when the drag began), key, d (the draft), raw (the clip in it), p0, x0, y0, xs, ys (what it snaps to), moved }
  const onPointerDown = (e) => {
    if (!doc || e.button !== 0) return;
    pause();
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = at(e), now = live.current.t;
    if (mode === 'comment') { setFocus(null); setDraft({ t: now, from: [x, y], box: [x, y, 0, 0], text: '' }); return; }
    // inside a clip's corners: on the same side of all four edges
    const inside = (q) => { const s = q.map(([ax, ay], i) => { const [bx, by] = q[(i + 1) % 4]; return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0; }); return s.every((v) => v === s[0]); };
    const c = cur && clips.find((k) => k.id === boxes.findLast(([, q]) => inside(q))?.[0]);
    if (!c) return setSel(null);
    const li = c.lines ? c.lines.findIndex((l) => now >= l.at && now < l.end) : -1;
    const add = e.shiftKey || e.metaKey;
    select(c, li < 0 ? null : li, add);
    if (add) return;
    if (c.type === 'custom' || typeof (c.x ?? 0) !== 'number' || typeof (c.y ?? 0) !== 'number') return; // placed by its layer, or keyframed
    const tg = target(c), d = copyOf(tg.key), others = clips.filter((k) => k !== c && k.type !== 'audio' && now >= k.at && now < k.end);
    const stops = (k, mid) => [mid, ...others.map((o) => o[k]).filter((v) => typeof v === 'number')];
    moving.current = { from: cur, key: tg.key, d, raw: d.tracks[tg.ref[0]].clips[tg.ref[1]], p0: [x, y], x0: c.x ?? W / 2, y0: c.y ?? H / 2, xs: stops('x', W / 2), ys: stops('y', H / 2) };
  };
  const onPointerMove = (e) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const [x1, y1] = at(e), m = moving.current;
    if (m) {
      if (!m.moved && Math.hypot(x1 - m.p0[0], y1 - m.p0[1]) < 0.01) return;
      m.moved = true;
      const snap = (v, to) => to.find((s) => Math.abs(v - s) < W * 0.015);
      const sx = snap(m.x0 + (x1 - m.p0[0]) * W, m.xs), sy = snap(m.y0 + (y1 - m.p0[1]) * H, m.ys);
      m.raw.x = sx ?? Math.round(m.x0 + (x1 - m.p0[0]) * W);
      m.raw.y = sy ?? Math.round(m.y0 + (y1 - m.p0[1]) * H);
      setGuides([sx ?? null, sy ?? null]);
      return show(m.key, m.d, m.from);
    }
    setDraft((d) => d && { ...d, box: [Math.min(d.from[0], x1), Math.min(d.from[1], y1), Math.abs(x1 - d.from[0]), Math.abs(y1 - d.from[1])] });
  };
  const onPointerUp = () => {
    const m = moving.current;
    moving.current = null;
    setGuides(null);
    if (m?.moved) commit(m.key, m.d, m.from);
    if (mode === 'comment') requestAnimationFrame(() => composeRef.current?.focus()); // the click itself takes focus off the new field
  };

  // Esc or a click anywhere else discards the comment being written.
  const composeRef = useRef(null);
  const drafting = !!draft;
  useEffect(() => {
    if (!drafting) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDraft(null); };
    const onDown = (e) => { if (!stageRef.current?.contains(e.target)) setDraft(null); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [drafting]);

  const saveDraft = (text) => {
    const box = draft.box[2] > 0.01 || draft.box[3] > 0.01 ? draft.box : null;
    api({ comment: { t: draft.t, box, text, plan: plan.file } }).catch((e) => setError(e.message));
  };
  const commentAction = (body) => api(body).catch((e) => setError(e.message));
  const pick = (n) => { setMode('comment'); setFocus(n.id); seek(n.t); };
  // To commenting, the cursor in the add-a-comment field.
  const toComment = () => { setMode('comment'); requestAnimationFrame(() => addRef.current?.focus()); };
  // Plays what changed for a comment: its changed stretch (or its moment), with a second either side.
  const review = (n) => {
    const [a, b] = n.span || [n.t, n.t + 1];
    setFocus(n.id);
    seek(Math.max(0, a - 1));
    play(b + 1);
  };

  const comments = useMemo(() => edit.comments.filter((n) => (n.plan || 'edit.json') === plan.file), [edit.comments, plan.file]);
  const pending = useMemo(() => comments.filter((n) => n.status !== 'approved'), [comments]);
  const nums = useMemo(() => commentNumbers(comments), [comments]);
  // Only open comments mark the frame: a done one's box would cover the change it asks you to judge.
  const shown = comments.filter((n) => n.box && n.status !== 'done' && n.status !== 'approved' && (n.id === focus || n.id === lit || (!playing && Math.abs(n.t - t) < 0.2)));
  const exp = edit.export?.plan === plan.file ? edit.export : null;
  const W = doc?.W || 1080, H = doc?.H || 1920;
  const [zone, nextZone] = useZones(W / H);
  const trimClip = trimId && cur && clips.find((c) => c.id === trimId);
  // The trim panel's cut. A base clip a version shows from its join on is cut on the base's clock.
  const applyTrim = async ({ in: inS, dur }) => {
    const tg = target(trimClip), raw = cur[tg.key].doc.tracks[tg.ref[0]].clips[tg.ref[1]], skip = r3((raw.in ?? 0) - trimClip.in); // ≤ 0: what the join hides
    if (inS + skip < 0) return setError(`this clip is shared with ${cur.base.file} and starts before the join there; trim its start in ${cur.base.file}`);
    change(trimClip, null, (d, ref) => { ops.source(d, ref, inS + skip, dur - skip / trimClip.rate); });
    setTrimId(null);
  };
  const sendAdd = () => {
    if (add.trim()) api({ comment: { t: range ? range[0] : live.current.t, ...(range && { to: range[1] }), box: null, text: add.trim(), plan: plan.file } }).catch((er) => setError(er.message));
    setAdd('');
    setRange(null);
  };
  const pickRange = (r, done) => { setRange(r); if (done) toComment(); };
  const outline = mode === 'edit' && picked && !playing && boxes.findLast(([id]) => id === picked.id)?.[1].map((p) => p.map((v) => Math.min(1, Math.max(0, v))).join()).join(' '); // kept inside the frame, so a clip filling it (or larger) still shows its outline
  // A version without that track mutes its base's.
  const muteTrack = (track, mute) => {
    for (const key of ['own', 'base']) {
      const d = cur[key] && structuredClone(cur[key].doc);
      if (d && ops.muteTrack(d, track, mute)) return commit(key, d);
    }
  };
  // A change to each document (a version and its base): fn(doc, key) → whether it changed it.
  const changeEach = (fn) => {
    let from = cur;
    for (const key of ['own', 'base']) {
      const d = from[key] && structuredClone(from[key].doc);
      if (d && fn(d, key)) { commit(key, d, from); from = { ...from, [key]: { ...from[key], text: `${JSON.stringify(d, null, 1)}\n`, doc: d } }; }
    }
  };
  // A track dragged above another (null: to the bottom), in each document that has both.
  const orderTrack = (name, before) => {
    changeEach((d) => ops.orderTrack(d, name, before));
    setSel(null); // clips are known by their track's place
  };
  // The edit's own settings: a new size reframes every clip; the rest live in the base when there is one (its
  // versions share them).
  const setEdit = ({ size, ...rest }) => changeEach((d, key) => {
    if (size) reframe(d, size);
    const main = key === (cur.base ? 'base' : 'own');
    for (const [k, v] of Object.entries(rest)) { if (main && v != null) d[k] = v; else delete d[k]; }
    return true;
  });
  // The brand's saved text styles (inputs/text-styles.json): the inspector's first templates.
  const [looks, setLooks] = useState([]);
  useEffect(() => { fetch(fileUrl(ws, brand, 'inputs/text-styles.json'), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).then(setLooks, () => {}); }, [ws, brand]);
  // The brand's font files, as paths from the ad's folder, and what the brand uses each for: the font picker lists them first.
  const [brandFonts, setBrandFonts] = useState({}), [fontRoles, setFontRoles] = useState({});
  useEffect(() => {
    fetch(`${apiBase(ws, brand)}/fonts`).then((r) => (r.ok ? r.json() : {})).then((r) => { setBrandFonts(Object.fromEntries(Object.entries(r.fonts || {}).map(([k, p]) => [k, `../../${p}`]))); setFontRoles(r.roles || {}); }, () => {});
  }, [ws, brand]);
  // The brand's colors (the hex values in its inputs/DESIGN.md, in order): the swatches every color picker in the inspector opens with.
  const [colors, setColors] = useState([]);
  useEffect(() => {
    fetch(fileUrl(ws, brand, 'inputs/DESIGN.md'), { cache: 'no-store' }).then((r) => (r.ok ? r.text() : ''))
      .then((md) => setColors([...new Set((md.match(/#[0-9a-f]{6}\b/gi) || []).map((x) => x.toLowerCase()))].slice(0, 16)), () => {});
  }, [ws, brand]);
  const saveLooks = (next) => { setLooks(next); editApi(ws, brand)({ looks: next }).catch((er) => setError(er.message)); };
  // A frame tool: a mode (on: whether it is the current one) or an action; n: a count beside its icon.
  const chip = (Icon, label, keys, run, on, n) => <button type="button" className="chip" aria-label={label} title={`${label} (${keys})`} aria-pressed={on} disabled={!cur} onClick={run}><Icon />{n && <span className="ed__count">{n}</span>}</button>;

  return (
    <div className="ed" ref={rootRef} style={{ '--ar': W / H }}>
      <div className="ed__main">
        <div className="ed__stage" ref={stageRef} data-mode={mode} style={{ aspectRatio: `${W} / ${H}` }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} role="img" aria-label="Preview: click or drag to leave a comment">
          <canvas ref={canvasRef} />
          {outline && <svg className="ed__outline" viewBox="0 0 1 1" preserveAspectRatio="none"><polygon points={outline} vectorEffect="non-scaling-stroke" /></svg>}
          {guides?.[0] != null && <i className="ed__guide" style={{ left: pct(guides[0] / W), top: 0, bottom: 0 }} />}
          {guides?.[1] != null && <i className="ed__guide" style={{ top: pct(guides[1] / H), left: 0, right: 0 }} />}
          {zone && <div className="ed__zones"><SafeZones mode={zone} ratio={W / H} /></div>}
          {mode === 'comment' && shown.map((n) => (
            <div key={n.id} className="ed__box" data-status={n.status} style={boxStyle(n.box)} />
          ))}
          {draft && (
            <>
              {(draft.box[2] > 0.01 || draft.box[3] > 0.01) && <div className="ed__box ed__box--draft" style={boxStyle(draft.box)} />}
              <Compose
                ref={composeRef} style={composeStyle(draft.box)} onPointerDown={(e) => e.stopPropagation()} placeholder={`Comment at ${clock(draft.t, true)}`}
                value={draft.text} onChange={(text) => setDraft({ ...draft, text })} onSend={saveDraft} onClose={() => setDraft(null)}
              />
            </>
          )}
          {!doc && !error && <div className="ed__wait">Loading</div>}
          {doc && waiting && <div className="ed__wait">Preparing this clip's preview…</div>}
        </div>
        <div className="chips ed__tools" role="toolbar" aria-label="Frame tools">
          {chip(IcCursor, 'Select: pick and move clips', 'V', () => setMode('edit'), mode === 'edit')}
          {chip(IcQuote, 'Comment: mark spots to comment on', 'C', () => setMode('comment'), mode === 'comment', pending.length || null)}
          <i />
          {chip(IcType, 'Add text', 'T', tools.text)}
          {chip(IcSplit, 'Split at the playhead', 'S', tools.split)}
          {nextZone && <><i /><ZoneButton mode={zone} onClick={nextZone} className="chip" /></>}
        </div>
      </div>
      <aside className="ed__side">
        <div className="ed__head">
          {edit.plans.length > 1 && (
            <div className="chips">
              {edit.plans.map((p) => (
                <button key={p.file} type="button" className="chip" aria-pressed={p.file === plan.file} onClick={() => { pause(); setPlanFile(p.file); }}>{p.label}</button>
              ))}
            </div>
          )}
          <div className="spacer" />
          <Export ws={ws} brand={brand} ad={ad} plan={plan} exp={exp} api={api} onError={setError} />
        </div>
        {error && <p className="ed__error">{error}</p>}
        <BrandColors.Provider value={colors}>
        {mode === 'edit' && (picked
          ? <Inspector key={`${sel.id}.${sel.li}`} clip={picked} line={line} W={W} H={H} len={lenOf(picked)} fonts={{ ...brandFonts, ...doc.fonts }} fontUrl={url} fontRoles={fontRoles} count={picks.length} looks={looks} onLooks={saveLooks} edit={changePicked} name={line ? line.text : labelOf(picked)}
            onSource={() => { pause(); setTrimId(picked.id); }} onDuplicate={line ? null : tools.duplicate} onDelete={tools.remove} />
          : doc && <Settings doc={doc} set={setEdit} />)}
        </BrandColors.Provider>
        {mode === 'comment' && <Comments
          comments={comments} focus={focus} lit={lit} onLit={setLit} onPick={pick} onReview={review} onAction={commentAction} lead={(n) => <span className="ed-comment__time"><b className="ed-comment__num">{nums.get(n.id)}</b>{clock(n.t, true)}{n.to > n.t && `–${clock(n.to, true)}`}</span>}
          footer={(
            <div className="ed__add-row">
              <textarea
                ref={addRef} className="field ed__add" rows={1} value={add} placeholder={range ? `Add a comment on ${clock(range[0], true)}–${clock(range[1], true)}` : `Add a comment at ${clock(t, true)}`} onChange={(e) => setAdd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.currentTarget.blur(); setRange(null); }
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAdd(); }
                }}
              />
              <button type="button" className="btn btn--primary ed__send" aria-label="Send comment" title="Send (Enter)" disabled={!add.trim()} onClick={sendAdd}><IcUp /></button>
            </div>
          )}
        />}
      </aside>
      {doc && (
        <div className="ed__tl" ref={tlMount} data-drag={tlDrag ? (tlDrag.snap ? 'snap' : 'drag') : undefined} style={tlDrag ? { height: tlDrag.h } : undefined}>
        <div className="ed__edge" role="separator" aria-orientation="horizontal" aria-label="Drag or double-click to show or hide the tracks" onPointerDown={edgeDown} onPointerMove={edgeMove} onPointerUp={edgeUp} onPointerCancel={edgeUp} onDoubleClick={edgeToggle} />
        <Timeline doc={doc} t={t} comments={pending} nums={nums} url={url} lib={lib} lit={lit} range={range} onRange={pickRange} onHover={setLit} onSeek={seek} onPick={pick} off={off} onToggle={toggleTrack} onMute={muteTrack} playing={playing} sel={tlSel} onSelect={select}
          onDrag={(c, li) => { const tg = target(c, li), d = copyOf(tg.key), len = lenOf(c); return Object.assign((mode, by, loose, stretch) => ops.limit(d, tg.ref, mode, by, len, loose, stretch), { rate: (mode, by) => ops.stretchRate(d, tg.ref, mode, by) }); }}
          onRetime={(c, li, mode, by, to, stretch) => change(c, li, (d, ref) => { ops.retime(d, ref, mode, by, lenOf(c), to != null, stretch); return to == null ? undefined : ops.toTrack(d, ref, to); })}
          onSkim={(x) => draw(x ?? live.current.t)} onOrder={orderTrack} onRename={(name, to) => changeEach((d) => ops.renameTrack(d, name, to))} onRemove={(name) => { changeEach((d) => ops.removeTrack(d, name)); setSel(null); }}
          onOpen={(id) => { pause(); setTrimId(id); }} simple={simple && !tlDrag}>
          <button type="button" className="ed__play" onClick={() => (playing ? pause() : play())} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <IcPause /> : <IcPlay />}
          </button>
          <span className="ed__clock">{clock(t, true)}<span> / {clock(doc.duration, true)}</span></span>
        </Timeline>
        </div>
      )}
      {trimClip && <Trim key={trimClip.id} clip={trimClip} src={url(trimClip.src)} saved={lib[trimClip.src]} onApply={applyTrim} onClose={() => setTrimId(null)} />}
    </div>
  );
}

const pct = (x) => `${x * 100}%`;
const boxStyle = ([x, y, w, h]) => ({ left: pct(x), top: pct(y), width: pct(w), height: pct(h) });
// The comment field sits under the marked spot, or above it near the bottom.
const composeStyle = ([x, y, w, h]) => (y + h > 0.75 ? { left: pct(Math.min(x, 0.45)), bottom: pct(1 - y + 0.01) } : { left: pct(Math.min(x, 0.45)), top: pct(y + h + 0.01) });

function Export({ ws, brand, ad, plan, exp, api, onError }) {
  const running = exp?.state === 'running';
  const start = () => api({ export: plan.file }).catch((e) => onError(e.message));
  return (
    <div className="ed__export">
      {exp?.state === 'done' && exp.out && (
        <button type="button" className="btn" onClick={() => openFile(ws, brand, brandPath(ad, exp.out)).catch((e) => onError(e.message))} title={exp.out}>Open video</button>
      )}
      {exp?.state === 'failed' && <span className="ed__fail" title={exp.error}>Export failed</span>}
      <button type="button" className="btn btn--primary" onClick={start} disabled={running}>
        {running ? `Exporting ${Math.round((exp.progress || 0) * 100)}%` : 'Export'}
      </button>
    </div>
  );
}
