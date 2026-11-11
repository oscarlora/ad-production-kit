'use client';
// The Workflow page: the ad list with current steps (no `ad`), or one ad's step bar and artifacts.
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { brandUrl, editApi, fileUrl, workflowUrl } from '../../lib/client/api.js';
import { renderName, words } from '../../lib/client/format.js';
import { useBrandData, useCopied } from '../../lib/client/hooks.js';
import { BarSelect, Bars, byId, formatOptions, LoadError, Param, SORTS, statusOf, statusOptions } from '../BrandPage.js';
import Editor from '../edit/Editor.js';
import { IcCheck, IcCopy, IcFilm, IcLeft, IcStatus } from '../icons.js';
import Player from '../Player.js';
import ViewerShell from '../ViewerShell.js';
import Footage from './Footage.js';
import { chat, Dot, Messages, TextDisclosure } from './parts.js';
import Markdown from './Markdown.js';
import MdEditor from './MdEditor.js';
import Storyboard, { ImageCard, Sheets } from './Storyboard.js';

const baseName = (n) => n.split('/').pop();
const STATE = { done: 'Done', current: 'Current', todo: 'Not started' };

function Lightbox({ ws, brand, images, index, onStep, onClose }) {
  const f = images[index];
  return (
    <ViewerShell onStep={onStep} onClose={onClose} nav={images.length > 1} title={baseName(f.name)}>
      <img src={fileUrl(ws, brand, f.p, f.v)} alt={f.name} />
    </ViewerShell>
  );
}

// An image ad's render: Approve moves it to final/, the pressed Approved moves it back to drafts/ (moveRender). The page
// updates live, so the tile reappears in the other step.
function RenderButton({ ws, brand, ad, file }) {
  const [busy, setBusy] = useState(false);
  const final = file.startsWith('final/');
  const move = () => { setBusy(true); editApi(ws, brand, ad)({ render: file }).catch(() => setBusy(false)); };
  return (
    <button type="button" className="btn btn--mini" aria-pressed={final} disabled={busy} onClick={move}
      title={final ? 'Move back to Drafts' : 'Move to Final'}>
      <IcCheck />{final ? 'Approved' : 'Approve'}
    </button>
  );
}

// "5_V8_Piel-De-Bebe_Static_…" → "V8 · Piel de bebe" (sentence case; "… · Story" for its 9:16); other names as they are.
const renderLabel = (rel) => { const r = renderName(rel); return r ? `${r.v} · ${r.name}${r.story ? ' · Story' : ''}` : baseName(rel); };

// The comments on an image (from a review link: share-ads.mjs), each led by who wrote it.
const ImageThread = ({ comments }) => comments.length > 0 && (
  <div className="ft-thread ft-thread--scene"><Messages msgs={chat(comments.map((n) => ({ ...n, text: n.by ? `${n.by}: ${n.text}` : n.text })))} /></div>
);

