'use client';
// The picked clip's (or caption line's) settings, one divided section each: its text, timing, place on the frame,
// a text's look (templates to pick from, then font, color, and its stroke, background and shadow), media (how it fills its box, speed, the part
// of its source it plays: onSource opens the trim panel), volume, and the optional ones (fades, how it comes in and
// out, its transition), closed until their + adds them; their − takes them away. A number's field drags
// sideways (Shift: ten times the step), showing live and saving once on release; typed, it saves when
// the typing pauses or the field is left. A value off its default lights its name up, and a double click on the
// name resets it. A keyframed value is the agent's, shown as "keyed".
// edit(fn, live): fn(doc, ref, shift) changes the clip's document (engine/ops.js): ref is the clip, or the line when
// one is picked, shift how far the document's clock runs ahead of the timeline's; live only previews. With several
// blocks picked (count), it runs on each.
// With nothing picked, Settings shows the edit's own: its frame size, background, frame rate and loudness.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { clipType, endOf, keyed } from '../../engine/doc.js';
import * as ops from '../../engine/ops.js';
import { getJson } from '../../lib/client/api.js';
import { clock } from '../../lib/client/format.js';
import { IcCopy, IcMute, IcSound, IcTrash } from '../icons.js';

const TRANSITIONS = ['cut', 'fade', 'dip', 'slide', 'push', 'wipe', 'zoom', 'blur', 'flip'];
const ANIMS = ['', 'fade', 'pop', 'bounce', 'zoom', 'blur', 'slide-up', 'slide-down', 'slide-left', 'slide-right'];
const FITS = [['contain', 'Fit'], ['cover', 'Fill'], ['fill', 'Stretch']];
const r2 = (x) => Math.round(x * 100) / 100;
// Ready-made looks for a text or the captions, after the ones the brand saved.
const SOFT = { color: '#000000', opacity: 0.5, blur: 8, y: 2 };
const LOOKS = [
  { font: 'Inter', weight: 600, color: '#FFFFFF', shadow: SOFT },
  { font: 'Montserrat', weight: 800, case: 'upper', color: '#FFFFFF', stroke: '#000000', strokeWidth: 8 },
  { font: 'Inter', weight: 700, color: '#FFFFFF', background: { color: '#000000', padX: 28, padY: 16, radius: 12 } },
  { font: 'Inter', weight: 700, color: '#111111', background: { color: '#FFFFFF', padX: 28, padY: 16, radius: 12 } },
  { font: 'Anton', weight: 400, case: 'upper', color: '#FFE500', stroke: '#000000', strokeWidth: 10 },
  { font: 'Playfair Display', weight: 600, italic: true, color: '#FFFFFF', shadow: SOFT },
];
const LOOK_FONTS = 'https://fonts.googleapis.com/css2?family=Anton&family=Montserrat:wght@800&family=Playfair+Display:ital,wght@1,600&display=swap';
// A look drawn small in CSS, close to how the engine draws it.
const lookCss = (k) => ({
  fontFamily: `"${k.font || 'Inter'}", sans-serif`, fontWeight: k.weight || 400, fontStyle: k.italic ? 'italic' : undefined,
  color: typeof k.color === 'string' ? k.color : '#FFFFFF', textTransform: k.case === 'upper' ? 'uppercase' : k.case === 'lower' ? 'lowercase' : undefined,
  WebkitTextStroke: k.stroke && k.strokeWidth ? `${Math.min(3, k.strokeWidth / 4)}px ${k.stroke}` : undefined, paintOrder: 'stroke fill',
  background: k.background ? k.background.color || '#000000' : undefined, textShadow: k.shadow ? `0 1px 3px ${k.shadow.color || '#000000'}` : undefined,
});


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
  const changed = dflt !== undefined && v != null && !keyed(v) && v !== dflt; // off its default: its name lights up, and a double click on it resets it
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
    <label className="num" data-off={keyed(v) || undefined} data-set={changed || undefined} onMouseDown={scrub} title={keyed(v) ? undefined : `Drag to change, click to type${changed ? ', double-click its name to reset' : ''}`}>
      <span className="num__k" onDoubleClick={changed ? () => { t.held.current = false; onSet(null); document.activeElement?.blur(); } : undefined}>{k}</span>
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

