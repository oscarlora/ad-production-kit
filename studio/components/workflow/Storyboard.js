'use client';
// The storyboard as a swipeable scroll-snap strip: one card per shot (row, frame, clip takes, generation details);
// the sheets as a stack of cards.
// Media loads lazily: a frame as it nears view, a clip only once played.
import { Fragment, useEffect, useRef, useState } from 'react';
import { fileUrl } from '../../lib/client/api.js';
import { when } from '../../lib/client/format.js';
import { isTyping } from '../../lib/client/hooks.js';
import { IcCal, IcCamera, IcChip, IcClock, IcCut, IcEye, IcFile, IcFilm, IcFrame, IcGrid, IcImage, IcLeft, IcMotion, IcPlay, IcQuote, IcRight, IcServer, IcSound, IcSpark, IcText, IcX } from '../icons.js';
import Markdown, { Inline } from './Markdown.js';
import Player from '../Player.js';

// A take's chip: its letter suffix (clip-01-b → Take B; none → Take A), else its model.
const takeLabel = (c) => (c.model === 'orig' ? 'Take A' : /^[a-z]$/i.test(c.model) ? `Take ${c.model.toUpperCase()}` : c.model === 'preview' ? 'Preview' : c.gen?.model || c.model);

// The newest take leads; a preview (clip + voice + music mix) is never the default.
const defaultTake = (clips) => clips.find((c) => c.model !== 'preview') || clips[0];

const PROVIDER = { kie: 'kie.ai', gateway: 'AI Gateway' };
const span = (ns) => (ns.length > 1 ? `${Math.min(...ns)}–${Math.max(...ns)}` : '');

// [icon, name, value] per non-empty parameter.
const genRows = (g, shots) => [
  [IcChip, 'Model', g.model],
  [IcServer, 'Provider', PROVIDER[g.provider] || g.provider],
  [IcFrame, 'Aspect', g.params.aspect],
  [IcGrid, 'Resolution', g.params.resolution],
  [IcClock, 'Duration', g.params.duration && `${g.params.duration} s`],
  [IcSpark, 'Quality', g.params.quality],
  [IcSound, 'Audio', g.params.audio != null && (g.params.audio ? 'On' : 'Off')],
  [IcFile, 'Format', g.params.format],
  [IcX, 'Negative', g.params.negative],
  [IcFilm, 'Shots', span(shots || [])],
  [IcCal, 'Generated', g.at && when(g.at)],
].filter(([, , v]) => v);

// Hover preview is fixed to the viewport so card overflow can't clip it; flips side near the right edge.
function Peek({ peek }) {
  if (!peek) return null;
  const w = Math.min(360, window.innerWidth * 0.4), gap = 16;
  const left = peek.x + gap + w > window.innerWidth ? peek.x - gap - w : peek.x + gap;
  const top = Math.max(gap, Math.min(peek.y - w / 2, window.innerHeight - gap - w * 1.8));
  return <img className="gen__peek" src={peek.src} alt="" style={{ left, top, width: w }} />;
}

