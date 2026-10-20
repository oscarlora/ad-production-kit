'use client';
// The Workflow page: the ad list with current steps (no `ad`), or one ad's step bar and artifacts.
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { brandUrl, fileUrl, workflowUrl } from '../../lib/client/api.js';
import { words } from '../../lib/client/format.js';
import { useBrandData } from '../../lib/client/hooks.js';
import { BarSelect, Bars, byId, formatOptions, LoadError, SORTS, statusOf, statusOptions } from '../BrandPage.js';
import Editor from '../edit/Editor.js';
import { IcFilm, IcLeft, IcStatus } from '../icons.js';
import Player from '../Player.js';
import ViewerShell from '../ViewerShell.js';
import Footage from './Footage.js';
import { Dot, TextDisclosure } from './parts.js';
import Markdown from './Markdown.js';
import MdEditor from './MdEditor.js';
import Storyboard from './Storyboard.js';

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

// A step's files, rendered by kind; .md files edit in place (view and script: see MdEditor).
function Files({ ws, brand, ad, files, view, script, comments }) {
  const [zoom, setZoom] = useState(-1);
  const images = files.filter((f) => f.type === 'image');
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
            <div className="flow-grid">
              {images.map((f, i) => (
                <figure key={f.p} className="flow-tile">
                  <img src={fileUrl(ws, brand, f.p, f.v)} alt={f.name} loading="lazy" onClick={() => setZoom(i)} />
                  {name(f)}
                  {f.prompt && <TextDisclosure ws={ws} brand={brand} label="Prompt" file={f.prompt} />}
                </figure>
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

function Panel({ ws, brand, step, data }) {
  const pn = step.panel || {};
  const { storyboard, footage } = data;
  if (pn.editor) return <section className="flow-panel"><Editor ws={ws} brand={brand} ad={data.folder} edit={data.edit} /></section>;
  const has = pn.note || pn.md || pn.fields || pn.files || (pn.storyboard && storyboard) || (pn.footage && footage);
  return (
    <section className="flow-panel">
      {!has && <p className="flow-note">{step.done ? 'Nothing to show for this step.' : 'Not started.'}</p>}
      {pn.note && <p className="flow-note">{pn.note}</p>}
      {pn.md && <Markdown text={pn.md} />}
      {pn.fields && pn.fields.map(([k, v]) => (
        <div key={k} className="kv">
          {pn.fields.length > 1 && <div className="k eyebrow">{k}</div>}
          <div className="v v--pre">{v}</div>
        </div>
      ))}
      {pn.files && <Files ws={ws} brand={brand} ad={data.folder} files={pn.files} view={pn.view} script={step.key === 'script'} comments={data.comments || []} />}
      {pn.storyboard && storyboard && <Storyboard ws={ws} brand={brand} sb={storyboard} />}
      {pn.footage && footage && <Footage ws={ws} brand={brand} ad={data.folder} footage={footage} comments={data.comments || []} />}
    </section>
  );
}

// Opens on the edit when there is one, else the storyboard, else the step in progress if it shows something, else the last one done.
const defaultStep = (d) => d.steps.find((s) => s.panel?.editor)?.key
  || (d.storyboard && 'storyboard')
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
