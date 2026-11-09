// upload-to-notion.mjs — upsert one ad on a brand's Notion Ads Board; new pages get the next board ID.
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { inferWorkspace, parseArgs, findBrandDir, die, markSent, mimeOf, typeOf, usage } from './lib/catalog.mjs';
import { fetchMissing } from './lib/r2.mjs';
import { notionClient, resolveBoard, boardQuery, titleOf, allPages, getSchema, findProp } from './lib/notion.mjs';

const HELP = `upload-to-notion.mjs — upsert one ad/idea (matched by Name) on a brand's Notion Ads Board

  node tools/upload-to-notion.mjs [--list] [--confirm] <spec.json>
    --list     list boards whose title contains the brand, with their schema; writes nothing
    (plain)    plan: resolve the board and map properties; writes nothing
    --confirm  write (only after the plan is confirmed). Upserts by Name, so re-runs never duplicate
  node tools/upload-to-notion.mjs next-id <Workspace> "<brand>"   print the next free board ID

Spec: skills/upload-ads. Board = spec.board (title) or spec.boardId, else the brand's
inputs/uploads.json notion.board / notion.boardId, else a search on spec.brand. Properties map to
each board's own schema; map odd names with spec.propertyMap.`;
const args = parseArgs(process.argv.slice(2), { flags: ['list', 'confirm'], help: HELP });
const LIST = !!args.list;
const CONFIRM = !!args.confirm;
const positional = args._;

if (!positional.length) usage(HELP);
const isNextId = positional[0] === 'next-id';
const { headers: H, api } = notionClient(isNextId ? positional[1] : positional[0] && inferWorkspace(positional[0]));
const rt = (s) => [{ type: 'text', text: { content: String(s) } }];

// logical fields → candidate board-property names (case-insensitive)
const FIELDS = [
  { key: 'status',      aliases: ['status', 'stage'],                                               val: (s) => s.status },
  { key: 'media',       aliases: ['media', 'asset type', 'type'],                                   val: (s) => s.media },
  { key: 'product',     aliases: ['product', 'sku'],                                                val: (s) => s.product },
  { key: 'ratio',       aliases: ['ratio', 'aspect ratio', 'aspect', 'size'],                       val: (s) => s.ratio },
  { key: 'variations',  aliases: ['variations', 'variation count'],                                 val: (s) => s.variations },
  { key: 'headline',    aliases: ['headline', 'hook'],                                              val: (s) => s.headline },
  { key: 'primaryText', aliases: ['primary text', 'primary copy', 'body', 'caption', 'copy'],       val: (s) => s.primaryText },
  { key: 'adCode',      aliases: ['ad link/code', 'ad link', 'ad code', 'link', 'url', 'code'],     val: (s) => s.adCode },
];

// → { prop } on a match, { missing } when a propertyMap name isn't on the board, else null.
function matchProp(schema, field, propertyMap) {
  const override = propertyMap?.[field.key];
  if (override) return schema[override] ? { prop: override } : { missing: override };
  const hit = field.aliases.map((a) => Object.keys(schema).find((n) => n.toLowerCase() === a)).find(Boolean);
  return hit ? { prop: hit } : null;
}
function buildValue(type, value) {
  switch (type) {
    case 'title': return { title: rt(value) };
    case 'rich_text': return { rich_text: rt(value) };
    case 'select': return { select: { name: String(Array.isArray(value) ? value[0] : value) } };
    case 'status': return { status: { name: String(value) } };
    case 'multi_select': return { multi_select: (Array.isArray(value) ? value : [value]).map((v) => ({ name: String(v) })) };
    case 'number': return { number: Number(value) };
    case 'url': return { url: String(value) };
    case 'date': return { date: { start: String(value) } };
    default: return null; // people, relation, etc.: skipped with a note
  }
}
const preview = (v) => { const s = Array.isArray(v) ? v.join(', ') : String(v); return s.length > 60 ? s.slice(0, 57) + '…' : s; };

