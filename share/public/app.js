// The review page: the link's ads in a grid, then one ad with its versions, where a reviewer marks a spot (a box; on a
// video also a moment or a stretch) and comments. Server: share/worker.js.
import { columnsFor, masonry } from './masonry.js';

const T = {
  title: (brand) => (brand ? `Anuncios de ${brand}` : 'Anuncios para revisar'),
  gone: 'Este enlace ya no está disponible.',
  ads: (n) => `${n} ${n === 1 ? 'anuncio' : 'anuncios'}`,
  versions: (n) => `${n} ${n === 1 ? 'versión' : 'versiones'}`,
  comments: (n) => `${n} ${n === 1 ? 'comentario' : 'comentarios'}`,
  back: 'Todos los anuncios', prev: 'Anuncio anterior (←)', next: 'Anuncio siguiente (→)',
  download: 'Descargar',
  downloadAll: 'Descargar todo', zipping: (n, of) => `Preparando ${n}/${of}…`, zipFailed: 'No se pudo descargar. Inténtalo de nuevo.',
  play: 'Reproducir', pause: 'Pausar',
  markIn: 'Entrada', markOut: 'Salida', clear: 'Quitar marca',
  hintImage: 'Arrastra sobre la imagen para marcar una zona.',
  hintVideo: 'Pausa y arrastra sobre el vídeo para marcar una zona; Entrada y Salida marcan un tramo.',
  at: (s) => `En ${s}`, zone: 'zona marcada',
  name: 'Tu nombre', as: 'Comentas como', change: 'cambiar',
  placeholder: 'Escribe tu comentario',
  send: 'Enviar', failed: 'No se pudo enviar. Inténtalo de nuevo.',
  none: 'Sin comentarios todavía.',
  status: { open: 'Enviado', seen: 'Visto', done: 'Listo', approved: 'Aprobado' },
  reply: 'Respuesta',
  copy: 'Copy de Meta', copyIt: 'Copiar', copied: 'Copiado',
  about: 'Por qué este anuncio',
  concept: 'Concepto', reference: 'Referencia', angle: 'Ángulo', persona: 'Persona', format: 'Formato', why: 'Por qué', notes: 'Notas',
};

const token = location.pathname.split('/')[2];
const api = (p) => `/s/${token}/${p}`;
// A file's URL (with small, its light copy when it has one: 'stream' a video's playable one); ?v= its version, so the browser keeps it.
const fileUrl = (ad, f, dl, small) => {
  const p = (small === 'stream' ? f.stream : small && f.preview) || f.path, q = new URLSearchParams({ ...(f.at && { v: f.at }), ...(dl && { dl: 1 }) });
  return api(`f/${encodeURIComponent(ad.id)}/${p.split('/').map(encodeURIComponent).join('/')}`) + (q.size ? `?${q}` : '');
};
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const NAME = 'adpk-share:name';

