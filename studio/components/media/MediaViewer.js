'use client';
// Full-screen media viewer (image, video, audio + transcript) with the editable sidebar; edits save via /record.
import { useEffect, useRef, useState } from 'react';
import { apiBase, getJson, mediaUrl, postJson } from '../../lib/client/api.js';
import { clock } from '../../lib/client/format.js';
import { useCopied } from '../../lib/client/hooks.js';
import { Param } from '../BrandPage.js';
import Player from '../Player.js';
import ViewerShell from '../ViewerShell.js';
import Wave from '../Wave.js';
import { IcBox, IcClock, IcDl, IcFile, IcFolder, IcFrame, IcFull, IcGlobe, IcHash, IcLink, IcOpen, IcPanelClose, IcPanelOpen, IcQuote, IcServer, IcText, IcUser } from '../icons.js';

const csv = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function ImageStage({ ws, brand, rec }) {
  const proxy = mediaUrl(ws, brand, `_catalog/proxies/${rec.id}.jpg`);
  const original = mediaUrl(ws, brand, rec.file.name);
  const [src, setSrc] = useState(proxy);
  useEffect(() => {
    setSrc(proxy);
    const full = new Image();
    full.onload = () => setSrc(original);
    full.src = original; // may 302 to R2
    return () => { full.onload = null; };
  }, [proxy, original]);
  return <img src={src} alt={rec.file.name || rec.id} />;
}

