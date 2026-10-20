'use client';
// An ad's edit: the live preview (Studio's engine, the same one the export runs), its timeline, and review comments
// pinned to a moment and a spot on the frame. The agent edits the document; the preview follows the file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { editApi, fileUrl, mediaUrl, openFile } from '../../lib/client/api.js';
import { clock } from '../../lib/client/format.js';
import { isTyping, useUndo } from '../../lib/client/hooks.js';
import { compose } from '../../engine/doc.js';
import { IcPause, IcPlay, IcUp } from '../icons.js';
import { Compose, Comments, commentNumbers } from '../workflow/parts.js';
import { SafeZones, useZones, ZoneButton } from '../Player.js';
import Timeline from './Timeline.js';
import Trim from './Trim.js';

const SIMPLE_KEY = 'ad-production-kit-studio:timeline-simple';

// A doc path (relative to the ad folder, may climb with ../) as a brand-relative path; climbing past the
// brand keeps its ../ (the shared library).
function brandPath(ad, src) {
  const out = ['outputs', ad];
  for (const part of String(src).split('/')) {
    if (part === '..' && out.length && out.at(-1) !== '..') out.pop(); else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

export default function Editor({ ws, brand, ad, edit }) {
  const [planFile, setPlanFile] = useState(edit.plans[0].file);
  const plan = edit.plans.find((p) => p.file === planFile) || edit.plans[0];
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [doc, setDoc] = useState(null); // the engine's normalized doc
  const [error, setError] = useState('');
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [draft, setDraft] = useState(null); // a comment being written: { t, from (drag start), box, text }
  const [focus, setFocus] = useState(null); // comment id
  const [lit, setLit] = useState(null); // the comment id under the pointer, in the list or on the timeline
  const [add, setAdd] = useState(''); // the add-a-comment field's text
  const [range, setRange] = useState(null); // a stretch picked on the timeline for the next comment: [from, to]
  const addRef = useRef(null);
  const [off, setOff] = useState(() => new Set()); // track names hidden in the preview (never written to the doc)
  const [trimId, setTrimId] = useState(null); // the clip open in the trim panel
  const api = editApi(ws, brand, ad);
  // ⌘Z / ⌘⇧Z undo and redo trims: each puts its document back as it was, unless it changed since.
  const recordUndo = useUndo(({ file, before, after }, redo) => api({ restore: { file, text: redo ? after : before, expect: redo ? before : after } }).catch((e) => setError(e.message)));
  const rootRef = useRef(null), tlRef = useRef(null);
  useEffect(() => { // the fixed timeline's height sizes the preview above it
    const el = tlRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => rootRef.current?.style.setProperty('--tl-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!doc]); // eslint-disable-line react-hooks/exhaustive-deps -- tlRef exists once the doc has loaded
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
  const url = useCallback((src) => fileUrl(ws, brand, brandPath(ad, src), versions.current[src]), [ws, brand, ad]);
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
      while (L.pending != null) { const x = L.pending; L.pending = null; await eng.render(x, L.stop ? 1 : 0); }
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
      eng = await createEngine({ canvas: canvasRef.current, url });
      if (dead) { eng.close(); return; }
      engineRef.current = eng;
      setEngine(eng);
    }).catch((e) => setError(String(e.message || e)));
    return () => { dead = true; pause(); eng?.close(); engineRef.current = null; };
  }, [url, pause]);
  useEffect(() => () => { const a = live.current.actx; live.current.actx = null; a?.close().catch(() => {}); }, []);

  // (Re)load the document whenever its file changes on disk.
  useEffect(() => {
    if (!engine) return undefined;
    let dead = false;
    (async () => {
      // A file caught mid-write reads as broken JSON: read it again before calling it an error.
      const get = (p) => fetch(fileUrl(ws, brand, p, plan.v), { cache: 'no-store' }).then((r) => r.json());
      const read = async () => { const own = await get(plan.p); return own.base ? compose(own, await get(plan.p.replace(/[^/]+$/, own.base))) : own; };
      const raw = await read().catch(() => new Promise((r) => setTimeout(r, 250)).then(read));
      const wasPlaying = !!live.current.stop;
      if (wasPlaying) pause();
      fitCanvas(raw.size || [1080, 1920]);
      const shown = { ...raw, tracks: (raw.tracks || []).map((tr) => (off.has(tr.name) ? { ...tr, hidden: true } : tr)) };
      const d = await engine.load(shown, raw.fx ? `${url(raw.fx)}&v=${Date.now()}` : null); // fx.js re-imported fresh
      if (dead) return;
      setDoc(d);
      setError('');
      await draw(Math.min(live.current.t, d.duration - 1 / d.fps));
      if (wasPlaying) play(live.current.until);
    })().catch((e) => { if (!dead) setError(`${plan.file}: ${e.message || e}`); });
    return () => { dead = true; };
  }, [engine, ws, brand, plan.p, plan.v, plan.file, off, url, draw, pause, play, fitCanvas]);

  // Space plays, arrows step a frame (with Shift, a second); N writes a comment, ↑ / ↓ move between comments, A approves
  // the picked one and W watches its change.
  useEffect(() => {
    const onKey = (e) => {
      if (isTyping(e) || !doc || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase(), n = pending.find((x) => x.id === focus);
      if (k === 'n') { e.preventDefault(); pause(); addRef.current?.focus(); }
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
  const onPointerDown = (e) => {
    if (!doc || e.button !== 0) return;
    pause();
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = at(e);
    setFocus(null);
    setDraft({ t: live.current.t, from: [x, y], box: [x, y, 0, 0], text: '' });
  };
  const onPointerMove = (e) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const [x1, y1] = at(e);
    setDraft((d) => d && { ...d, box: [Math.min(d.from[0], x1), Math.min(d.from[1], y1), Math.abs(x1 - d.from[0]), Math.abs(y1 - d.from[1])] });
  };
  // The click itself takes focus off the new field.
  const onPointerUp = () => requestAnimationFrame(() => composeRef.current?.focus());

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
  const pick = (n) => { setFocus(n.id); seek(n.t); };
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
  const shown = comments.filter((n) => n.box && (n.id === focus || n.id === lit || (!playing && n.status !== 'done' && n.status !== 'approved' && Math.abs(n.t - t) < 0.2)));
  const exp = edit.export?.plan === plan.file ? edit.export : null;
  const W = doc?.W || 1080, H = doc?.H || 1920;
  const [zone, nextZone] = useZones(W / H);
  const trimClip = trimId && doc?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === trimId);
  const applyTrim = (cut) => api({ trim: { plan: plan.file, id: trimId, ...cut } })
    .then((r) => { if (r.undo) recordUndo(r.undo); setTrimId(null); }).catch((e) => setError(e.message));
  const sendAdd = () => {
    if (add.trim()) api({ comment: { t: range ? range[0] : live.current.t, ...(range && { to: range[1] }), box: null, text: add.trim(), plan: plan.file } }).catch((er) => setError(er.message));
    setAdd('');
    setRange(null);
  };
  const pickRange = useCallback((r, done) => { setRange(r); if (done) addRef.current?.focus(); }, []);
  const muteTrack = useCallback((track, mute) => editApi(ws, brand, ad)({ mute: { plan: plan.file, track, mute } })
    .then((r) => recordUndo(r.undo)).catch((e) => setError(e.message)), [ws, brand, ad, plan.file, recordUndo]);

  return (
    <div className="ed" ref={rootRef}>
      <div className="ed__main">
        <div className="ed__stage" ref={stageRef} style={{ aspectRatio: `${W} / ${H}` }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} role="img" aria-label="Preview: click or drag to leave a comment">
          <canvas ref={canvasRef} />
          {zone && <div className="ed__zones"><SafeZones mode={zone} ratio={W / H} /></div>}
          {shown.map((n) => (
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
          {nextZone && <ZoneButton mode={zone} onClick={nextZone} className={zone ? 'btn' : 'btn btn--icon'} />}
          <Export ws={ws} brand={brand} ad={ad} plan={plan} exp={exp} api={api} onError={setError} />
        </div>
        {error && <p className="ed__error">{error}</p>}
        <Comments
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
        />
      </aside>
      {doc && (
        <div className="ed__tl" ref={tlRef} data-drag={tlDrag ? (tlDrag.snap ? 'snap' : 'drag') : undefined} style={tlDrag ? { height: tlDrag.h } : undefined}>
        <div className="ed__edge" role="separator" aria-orientation="horizontal" aria-label="Drag or double-click to show or hide the tracks" onPointerDown={edgeDown} onPointerMove={edgeMove} onPointerUp={edgeUp} onPointerCancel={edgeUp} onDoubleClick={edgeToggle} />
        <Timeline doc={doc} t={t} comments={pending} nums={nums} url={url} lib={lib} lit={lit} range={range} onRange={pickRange} onHover={setLit} onSeek={seek} onPick={pick} off={off} onToggle={toggleTrack} onMute={muteTrack} onClip={(id) => { pause(); setTrimId(id); }} simple={simple && !tlDrag}>
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