let M, comments = [], me = store.get(NAME), view = null, cols = 0;

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const ICON = {
  back: 'M10 3 5 8l5 5', all: 'M3 3h4v4H3zm6 0h4v4H9zM3 9h4v4H3zm6 0h4v4H9z', next: 'M6 3l5 5-5 5', down: 'M8 2v8m-3.5-3.5L8 10l3.5-3.5M3 13h10',
  play: 'M5 3.5v9l7.5-4.5z', pause: 'M5.5 3.5v9m5-9v9',
};
const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<path d="${ICON[name]}"/>`;
  return s;
};
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const clamp = (x) => Math.min(1, Math.max(0, x));
const versions = (ad) => [...new Set(ad.files.map((f) => f.v))];
const onFile = (ad, f) => comments.filter((c) => c.ad === ad.id && c.src === f.path);
// Each comment's number on its file, 1 for the first one left.
const numbers = (list) => new Map([...list].sort((a, b) => a.at.localeCompare(b.at)).map((c, i) => [c.id, i + 1]));

async function loadComments() {
  try { const r = await fetch(api('comments')); if (r.ok) comments = await r.json(); } catch {}
}

// The ad before or after this one, wrapping around.
const step = (ad, by) => M.ads[(M.ads.indexOf(ad) + by + M.ads.length) % M.ads.length];

// The top bar: back, the title, then on an ad its version and format tabs and downloads (tools).
function bar(ad, tools = []) {
  const title = ad ? ad.title : T.title(M.brand);
  document.title = title;
  document.getElementById('bar').replaceChildren(...[
    ad && h('a', { class: 'btn btn--icon', href: '#', title: T.back, 'aria-label': T.back }, icon('all')),
    ad && h('a', { class: 'btn btn--icon', href: `#${encodeURIComponent(step(ad, -1).id)}`, title: T.prev, 'aria-label': T.prev }, icon('back')),
    ad && h('a', { class: 'btn btn--icon', href: `#${encodeURIComponent(step(ad, 1).id)}`, title: T.next, 'aria-label': T.next }, icon('next')),
    h('h1', { class: 'bar__title' }, title),
    !ad && h('span', { class: 'bar__meta' }, T.ads(M.ads.length)),
    ...tools,
  ].filter(Boolean));
}

