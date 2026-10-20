// Media data: the catalog's records via tools/lib/catalog.mjs, its index via tools/record-media.mjs.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from './brands.js';
import { catalogLib, recordMediaTool } from './tools.js';

const mediaDirOf = (brandDirAbs) => join(brandDirAbs, 'inputs', 'media');

// Catalog ids are zero-padded numbers ("00042"); anything else is refused so an id can't walk out (`../`).
export const isMediaId = (id) => typeof id === 'string' && /^\d{5,}$/.test(id);

async function mediaPaths(brandDirAbs) {
  const { catalogPaths } = await catalogLib();
  return catalogPaths(mediaDirOf(brandDirAbs));
}

export async function mediaRecords(brandDirAbs) {
  const { readRecords } = await catalogLib();
  const paths = await mediaPaths(brandDirAbs);
  return readRecords(paths).sort((x, y) => String(x.id).localeCompare(String(y.id)));
}

// Swipe item id -> the ids of the ads made from it (an ad record's `swipe`).
export async function swipedBy(brandDirAbs) {
  const { readRecords } = await catalogLib();
  const out = {};
  for (const ad of readRecords({ json: join(brandDirAbs, 'outputs', 'json') })) if (ad.swipe) (out[ad.swipe] ||= []).push(ad.id);
  return out;
}

export async function mediaRecord(brandDirAbs, id) {
  if (!isMediaId(id)) return null;
  const { readRecord } = await catalogLib();
  return readRecord(await mediaPaths(brandDirAbs), id);
}

// Adds new names to the known-people ledger (_catalog/people.json).
export async function addPeople(brandDirAbs, entries) {
  const paths = await mediaPaths(brandDirAbs);
  const people = readJson(paths.people, []);
  const have = new Set(people.map((p) => String(p.name || '').toLowerCase()));
  let changed = false;
  for (const e of entries || []) {
    const name = String(e?.name || '').trim();
    if (!name || have.has(name.toLowerCase())) continue;
    people.push({ name, description: String(e.description || '') });
    have.add(name.toLowerCase());
    changed = true;
  }
  if (changed) writeFileSync(paths.people, JSON.stringify(people, null, 2) + '\n');
}

// A sidebar edit: the patch merged into the record, then the index rebuilt. Returns the record.
export async function mergeMediaRecord(brandDirAbs, id, patch) {
  const [{ mergeRecord }, { buildIndex }, paths] = await Promise.all([catalogLib(), recordMediaTool(), mediaPaths(brandDirAbs)]);
  const record = mergeRecord(paths, { id, ...patch });
  try { buildIndex(paths); } catch {} // the record is saved either way
  return record;
}
