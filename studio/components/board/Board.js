'use client';
// The ads board: records + batch-plan slots not made yet as a masonry grid, with filters, search and a full-screen viewer.
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { fileUrl, mediaType, openFile, workflowUrl } from '../../lib/client/api.js';
import { when, words } from '../../lib/client/format.js';
import { masonry, useBrandData, useColumns } from '../../lib/client/hooks.js';
import { BarSelect, Bars, byId, CopyParam, formatOptions, LoadError, Param, SORTS, statusLabel, statusOf, statusOptions } from '../BrandPage.js';
import Player from '../Player.js';
import { IcFilm, IcFlow, IcFolder, IcSound, IcStatus } from '../icons.js';
import ViewerShell from '../ViewerShell.js';

// Photo-centric when a ref is a library photo outside the brand kit, else graphic-centric.
function imageType(rec) {
  const refs = rec?.refs || [];
  const scene = refs.some((r) => /(^|\/)inputs\/media\//.test(r) && !/type_sheet|(^|\/)brand\//i.test(r));
  return scene ? 'Photo' : 'Graphic';
}

const sentence = (s) => { const w = words(s); return w.charAt(0).toUpperCase() + w.slice(1); };

const Badge = ({ rec }) => <span className="badge" data-status={statusOf(rec)}>{statusLabel(statusOf(rec))}</span>;

// The version and place shown: the ones holding the ad's main file until the user picks others.
function useVersion(rec) {
  const at = Math.max((rec?.versions || []).findIndex((v) => v.files.some((f) => f.img === rec.img)), 0);
  const [pick, setPick] = useState({ id: null, vi: 0, pi: 0 });
  const cur = pick.id === rec?.id ? pick : { id: rec?.id, vi: at, pi: Math.max(rec?.versions?.[at]?.files.findIndex((f) => f.img === rec.img) ?? 0, 0) };
  const version = rec?.versions?.[cur.vi];
  const file = version ? version.files[Math.min(cur.pi, version.files.length - 1)] : { img: rec?.img, v: rec?.imgVersion };
  return { ...cur, version, file, set: (vi, pi) => setPick({ id: rec.id, vi, pi }) };
}

function Viewer({ ws, brand, view, index, onStep, onClose }) {
  const rec = view[index];
  const [loaded, setLoaded] = useState({ src: '', ratio: 0 }); // the shown image's width / height
  const ver = useVersion(rec);
  const img = ver.file.img, type = mediaType(img);
  const src = rec ? fileUrl(ws, brand, img, ver.file.v) : '';
  if (!rec) return null;
  const cc = rec.concept || {};
  const pd = rec.personaDetail;
  const gen = rec.generation || null;
  const openIt = (mode) => openFile(ws, brand, img, mode).catch(() => {});
  const places = ver.version?.files.length > 1 ? ver.version.files : [];
  const tools = (
    <>
      {rec.versions && <div className="chips" role="group" aria-label="Versions">
        {rec.versions.map((v, i) => <button key={v.label} type="button" className="chip" aria-pressed={i === ver.vi} onClick={() => ver.set(i, ver.pi)}>{v.label}</button>)}
      </div>}
      {places.length > 0 && (
        <div className="chips" role="group" aria-label="Placement">
          {places.map((f, i) => <button key={f.img} type="button" className="chip" aria-pressed={i === Math.min(ver.pi, places.length - 1)} onClick={() => ver.set(ver.vi, i)}>{f.place || `File ${i + 1}`}</button>)}
        </div>
      )}
      {rec.folder && <Link className="btn" href={workflowUrl(ws, brand, rec.folder)}><IcFlow /> Workflow</Link>}
    </>
  );
  const personaHead = pd && [pd.age && pd.gender ? `${pd.age} ${pd.gender}` : pd.age || pd.gender, (pd.awareness || '').toLowerCase()].filter(Boolean).join(', ');

  return (
    <ViewerShell onStep={onStep} onClose={onClose} tools={tools} ratio={rec.img && type !== 'video' && loaded.src === src ? loaded.ratio : 0} side={(
      <aside className="vw__side rise">
        <h2>Ad {rec.id}</h2>
        <div className="params">
          <Param label="Status"><Badge rec={rec} /></Param>
          {rec.sentTo && (
            <Param label="Sent to">
              <span className="param__links">
                {Object.entries(rec.sentTo).map(([dest, url]) => <a key={dest} href={url} target="_blank" rel="noreferrer">{sentence(dest)}</a>)}
              </span>
            </Param>
          )}
          {rec.batch && <Param label="Batch">{rec.batch}</Param>}
          <Param label="Product">{words(cc.product)}</Param>
          <Param label="Format">{words(cc.format)}</Param>
          <Param label="Type">{imageType(rec)}</Param>
        </div>
        <div className="params">
          {cc.persona && <Param label="Persona">{words(cc.persona)}</Param>}
          {personaHead && <Param label="Who">{personaHead}</Param>}
          {pd && [['Pain', pd.pain], ['Feels', pd.feels], ['Wants', pd.wants], ['But', pd.but]].filter(([, v]) => v).map(([k, v]) => <Param key={k} label={k}>{v}</Param>)}
          {cc.angle && <Param label="Angle">{words(cc.angle)}</Param>}
        </div>
        {(rec.meta?.headline || rec.meta?.primary_text) && (
          <div className="params">
            {rec.meta.headline && <CopyParam label="Meta headline" text={String(rec.meta.headline)} />}
            {rec.meta.primary_text && <CopyParam label="Meta primary text" text={String(rec.meta.primary_text)} />}
          </div>
        )}
        <div className="params">
          {(rec.refs || []).length > 0 && (
            <Param label="References">
              <div className="refstrip">
                {rec.refs.map((r, k) => (
                  <a key={k} href={fileUrl(ws, brand, r)} target="_blank" rel="noreferrer" title={r}>
                    <span className="media-frame"><img loading="lazy" src={fileUrl(ws, brand, r, undefined, 160)} alt="" /></span>
                  </a>
                ))}
              </div>
            </Param>
          )}
          {gen && [['Model', gen.model], ['Resolution', gen.resolution], ['Aspect', gen.aspect], ['Generated', when(gen.generatedAt)]].filter(([, v]) => v).map(([k, v]) => <Param key={k} label={k}>{String(v)}</Param>)}
          {rec.prompt && <CopyParam label="Prompt" text={rec.prompt} className="param--long" />}
          {img && <Param label="File" className="param--long">{img}</Param>}
        </div>
        {rec.img && (
          <div className="vw__actions">
            <button type="button" className="btn" onClick={() => openIt('open')}>Open full</button>
            <button type="button" className="btn" onClick={() => openIt('reveal')}>Reveal</button>
          </div>
        )}
      </aside>
    )}>
      {!rec.img ? <p className="vw__empty">No file yet</p>
        : type === 'video' || type === 'audio'
          ? <Player key={src} src={src} kind={type} autoPlay keys label={`Ad ${rec.id}${ver.version ? ` ${ver.version.label}` : ''}`} />
          : <img src={src} alt={`Ad ${rec.id}`} onLoad={(e) => setLoaded({ src, ratio: e.target.naturalWidth / e.target.naturalHeight })} />}
    </ViewerShell>
  );
}

// Width / height: the generation's aspect ("4:5") until the render loads, else a 9:16 video or a 4:5 image.
function ratioGuess(rec) {
  const m = String(rec.generation?.aspect || '').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (m) return m[1] / m[2];
  const type = mediaType(rec.img);
  return type === 'video' || type === 'audio' ? 9 / 16 : 4 / 5;
}

// Just the render, as in Media; ID and status show on hover. An ad with no render yet shows them on an empty frame.
function AdCard({ ws, brand, rec, onOpen }) {
  const [ratio, setRatio] = useState(() => ratioGuess(rec));
  const fit = (w, h) => w && h && setRatio(w / h);
  const type = mediaType(rec.img);
  if (!rec.img || type === 'audio') {
    return (
      <button type="button" className="media-frame media-frame--empty" style={{ aspectRatio: ratio }} aria-label={`Open ad ${rec.id}`} onClick={onOpen}>
        <span className="g-card__empty">{rec.img && <IcSound />}#{rec.id} · {statusLabel(statusOf(rec))}</span>
      </button>
    );
  }
  return (
    <button type="button" className="media-frame" style={{ aspectRatio: ratio }} aria-label={`Open ad ${rec.id}`} onClick={onOpen}>
      {type === 'video'
        // #t= makes the browser paint the video's first frame.
        ? <video src={`${fileUrl(ws, brand, rec.img, rec.imgVersion)}#t=0.1`} muted playsInline preload="metadata" onLoadedMetadata={(e) => fit(e.target.videoWidth, e.target.videoHeight)} />
        : <img src={fileUrl(ws, brand, rec.img, rec.imgVersion, 800)} alt={`Ad ${rec.id}`} loading="lazy" onLoad={(e) => fit(e.target.naturalWidth, e.target.naturalHeight)} />}
      <span className="g-card__meta"><span className="nm">#{rec.id} · {words(rec.concept?.angle)}</span><span className="dur">{statusLabel(statusOf(rec))}{rec.versions && ` · ${rec.versions.length} versions`}</span></span>
    </button>
  );
}

function Grid({ ws, brand, view, onOpen }) {
  const n = useColumns();
  const index = new Map(view.map((r, i) => [r.id, i]));
  return (
    <div className="masonry grid-page">
      {masonry(view, n, (r) => 1 / ratioGuess(r)).map((col, ci) => (
        <div className="masonry__col" key={ci}>
          {col.map((rec) => <AdCard key={rec.id} ws={ws} brand={brand} rec={rec} onOpen={() => onOpen(index.get(rec.id))} />)}
        </div>
      ))}
    </div>
  );
}

export default function Board({ ws, brand }) {
  const { data, error, load, updatedAt } = useBrandData(ws, brand, 'ads');
  const [status, setStatus] = useState('');
  const [format, setFormat] = useState('');
  const [batch, setBatch] = useState('');
  const [sort, setSort] = useState('new');
  const [q, setQ] = useState('');
  const [viewerIdx, setViewerIdx] = useState(-1);

  const ads = useMemo(() => data?.ads || [], [data]);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ads.filter((r) => {
      if (status && statusOf(r) !== status) return false;
      if (format && r.concept?.format !== format) return false;
      if (batch && r.batch !== batch) return false;
      if (!needle) return true;
      const hay = [r.id, r.status, r.batch, ...Object.values(r.concept || {}), ...Object.values(r.personaDetail || {})].join(' ').toLowerCase();
      return hay.includes(needle);
    }).sort(byId(sort));
  }, [ads, status, format, batch, sort, q]);

  const openViewer = (i) => setViewerIdx(i);
  const step = useCallback((d) => setViewerIdx((cur) => (cur + d + view.length) % view.length), [view]);

  const batches = data?.batches || [];

  return (
    <div>
      <Bars
        ws={ws} brand={brand} current="board" count={data ? `${view.length} of ${ads.length} ads` : 'Loading'} updatedAt={updatedAt}
        search={<input className="input bar__search" placeholder="Search ads" aria-label="Search ID, status, batch, product, persona, angle, format" value={q} onChange={(e) => setQ(e.target.value)} />}
      >
        <BarSelect label="Status" icon={IcStatus} value={status} onChange={setStatus} options={statusOptions} />
        <BarSelect label="Format" icon={IcFilm} value={format} onChange={setFormat} options={formatOptions(ads.map((r) => r.concept?.format))} />
        {batches.length > 0 && <BarSelect label="Batch" icon={IcFolder} value={batch} onChange={setBatch} options={[['', 'Any batch'], ...batches.map((b) => [b, b])]} />}
        <BarSelect label="Sort" value={sort} onChange={setSort} options={SORTS} />
      </Bars>

      {error && <LoadError what="ads" error={error} onRetry={load} />}
      {!error && data && view.length === 0 && <div className="empty-state">No ads match.</div>}
      {!error && view.length > 0 && <Grid ws={ws} brand={brand} view={view} onOpen={openViewer} />}

      {viewerIdx >= 0 && (
        <Viewer ws={ws} brand={brand} view={view} index={viewerIdx} onStep={step} onClose={() => setViewerIdx(-1)} />
      )}
    </div>
  );
}