// How a frame or clip was generated (its sidecar); nothing without one.
function GenInfo({ ws, brand, label, gen, shots }) {
  const [peek, setPeek] = useState(null);
  if (!gen) return null;
  return (
    <section className="gen" aria-label={`${label} generation`}>
      <div className="eyebrow">{label}</div>
      <table className="gen__table">
        <tbody>
          {genRows(gen, shots).map(([Icon, k, v]) => (
            <tr key={k}><th scope="row"><Icon />{k}</th><td>{v}</td></tr>
          ))}
          {gen.prompt && (
            <tr>
              <th scope="row"><IcText />Prompt</th>
              <td>
                <details className="disclosure">
                  <summary>{gen.prompt.length.toLocaleString()} characters</summary>
                  <div className="disclosure__body">{gen.prompt}</div>
                </details>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {gen.refs.length > 0 && (
        <>
          <div className="gen__label"><IcImage />References <small>{gen.refs.length}</small></div>
          <ul className="gen__refs">
            {gen.refs.map((r, i) => {
              const href = r.p ? fileUrl(ws, brand, r.p, r.v) : r.url;
              const img = r.type === 'image' && href;
              const hover = img ? {
                onMouseMove: (e) => setPeek({ src: href, x: e.clientX, y: e.clientY }),
                onMouseLeave: () => setPeek(null),
              } : {};
              const body = (
                <>
                  {img ? <img src={href} alt="" loading="lazy" {...hover} /> : <span className="gen__ph" />}
                  <span className="gen__name">{r.name}</span>
                  {r.role !== 'ref' && <small>{r.role}</small>}
                </>
              );
              return <li key={i}>{href ? <a href={href} target="_blank" rel="noreferrer" title={r.p || r.url}>{body}</a> : <span title={r.name}>{body}</span>}</li>;
            })}
          </ul>
        </>
      )}
      <Peek peek={peek} />
    </section>
  );
}

function ShotMedia({ ws, brand, shot, take, onTake, ratio, onRatio }) {
  const [playing, setPlaying] = useState(false);
  const frame = shot.frame && fileUrl(ws, brand, shot.frame.p, shot.frame.v);
  return (
    <>
      <div className="sb-media" style={ratio ? { aspectRatio: ratio } : undefined}>
        {playing && take ? (
          <Player key={take.p} src={fileUrl(ws, brand, take.p, take.v)} poster={frame || undefined} autoPlay muted preload="none" label={`Clip ${shot.n}`}
            onLoadedMetadata={(e) => e.target.videoWidth && onRatio(e.target.videoWidth / e.target.videoHeight)} />
        ) : frame ? (
          <img src={frame} alt={`Frame ${shot.n}`} loading="lazy" onLoad={(e) => onRatio(e.target.naturalWidth / e.target.naturalHeight)} />
        ) : (
          <div className="sb-media__empty">No frame yet</div>
        )}
        {!playing && take && (
          <button type="button" className="sb-play" aria-label={`Play clip ${shot.n}`} onClick={() => setPlaying(true)}>
            <IcPlay />
          </button>
        )}
      </div>
      {shot.clips.length > 1 && (
        <div className="chips sb-takes" role="group" aria-label="Clip takes">
          {shot.clips.map((c) => (
            <button key={c.p} type="button" className="chip" aria-pressed={c === take} onClick={() => { onTake(c.model); setPlaying(true); }}>
              {takeLabel(c)}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function ShotCard({ ws, brand, shot }) {
  const isShot = shot.n != null;
  const [ratio, setRatio] = useState(null); // so a 16:9 slide isn't cropped to 9:16
  const [chosen, setChosen] = useState(null);
  const take = isShot ? shot.clips.find((c) => c.model === chosen) || defaultTake(shot.clips) : null;
  const scene = shot.scene.split(/\s+[—(]/)[0];
  const setting = shot.setting && shot.setting !== '—' ? `Setting ${shot.setting}` : '';
  return (
    <article className={`sb-card${ratio > 1 ? ' sb-card--wide' : ''}`} aria-label={isShot ? `Shot ${shot.n}` : shot.scene}>
      {(scene || setting) && <div className="sb-card__head"><span className="sb-card__meta">{[scene, setting].filter(Boolean).join(' · ')}</span></div>}
      {isShot && <ShotMedia ws={ws} brand={brand} shot={shot} take={take} onTake={setChosen} ratio={ratio} onRatio={setRatio} />}
      <div className="sb-card__body">
        {shot.onScreen && <div className="sb-on"><span className="eyebrow">On screen</span> {shot.onScreen}</div>}
        {(isShot || shot.lines.length > 0 || shot.see || shot.moves || shot.hear || shot.camera || shot.transition) && (
          <div className="sb-fields">
            {(isShot || shot.secs) && (
              <div className="sb-fields__row">
                {isShot && <span className="pill-mark" title="Shot"><span className="sb-hash" aria-hidden="true">#</span>{shot.n}</span>}
                {shot.secs && <span className="pill-mark" title="Time"><IcClock />{shot.from && shot.to ? `${shot.from}–${shot.to} (${shot.secs} s)` : `${shot.secs} s`}</span>}
              </div>
            )}
            {shot.lines.map((l, i) => (
              <div key={i} className="sb-line" title={l.who || 'Line'}>
                <IcQuote /><span>{l.who && <span className="sb-line__who">{l.who} </span>}<strong>“<Inline text={l.text} />”</strong></span>
              </div>
            ))}
            {shot.see && <div className="sb-line" title="Scene"><IcEye /><span><Inline text={shot.see} /></span></div>}
            {shot.moves && <div className="sb-line" title="What moves"><IcMotion /><span><Inline text={shot.moves} /></span></div>}
            {shot.hear && <div className="sb-line" title="What we hear"><IcSound /><span><Inline text={shot.hear} /></span></div>}
            {shot.camera && <div className="sb-line" title="Camera"><IcCamera /><span><Inline text={shot.camera} /></span></div>}
            {shot.transition && <div className="sb-line" title="Transition in"><IcCut /><span><Inline text={shot.transition} /></span></div>}
          </div>
        )}
        {isShot && <GenInfo ws={ws} brand={brand} label="Frame" gen={shot.frame?.gen} />}
        {isShot && <GenInfo ws={ws} brand={brand} label="Clip" gen={take?.gen} shots={take?.shots} />}
      </div>
    </article>
  );
}

// A sheet: its image beside how it was generated. Sheets stack; they are references, not a sequence.
function SheetCard({ ws, brand, sheet }) {
  const src = fileUrl(ws, brand, sheet.p, sheet.v);
  return (
    <article className="sheet" aria-label={sheet.name}>
      <a className="sheet__media" href={src} target="_blank" rel="noreferrer"><img src={src} alt={sheet.name} loading="lazy" /></a>
      <div className="sheet__body">
        <div className="sheet__name">{sheet.name}</div>
        <GenInfo ws={ws} brand={brand} label="Sheet" gen={sheet.gen} />
      </div>
    </article>
  );
}

export function Sheets({ ws, brand, sheets }) {
  return <div className="sheets">{sheets.map((sh) => <SheetCard key={sh.p} ws={ws} brand={brand} sheet={sh} />)}</div>;
}

export default function Storyboard({ ws, brand, sb }) {
  const strip = useRef(null);
  // Scroll d cards from the one at the snap edge.
  const step = (d) => {
    const el = strip.current;
    if (!el) return;
    const edge = el.getBoundingClientRect().left + (parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0);
    const cards = [...el.querySelectorAll('.sb-card')];
    const at = cards.findIndex((c) => c.getBoundingClientRect().left >= edge - 4);
    const j = (at < 0 ? cards.length - 1 : at) + d;
    const left = j < 0 ? 0 : el.scrollLeft + cards[Math.min(j, cards.length - 1)].getBoundingClientRect().left - edge;
    el.scrollTo({ left, behavior: 'smooth' });
  };
  const stepRef = useRef(step);
  stepRef.current = step;

  // Arrow keys step the strip unless a field has focus.
  useEffect(() => {
    const onKey = (e) => {
      if (isTyping(e)) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); stepRef.current(e.key === 'ArrowRight' ? 1 : -1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div>
      <div className="sb__bar">
        {sb.blocking ? (
          <details className="disclosure sb__blocking">
            <summary>Blocking</summary>
            <Markdown text={sb.blocking} />
          </details>
        ) : <div className="spacer" />}
        <button type="button" className="btn btn--icon" aria-label="Previous shot" title="Previous shot (←)" onClick={() => step(-1)}><IcLeft /></button>
        <button type="button" className="btn btn--icon" aria-label="Next shot" title="Next shot (→)" onClick={() => step(1)}><IcRight /></button>
      </div>
      <div className="sb__strip" ref={strip} aria-label="Storyboard shots">
        {sb.rows.map((r, i) => (
          <Fragment key={`${r.n ?? 'x'}-${i}`}>
            {r.scene && r.scene !== sb.rows[i - 1]?.scene && <div className="sb-scene"><span>{r.scene}</span></div>}
            <ShotCard ws={ws} brand={brand} shot={r} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}