async function usedIds(dbId, idProp) {
  const pages = await allPages(api, `/databases/${dbId}/query`, {});
  return new Set(pages.map((p) => p.properties?.[idProp]?.number).filter((n) => typeof n === 'number'));
}
const maxOf = (set) => (set.size ? Math.max(...set) : 0);

// --- next-id mode ---
if (isNextId) {
  const [, workspace, ...rest] = positional;
  const name = rest.join(' ');
  if (!name) usage(HELP);
  const b = await resolveBoard(api, boardQuery({ brand: name }, findBrandDir(workspace, name)));
  if (!b.id) die(`Could not uniquely match a board for "${name}". Candidates: ${b.candidates.map(titleOf).join(', ') || '(none)'}. Pin it in inputs/uploads.json (run --list on a spec).`);
  const schema = await getSchema(api, b.id);
  const idProp = findProp(schema, 'id', 'number') || 'ID';
  console.log(maxOf(await usedIds(b.id, idProp)) + 1);
  process.exit(0);
}

const specPath = positional[0];
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
// The board's ID property is a number: "12" counts as 12.
if (typeof spec.id === 'string' && spec.id !== 'auto') {
  if (!/^\d+$/.test(spec.id.trim())) die(`spec.id must be "auto" or a number (got "${spec.id}").`);
  spec.id = Number(spec.id);
}
const query = boardQuery(spec, specPath);
const board = await resolveBoard(api, query);

// --- list mode ---
if (LIST) {
  console.log(`board query "${query.boardId || query.board || query.brand}" — matching boards:\n`);
  if (!board.candidates.length) { console.log('  (none)'); process.exit(0); }
  for (const d of board.candidates) {
    const mark = d.id === board.id ? '* ' : '  ';
    console.log(`${mark}${titleOf(d)}  (${d.id})`);
    const schema = d.properties || await getSchema(api, d.id);
    for (const [n, def] of Object.entries(schema)) console.log(`      - ${n} (${def.type})`);
  }
  console.log(board.id
    ? `\n* = where uploads go. Pin it in inputs/uploads.json: { "notion": { "board": "${board.title}" } }`
    : `\nNo single board matched. Pin one in inputs/uploads.json: { "notion": { "board": "<title above>" } }`);
  process.exit(0);
}

// --- plan (also used by confirm) ---
if (!board.id) {
  console.error(`Could not uniquely match a board for "${query.board || query.brand}".`);
  console.error(`Candidates: ${board.candidates.map(titleOf).join(', ') || '(none)'}`);
  console.error('Pin it in inputs/uploads.json (run --list to inspect).');
  process.exit(1);
}
const schema = await getSchema(api, board.id);
const titleProp = findProp(schema, null, 'title');
const idProp = findProp(schema, 'id', 'number');
const pmap = spec.propertyMap || {};
await fetchMissing(spec.images || []); // freed here (sync-brand --free): back from the bucket
const missing = (spec.images || []).filter((f) => !existsSync(f));
if (missing.length) die(`Missing local file(s): ${missing.join(', ')}`);

const planned = [];  // { prop, type, key, value }
const skipped = [];  // { key, value, reason }
if (titleProp) planned.push({ prop: titleProp, type: 'title', key: 'name', value: spec.name });
else skipped.push({ key: 'name', value: spec.name, reason: 'board has no title property' });

for (const f of FIELDS) {
  const value = f.val(spec);
  if (value == null) continue;
  const { prop, missing: unmapped } = matchProp(schema, f, pmap) || {};
  if (unmapped) { skipped.push({ key: f.key, value, reason: `propertyMap → "${unmapped}" not on board` }); continue; }
  if (!prop) { skipped.push({ key: f.key, value, reason: 'no matching board property (use propertyMap)' }); continue; }
  const built = buildValue(schema[prop].type, value);
  if (!built) { skipped.push({ key: f.key, value, reason: `unsupported property type "${schema[prop].type}"` }); continue; }
  planned.push({ prop, type: schema[prop].type, key: f.key, value });
}