// The brand's colors (hex), which every color's picker offers first. The editor provides them.
export const BrandColors = createContext([]);

// A color: its swatch opens the brand's colors to pick from, with Custom for any other (the browser's picker, which
// the swatch opens directly when the brand has none); its hex types. A double click on its name resets it.
function Color({ k, value, dflt, onSave }) {
  const brand = useContext(BrandColors), [open, setOpen] = useState(false), box = useRef(null);
  const t = useTyped(typeof (value ?? dflt) === 'string' ? value ?? dflt : 'keyed', (v) => { if (/^#[0-9a-f]{6}$/i.test(v)) onSave(v); });
  const hex = /^#[0-9a-f]{6}$/i.test(t.text) ? t.text : '#000000';
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const native = <input type="color" className="num__swatch" value={hex} onChange={t.props.onChange} />;
  return (
    <label className="num" ref={box} data-off={t.text === 'keyed' || undefined} data-set={(dflt && typeof value === 'string' && value.toLowerCase() !== dflt.toLowerCase()) || undefined}>
      <span className="num__k" title={dflt ? 'Double-click to reset' : undefined} onDoubleClick={dflt ? () => { onSave(null); document.activeElement?.blur(); } : undefined}>{k}</span>
      {brand.length ? <button type="button" className="num__swatch" style={{ background: hex }} aria-label={`Pick ${k.toLowerCase()}`} aria-expanded={open} onClick={(e) => { e.preventDefault(); setOpen(!open); }} /> : native}
      <input {...t.props} spellCheck={false} onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') e.currentTarget.blur(); }} />
      {open && (
        <span className="num__colors" onClick={(e) => { if (e.target.type !== 'color') e.preventDefault(); }}>
          {brand.map((x) => <button key={x} type="button" className="num__swatch" style={{ background: x }} title={x} aria-label={x} aria-pressed={x.toLowerCase() === hex.toLowerCase()} onClick={() => { t.setText(x); t.save(x); setOpen(false); }} />)}
          <span className="num__custom">{native}Custom</span>
        </span>
      )}
    </label>
  );
}

// A font: a field showing the font, opening a list under it: a search box, then the edit's and the brand's own fonts
// (`own`: family -> file, shown through `url`; a brand font is marked with its use, `roles`), then Google Fonts' families, most used first, each name in its own font.
// Arrows or the moving pointer preview a font live on the frame (a list opening under a still pointer previews nothing); Enter or a click keeps it, Esc or a click outside puts the
// first one back.
let families = null; // Google's, read once for the whole app
const shown = new Set(); // families whose name has been drawn in their own font
function showFont(fam, file) {
  if (shown.has(fam)) return;
  shown.add(fam);
  if (file) { new FontFace(fam, `url("${file}")`).load().then((f) => document.fonts.add(f), () => {}); return; }
  const q = encodeURIComponent(fam).replace(/%20/g, '+');
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?family=${q}&text=${encodeURIComponent(fam)}&display=swap` }));
}
const MAX_SHOWN = 80; // Google families listed at once; typing finds the rest
function Font({ value, own, roles = {}, url, onSave }) {
  const [list, setList] = useState([]), [open, setOpen] = useState(null), [q, setQ] = useState(''), [hi, setHi] = useState(0); // open: where the list floats
  const box = useRef(null), from = useRef(value), listEl = useRef(null);
  useEffect(() => { (families ||= getJson('/api/fonts').then((r) => r.fonts).catch(() => { families = null; return []; })).then(setList); }, []);
  const mine = Object.keys(own).sort((a, b) => !roles[a] - !roles[b]), needle = q.trim().toLowerCase();
  const hit = (f) => !needle || `${f} ${roles[f] || ''}`.toLowerCase().includes(needle); // a brand font by its use too ("headline")
  const google = list.filter((f) => !own[f] && hit(f)).slice(0, MAX_SHOWN);
  if (!own[value] && !google.includes(value) && list.includes(value) && hit(value)) google.unshift(value); // the current font always listed
  const groups = [['Brand fonts', mine.filter(hit)], ['Google Fonts', google]].filter(([, fs]) => fs.length);
  const opts = groups.flatMap(([, fs]) => fs);
  const shut = () => { setOpen(null); setQ(''); if (value !== from.current) onSave(from.current, false); }; // closed without a pick: the first font back
  const preview = (f) => { if (f && f !== value) onSave(f, true); };
  const keep = (f) => { if (f && (f !== from.current || value !== from.current)) onSave(f, false); setOpen(null); setQ(''); };
  // Floats over the panel and the timeline: under the field, or over it when there's more room there.
  const show = () => {
    const r = box.current.getBoundingClientRect(), floor = document.querySelector('.ed__tl')?.getBoundingClientRect().top ?? innerHeight;
    const below = floor - r.bottom - 12, above = r.top - 60, up = below < 280 && above > below;
    from.current = value;
    const width = Math.max(r.width, 320);
    setOpen({ left: Math.max(8, Math.min(r.left, innerWidth - width - 8)), width, maxHeight: Math.min(352, up ? above : below), ...(up ? { bottom: innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
    setHi(Math.max(0, opts.indexOf(value)));
  };
  useEffect(() => { if (open) for (const f of opts) showFont(f, own[f] && url(own[f])); }, [open, q, list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // the highlighted one in view; a click outside closes it, putting the first font back
    if (!open) return undefined;
    listEl.current?.querySelector('[data-hi]')?.scrollIntoView({ block: 'nearest' });
    const out = (e) => { if (!box.current?.contains(e.target)) shut(); };
    const away = (e) => { if (!box.current?.contains(e.target)) shut(); }; // the panel scrolled: the list would float off its field
    document.addEventListener('pointerdown', out);
    document.addEventListener('scroll', away, true);
    return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('scroll', away, true); };
  });
  const key = (e) => {
    const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (move) { e.preventDefault(); const n = Math.min(opts.length - 1, Math.max(0, hi + move)); setHi(n); preview(opts[n]); }
    else if (e.key === 'Enter') { e.preventDefault(); keep(opts[hi]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); shut(); }
  };
  let i = -1;
  return (
    <div className="font" ref={box}>
      <button type="button" className="num font__field" aria-haspopup="listbox" aria-expanded={!!open} onClick={() => (open ? shut() : show())}>
        <span className="num__k">Font</span>
        <span className="font__value" style={{ fontFamily: `"${value}", var(--font-sans)` }}>{value}</span>
        <svg className="font__caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="font__pop" style={open}>
          <input className="font__search" autoFocus value={q} placeholder="Search fonts" spellCheck={false} aria-label="Search fonts"
            onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={key} />
          <div className="font__list" role="listbox" ref={listEl} aria-label="Fonts">
            {groups.map(([name, fs]) => (
              <div key={name} role="group" aria-label={name}>
                <div className="font__group">{name}</div>
                {fs.map((f) => { i += 1; const n = i; return (
                  <div key={f} role="option" aria-selected={f === value} data-hi={n === hi ? '' : undefined} className="font__opt"
                    style={{ fontFamily: `"${f}", var(--font-sans)` }}
                    onPointerMove={(e) => { if (!e.movementX && !e.movementY) return; if (n !== hi) setHi(n); preview(f); }} onPointerDown={(e) => e.preventDefault()} onClick={() => keep(f)}>
                    <span>{f}</span>
                    {roles[f] && <span className="font__role">{roles[f]}</span>}
                    {f === from.current && <svg className="font__tick" viewBox="0 0 12 10" aria-hidden="true"><path d="M1 5l3.5 3.5L11 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </div>
                ); })}
              </div>
            ))}
            {!opts.length && <div className="font__none">No font called “{q.trim()}”</div>}
          </div>
        </div>
      )}
    </div>
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

export default function Inspector({ clip: c, line, name, count, looks, onLooks, W, H, len, fonts, fontUrl, fontRoles, edit, onSource, onDuplicate, onDelete }) {
  const b = line || c, media = c.type === 'video' || c.type === 'audio', visual = c.type !== 'audio' && c.type !== 'custom';
  const set = (path, onClip) => (v, live) => edit((d, ref) => ops.set(d, onClip ? ref.slice(0, 2) : ref, path, v), live);
  // A text's or the captions' look; with several picked, only the texts among them take it.
  const isText = (d, ref) => ['text', 'captions'].includes(clipType(ops.get(d, ref.slice(0, 2))));
  const st = c.style || {}, sty = (key) => (v, live) => edit((d, ref) => { if (isText(d, ref)) ops.set(d, ref.slice(0, 2), `style.${key}`, v); }, live);
  // A font from a file (the edit's own, or the brand's) is written into the doc's fonts too, so it loads wherever it plays.
  const font = (v, live) => edit((d, ref) => { if (!isText(d, ref)) return; ops.set(d, ref.slice(0, 2), 'style.font', v); if (fonts[v] && !d.fonts?.[v]) d.fonts = { ...d.fonts, [v]: fonts[v] }; }, live);
  // Its own look, and whether that is a new one: not among the saved styles or the templates, so it can be saved.
  const own = Object.fromEntries(ops.LOOK.filter((k) => st[k] != null).map((k) => [k, st[k]]));
  const key = (k) => JSON.stringify(ops.LOOK.map((x) => k[x] ?? null));
  const fresh = Object.keys(own).length > 0 && ![...looks, ...LOOKS].some((k) => key(k) === key(own));
  useEffect(() => { // the templates' fonts, for their previews
    if (document.querySelector(`link[href="${LOOK_FONTS}"]`)) return;
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: LOOK_FONTS }));
  }, []);
  const anim = (key, k) => <Pick k={k} value={c[key]?.type ?? c[key] ?? ''} options={ANIMS} onSave={(v) => set(key, true)(v ? (c[key]?.type ? { ...c[key], type: v } : v) : null)} />;
  const span = (d, ref) => { const x = ops.get(d, ref); return [x.at ?? 0, ref.length === 3 ? x.end : endOf(x)]; }; // in its document
  return (
    <div className="insp">
      <div className="insp__head">
        <span className="insp__name">{count > 1 ? `${count} picked` : name}</span>
        {onDuplicate && <button type="button" className="btn btn--mini btn--icon" aria-label="Duplicate" title="Duplicate (⌘D)" onClick={onDuplicate}><IcCopy /></button>}
        <button type="button" className="btn btn--mini btn--icon" aria-label="Delete" title="Delete (⌫, with Shift its time too)" onClick={(e) => onDelete(e.shiftKey)}><IcTrash /></button>
      </div>
      {(c.type === 'text' || line) && (
        <Sec title="Text">
          <Text value={b.text} onSave={(v) => edit((d, ref) => (ref.length === 3 ? ops.lineText(d, ref, v) : ops.set(d, ref, 'text', v)))} />
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
            <div className="insp__looks insp__wide" role="group" aria-label="Style templates">
              {fresh && <button type="button" className="insp__look insp__look--save" title="Save this style as a template" onClick={() => onLooks([own, ...looks])}><span style={lookCss(own)}>Aa</span><b>Save</b></button>}
              {[...looks, ...LOOKS].map((k, n) => (
                <span key={n} className="insp__look" role="button" tabIndex={0} title={n < looks.length ? 'A style you saved' : 'A template'} onClick={() => edit((d, ref) => ops.restyle(d, ref.slice(0, 2), k))} onKeyDown={(ev) => { if (ev.key === 'Enter') ev.currentTarget.click(); }}>
                  <span style={lookCss(k)}>Aa</span>
                  {n < looks.length && <button type="button" className="insp__unlook" aria-label="Remove this saved style" title="Remove this saved style" onClick={(ev) => { ev.stopPropagation(); onLooks(looks.filter((x) => x !== k)); }}>×</button>}
                </span>
              ))}
            </div>
            <Font value={st.font || 'Inter'} own={fonts} roles={fontRoles} url={fontUrl} onSave={font} />
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
