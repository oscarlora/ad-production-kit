'use client';
// The picked clip's (or caption line's) settings, one divided section each: its text, timing, place on the frame,
// a text's look (font, color, and its stroke, background and shadow), media (how it fills its box, speed, the part
// of its source it plays: onSource opens the trim panel), volume, and the optional ones (fades, how it comes in and
// out, its transition), closed until their + adds them; their − takes them away. A number's field drags
// sideways (Shift: ten times the step), showing live and saving once on release; typed, it saves when
// the typing pauses or the field is left. A keyframed value is the agent's, shown as "keyed".
// edit(fn, live): fn(doc, ref, shift) changes the clip's document (engine/ops.js): ref is the clip, or the line when
// one is picked, shift how far the document's clock runs ahead of the timeline's; live only previews.
// With nothing picked, Settings shows the edit's own: its frame size, background, frame rate and loudness.
import { useEffect, useRef, useState } from 'react';
import { endOf, keyed } from '../../engine/doc.js';
import * as ops from '../../engine/ops.js';
import { getJson } from '../../lib/client/api.js';
import { clock } from '../../lib/client/format.js';
import { IcCopy, IcMute, IcSound, IcTrash } from '../icons.js';

const TRANSITIONS = ['cut', 'fade', 'dip', 'slide', 'push', 'wipe', 'zoom', 'blur', 'flip'];
const ANIMS = ['', 'fade', 'pop', 'bounce', 'zoom', 'blur', 'slide-up', 'slide-down', 'slide-left', 'slide-right'];
const FITS = [['contain', 'Fit'], ['cover', 'Fill'], ['fill', 'Stretch']];
const r2 = (x) => Math.round(x * 100) / 100;

// Keeps what is being typed and saves it 400 ms after the last key, or when the field is left.
function useTyped(value, onSave) {
  const [text, setText] = useState(String(value ?? '')), timer = useRef(0), el = useRef(null), last = useRef(text), held = useRef(false);
  useEffect(() => { if (document.activeElement !== el.current && !held.current) { last.current = String(value ?? ''); setText(last.current); } }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const save = (v) => { clearTimeout(timer.current); if (v !== last.current) { last.current = v; onSave(v); } };
  return {
    text, setText, held, last, save,
    props: {
      ref: el, value: text, onBlur: () => save(text),
      onChange: (e) => { const v = e.target.value; setText(v); clearTimeout(timer.current); timer.current = setTimeout(() => save(v), 400); },
    },
  };
}

// A number with its label and unit in one field. v is shown times `mul` (a percent), dflt when unset.
function Num({ k, unit, v, dflt, mul = 1, step = 1, min = -Infinity, max = Infinity, onSet }) {
  const fit = (n) => Math.min(max, Math.max(min, n));
  const t = useTyped(keyed(v) ? 'keyed' : r2((v ?? dflt) * mul), (s) => { const n = parseFloat(s); if (Number.isFinite(n)) onSet(fit(n) / mul); });
  // Anywhere on the field: a drag changes the value, a click goes on to type it (as does a field already being typed in).
  const scrub = (e) => {
    const input = e.currentTarget.querySelector('input');
    if (keyed(v) || e.button !== 0 || document.activeElement === input) return;
    e.preventDefault(); // no focus or text selection yet
    const x0 = e.clientX, v0 = parseFloat(t.text) || 0;
    let n = v0, shown = false, moved = false;
    const onMove = (ev) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = t.held.current = true;
      const to = fit(r2(v0 + Math.round((ev.clientX - x0) / 3) * step * (ev.shiftKey ? 10 : 1)));
      if (to === n) return;
      n = to;
      shown = true;
      t.setText(String(n));
      onSet(n / mul, true);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      t.held.current = false;
      if (shown) { t.last.current = String(n); onSet(n / mul); }
      if (!moved) { input.focus(); input.select(); }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return (
    <label className="num" data-off={keyed(v) || undefined} onMouseDown={scrub} title={keyed(v) ? undefined : 'Drag to change, click to type'}>
      <span className="num__k">{k}</span>
      <input {...t.props} inputMode="decimal" disabled={keyed(v)} onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') e.currentTarget.blur(); }} />
      {unit && <span className="num__u">{unit}</span>}
    </label>
  );
}

function Text({ value, onSave }) {
  const t = useTyped(value, onSave);
  return <textarea className="field insp__text" rows={2} {...t.props} onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); e.currentTarget.blur(); } }} />;
}

const Pick = ({ k, value, options, none = 'none', onSave }) => (
  <label className="num">
    <span className="num__k">{k}</span>
    <select value={value} onChange={(e) => onSave(e.target.value)}>{options.map((o) => <option key={o} value={o}>{o || none}</option>)}</select>
  </label>
);