function printPlan() {
  console.log(`BOARD: ${board.title} (${board.id})`);
  if (board.candidates.length > 1) console.log(`  other candidates: ${board.candidates.filter((c) => c.id !== board.id).map(titleOf).join(', ')}`);
  console.log(`\nPROPERTIES TO SET:`);
  for (const p of planned) console.log(`  ${p.prop} (${p.type})  ← ${p.key} = ${preview(p.value)}`);
  if (idProp) console.log(`  ${idProp} (number)  ← id = ${spec.id === 'auto' || spec.id == null ? 'auto (next in sequence)' : spec.id}`);
  else if (spec.id != null) skipped.push({ key: 'id', value: spec.id, reason: 'no ID number property on board' });
  if (skipped.length) { console.log(`\nSKIPPED (not written):`); for (const s of skipped) console.log(`  ${s.key} = ${preview(s.value)}  — ${s.reason}`); }
  console.log(`\nBODY: ${(spec.images || []).length} image/video block(s): ${(spec.images || []).map((i) => basename(i)).join(', ') || '(none)'}`);
}

if (!CONFIRM) {
  printPlan();
  console.log(`\nPLAN ONLY — nothing written. Re-run with --confirm to write.`);
  process.exit(0);
}

// --- confirm mode ---
console.log('Writing per plan:');
printPlan();
console.log('');

async function upload(path) {
  const fname = basename(path), type = mimeOf(path);
  const cu = await api('/file_uploads', 'POST', { filename: fname, content_type: type });
  if (!cu.id) throw new Error('upload create: ' + JSON.stringify(cu));
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(path)], { type }), fname);
  const sr = await (await fetch(cu.upload_url || `https://api.notion.com/v1/file_uploads/${cu.id}/send`, { method: 'POST', headers: H, body: fd })).json();
  if (sr.status !== 'uploaded') throw new Error('upload send: ' + JSON.stringify(sr));
  console.log('uploaded', fname);
  return { id: cu.id, fname, block: typeOf(path) === 'video' ? 'video' : 'image' };
}
const ups = [];
for (const f of spec.images || []) ups.push(await upload(f));

const children = [];
for (const u of ups) {
  children.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: rt(u.fname.replace(/\.[^.]+$/, '')) } });
  children.push({ object: 'block', type: u.block, [u.block]: { type: 'file_upload', file_upload: { id: u.id } } });
}

const props = {};
for (const p of planned) props[p.prop] = buildValue(p.type, p.value);

// upsert by the title property
const q = await api(`/databases/${board.id}/query`, 'POST', { filter: { property: titleProp, title: { equals: spec.name } }, page_size: 1 });
const existing = (q.results || [])[0];

// ID: kept on update; next free one on create
if (idProp) {
  const used = await usedIds(board.id, idProp);
  if (existing) {
    if (typeof spec.id === 'number') props[idProp] = { number: spec.id };
  } else {
    let id;
    if (spec.id == null || spec.id === 'auto') id = maxOf(used) + 1;
    else if (typeof spec.id === 'number') {
      if (used.has(spec.id)) { console.error(`ID ${spec.id} is already used on the board. Use "auto" or a free ID (next is ${maxOf(used) + 1}).`); process.exit(1); }
      id = spec.id;
    }
    props[idProp] = { number: id };
    console.log(`assigned ID ${id} (board max was ${maxOf(used)})`);
  }
}

let page;
if (existing) {
  await api(`/pages/${existing.id}`, 'PATCH', { properties: props, cover: null });
  const oldIds = (await allPages(api, `/blocks/${existing.id}/children`)).map((b) => b.id);
  if (children.length) await api(`/blocks/${existing.id}/children`, 'PATCH', { children });
  for (const bid of oldIds) await api(`/blocks/${bid}`, 'DELETE');
  page = await api(`/pages/${existing.id}`);
  console.log('UPDATED existing page');
} else {
  page = await api('/pages', 'POST', { parent: { database_id: board.id }, properties: props, children });
  if (page.object === 'error') { console.error('CREATE ERROR', page.message); process.exit(1); }
  console.log('CREATED page');
}
markSent(specPath, spec, 'notion', page.url);
console.log('url:', page.url, '\nName:', spec.name, '| images:', ups.length);
