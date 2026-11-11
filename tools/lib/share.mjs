// share.mjs — a brand's review link (share-ads.mjs): one per brand (outputs/share.json), showing every approved ad, and
// the comments people leave on it. It lives in the workspace's bucket under _shares/<token>/: manifest.json (what the
// page shows), files/<ad id>/<path in the ad folder> (copies of its final/ files and concept references) and
// comments/<ad id>/<comment id>.json (written by the page, share/worker.js).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, normalize } from 'node:path';
import { brandDirFrom, hashFile, inferBrand, inferWorkspace, loadEnv, mimeOf, readRecords, run, slugify, typeOf } from './catalog.mjs';
import { fetchMissing, r2FromEnv } from './r2.mjs';
import { inSections, isSeparator, mediaItems, parseDoc, tableCells } from '../../studio/lib/markdown.js';
import { renderName } from '../../studio/lib/client/format.js';

const COMMENT_ID = /^n[a-z0-9]{6,16}$/;
export const sharePrefix = (token) => `_shares/${token}/`;
export const shareFile = (brandDir) => join(brandDir, 'outputs', 'share.json');

// { token, created, ads: ['5', …], revoked? }, or null.
export function readShare(brandDir) {
  try { return JSON.parse(readFileSync(shareFile(brandDir), 'utf8')); } catch { return null; }
}
export const writeShare = (brandDir, s) => writeFileSync(shareFile(brandDir), JSON.stringify(s, null, 1) + '\n');

// The bucket of the workspace a path is in (the shell's environment wins over .env); null without R2 keys.
export const shareR2 = (path) => r2FromEnv({ ...loadEnv(), ...process.env }, inferWorkspace(path));

// ---------- the link's contents ----------
const ASPECTS = { '4:5': 0.8, '9:16': 9 / 16, '1:1': 1, '16:9': 16 / 9 };
const shown = (n) => !n.startsWith('.') && ['image', 'video'].includes(typeOf(n));
const plain = (s) => s.replace(/\*\*|`/g, '').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)').replace(/\s*\n\s*/g, ' ').trim();

// The ad's CONCEPT section (block format: open-studio) from its newest brief that has one: { label: text } and its media.
function conceptOf(dir) {
  const briefs = readdirSync(dir).filter((n) => n.endsWith('.md') && !/^(analysis|meta)\.md$/i.test(n)).sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs);
  for (const n of briefs) {
    const { blocks } = parseDoc(readFileSync(join(dir, n), 'utf8')), on = inSections(blocks, /^concept/i);
    const fields = {}, media = [];
    blocks.forEach(({ src }, i) => {
      if (!on[i]) return;
      const m = /^\*\*([^*]+?):\*\*\s*([\s\S]*)$/.exec(src.trim()), label = m?.[1].trim().toLowerCase();
      if (m && !(label in fields)) fields[label] = plain(m[2]);
      for (const it of mediaItems(src) || []) if (!/^(\.\.|\/)/.test(normalize(it.path)) && shown(it.path)) media.push(it.path);
    });
    if (Object.keys(fields).length) return { fields, media };
  }
  return { fields: {}, media: [] };
}

// The "why" column of the brand's persona or angle rows (inputs/products/<product>-<kind>.md) for these slugs.
function rowWhy(brandDir, product, kind, slugs) {
  const dir = join(brandDir, 'inputs', 'products'), own = join(dir, `${slugify(product)}-${kind}.md`);
  const files = existsSync(own) ? [own] : existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(`-${kind}.md`)).map((n) => join(dir, n)) : [];
  const out = [];
  for (const f of files) {
    let col = null; // null before a table's header
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim().startsWith('|')) { col = null; continue; }
      const cells = tableCells(line);
      if (col === null) { col = cells.findIndex((c) => /why/i.test(c)); continue; }
      if (col > 0 && !isSeparator(cells) && slugs.includes(cells[0])) out.push(plain(cells[col]));
    }
  }
  return out.join(' ') || null;
}

// Text for someone outside the team: no file names or paths, slugs, versions or account numbers (ROAS, spend).
const INTERNAL = /\bROAS\b|€|\bgasto\b|\b(?:inputs|outputs|refs|final)\/|\bV\d+\b|\.(?:md|json|mjs)\b/i;
const SLUGS = /\b[a-z]+(?:-[a-z]+)+\b(?:\s*\+\s*[a-z]+(?:-[a-z]+)+\b)*(?:\s*\(([^()]*)\))?/g;
function forReader(text) {
  if (!text) return null;
  const out = text.replace(/\s*\([^()]*\)/g, (m) => (INTERNAL.test(m) || /base de la cuenta/.test(m) ? '' : m))
    .split(/(?<=[.;])\s+/).filter((x) => !INTERNAL.test(x)).join(' ')
    .replace(SLUGS, (_, inside) => inside || '')
    .replace(/\s*\(\s*\)/g, '')
    .replace(/\b[\w-]+\.(?:mp4|mov|png|jpe?g|webp)\b/g, '')
    .replace(/^[\s·:,;]+|\s+(?=[.,;:)])/g, '').replace(/\s{2,}/g, ' ')
    .replace(/(^|[.!?]\s+)([a-záéíóúñ])/g, (_, a, b) => a + b.toUpperCase()).trim();
  return out || null;
}

// What the page shows beside an ad: the user's own reasoning only under "User's notes"; a field missing stays out;
// the reference is only its picture or video.
function aboutOf(brandDir, dir, rec) {
  const { fields: f, media } = conceptOf(dir), c = rec.concept || {};
  const slugs = (s) => String(s || '').split(/\s*[+,]\s*/).filter(Boolean);
  const part = (text, why) => (text = forReader(text), why = forReader(why), text || why ? { text, why } : null);
  return {
    concept: forReader(f.concept),
    reference: media.length ? { media } : null,
    angle: part(f.angle, f['why this angle'] || rowWhy(brandDir, c.product, 'angles', slugs(c.angle))),
    persona: part(f.persona?.replace(/^[a-z]+(?:-[a-z]+)+/, (m) => m.replace(/-/g, ' ')), f['why this persona'] || rowWhy(brandDir, c.product, 'personas', slugs(c.persona))),
    format: part(f.format, f['why this format']),
    notes: forReader(f["user's notes"]),
  };
}

// The ad's Meta copy (meta.md: write-meta-copy) as [{ label, text }], one per **Label** line; [] without it.
function copyOf(dir) {
  const f = join(dir, 'meta.md');
  if (!existsSync(f)) return [];
  const out = [];
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^\*\*([^*]+?):?\*\*\s*$/.exec(line.trim());
    if (m) out.push({ label: m[1].trim(), text: '' });
    else if (out.length && !/^#/.test(line)) out.at(-1).text += line.replace(/\*\*|`/g, '') + '\n';
  }
  return out.map((x) => ({ ...x, text: x.text.trim() })).filter((x) => x.text);
}