// A color: its swatch opens the picker, its hex types.
function Color({ k, value, dflt, onSave }) {
  const t = useTyped(typeof (value ?? dflt) === 'string' ? value ?? dflt : 'keyed', (v) => { if (/^#[0-9a-f]{6}$/i.test(v)) onSave(v); });
  return (
    <label className="num" data-off={t.text === 'keyed' || undefined}>
      <span className="num__k">{k}</span>
      <input type="color" className="num__swatch" value={/^#[0-9a-f]{6}$/i.test(t.text) ? t.text : '#000000'} onChange={t.props.onChange} />
      <input {...t.props} spellCheck={false} onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') e.currentTarget.blur(); }} />
    </label>
  );
}

// A font: type to search Google Fonts' families (and the edit's own, `own`); it saves once the name is one of them.
let families = null; // read once for the whole app
function Font({ value, own, onSave }) {
  const [list, setList] = useState([]);
  useEffect(() => { (families ||= getJson('/api/fonts').then((r) => r.fonts).catch(() => { families = null; return []; })).then(setList); }, []);
  const all = [...own, ...list];
  const known = (v) => all.find((x) => x.toLowerCase() === v.trim().toLowerCase());
  const t = useTyped(value, (v) => { const f = known(v); if (f) onSave(f); });
  return (
    <label className="num">
      <span className="num__k">Font</span>
      <input {...t.props} list="insp-fonts" spellCheck={false} placeholder="Search fonts" onFocus={(e) => e.currentTarget.select()} onBlur={() => { t.props.onBlur(); t.last.current = known(t.text) || value; t.setText(t.last.current); }} onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') e.currentTarget.blur(); }} />
      <datalist id="insp-fonts">{all.map((f) => <option key={f} value={f} />)}</datalist>
    </label>
  );
}

// A section: its title, then its settings. `set` (given for the optional ones): whether it has a value; unset, it
// stays closed until its + is pressed, and its − takes the value away again (onClear).
function Sec({ title, set, onClear, children }) {
  const [open, setOpen] = useState(set ?? true);
  return (
    <section className="insp__sec" data-closed={!open || undefined}>
      {set === undefined ? <h3>{title}</h3> : <button type="button" className="insp__more" aria-expanded={open} title={open ? `Remove ${title.toLowerCase()}` : `Add ${title.toLowerCase()}`} onClick={() => { if (open && set) onClear(); setOpen(!open); }}><h3>{title}</h3><span>{open ? '−' : '+'}</span></button>}
      {open && <div className="insp__grid">{children}</div>}
    </section>
  );
}

export default function Inspector({ clip: c, line, name, W, H, len, fonts, edit, onSource, onDuplicate, onDelete }) {
  const b = line || c, media = c.type === 'video' || c.type === 'audio', visual = c.type !== 'audio' && c.type !== 'custom';
  const set = (path, onClip) => (v, live) => edit((d, ref) => ops.set(d, onClip ? ref.slice(0, 2) : ref, path, v), live);
  const st = c.style || {}, sty = (key) => set(`style.${key}`, true); // a text's or the captions' look
  const anim = (key, k) => <Pick k={k} value={c[key]?.type ?? c[key] ?? ''} options={ANIMS} onSave={(v) => set(key, true)(v ? (c[key]?.type ? { ...c[key], type: v } : v) : null)} />;
  const span = (d, ref) => { const x = ops.get(d, ref); return [x.at ?? 0, ref.length === 3 ? x.end : endOf(x)]; }; // in its document
  return (
    <div className="insp">
      <div className="insp__head">
        <span className="insp__name">{name}</span>
        {onDuplicate && <button type="button" className="btn btn--mini btn--icon" aria-label="Duplicate" title="Duplicate (⌘D)" onClick={onDuplicate}><IcCopy /></button>}
        <button type="button" className="btn btn--mini btn--icon" aria-label="Delete" title="Delete (⌫, with Shift its time too)" onClick={(e) => onDelete(e.shiftKey)}><IcTrash /></button>
      </div>
      {(c.type === 'text' || line) && (
        <Sec title="Text">
          <Text value={b.text} onSave={(v) => edit((d, ref) => (line ? ops.lineText(d, ref, v) : ops.set(d, ref, 'text', v)))} />
        </Sec>
      )}
      <Sec title="Timing">
        <Num k="Start" unit="s" v={b.at} step={0.1} min={0} onSet={(v, live) => edit((d, ref, shift) => ops.retime(d, ref, 'move', v + shift - span(d, ref)[0]), live)} />
        <Num k="Length" unit="s" v={b.end - b.at} step={0.1} min={ops.MIN} onSet={(v, live) => edit((d, ref) => { const [at, end] = span(d, ref); ops.retime(d, ref, 'end', v - (end - at), len); }, live)} />
      </Sec>
      {visual && (
        <Sec title={line ? 'Layout (all captions)' : 'Layout'}>
          <Num k="X" unit="px" v={c.x} dflt={W / 2} onSet={set('x', true)} />
          <Num k="Y" unit="px" v={c.y} dflt={H / 2} onSet={set('y', true)} />
          <Num k="Scale" unit="%" v={c.scale} dflt={1} mul={100} min={1} onSet={set('scale', true)} />
          <Num k="Angle" unit="°" v={c.rotate} dflt={0} onSet={set('rotate', true)} />
          <Num k="Opacity" unit="%" v={c.opacity} dflt={1} mul={100} min={0} max={100} onSet={set('opacity', true)} />
        </Sec>
      )}
      {(c.type === 'text' || c.type === 'captions') && (
        <>
          <Sec title={line ? 'Style (all captions)' : 'Style'}>
            <Font value={st.font || 'Inter'} own={fonts} onSave={sty('font')} />
            <Pick k="Weight" value={st.weight || 400} options={[300, 400, 500, 600, 700, 800, 900]} onSave={(v) => sty('weight')(+v)} />
            <Num k="Size" unit="px" v={st.size} dflt={64} step={2} min={8} onSet={sty('size')} />
            <Num k="Line" unit="×" v={st.lineHeight} dflt={1.15} step={0.05} min={0.5} max={3} onSet={sty('lineHeight')} />
            <Color k="Color" value={st.color} dflt="#FFFFFF" onSave={sty('color')} />
            <Color k="Accent" value={st.accent} dflt="#FFD400" onSave={sty('accent')} />
            <Pick k="Case" value={st.case || ''} options={['', 'upper', 'lower']} none="as typed" onSave={(v) => sty('case')(v || null)} />
            <Pick k="Slant" value={st.italic ? 'italic' : ''} options={['', 'italic']} none="upright" onSave={(v) => sty('italic')(v ? true : null)} />
            <Num k="Spacing" unit="px" v={st.letterSpacing} dflt={0} step={0.5} onSet={sty('letterSpacing')} />
            <Num k="Width" unit="px" v={st.maxWidth} dflt={960} step={10} min={50} onSet={sty('maxWidth')} />
          </Sec>
          <Sec title="Stroke" set={!!(st.stroke && st.strokeWidth)} onClear={() => edit((d, ref) => { ops.set(d, ref.slice(0, 2), 'style.stroke', null); ops.set(d, ref.slice(0, 2), 'style.strokeWidth', null); })}>
            <Color k="Color" value={st.stroke} dflt="#000000" onSave={(v) => edit((d, ref) => { ops.set(d, ref.slice(0, 2), 'style.stroke', v); if (!st.strokeWidth) ops.set(d, ref.slice(0, 2), 'style.strokeWidth', 6); })} />
            <Num k="Width" unit="px" v={st.strokeWidth} dflt={0} min={0} onSet={(v, live) => edit((d, ref) => { ops.set(d, ref.slice(0, 2), 'style.strokeWidth', v); if (!st.stroke) ops.set(d, ref.slice(0, 2), 'style.stroke', '#000000'); }, live)} />
          </Sec>
          <Sec title="Background" set={!!st.background} onClear={() => sty('background')(null)}>
            <Color k="Color" value={st.background?.color} dflt="#000000" onSave={sty('background.color')} />
            <Num k="Opacity" unit="%" v={st.background?.opacity} dflt={1} mul={100} min={0} max={100} onSet={sty('background.opacity')} />
            <Num k="Pad X" unit="px" v={st.background?.padX} dflt={28} min={0} onSet={sty('background.padX')} />
            <Num k="Pad Y" unit="px" v={st.background?.padY} dflt={16} min={0} onSet={sty('background.padY')} />
            <Num k="Radius" unit="px" v={st.background?.radius} dflt={12} min={0} onSet={sty('background.radius')} />
          </Sec>
          <Sec title="Shadow" set={!!st.shadow} onClear={() => sty('shadow')(null)}>
            <Color k="Color" value={st.shadow?.color} dflt="#000000" onSave={sty('shadow.color')} />
            <Num k="Opacity" unit="%" v={st.shadow?.opacity} dflt={0.5} mul={100} min={0} max={100} onSet={sty('shadow.opacity')} />
            <Num k="Blur" unit="px" v={st.shadow?.blur} dflt={0} min={0} onSet={sty('shadow.blur')} />
            <Num k="X" unit="px" v={st.shadow?.x} dflt={0} onSet={sty('shadow.x')} />
            <Num k="Y" unit="px" v={st.shadow?.y} dflt={3} onSet={sty('shadow.y')} />
          </Sec>
        </>
      )}
      {(media || c.type === 'image') && (
        <Sec title="Media">
          {c.type !== 'audio' && (
            <div className="chips insp__wide">
              {FITS.map(([fit, label]) => <button key={fit} type="button" className="chip" aria-pressed={(c.fit || 'cover') === fit} onClick={() => set('fit')(fit === 'cover' ? null : fit)}>{label}</button>)}
            </div>
          )}
          {media && !(c.rate < 0.1) && <Num k="Speed" unit="×" v={c.rate} step={0.05} min={0.25} max={4} onSet={(v, live) => edit((d, ref) => ops.speed(d, ref, v), live)} />}
          {media && <button type="button" className="btn btn--mini insp__src" title="Pick the part of its source it plays (Enter, or a double click on the clip)" onClick={onSource}>{clock(c.in, true)}–{clock(c.in + (c.end - c.at) * c.rate, true)}</button>}
        </Sec>
      )}
      {media && (
        <Sec title="Volume">
          {c.type === 'video' && <button type="button" className="btn btn--mini btn--icon" aria-pressed={!!c.mute} aria-label={c.mute ? 'Unmute' : 'Mute'} title={c.mute ? 'Unmute' : 'Mute'} onClick={() => set('mute')(c.mute ? null : true)}>{c.mute ? <IcMute /> : <IcSound />}</button>}
          {!c.mute && <Num k="Level" unit="dB" v={c.volume} dflt={0} min={-60} max={24} onSet={set('volume')} />}
        </Sec>
      )}
      {c.type === 'audio' && (
        <Sec title="Fade" set={!!(c.fadeIn || c.fadeOut)} onClear={() => edit((d, ref) => { ops.set(d, ref, 'fadeIn', null); ops.set(d, ref, 'fadeOut', null); })}>
          <Num k="In" unit="s" v={c.fadeIn} dflt={0} step={0.1} min={0} onSet={set('fadeIn')} />
          <Num k="Out" unit="s" v={c.fadeOut} dflt={0} step={0.1} min={0} onSet={set('fadeOut')} />
        </Sec>
      )}
      {visual && !line && c.type !== 'captions' && (
        <Sec title="Animation" set={!!(c.enter || c.exit)} onClear={() => edit((d, ref) => { ops.set(d, ref, 'enter', null); ops.set(d, ref, 'exit', null); })}>
          {anim('enter', 'In')}
          {anim('exit', 'Out')}
        </Sec>
      )}
      {c.type === 'video' && c.prev && (
        <Sec title="Transition" set={!!c.transition} onClear={() => set('transition')(null)}>
          <Pick k="Type" value={c.transition?.type || 'cut'} options={TRANSITIONS} onSave={(v) => set('transition')(v === 'cut' ? null : { ...c.transition, type: v })} />
          {c.transition && <Num k="Length" unit="s" v={c.transition.dur} dflt={0.4} step={0.05} min={0.05} max={3} onSet={set('transition.dur')} />}
        </Sec>
      )}
    </div>
  );
}

const SIZES = [['9:16', 1080, 1920], ['4:5', 1080, 1350], ['1:1', 1080, 1080], ['16:9', 1920, 1080]];

// With nothing picked: the edit's own settings. set(patch): its new values (size reframes every clip).
export function Settings({ doc, set }) {
  const num = (key) => (v, live) => !live && set({ [key]: v });
  return (
    <div className="insp">
      <div className="insp__head"><span className="insp__name">Video</span></div>
      <Sec title="Frame">
        <div className="chips insp__wide">
          {SIZES.map(([name, w, h]) => <button key={name} type="button" className="chip" aria-pressed={doc.W === w && doc.H === h} onClick={() => set({ size: [w, h] })}>{name}</button>)}
        </div>
        <Num k="W" unit="px" v={doc.W} step={10} min={16} onSet={(v, live) => !live && set({ size: [Math.round(v), doc.H] })} />
        <Num k="H" unit="px" v={doc.H} step={10} min={16} onSet={(v, live) => !live && set({ size: [doc.W, Math.round(v)] })} />
        <Color k="Background" value={doc.background} onSave={(v) => set({ background: v })} />
        <Num k="Rate" unit="fps" v={doc.fps} min={1} max={120} onSet={num('fps')} />
      </Sec>
      <Sec title="Sound">
        <Num k="Loudness" unit="LUFS" v={doc.loudness} dflt={-14} min={-40} max={0} onSet={num('loudness')} />
      </Sec>
    </div>
  );
}
