// The brand's pages: every .md under inputs/ (research-brand's files and what research collected), grouped and
// ordered for reading, each edited like an ad's brief (MdEditor; its saves and comments: lib/server/edit.js on
// inputs/, comments in inputs/comments/). media/ and sources/files/ (raw uploads) are left out. p: the path under
// inputs/, without ".md".
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { within } from './brands.js';
import { docComments } from './edit.js';

const SKIP = new Set(['media', 'sources/files']);
// Top-level files first in this order (the rest by name); a product's file before its personas and angles.
const ORDER = ['brand', 'customers', 'competitors', 'ads', 'videos', 'DESIGN', 'memory', 'brief-templates'];
const PRODUCT_ORDER = ['', '-personas', '-angles'];

const rank = (list, key) => { const i = list.indexOf(key); return i < 0 ? list.length : i; };
const groupOf = (p) => {
  const parts = p.split('/');
  if (parts.length === 1) return 'Research';
  if (parts[0] === 'products') return 'Products';
  if (parts[0] === 'sources') return parts.length === 2 ? 'Sources' : `Sources · ${parts[1]}`;
  return parts.slice(0, -1).join(' · ');
};
const GROUP_ORDER = ['Research', 'Products', 'Sources'];

function titleOf(text, p) {
  const h = /^#\s+(.+)$/m.exec(text.replace(/^---\n[\s\S]*?\n---\n/, ''));
  return (h ? h[1] : p.split('/').pop()).replace(/[*`]/g, '').replace(/&ndash;/g, '–').replace(/&amp;/g, '&').trim();
}

function walk(root, dir, out) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (/^[._]/.test(e.name)) continue;
    const abs = join(dir, e.name), rel = relative(root, abs).split(sep).join('/');
    if (e.isDirectory()) { if (!SKIP.has(rel)) walk(root, abs, out); }
    else if (e.name.endsWith('.md')) out.push(rel.slice(0, -3));
  }
}

export const inputsDir = (brandDir) => join(brandDir, 'inputs');

// [{ p, title, group, mtime }] in reading order.
export function listPages(brandDir) {
  const root = inputsDir(brandDir), found = [];
  walk(root, root, found);
  const pages = found.map((p) => {
    const abs = join(root, `${p}.md`);
    let text = '', mtime = 0;
    try { text = readFileSync(abs, 'utf8').slice(0, 4000); mtime = statSync(abs).mtimeMs; } catch {}
    return { p, title: titleOf(text, p), group: groupOf(p), mtime };
  });
  const key = (pg) => {
    const name = pg.p.split('/').pop();
    if (pg.group === 'Research') return [rank(ORDER, name), name];
    if (pg.group === 'Products') {
      const suffix = PRODUCT_ORDER.slice(1).find((s) => name.endsWith(s)) || '';
      return [name.slice(0, name.length - suffix.length), rank(PRODUCT_ORDER, suffix)];
    }
    return [0, pg.p];
  };
  const groupRank = (g) => { const base = g.split(' · ')[0]; return [rank(GROUP_ORDER, base), g]; };
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return pages.sort((a, b) => {
    const [ga, gb] = [groupRank(a.group), groupRank(b.group)];
    if (ga[0] !== gb[0] || ga[1] !== gb[1]) return ga[0] - gb[0] || cmp(ga[1], gb[1]);
    const [ka, kb] = [key(a), key(b)];
    return cmp(ka[0], kb[0]) || cmp(ka[1], kb[1]);
  });
}

// One page: { p, title, mtime, file: MdEditor's { name (under inputs/), p (brand-relative), v }, comments }, or null
// when p isn't a listed page.
export function readPage(brandDir, p) {
  const root = inputsDir(brandDir);
  const rel = String(p || '').replace(/\.md$/, '');
  const abs = resolve(root, `${rel}.md`);
  if (!rel || rel.includes('\0') || !within(root, abs) || [...SKIP].some((s) => within(join(root, s), abs))) return null;
  try {
    const mtime = statSync(abs).mtimeMs, name = `${rel}.md`;
    return {
      p: rel, title: titleOf(readFileSync(abs, 'utf8').slice(0, 4000), rel), mtime,
      file: { name, p: `inputs/${name}`, v: Math.round(mtime) },
      comments: docComments(root).filter((n) => n.file === name),
    };
  } catch { return null; }
}

// True when a change under inputs/ (fs.watch's filename) is to a page or a comment on one.
export const isPageChange = (name) => {
  const f = String(name || '').split(sep).join('/');
  return (f.endsWith('.md') && ![...SKIP].some((s) => f === s || f.startsWith(`${s}/`))) || /^comments\/[^/]+\.json$/.test(f);
};