// A step's files, rendered by kind; .md files edit in place (view and script: see MdEditor).
function Files({ ws, brand, ad, files, view, script, comments }) {
  const [zoom, setZoom] = useState(-1);
  const images = files.filter((f) => f.type === 'image')
    // Newest first: by the minute made, then by name (V13 before V2), so a batch made together keeps its order.
    .sort((a, b) => Math.floor(b.v / 6e4) - Math.floor(a.v / 6e4) || b.name.localeCompare(a.name, undefined, { numeric: true }));
  const videos = files.filter((f) => f.type === 'video');
  const step = useCallback((d) => setZoom((i) => (i + d + images.length) % images.length), [images.length]);
  const close = useCallback(() => setZoom(-1), []);
  const name = (f) => <figcaption>{baseName(f.name)}</figcaption>;
  const mds = files.filter((f) => f.type === 'md');
  return (
    <div className="flow-files">
      {mds.map((f) => (
        <section key={f.p}>
          {mds.length > 1 && <div className="eyebrow">{baseName(f.name)}</div>}
          <MdEditor ws={ws} brand={brand} ad={ad} file={f} view={view} script={script} comments={comments.filter((n) => n.file === f.name)} />
        </section>
      ))}
      {(images.length > 0 || videos.length > 0) && (
        // Beside a brief, media lines up with its blocks.
        <div className={mds.length ? 'flow-media' : 'flow-files'}>
          {images.length > 0 && (
            <div className="flow-grid flow-grid--cards">
              {images.map((f, i) => (
                <ImageCard
                  key={f.p} ws={ws} brand={brand} name={renderLabel(f.name)} title={baseName(f.name)} file={f} gen={f.gen} onOpen={() => setZoom(i)}
                  promptText={f.prompt && <TextDisclosure ws={ws} brand={brand} label="Prompt" file={f.prompt} />}
                  thread={<ImageThread comments={comments.filter((n) => n.file === f.name)} />}
                >
                  {/^(drafts|final)\//.test(f.name) && <RenderButton ws={ws} brand={brand} ad={ad} file={f.name} />}
                </ImageCard>
              ))}
            </div>
          )}
          {videos.length > 0 && (
            <div className="flow-grid flow-grid--video">
              {videos.map((f) => (
                <figure key={f.p} className="flow-tile">
                  <Player src={fileUrl(ws, brand, f.p, f.v)} preload={videos.length > 4 ? 'none' : 'metadata'} label={baseName(f.name)} />
                  {name(f)}
                </figure>
              ))}
            </div>
          )}
        </div>
      )}
      {files.filter((f) => f.type === 'audio').map((f) => (
        <figure key={f.p} className="flow-audio">
          {name(f)}
          <Player kind="audio" src={fileUrl(ws, brand, f.p, f.v)} preload="none" label={baseName(f.name)} />
        </figure>
      ))}
      {files.filter((f) => f.type === 'txt').map((f) => <TextDisclosure key={f.p} ws={ws} brand={brand} label={baseName(f.name)} file={f} />)}
      {files.filter((f) => f.type === 'pdf' || f.type === 'other').map((f) => (
        <a key={f.p} className="flow-link" href={fileUrl(ws, brand, f.p, f.v)} target="_blank" rel="noreferrer">{baseName(f.name)}</a>
      ))}
      {zoom >= 0 && images[zoom] && <Lightbox ws={ws} brand={brand} images={images} index={zoom} onStep={step} onClose={close} />}
    </div>
  );
}

// The voiceover takes; picking one tells the agent to retime the storyboard to it.
function Voices({ ws, brand, ad, takes }) {
  const [picked, setPicked] = useState(null);
  const current = picked || takes.find((t) => t.picked)?.name;
  const pick = (name) => { setPicked(name); editApi(ws, brand, ad)({ voice: name }).catch(() => setPicked(null)); };
  return takes.map((t) => (
    <figure key={t.p} className="flow-audio">
      <figcaption>{baseName(t.name)}</figcaption>
      <div className="flow-audio__row">
        <Player kind="audio" src={fileUrl(ws, brand, t.p, t.v)} preload="none" label={baseName(t.name)} />
        <button type="button" className="chip" aria-pressed={t.name === current} onClick={() => pick(t.name)}>
          {t.name === current ? <><IcCheck />Picked</> : 'Pick this take'}
        </button>
      </div>
    </figure>
  ));
}

// A prompt's words, with the ad's own copy (anything in quotes) set in the text color and each hex color led by its swatch.
const QUOTE_HEX = /([“"][^”"]+[”"]|#[0-9a-f]{6}\b)/gi;
function PromptText({ text }) {
  return text.split(QUOTE_HEX).map((part, i) => (
    i % 2 === 0 ? part
      : part[0] === '#' ? <span key={i} className="prompt__hex"><i style={{ background: part }} />{part.toUpperCase()}</span>
      : <span key={i} className="prompt__copy">{part}</span>
  ));
}

// The prompt as its sections ("Composition: …" opens one; "- " lines list), beside the current render, the settings and
// the references. File name goes to the side.
function PromptPanel({ ws, brand, prompt }) {
  const [copied, copy] = useCopied();
  const secs = prompt.text.split(/\n\s*\n/).map((para) => {
    const lines = para.trim().split('\n');
    const m = /^([A-Z][^:\n]{0,40}):\s*(.*)$/.exec(lines[0]);
    const body = [m ? m[2] : lines[0], ...lines.slice(1)].filter((l) => l.trim());
    return { label: m?.[1] || '', body };
  });
  const fileName = secs.find((x) => /^file name$/i.test(x.label))?.body.join(' ');
  return (
    <div className="prompt">
      <div className="prompt__main">
        {secs.filter((x) => !/^file name$/i.test(x.label)).map((x, i) => {
          // Lines in order; a run of "- " or "1. " lines is one list.
          const runs = [];
          for (const l of x.body) {
            const item = /^\s*(?:-|\d+\.)\s+(.*)$/.exec(l)?.[1];
            if (item == null) runs.push(l);
            else if (Array.isArray(runs.at(-1))) runs.at(-1).push(item);
            else runs.push([item]);
          }
          return (
            <section key={i} className="prompt__sec">
              {x.label && <h3 className="eyebrow">{x.label}</h3>}
              {runs.map((r, k) => (Array.isArray(r)
                ? <ul key={k}>{r.map((l, j) => <li key={j}><PromptText text={l} /></li>)}</ul>
                : <p key={k}><PromptText text={r} /></p>))}
            </section>
          );
        })}
      </div>
      <aside className="prompt__side">
        {prompt.output && (
          <a className="media-frame prompt__render" href={fileUrl(ws, brand, prompt.output.p, prompt.output.v)} target="_blank" rel="noreferrer" title={prompt.output.name}>
            <img src={fileUrl(ws, brand, prompt.output.p, prompt.output.v, 480)} alt="Current render" />
          </a>
        )}
        <button type="button" className="btn" onClick={() => copy(prompt.text)}><IcCopy />{copied ? 'Copied' : 'Copy prompt'}</button>
        <div className="params">
          {prompt.settings.map(([k, v]) => <Param key={k} label={k}>{v}</Param>)}
          {prompt.refs.length > 0 && (
            <Param label="References">
              <div className="refstrip">
                {prompt.refs.map((r, k) => (
                  <a key={r.p} href={fileUrl(ws, brand, r.p, r.v)} target="_blank" rel="noreferrer" title={`Image ${k + 1} · ${r.name}`}>
                    <span className="media-frame"><img loading="lazy" src={fileUrl(ws, brand, r.p, r.v, 160)} alt={`Reference image ${k + 1}`} /></span>
                  </a>
                ))}
              </div>
            </Param>
          )}
          {fileName && <Param label="File name" className="param--long">{fileName}</Param>}
        </div>
      </aside>
    </div>
  );
}

function Panel({ ws, brand, step, data }) {
  const pn = step.panel || {};
  const { storyboard, footage } = data;
  if (pn.editor) return <section className="flow-panel"><Editor ws={ws} brand={brand} ad={data.folder} edit={data.edit} /></section>;
  const has = pn.prompt || pn.note || pn.md || pn.fields || pn.files || pn.voices || pn.sheets || (pn.storyboard && storyboard) || (pn.footage && footage);
  return (
    <section className="flow-panel">
      {!has && (
        <div className="empty-state">
          {step.key === 'final' && !step.done ? 'Approve a draft to move it here.' : step.done ? 'Nothing to show for this step.' : `Ask the agent to start ${step.key === 'edit' ? 'editing' : 'this step'}.`}
        </div>
      )}
      {pn.note && <p className="flow-note">{pn.note}</p>}
      {pn.prompt && <PromptPanel ws={ws} brand={brand} prompt={pn.prompt} />}
      {pn.md && <Markdown text={pn.md} />}
      {pn.fields && pn.fields.map(([k, v]) => (
        <div key={k} className="kv">
          {pn.fields.length > 1 && <div className="k eyebrow">{k}</div>}
          <div className="v v--pre">{v}</div>
        </div>
      ))}
      {pn.storyboard && storyboard && <Storyboard ws={ws} brand={brand} sb={storyboard} />}
      {pn.sheets && <Sheets ws={ws} brand={brand} sheets={pn.sheets} />}
      {pn.voices && <Voices ws={ws} brand={brand} ad={data.folder} takes={pn.voices} />}
      {pn.files && <Files ws={ws} brand={brand} ad={data.folder} files={pn.files} view={pn.view} script={step.key === 'script'} comments={data.comments || []} />}
      {pn.footage && footage && <Footage ws={ws} brand={brand} ad={data.folder} footage={footage} comments={data.comments || []} />}
    </section>
  );
}

// Opens on the edit when there is one, else a slides storyboard, else the step in progress if it shows something, else the last one done.
const defaultStep = (d) => d.steps.find((s) => s.panel?.editor)?.key
  || d.steps.find((s) => s.key === 'storyboard' && s.done)?.key
  || d.steps.find((s) => s.state === 'current' && Object.keys(s.panel || {}).length)?.key
  || [...d.steps].reverse().find((s) => s.done)?.key
  || d.steps[0]?.key;

function Detail({ ws, brand, ad }) {
  const { data, error, load } = useBrandData(ws, brand, `workflow?ad=${encodeURIComponent(ad)}`);
  const [sel, setSel] = useState(null);
  const steps = data?.steps || [];
  const step = steps.find((s) => s.key === sel) || (data && steps.find((s) => s.key === defaultStep(data)));

  const head = (
    <>
      <Link className="flow-back" href={brandUrl(ws, brand, 'workflow')} aria-label="All ads" title="All ads"><IcLeft /></Link>
      {data && <h1 className="flow-title"><span className="flow-title__id">{data.id}</span>{words(data.concept)}</h1>}
      <nav className="flow-steps" aria-label="Steps">
        {steps.map((s) => (
          <button key={s.key} type="button" className="flow-step" data-state={s.state} aria-pressed={s === step} title={STATE[s.state]} onClick={() => setSel(s.key)}>
            {s.label}
          </button>
        ))}
      </nav>
    </>
  );
  return (
    <div>
      <Bars ws={ws} brand={brand} current="workflow" head={head} />
      {error && <LoadError what="this ad" error={error} onRetry={load} />}
      {!error && data && step && <div className="flow-page"><Panel ws={ws} brand={brand} step={step} data={data} /></div>}
    </div>
  );
}

function List({ ws, brand }) {
  const { data, error, load, updatedAt } = useBrandData(ws, brand, 'workflow');
  const ads = useMemo(() => data?.ads || [], [data]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [format, setFormat] = useState('');
  const [sort, setSort] = useState('new');
  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ads.filter((a) => (!status || statusOf(a) === status) && (!format || a.format === format)
      && (!needle || [a.id, a.concept, a.format, a.step?.label].join(' ').toLowerCase().replace(/[-_]/g, ' ').includes(needle))).sort(byId(sort));
  }, [ads, q, status, format, sort]);
  return (
    <div>
      <Bars
        ws={ws} brand={brand} current="workflow" count={data ? `${view.length} of ${ads.length} ads` : 'Loading'} updatedAt={updatedAt}
        search={<input className="input bar__search" placeholder="Search ads" aria-label="Search concept, format, step" value={q} onChange={(e) => setQ(e.target.value)} />}
      >
        <BarSelect label="Status" icon={IcStatus} value={status} onChange={setStatus} options={statusOptions} />
        <BarSelect label="Format" icon={IcFilm} value={format} onChange={setFormat} options={formatOptions(ads.map((a) => a.format))} />
        <BarSelect label="Sort" value={sort} onChange={setSort} options={SORTS} />
      </Bars>
      {error && <LoadError what="ads" error={error} onRetry={load} />}
      {!error && data && ads.length === 0 && <div className="empty-state">No ad folders in <code>outputs/</code> yet.</div>}
      {!error && data && ads.length > 0 && view.length === 0 && <div className="empty-state">No ads match.</div>}
      {!error && view.length > 0 && (
        <ul className="flow-list">
          <li className="flow-row flow-row--head eyebrow" aria-hidden="true">
            <span>ID</span><span>Concept</span><span>Format</span><span>Progress</span><span>Now</span>
          </li>
          {view.map((a) => (
            <li key={a.folder}>
              <Link className="flow-row" href={workflowUrl(ws, brand, a.folder)}>
                <span className="cell-id">{a.id}</span>
                <span className="flow-row__concept">{words(a.concept)}</span>
                <span className="pill-mark">{words(a.format) || '—'}</span>
                <span className="flow-row__dots" aria-hidden="true">{a.states.map((st, i) => <Dot key={i} state={st} />)}</span>
                <span className="flow-row__step">{a.step ? <>{a.step.label}{a.step.count && <small>{a.step.count}</small>}</> : 'Done'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Workflow({ ws, brand, ad }) {
  return ad ? <Detail ws={ws} brand={brand} ad={ad} /> : <List ws={ws} brand={brand} />;
}
