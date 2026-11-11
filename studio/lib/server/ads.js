// Board data: ad records plus batch-plan slots not made yet, each with its persona's details and its files.
// Returned paths are brand-relative (POSIX), for the /file route.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { mediaType } from '../client/api.js';
import { adRest } from '../client/format.js';
import { isSeparator, tableCells } from '../markdown.js';
import { repoRoot } from './root.js';
import { catalogLib } from './tools.js';

// ---- persona details (the table in inputs/products/<product>-personas.md) ----
// Table names ("The Morning Routine") vs record slugs ("MorningRoutine"): drop "The ", compare alphanumerics, digits as words.
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const norm = (s) => String(s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
const wordy = (s) => s.replace(/\d/g, (d) => WORDS[+d]);

function parsePersonaTable(md) {
  const rows = md.split('\n').filter((l) => l.trim().startsWith('|')).map(tableCells);
  if (rows.length < 3) return [];
  const heads = rows[0].map((h) => h.toLowerCase());
  const KEY = { name: 'name', age: 'age', gender: 'gender', 'awareness stage': 'awareness', 'physical pain': 'pain', 'emotional pain': 'feels', 'desired outcome': 'wants', objection: 'but' };
  return rows.slice(1).filter((vals) => !isSeparator(vals)).map((vals) => {
    const rec = {};
    heads.forEach((h, i) => { if (KEY[h]) rec[KEY[h]] = vals[i] || ''; });
    return rec.name ? rec : null;
  }).filter(Boolean);
}

function personas(brandDirAbs) {
  const out = [];
  const dir = join(brandDirAbs, 'inputs', 'products');
  try {
    for (const f of readdirSync(dir).filter((f) => /-personas\.md$/i.test(f))) {
      try { out.push(...parsePersonaTable(readFileSync(join(dir, f), 'utf8'))); } catch {}
    }
  } catch {}
  return out;
}

function personaDetail(list, slug) {
  if (!slug) return null;
  const s = norm(slug);
  let best = null, bestScore = 0;
  for (const p of list) {
    const n = norm(p.name), nw = wordy(n), sw = wordy(s);
    let score = 0;
    if (s === n || sw === nw) score = 3;
    else if (nw.includes(sw) || sw.includes(nw)) score = 2;
    else { const nl = nw.replace(/[^a-z]/g, ''), sl = sw.replace(/[^a-z]/g, ''); if (nl && sl && (nl.includes(sl) || sl.includes(nl))) score = 1; }
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

const posix = (p) => p.split(sep).join('/');

// The ad's files: the ones its record names, else its exported ones (final/, then the folder: <id>_<initials>_V1_…), one per
// file name. [{ abs, mtime, version, place }]: version from "<id>_V2_…" (place Feed, or Story when it ends _Story) or
// an upload name ("ID-2_STORY.png", whose place is Story), else the file's own name; the record's first file is the one shown.
function filesOf(rec, folderAbs) {
  const named = [rec?.generation?.output, ...(rec?.generation?.outputs || [])].filter(Boolean).map((p) => resolve(repoRoot(), p));
  const exported = named.length || !folderAbs ? [] : [join(folderAbs, 'final'), folderAbs].flatMap((dir) => {
    try { return readdirSync(dir).filter((n) => /^V\d+_/.test(adRest(n) || '') && ['image', 'video'].includes(mediaType(n))).map((n) => join(dir, n)); } catch { return []; }
  });
  const seen = new Set(), out = [];
  for (const abs of [...named, ...exported]) {
    const name = basename(abs);
    if (seen.has(name)) continue;
    try { if (!statSync(abs).isFile()) continue; } catch { continue; }
    seen.add(name);
    const m = /_V(\d+)_/.exec(name) || /-(\d+)_([A-Z]+)\.\w+$/.exec(name);
    const place = m?.[2] ? m[2][0] + m[2].slice(1).toLowerCase() : m ? (/_Story\.\w+$/.test(name) ? 'Story' : 'Feed') : '';
    out.push({ abs, mtime: statSync(abs).mtimeMs, version: m ? `V${m[1]}` : name.replace(/\.\w+$/, ''), place });
  }
  return out;
}

// Brand-relative form of a record path (for the file route); falls back to the raw string.
function brandRel(brandDirAbs, p) {
  if (!p) return '';
  const abs = isAbsolute(p) ? p : resolve(repoRoot(), p);
  const rel = relative(brandDirAbs, abs);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return posix(rel);
  return posix(String(p));
}

function promptOf(rec) {
  const p = rec?.generation?.prompt;
  if (!p) return '';
  return typeof p === 'string' ? p : JSON.stringify(p, null, 2);
}

// Records tagged with their batch, plus a planned row for each plan slot with no record yet (plan format: plan-batch).
function adsWithPlan(recs, plans) {
  const byId = new Map(recs.map((r) => [String(r.id), r]));
  const planned = [];
  for (const plan of plans) {
    for (const slot of plan.slots || []) {
      const existing = byId.get(String(slot.id));
      if (existing) { existing.batch = plan.name; continue; }
      planned.push({
        id: slot.id,
        status: 'in-progress',
        batch: plan.name,
        concept: { product: plan.product || '', persona: slot.persona || '', angle: slot.angle || '', format: slot.format || '' },
        generation: null,
      });
    }
  }
  return [...recs, ...planned].sort((x, y) => (x.id || 0) - (y.id || 0));
}

// Ad folders in outputs/ ("<id>_<initials>_<Concept>_<Format>_…").
export function adFolders(outputs) {
  try { return readdirSync(outputs, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d+_/.test(d.name)).map((d) => d.name); } catch { return []; }
}

export async function boardData(brandDirAbs) {
  const { readRecords } = await catalogLib();
  const outputs = join(brandDirAbs, 'outputs');
  const plans = readRecords({ json: join(outputs, 'batches') });
  const personaList = personas(brandDirAbs);
  const folders = adFolders(outputs);
  const ads = adsWithPlan(readRecords({ json: join(outputs, 'json') }), plans).map((r) => {
    const folder = folders.find((f) => f.startsWith(`${r.id}_`)) || '';
    const ad = {
      ...r,
      folder, // links the ad to its Workflow page
      refs: (r.refs || r.generation?.refs || []).map((ref) => brandRel(brandDirAbs, ref)),
      prompt: promptOf(r),
    };
    const files = filesOf(r, folder && join(outputs, folder));
    if (files[0]) {
      ad.img = posix(relative(brandDirAbs, files[0].abs));
      ad.imgVersion = files[0].mtime; // cache-buster
    }
    // Versions in order (V1, V2 …), each with its files by place (Feed, Story, or one file with no place).
    if (files.length > 1) {
      const groups = new Map();
      for (const f of files) groups.set(f.version, [...(groups.get(f.version) || []), { place: f.place, img: posix(relative(brandDirAbs, f.abs)), v: f.mtime }]);
      ad.versions = [...groups].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([label, fs]) => ({ label, files: fs }));
    }
    const pd = personaDetail(personaList, r.concept?.persona);
    if (pd) ad.personaDetail = pd;
    return ad;
  });
  return { ads, batches: plans.map((pl) => pl.name).filter(Boolean) };
}