// Brings the brand's link up to date: every approved ad (its record), each file copied under the link when new or
// changed, files and ads no longer approved removed. Returns the manifest, or null when the brand has no live link
// or no R2 keys.
export async function refreshShare(brandDir, r2 = shareR2(brandDir)) {
  const s = readShare(brandDir);
  if (!s || s.revoked || !r2) return null;
  const { videoMeta } = await import('./media-probe.mjs');
  const pre = sharePrefix(s.token), outputs = join(brandDir, 'outputs'), brand = inferBrand(brandDir);
  const there = new Map((await r2.listWithMeta(`${pre}files/`)).map((o) => [o.key, o]));
  const before = JSON.parse(String(await r2.get(`${pre}manifest.json`) || '{"ads":[]}'));
  const known = new Map(before.ads.flatMap((a) => a.files.map((f) => [`${a.id}/${f.path}`, f])));
  const keep = new Set(), folders = readdirSync(outputs);
  // Copies one file of an ad under the link unless it's there as is; true when it's there. A file freed here
  // (sync-brand --free) comes from the brand's own copy in the bucket.
  async function put(id, folder, rel) {
    const abs = join(outputs, folder, rel), key = `${pre}files/${id}/${rel}`, o = there.get(key);
    keep.add(key);
    if (!existsSync(abs)) { if (o) return true; await fetchMissing(abs); }
    if (!existsSync(abs)) return false;
    const st = statSync(abs);
    if (o && o.size === st.size && (st.mtimeMs <= Date.parse(o.lastModified) || o.etag === await hashFile(abs, 'md5'))) return true;
    await r2.putFile(key, abs, mimeOf(abs));
    known.delete(`${id}/${rel}`);
    return true;
  }
  // Light copies to show, beside the original that downloads: a JPEG (the grid, the viewer, a video's poster) and,
  // for a video, a 720p MP4 that plays while it loads.
  async function preview(id, folder, f) {
    const abs = join(outputs, folder, f.path), tmp = join(tmpdir(), `adpk-preview-${process.pid}`);
    const make = [['preview', 'jpg', 'image/jpeg', [...(f.kind === 'video' ? ['-ss', '0.3'] : []), '-i', abs, '-frames:v', '1', '-vf', "scale='min(1200,iw)':-2", '-q:v', '3']]];
    if (f.kind === 'video') make.push(['stream', 'mp4', 'video/mp4', ['-i', abs, '-vf', "scale='min(720,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart']]);
    for (const [field, ext, type, a] of make) {
      const rel = `.previews/${f.path}.${ext}`, key = `${pre}files/${id}/${rel}`;
      keep.add(key);
      if (f[field] && there.has(key)) continue;
      await fetchMissing(abs);
      if (run('ffmpeg', ['-v', 'error', '-y', ...a, `${tmp}.${ext}`], { allowFail: true }).status !== 0) continue;
      await r2.putFile(key, `${tmp}.${ext}`, type);
      f[field] = rel;
    }
  }
  const ads = [];
  for (const rec of readRecords({ json: join(outputs, 'json') }).filter((r) => r.status === 'approved')) {
    const id = String(rec.id), folder = folders.find((n) => n.startsWith(`${id}_`) && statSync(join(outputs, n)).isDirectory());
    if (!folder) continue;
    const dir = join(outputs, folder), cloud = `${brand}/outputs/${folder}/final/`;
    const names = new Set(existsSync(join(dir, 'final')) ? readdirSync(join(dir, 'final')).filter(shown) : []);
    for (const o of await r2.listWithMeta(cloud)) { const n = o.key.slice(cloud.length); if (shown(n) && !n.includes('/')) names.add(n); }
    const files = [];
    for (const n of names) {
      const rel = `final/${n}`;
      if (!await put(id, folder, rel)) continue;
      let f = known.get(`${id}/${rel}`);
      if (!f) {
        const abs = join(dir, rel), m = existsSync(abs) ? videoMeta(abs) : {}, r = renderName(n) || { v: 'V1', name: '' }, kind = typeOf(n);
        const aspect = m.width && Object.entries(ASPECTS).find(([, x]) => Math.abs(m.width / m.height - x) < 0.02)?.[0];
        f = { path: rel, kind, v: r.v, name: r.name, format: r.story ? 'Story' : aspect || '', width: m.width || null, height: m.height || null, duration: kind === 'video' ? m.duration : null };
      }
      f.at ||= Date.now().toString(36);
      await preview(id, folder, f);
      files.push(f);
    }
    if (!files.length) continue;
    const about = aboutOf(brandDir, dir, rec);
    if (about.reference) {
      const media = (await Promise.all(about.reference.media.map(async (p) => (await put(id, folder, p)) && { path: p, kind: typeOf(p) }))).filter(Boolean);
      about.reference = media.length ? { media } : null;
    }
    const vnum = (f) => +f.v.slice(1) || 1;
    files.sort((a, b) => vnum(a) - vnum(b) || (a.format === 'Story') - (b.format === 'Story') || a.path.localeCompare(b.path));
    ads.push({ id, title: folder, files, copy: copyOf(dir), about });
  }
  for (const key of there.keys()) if (!keep.has(key)) await r2.remove(key);
  const manifest = { brand, created: s.created, ads: ads.sort((a, b) => +a.id - +b.id) };
  await r2.put(`${pre}manifest.json`, JSON.stringify(manifest), 'application/json');
  writeShare(brandDir, { ...s, ads: ads.map((a) => a.id) });
  return manifest;
}

// ---------- the comment bridge (edit-video.mjs comments) ----------
const adId = (ad) => basename(ad).split('_')[0];
const liveFor = (ad) => { const s = readShare(brandDirFrom(ad)); return s && !s.revoked && s.ads.includes(adId(ad)) ? s : null; };

// Comments left on the ad on the brand's link since, into <ad>/comments/ as open, with the same id; one on a shared
// image gets file (its path in the ad folder), one on a video its plan (planOf: the edit document that exported it).
// Returns how many came in.
export async function pullShared(ad, planOf) {
  const s = liveFor(ad), r2 = s && shareR2(ad);
  if (!r2) return 0;
  const cdir = join(ad, 'comments');
  const have = new Set(existsSync(cdir) ? readdirSync(cdir).map((n) => n.replace(/\.json$/, '')) : []);
  let n = 0;
  for (const o of await r2.listWithMeta(`${sharePrefix(s.token)}comments/${adId(ad)}/`)) {
    const id = basename(o.key, '.json');
    if (!COMMENT_ID.test(id) || have.has(id)) continue;
    const c = JSON.parse(String(await r2.get(o.key) || 'null'));
    if (c?.status !== 'open') continue;
    const on = Number.isFinite(c.t) ? { t: c.t, ...(c.to > c.t && { to: c.to }), plan: planOf(c.src) } : { file: c.src };
    mkdirSync(cdir, { recursive: true });
    writeFileSync(join(cdir, `${id}.json`), JSON.stringify({ id, ...on, box: c.box || null, text: c.text, by: c.by, share: s.token, status: 'open', at: c.at }, null, 1) + '\n');
    n++;
  }
  return n;
}

// A shared comment's status and reply back to the link, so the page shows them.
export async function pushShared(ad, c) {
  const r2 = c.share && shareR2(ad), key = `${sharePrefix(c.share)}comments/${adId(ad)}/${c.id}.json`;
  const cur = r2 && JSON.parse(String(await r2.get(key) || 'null'));
  if (cur) await r2.put(key, JSON.stringify({ ...cur, status: c.status, ...(c.reply && { reply: c.reply }) }), 'application/json');
}