// The waveform and transcript (the word being said lit) over the player; a click on either seeks there.
function AudioStage({ ws, brand, rec }) {
  const audio = useRef(null);
  const [time, setTime] = useState(0);
  const words = rec.transcript?.words || [];
  const list = words.length ? words : rec.transcript?.segments || [];
  const now = list.findIndex((x) => time >= x.start && time <= (x.end ?? x.start + 0.4));
  const dur = rec.file.duration || 0;
  const seek = (t) => { const a = audio.current; if (a) { a.currentTime = t; a.play().catch(() => {}); } };

  return (
    <div className="wf-wrap">
      <Wave
        src={mediaUrl(ws, brand, rec.file.name)} peaks={mediaUrl(ws, brand, `_catalog/peaks/${rec.id}.json`)} aria-hidden={undefined} progress={dur && time ? time / dur : -1}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * (audio.current?.duration || dur)); }}
      />
      <Player
        kind="audio" src={mediaUrl(ws, brand, rec.file.name)} label={rec.file.name} keys
        onLoadedMetadata={(e) => { audio.current = e.currentTarget; }} onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
      />
      {list.length > 0 && (
        <div className="wf-transcript">
          {list.map((x, i) => (
            <span key={i} className={i === now ? 'now' : ''} onClick={() => seek(x.start)}>
              {words.length ? x.word : `${x.speaker ? `${x.speaker}: ` : ''}${x.text}`}{' '}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const FILE_MANAGER = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? 'Finder' : /Win/.test(globalThis.navigator?.platform || '') ? 'Explorer' : 'folder';

// Where the original lives: its public link (R2, presigned) and its path on this device, each with its actions.
function Location({ ws, brand, rec, actions }) {
  const [where, setWhere] = useState(null);
  const [copied, copy] = useCopied();
  useEffect(() => {
    let dead = false;
    getJson(`${apiBase(ws, brand)}/presign?id=${encodeURIComponent(rec.id)}`).then((r) => { if (!dead) setWhere(r); }).catch(() => {});
    return () => { dead = true; };
  }, [ws, brand, rec.id]);
  if (!where) return null;
  return (
    <>
      <Param icon={IcGlobe} label="Public link">
        {where.local
          ? <span className="param__hint">None: this workspace has no R2 keys.</span>
          : <><span className="param__link" title={where.url}>{where.url}</span>{where.expires ? <span className="param__hint">Expires {Math.round(where.expires / 86400)} days after opening.</span> : null}</>}
        <span className="param__actions">
          {!where.local && <button type="button" className="btn btn--mini" onClick={() => copy(where.url)}><IcLink />{copied ? 'Copied' : 'Copy link'}</button>}
          <button type="button" className="btn btn--mini" onClick={() => actions.download([rec])}><IcDl />Download</button>
        </span>
      </Param>
      {where.onDevice && (
        <Param icon={IcFolder} label="On this device">
          {where.onDevice}
          <span className="param__actions">
            <button type="button" className="btn btn--mini" onClick={() => actions.open(rec, 'open')}><IcOpen />{where.app ? `Open in ${where.app}` : 'Open'}</button>
            <button type="button" className="btn btn--mini" onClick={() => actions.open(rec, 'reveal')}><IcFolder />Show in {FILE_MANAGER}</button>
          </span>
        </Param>
      )}
    </>
  );
}

// Edits save on their own when a field loses focus (or the panel closes), only if something changed.
function SidePanel({ ws, brand, rec, onSaved, actions, toast }) {
  const [products, setProducts] = useState((rec.products || []).join(', '));
  const [people, setPeople] = useState((rec.people || []).join(', '));
  const [analysis, setAnalysis] = useState(rec.analysis || '');
  const [unkNames, setUnkNames] = useState({});
  const queue = useRef(Promise.resolve()); // one save at a time, in order
  const sent = useRef(''); // the last patch sent, so a blur and a close never send it twice
  const f = rec.file || {};

  const saveIfChanged = () => {
    const nextPeople = csv(people);
    const remaining = [];
    const named = [];
    (rec.unknown_people || []).forEach((u, i) => {
      const nm = (unkNames[i] || '').trim();
      if (nm) { nextPeople.push(nm); named.push({ name: nm, description: u.description || '' }); }
      else remaining.push(u);
    });
    const patch = {
      products: csv(products),
      people: [...new Set(nextPeople)],
      unknown_people: remaining,
      analysis,
    };
    const before = { products: rec.products || [], people: rec.people || [], unknown_people: rec.unknown_people || [], analysis: rec.analysis || '' };
    const key = JSON.stringify(patch);
    if (key === JSON.stringify(before) || key === sent.current) return;
    sent.current = key;
    queue.current = queue.current.then(async () => {
      try {
        const r = await postJson(`${apiBase(ws, brand)}/record`, { id: rec.id, patch, addPeople: named });
        toast('Saved');
        setUnkNames({});
        onSaved(r.record);
      } catch (e) {
        toast(String(e.message || e));
      }
    });
  };
  const saveRef = useRef(saveIfChanged);
  saveRef.current = saveIfChanged;
  useEffect(() => () => saveRef.current(), []); // closing or moving to the next file saves too

  const unknown = rec.unknown_people || [];
  const field = (id, value, set, props = {}) => (
    <input className="field" id={id} value={value} onChange={(e) => set(e.target.value)} onBlur={saveIfChanged}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} {...props} />
  );
  return (
    <aside className="vw__side rise">
      <h2>{f.name || rec.id}</h2>
      <div className="params">
        <Param icon={IcText} label="Analysis" id="p-analysis"><textarea className="field" id="p-analysis" rows={12} value={analysis} onChange={(e) => setAnalysis(e.target.value)} onBlur={saveIfChanged} /></Param>
        {rec.transcript?.text && <Param icon={IcQuote} label="Transcript">{rec.transcript.text}</Param>}
        <Param icon={IcBox} label="Products" id="p-products">{field('p-products', products, setProducts, { placeholder: 'Separate with commas' })}</Param>
        <Param icon={IcUser} label="People" id="p-people">{field('p-people', people, setPeople, { placeholder: 'Separate with commas' })}</Param>
        {unknown.map((u, i) => (
          <div key={i} className="notice">
            <label htmlFor={`p-unk-${i}`}>Someone we don't know yet: {u.description}. Name them to add them to People.</label>
            {field(`p-unk-${i}`, unkNames[i] || '', (v) => setUnkNames((m) => ({ ...m, [i]: v })), { placeholder: 'Their name' })}
          </div>
        ))}
      </div>
      <div className="params">
        <Param icon={IcFile} label="Type">{f.type}</Param>
        {f.width ? <Param icon={IcFull} label="Dimensions">{f.width} × {f.height}</Param> : null}
        {f.aspect && <Param icon={IcFrame} label="Ratio">{f.aspect}{f.orientation ? `, ${f.orientation}` : ''}</Param>}
        {f.duration != null && <Param icon={IcClock} label="Duration">{clock(f.duration)}</Param>}
        {f.bytes ? <Param icon={IcServer} label="File size">{(f.bytes / 1e6).toFixed(2)} MB</Param> : null}
        <Param icon={IcLink} label="Source">{rec.source?.url
          ? <a className="param__link" href={rec.source.url} target="_blank" rel="noreferrer" title={rec.source.url}>{rec.source.url}</a>
          : rec.source?.kind === 'generated' ? 'Generated' : 'Upload'}</Param>
        <Param icon={IcHash} label="ID">{rec.id}</Param>
        <Location ws={ws} brand={brand} rec={rec} actions={actions} />
      </div>
    </aside>
  );
}

// actions: Gallery's per-asset actions.
export default function MediaViewer({ ws, brand, rec, sideOpen, onToggleSide, onNav, onClose, onSaved, actions, toast }) {
  const f = rec.file || {};
  const panel = sideOpen ? 'Hide details' : 'Show details';
  return (
    <ViewerShell
      onStep={onNav}
      onClose={onClose}
      ratio={f.type === 'image' && f.width ? f.width / f.height : 0}
      tools={<button type="button" className="btn btn--icon" aria-label={panel} title={panel} onClick={onToggleSide}>{sideOpen ? <IcPanelClose /> : <IcPanelOpen />}</button>}
      side={sideOpen && <SidePanel key={rec.id} ws={ws} brand={brand} rec={rec} onSaved={onSaved} actions={actions} toast={toast} />}
    >
      {f.type === 'image' && <ImageStage ws={ws} brand={brand} rec={rec} />}
      {f.type === 'video' && (
        <Player
          key={rec.id} src={mediaUrl(ws, brand, f.name)} poster={mediaUrl(ws, brand, `_catalog/thumbs/${rec.id}.jpg`)} label={f.name} keys
          captions={rec.transcript?.segments || []} scenes={rec.scenes || []} sprites={rec.sprites && { ...rec.sprites, url: mediaUrl(ws, brand, rec.sprites.sheet) }}
        />
      )}
      {f.type === 'audio' && <AudioStage key={rec.id} ws={ws} brand={brand} rec={rec} />}
    </ViewerShell>
  );
}
