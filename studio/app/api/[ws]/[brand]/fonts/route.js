// The brand's own font files (inputs/media/brand/fonts/, where pull-fonts keeps them), for the editor's font picker:
// { fonts: { family: brand-relative path }, roles: { family: what the brand uses it for } }. A font is named from its
// file ("PPMori-SemiBold" → "PP Mori Semi Bold"); its role comes from the typography in the brand's inputs/DESIGN.md
// (a role's trailing # comment, else its name), matched by family and weight.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brandRoute, jsonRes } from '../../../../../lib/server/http.js';

const DIR = 'inputs/media/brand/fonts', RANK = ['ttf', 'otf', 'woff2', 'woff']; // a file in several formats: the first here
const WEIGHT = { 100: 'thin', 200: 'extralight', 300: 'light', 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black' };
const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// DESIGN.md's typography roles: [{ family, weight, label }].
function roles(dir) {
  let md = '';
  try { md = readFileSync(join(dir, 'inputs/DESIGN.md'), 'utf8'); } catch { return []; }
  const block = md.match(/^typography:\n((?:[ \t]+.*\n)+)/m)?.[1] || '';
  return block.split('\n').flatMap((line) => {
    const m = line.match(/^\s+([\w-]+):\s*\{([^}]*)\}\s*(?:#\s*(.+))?$/);
    if (!m) return [];
    const family = m[2].match(/fontFamily:\s*["']?([^,"'}]+)/)?.[1]?.trim(), weight = Number(m[2].match(/fontWeight:\s*(\d+)/)?.[1] || 400);
    const label = m[3]?.trim() || m[1].replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());
    return family ? [{ family, weight, label }] : [];
  });
}

export const GET = brandRoute(async (req, ctx) => {
  let names = [];
  try { names = readdirSync(join(ctx.dir, DIR)); } catch {}
  const best = new Map(); // family -> [rank, file]
  for (const f of names) {
    const ext = f.split('.').pop().toLowerCase(), rank = RANK.indexOf(ext);
    if (rank < 0) continue;
    const family = f.replace(/(\.(ttf|otf|woff2?))+$/i, '').replace(/[-_]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim();
    if (!best.has(family) || rank < best.get(family)[0]) best.set(family, [rank, `${DIR}/${f}`]);
  }
  const used = roles(ctx.dir), roleOf = (fam) => used
    .filter((r) => [squash(r.family), squash(r.family) + WEIGHT[r.weight]].includes(squash(fam)) || (r.weight === 400 && squash(fam) === squash(`${r.family}regular`)))
    .map((r) => r.label).join(', ');
  return jsonRes({
    fonts: Object.fromEntries([...best].map(([k, [, p]]) => [k, p])),
    roles: Object.fromEntries([...best.keys()].map((k) => [k, roleOf(k)]).filter(([, v]) => v)),
  });
});