// One .zip of these ads' files, a folder per ad, built in the browser (media is already compressed: stored as is).
async function downloadZip(ads, name, btn) {
  const { zip } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js');
  const all = ads.flatMap((ad) => ad.files.map((f) => [ad, f])), files = {}, label = btn.textContent;
  btn.disabled = true;
  try {
    for (const [i, [ad, f]] of all.entries()) {
      btn.textContent = T.zipping(i + 1, all.length);
      const r = await fetch(fileUrl(ad, f));
      if (!r.ok) throw new Error(r.status);
      files[`${ad.title}/${f.path.split('/').pop()}`] = [new Uint8Array(await r.arrayBuffer()), { level: 0 }];
    }
    const data = await new Promise((res, rej) => zip(files, (e, d) => (e ? rej(e) : res(d))));
    const url = URL.createObjectURL(new Blob([data], { type: 'application/zip' }));
    h('a', { href: url, download: `${name}.zip` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch { alert(T.zipFailed); }
  btn.textContent = label;
  btn.disabled = false;
}
const zipButton = (ads, name) => h('button', { type: 'button', class: 'btn btn--mini', onclick: (e) => downloadZip(ads, name, e.currentTarget) }, icon('down'), T.downloadAll);

// The ads in Studio's masonry (masonry.js, gallery.css), each shown by its first feed picture.
const cover = (ad) => ad.files.find((x) => x.format !== 'Story') || ad.files[0];
function grid() {
  view = null;
  cols = columnsFor(innerWidth);
  bar(null, [h('span', { class: 'grow' }), M.ads.length > 0 && zipButton(M.ads, T.title(M.brand))]);
  const card = (ad) => {
    const f = cover(ad), n = comments.filter((c) => c.ad === ad.id).length;
    return h('div', { class: 'card' },
      h('a', { class: 'media-frame', href: `#${encodeURIComponent(ad.id)}`, style: { aspectRatio: f?.width ? `${f.width} / ${f.height}` : '4 / 5' }, 'aria-label': ad.title },
        f && h('img', { src: fileUrl(ad, f, false, true), alt: '', loading: 'lazy' })),
      h('div', { class: 'card__name' }, ad.title),
      h('div', { class: 'card__meta' }, [T.versions(versions(ad).length), n && T.comments(n)].filter(Boolean).join(' · ')));
  };
  const ratio = (ad) => { const f = cover(ad); return f?.width ? f.height / f.width : 1.25; };
  document.getElementById('app').replaceChildren(h('div', { class: 'masonry cards' },
    masonry(M.ads, cols, ratio).map((col) => h('div', { class: 'masonry__col' }, col.map(card)))));
}
addEventListener('resize', () => { if (!view && M && columnsFor(innerWidth) !== cols) grid(); });

function route() {
  const [a = '', ...p] = location.hash.slice(1).split('/');
  const ad = a && M.ads.find((x) => x.id === decodeURIComponent(a));
  if (!ad) return grid();
  open(ad, ad.files.find((f) => f.path === decodeURIComponent(p.join('/'))) || ad.files[0]);
}
const go = (ad, f) => { location.hash = `#${encodeURIComponent(ad.id)}/${encodeURIComponent(f.path)}`; };

function chips(items, current, pick) {
  return h('div', { class: 'chips', role: 'tablist' }, items.map(([key, label, title]) =>
    h('button', { type: 'button', role: 'tab', 'aria-selected': String(key === current), title, onclick: () => pick(key) }, label)));
}

// Text with its links clickable.
const linked = (text) => text.split(/(https?:\/\/[^\s)]+)/).map((x, i) => (i % 2 ? h('a', { href: x, target: '_blank', rel: 'noreferrer' }, x) : x));

// The ad's Meta copy (lib/share.mjs copyOf), each part with a button that copies it.
function copy(ad) {
  if (!ad.copy?.length) return null;
  const button = (text) => h('button', { type: 'button', class: 'btn', onclick: (e) => {
    navigator.clipboard?.writeText(text).then(() => { e.target.textContent = T.copied; setTimeout(() => { e.target.textContent = T.copyIt; }, 1500); }, () => {});
  } }, T.copyIt);
  return h('section', { class: 'about' }, h('h2', null, T.copy), h('dl', null, ad.copy.map(({ label, text }) =>
    h('div', { class: 'about__row' }, h('dt', null, label, ' ', button(text)), h('dd', null, h('p', { class: 'copy' }, linked(text)))))));
}

// Why the ad was made (lib/share.mjs aboutOf): only the fields it has.
function about(ad) {
  const a = ad.about || {}, ref = a.reference;
  const part = (p) => p && [p.text && h('p', null, linked(p.text)), p.why && h('p', { class: 'about__why' }, h('span', { class: 'eyebrow' }, T.why), ' ', linked(p.why))];
  const rows = [
    [T.concept, a.concept && h('p', null, a.concept)],
    [T.reference, ref?.media.length && ref.media.map((m) => (m.kind === 'video'
      ? h('video', { src: fileUrl(ad, m), controls: true, playsinline: true, preload: 'metadata' })
      : h('a', { href: fileUrl(ad, m), target: '_blank', rel: 'noreferrer' }, h('img', { src: fileUrl(ad, m), alt: T.reference, loading: 'lazy' }))))],
    [T.angle, part(a.angle)], [T.persona, part(a.persona)], [T.format, part(a.format)],
    [T.notes, a.notes && h('blockquote', null, a.notes)],
  ].filter(([, body]) => body);
  return rows.length > 0 && h('section', { class: 'about' }, h('h2', null, T.about), h('dl', null, rows.map(([label, body]) => h('div', { class: 'about__row' }, h('dt', null, label), h('dd', null, body)))));
}

// One ad, on file f.
function open(ad, f) {
  const video = f.kind === 'video', same = ad.files.filter((x) => x.v === f.v);
  let draft = { box: null, in: null, out: null }, sel = null;
  const versionChips = chips(versions(ad).map((v) => {
    const fs = ad.files.filter((x) => x.v === v), n = fs.reduce((s, x) => s + onFile(ad, x).length, 0);
    return [v, n ? `${v} · ${n}` : v, fs[0].name];
  }), f.v, (v) => go(ad, ad.files.find((x) => x.v === v && x.format === f.format) || ad.files.find((x) => x.v === v)));
  const formatChips = same.length > 1 && chips(same.map((x) => [x.path, x.format || x.path.split('/').pop()]), f.path, (p) => go(ad, same.find((x) => x.path === p)));

  const media = video ? h('video', { src: fileUrl(ad, f, false, 'stream'), poster: f.preview && fileUrl(ad, f, false, true), playsinline: true, preload: 'metadata' }) : h('img', { src: fileUrl(ad, f, false, true), alt: f.name || '' });
  const marks = h('div', { class: 'marks' });
  const frame = h('div', { class: 'frame' }, media, marks);
  const ratio = (w, hgt) => w && hgt && frame.style.setProperty('--r', w / hgt);
  ratio(f.width, f.height);
  media.addEventListener(video ? 'loadedmetadata' : 'load', () => ratio(media.videoWidth || media.naturalWidth, media.videoHeight || media.naturalHeight));
  const dur = () => (Number.isFinite(media.duration) ? media.duration : f.duration || 0);

  // Video controls: play, time, the timeline (comment markers, the draft stretch, the playhead), in and out.
  const playBtn = h('button', { type: 'button', class: 'btn btn--icon', onclick: () => (media.paused ? media.play() : media.pause()) });
  const time = h('span', { class: 'time num' });
  const tl = h('div', { class: 'tl' });
  const clearBtn = h('button', { type: 'button', class: 'btn btn--mini', onclick: () => { draft = { box: null, in: null, out: null }; paint(); } }, T.clear);
  const setIn = () => { draft.in = media.currentTime; if (draft.out != null && draft.out <= draft.in) draft.out = null; paint(); };
  // Out before in swaps them; out with no in starts the stretch at 0.
  const setOut = () => {
    const t = media.currentTime, from = draft.in ?? 0;
    [draft.in, draft.out] = t > from ? [from, t] : [t, from];
    if (draft.out - draft.in < 0.05) draft.out = null;
    paint();
  };
  const controls = video && h('div', { class: 'controls' }, playBtn, time, tl,
    h('button', { type: 'button', class: 'btn btn--mini', title: 'I', onclick: setIn }, T.markIn),
    h('button', { type: 'button', class: 'btn btn--mini', title: 'O', onclick: setOut }, T.markOut));
  const seek = (e) => { const r = tl.getBoundingClientRect(); media.currentTime = clamp((e.clientX - r.left) / r.width) * dur(); };
  tl.addEventListener('pointerdown', (e) => { media.pause(); seek(e); tl.setPointerCapture(e.pointerId); tl.onpointermove = seek; });
  tl.addEventListener('pointerup', () => { tl.onpointermove = null; });
  let raf = 0;
  const tick = () => { paintTime(); if (!media.paused) raf = requestAnimationFrame(tick); };
  if (video) {
    media.addEventListener('play', () => { sel = null; paint(); tick(); });
    media.addEventListener('pause', () => { cancelAnimationFrame(raf); paint(); });
    media.addEventListener('seeked', paintOn);
    media.addEventListener('seeked', paintTime);
    media.addEventListener('loadedmetadata', paint);
  }

  // Drawing a box: drag on the picture (a video pauses first); a click clears the box, or plays a paused video.
  marks.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const wasPlaying = video && !media.paused;
    if (wasPlaying) media.pause();
    const r = marks.getBoundingClientRect(), at = (ev) => [clamp((ev.clientX - r.left) / r.width), clamp((ev.clientY - r.top) / r.height)];
    const [x0, y0] = at(e);
    let moved = false;
    marks.setPointerCapture(e.pointerId);
    marks.onpointermove = (ev) => {
      const [x, y] = at(ev);
      if (!moved && Math.abs(x - x0) + Math.abs(y - y0) < 0.015) return;
      moved = true; sel = null;
      draft.box = [Math.min(x0, x), Math.min(y0, y), Math.abs(x - x0), Math.abs(y - y0)];
      paintMarks();
    };
    marks.onpointerup = () => {
      marks.onpointermove = marks.onpointerup = null;
      if (moved) { if (draft.box[2] < 0.01 || draft.box[3] < 0.01) draft.box = null; paint(); text.focus(); return; }
      if (draft.box || sel) { draft.box = null; sel = null; paint(); } else if (video && !wasPlaying) media.play();
    };
  });

  // The composer: who is commenting (asked once), what the comment is on, the text.
  const nameIn = h('input', { class: 'input', placeholder: T.name, maxlength: 60, autocomplete: 'name' });
  const who = h('div', { class: 'compose__who' });
  const paintWho = () => who.replaceChildren(...(me ? [`${T.as} `, h('b', null, me), ' · ', h('button', { type: 'button', class: 'link', onclick: () => { nameIn.value = me; me = ''; paintWho(); nameIn.focus(); } }, T.change)] : [nameIn]));
  const on = h('div', { class: 'compose__on' });
  const text = h('textarea', { class: 'input compose__text', rows: 3, maxlength: 2000, placeholder: T.placeholder });
  const err = h('p', { class: 'compose__err', hidden: true }, T.failed);
  const sendBtn = h('button', { type: 'button', class: 'btn btn--primary', onclick: send }, T.send);
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); });
  async function send() {
    const body = text.value.trim(), by = me || nameIn.value.trim();
    if (!by) return nameIn.focus();
    if (!body) return text.focus();
    if (by !== me) { me = by; store.set(NAME, me); paintWho(); }
    const c = { ad: ad.id, src: f.path, text: body, by, box: draft.box };
    if (video) { c.t = draft.in ?? media.currentTime; if (draft.out > c.t) c.to = draft.out; }
    sendBtn.disabled = true; err.hidden = true;
    const r = await fetch(api('comments'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) }).catch(() => null);
    sendBtn.disabled = false;
    if (!r?.ok) { err.hidden = false; return; }
    const saved = await r.json();
    comments.push(saved);
    text.value = ''; draft = { box: null, in: null, out: null }; sel = saved.id;
    paint();
  }
  const list = h('div', { class: 'list' });

  function pick(c) {
    sel = sel === c.id ? null : c.id;
    if (video && sel) { media.pause(); media.currentTime = c.t; }
    paint();
  }
  const span = (c) => clock(c.t) + (c.to > c.t ? `–${clock(c.to)}` : '');
  function paintMarks() {
    const mine = onFile(ad, f), n = numbers(mine);
    // An image shows every comment's box; a video the picked one's.
    const shown = mine.filter((c) => c.box && (c.id === sel || (!video && c.status !== 'approved')));
    marks.replaceChildren(...shown.map((c) => box(c.box, c.id === sel ? 'box box--sel' : 'box', n.get(c.id))), ...(draft.box ? [box(draft.box, 'box box--draft')] : []));
  }
  const box = ([x, y, w, hgt], cls, label) => h('div', { class: cls, style: { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${hgt * 100}%` } }, label && h('span', { class: 'box__n num' }, label));
  function paintTime() {
    if (!video) return;
    const d = dur(), at = (t) => `${(d ? clamp(t / d) : 0) * 100}%`;
    time.textContent = `${clock(media.currentTime)} / ${clock(d)}`;
    tl.querySelector('.tl__head')?.style.setProperty('left', at(media.currentTime));
    tl.querySelector('.tl__done')?.style.setProperty('width', at(media.currentTime));
  }
  function paintTimeline() {
    if (!video) return;
    const d = dur(), at = (t) => `${(d ? clamp(t / d) : 0) * 100}%`, mine = onFile(ad, f), n = numbers(mine);
    playBtn.replaceChildren(icon(media.paused ? 'play' : 'pause'));
    playBtn.setAttribute('aria-label', media.paused ? T.play : T.pause);
    tl.replaceChildren(
      h('div', { class: 'tl__track' }, h('div', { class: 'tl__done' })),
      ...(draft.in != null ? [h('div', { class: 'tl__band', style: { left: at(draft.in), width: draft.out != null ? `calc(${at(draft.out)} - ${at(draft.in)})` : '2px' } })] : []),
      ...mine.filter((c) => c.to > c.t).map((c) => h('div', { class: 'tl__span', style: { left: at(c.t), width: `calc(${at(c.to)} - ${at(c.t)})` } })),
      ...mine.map((c) => h('button', { type: 'button', class: 'tl__mark', 'aria-current': c.id === sel ? 'true' : null, title: `${n.get(c.id)} · ${c.text}`, style: { left: at(c.t) },
        onpointerdown: (e) => e.stopPropagation(), onclick: () => pick(c) })),
      h('div', { class: 'tl__head' }),
    );
    paintTime();
  }
  function paintOn() {
    const bits = [video && T.at(draft.in != null ? span({ t: draft.in, to: draft.out }) : clock(media.currentTime || 0)), draft.box && T.zone].filter(Boolean);
    const any = draft.box || draft.in != null;
    on.replaceChildren(h('span', null, bits.join(' · ') || (video ? T.hintVideo : T.hintImage)), ...(any ? [clearBtn] : []));
  }
  function paintList() {
    const mine = onFile(ad, f), n = numbers(mine);
    const sorted = video ? [...mine].sort((a, b) => a.t - b.t || a.at.localeCompare(b.at)) : [...mine].sort((a, b) => a.at.localeCompare(b.at));
    list.replaceChildren(...(sorted.length ? sorted.map((c) => h('article', { class: 'cmt', 'aria-current': c.id === sel ? 'true' : null, 'data-status': c.status, onclick: () => pick(c) },
      h('div', { class: 'cmt__head' },
        h('span', { class: 'cmt__n num' }, n.get(c.id)),
        video && h('span', { class: 'num' }, span(c)),
        h('b', null, c.by),
        h('span', { class: 'badge' }, h('i', { class: 'dot', 'data-status': c.status }), T.status[c.status] || c.status)),
      h('p', { class: 'cmt__text' }, c.text),
      c.reply && h('div', { class: 'cmt__reply' }, h('span', { class: 'eyebrow' }, T.reply), h('p', null, c.reply)))) : [h('p', { class: 'empty' }, T.none)]));
  }
  function paint() { paintMarks(); paintTimeline(); paintOn(); paintList(); }

  bar(ad, [versionChips, formatChips, h('span', { class: 'grow' }),
    h('a', { class: 'btn btn--mini', href: fileUrl(ad, f, true), download: '' }, icon('down'), T.download),
    ad.files.length > 1 && zipButton([ad], ad.title)]);
  document.getElementById('app').replaceChildren(h('div', { class: 'ad' },
    h('div', { class: 'ad__body' },
      h('div', { class: 'ad__main' }, h('div', { class: 'stage' }, frame, controls), copy(ad), about(ad)),
      h('aside', { class: 'side' }, list, h('div', { class: 'compose' }, who, on, text, err, h('div', { class: 'compose__acts' }, sendBtn))))));
  paintWho();
  paint();
  view = { ad, paint, video, media, setIn, setOut, clear: () => { draft = { box: null, in: null, out: null }; sel = null; paint(); } };
}

addEventListener('keydown', (e) => {
  if (!view || /^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.metaKey || e.ctrlKey) return;
  if (e.key === 'Escape') view.clear();
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { location.hash = `#${encodeURIComponent(step(view.ad, e.key === 'ArrowLeft' ? -1 : 1).id)}`; return; }
  if (!view.video) return;
  if (e.key === ' ') { e.preventDefault(); view.media.paused ? view.media.play() : view.media.pause(); }
  if (e.key === 'i' || e.key === 'I') view.setIn();
  if (e.key === 'o' || e.key === 'O') view.setOut();
});

const r = await fetch(api('manifest.json')).catch(() => null);
if (!r?.ok) {
  document.getElementById('app').replaceChildren(h('p', { class: 'empty empty--page' }, T.gone));
} else {
  M = await r.json();
  await loadComments();
  addEventListener('hashchange', route);
  route();
  // Replies and other reviewers' comments come in while the page is open.
  setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    const before = JSON.stringify(comments);
    await loadComments();
    if (JSON.stringify(comments) !== before) view ? view.paint() : grid();
  }, 15000);
}
