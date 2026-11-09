#!/usr/bin/env node
// sync-brand.mjs — mirror a brand's context to/from its workspace's R2 bucket, and presign originals.
// Bucket keys mirror the brand tree: <Brand>/inputs/..., <Brand>/outputs/...
// Light (default): everything except heavy = media originals (inputs/media/<id>_*) and rendered ads.
// workspaces/<WS>/_custom (private skills/tools) ↔ prefix _custom/<WS>/ (workspaces can share a
// bucket), synced in full with every brand of the workspace; pass the _custom dir to sync only it.
// Files compare by md5 vs etag (multipart etags contain '-' and count as changed). <dir>/.sync-state.json
// records the bucket etags last seen; push refuses to overwrite files changed in the cloud since, and pull
// keeps files changed here since (unpushed work). Dotfiles never sync, except Studio's light video preview copies
// (.previews/*.mp4, cachedPath in lib/catalog.mjs), which sync as light files. An ad folder being edited (.editing.json, see
// markEditing in lib/catalog.mjs) is never touched by pull; push releases it, or leaves it out when another session holds it.
// Creds in .env: <WS>_R2_ACCOUNT_ID <WS>_R2_ACCESS_KEY_ID <WS>_R2_SECRET_ACCESS_KEY <WS>_R2_BUCKET
// A public workspace (PUBLIC_BUCKETS in lib/r2.mjs, e.g. Shared) pulls without creds: each push
// writes <Brand>/.manifest.json for that. It never syncs _custom, which would be public.
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { loadEnv, inferWorkspace, inferBrand, brandDirFrom, catalogPaths, readRecord, mimeOf, parseArgs, isMedia, hashFile, usage, EDITING, readEditing, sessionId } from './lib/catalog.mjs';
import { r2FromEnv, r2Public, PUBLIC_BUCKETS, MANIFEST } from './lib/r2.mjs';

const HELP = `sync-brand.mjs — mirror a brand to/from its workspace's R2 bucket (path = the brand dir or any path under it)

  node tools/sync-brand.mjs --brands <workspace>                        list the brands in the bucket (Acme or workspaces/Acme)
  node tools/sync-brand.mjs --pull <brand dir> [--originals] [--force]  download changes (heavy files too with --originals);
                                                                        keeps local edits not pushed yet unless --force, and
                                                                        never touches an ad folder being edited
  node tools/sync-brand.mjs --push <brand dir> [--originals] [--force]  upload changes and release this session's ad folders;
                                                                        stops on someone's newer work, and leaves out ad
                                                                        folders another session is editing, unless --force.
                                                                        A path under the brand (e.g. one ad folder) pushes only
                                                                        it, and --force reaches no further
  node tools/sync-brand.mjs --remove <brand dir> <relpath>              delete a file or folder from the bucket that is gone
                                                                        here (renamed or deleted), e.g. outputs/<old ad folder>
  node tools/sync-brand.mjs --free <brand dir> [--dry-run]             delete heavy files here whose exact copy is in the
                                                                        bucket (never in an ad folder being edited); tools
                                                                        and Studio fetch them back when needed
  node tools/sync-brand.mjs --presign <brand dir> <id|relpath> [--expires 3600]   presigned GET URL for an original
  node tools/sync-brand.mjs --status <brand dir>                        local vs cloud, one-line report`;

const CUSTOM = '_custom';

const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }) : [])
  .filter((e) => !e.isDirectory()).map((e) => join(e.parentPath, e.name));

const isCatalog = (rel) => rel.includes('/_catalog/');
const isBrandKit = (rel) => rel.startsWith('inputs/media/brand/');
const isPreview = (rel) => /(^|\/)\.previews\/[^/]+\.\d+\.\d+\.mp4$/.test(rel);
const isHeavy = (rel) => isMedia(rel) && !isCatalog(rel) && !isBrandKit(rel) && !isPreview(rel);
const isSyncable = (rel) => !(isPreview(rel) ? dirname(dirname(rel)) : rel).split('/').some((seg) => seg.startsWith('.'));

function r2ForWorkspace(workspace, readOnly = false) {
  const env = loadEnv();
  const r2 = r2FromEnv(env, workspace) || (readOnly && r2Public(env, workspace));
  if (!r2) {
    const W = workspace.toUpperCase();
    console.error(`\nNo R2 credentials for workspace ${workspace}. Add to .env:`);
    console.error(`  ${W}_R2_ACCOUNT_ID=...\n  ${W}_R2_ACCESS_KEY_ID=...\n  ${W}_R2_SECRET_ACCESS_KEY=...\n  ${W}_R2_BUCKET=...`);
    console.error('(R2 → S3 API token with Object Read & Write on the bucket.)\n');
    process.exit(2);
  }
  return r2;
}

// A scope is one local dir mirrored under one bucket prefix: a brand path gives [brand, _custom].
function scopesFor(path) {
  const workspace = inferWorkspace(path);
  const name = inferBrand(path);
  if (!workspace || !name || (name.startsWith('_') && name !== CUSTOM)) return null;
  const dir = brandDirFrom(path);
  const isPublic = !!PUBLIC_BUCKETS[workspace];
  if (isPublic && name === CUSTOM) return null;
  const custom = { kind: 'custom', prefix: `${CUSTOM}/${workspace}`, dir: join(dirname(dir), CUSTOM), heavy: () => false, show: (rel) => `${CUSTOM}/${rel}` };
  const brand = { kind: 'brand', prefix: name, dir, heavy: isHeavy, show: (rel) => rel };
  const scopes = name === CUSTOM ? [custom] : isPublic ? [brand] : [brand, custom];
  return { workspace, scopes, isPublic };
}

function requireR2(path, readOnly = false) {
  const found = scopesFor(path);
  if (!found) { console.error('Run on a path under workspaces/<Workspace>/<Brand>/... (or workspaces/<Workspace>/_custom)'); process.exit(1); }
  return { r2: r2ForWorkspace(found.workspace, readOnly), ...found };
}

function workspaceFrom(v) {
  const s = String(v).replace(/\\/g, '/').replace(/\/+$/, '');
  const m = s.match(/(?:^|\/)workspaces\/([^/]+)/);
  return m ? m[1] : s && !s.includes('/') ? s : '';
}

const relOf = (dir, abs) => relative(dir, abs).split('\\').join('/');
const toKey = (scope, abs) => `${scope.prefix}/${relOf(scope.dir, abs)}`;
const toLocal = (scope, key) => join(scope.dir, key.slice(scope.prefix.length + 1));
const keyRel = (scope, key) => key.slice(scope.prefix.length + 1);

const selected = (scope, withOriginals) => walk(scope.dir).filter((f) => {
  const rel = relOf(scope.dir, f);
  return isSyncable(rel) && (withOriginals || !scope.heavy(rel));
});

const comparable = (etag) => !!etag && !etag.includes('-');
const sameContent = async (abs, o) => comparable(o.etag) && statSync(abs).size === o.size && (await hashFile(abs, 'md5')) === o.etag;

const statePath = (dir) => join(dir, '.sync-state.json');
function readState(dir) {
  try { return JSON.parse(readFileSync(statePath(dir), 'utf8')).etags || null; } catch { return null; }
}
function writeState(dir, etags) {
  if (existsSync(dir)) writeFileSync(statePath(dir), JSON.stringify({ syncedAt: new Date().toISOString(), etags }, null, 1));
}

async function remoteByRel(r2, scope) {
  const map = new Map();
  for (const o of await r2.listWithMeta(scope.prefix + '/')) {
    const rel = keyRel(scope, o.key);
    if (isSyncable(rel)) map.set(rel, o);
  }
  return map;
}

// A public bucket's listing, so it pulls without creds.
async function writeManifest(r2, scope) {
  const listing = (await r2.listWithMeta(scope.prefix + '/')).filter((o) => isSyncable(keyRel(scope, o.key)));
  await r2.put(`${scope.prefix}/${MANIFEST}`, JSON.stringify(listing), 'application/json');
}

// Ad folders being edited here: [rel prefix, lock] (brand scope only).
function editing(scope) {
  const dir = join(scope.dir, 'outputs');
  if (scope.kind !== 'brand' || !existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())
    .map((e) => [`outputs/${e.name}/`, readEditing(join(dir, e.name))]).filter(([, lock]) => lock);
}
const under = (locks, rel) => locks.find(([pre]) => rel.startsWith(pre));

// The part of the brand a push was pointed at: '' for the brand itself, else a rel path ('outputs/<ad>/').
function onlyFor(path, dir) {
  const rel = relOf(dir, resolve(path));
  if (!rel || rel.startsWith('..')) return '';
  return existsSync(resolve(path)) && statSync(resolve(path)).isDirectory() ? `${rel}/` : rel;
}
const inside = (only, rel) => !only || (only.endsWith('/') ? rel.startsWith(only) : rel === only);

const nfiles = (n) => `${n} file${n === 1 ? '' : 's'}`;
function deltaSummary(verb, nNew, nUpd, nSame) {
  if (!nNew && !nUpd) return `already up to date — nothing to ${verb === 'pushed' ? 'send' : 'download'} (${nfiles(nSame)})`;
  const parts = [];
  if (nNew) parts.push(`${nNew} new`);
  if (nUpd) parts.push(`${nUpd} updated`);
  return `${verb} ${parts.join(', ')}${nSame ? ` · ${nSame} already up to date` : ''}`;
}
const report = (scope, line) => console.log(scope.kind === 'brand' ? line : `workspace ${CUSTOM}: ${line}`);
const empty = (scope, remote) => scope.kind === 'custom' && !remote.size && !existsSync(scope.dir);

async function push(path, withOriginals, force) {
  const { r2, scopes: all, isPublic } = requireR2(path);
  const only = onlyFor(path, all[0].dir);
  const scopes = only ? all.slice(0, 1) : all;
  // Plan every scope first so a conflict stops the push before any upload.
  const plans = [];
  for (const scope of scopes) {
    const remote = await remoteByRel(r2, scope);
    if (empty(scope, remote)) continue;
    const seen = readState(scope.dir); // null = never synced → no guard
    const locks = editing(scope).filter(([pre]) => inside(only, pre) || only.startsWith(pre)), me = sessionId();
    const others = force ? [] : locks.filter(([, l]) => l.session !== me && l.session !== 'studio');
    const toSend = []; let same = 0;
    for (const f of selected(scope, withOriginals)) {
      const rel = relOf(scope.dir, f);
      if (!inside(only, rel) || under(others, rel)) continue;
      const o = remote.get(rel);
      if (o && await sameContent(f, o)) { same++; continue; }
      toSend.push({ f, rel, isNew: !o });
    }
    const conflicts = seen && !force ? toSend.filter(({ rel, isNew }) => !isNew && remote.get(rel).etag !== seen[rel]).map(({ rel }) => scope.show(rel)) : [];
    plans.push({ scope, remote, toSend, same, conflicts, release: locks.filter((l) => !others.includes(l)), others });
  }
  const conflicts = plans.flatMap((p) => p.conflicts);
  if (conflicts.length) {
    console.error(`Someone else saved newer work for this brand after you last downloaded it (${nfiles(conflicts.length)}). Pull the brand first to get their changes, or run again with --force to replace their version with yours.`);
    for (const c of conflicts.slice(0, 10)) console.error(`  ${c}`);
    if (conflicts.length > 10) console.error(`  …and ${conflicts.length - 10} more`);
    process.exit(1);
  }
  for (const { scope, remote, toSend, same, release, others } of plans) {
    let nNew = 0, nUpd = 0;
    for (const t of toSend) {
      await r2.putFile(toKey(scope, t.f), t.f, mimeOf(t.f));
      t.isNew ? nNew++ : nUpd++;
      if ((nNew + nUpd) % 25 === 0) console.error(`  …${nNew + nUpd}`);
    }
    const etags = {};
    for (const [rel, o] of remote) etags[rel] = o.etag;
    for (const t of toSend) etags[t.rel] = await hashFile(t.f, 'md5');
    writeState(scope.dir, etags);
    if (isPublic) await writeManifest(r2, scope);
    report(scope, deltaSummary('pushed', nNew, nUpd, same));
    for (const [pre] of release) rmSync(join(scope.dir, pre, EDITING), { force: true });
    for (const [pre, l] of others) console.log(`left out ${pre}: session ${l.session} is editing it (last change ${l.at}); it goes up when that session pushes, or push --force`);
  }
}

// A local file edited since the last sync and not pushed yet (with no sync state: newer than the cloud copy).
async function editedHere(f, seen, o) {
  const before = seen?.[o.rel];
  if (before) return (await hashFile(f, 'md5')) !== before;
  return statSync(f).mtimeMs > Date.parse(o.lastModified || 0);
}

async function pull(path, withOriginals, force) {
  const { r2, scopes } = requireR2(path, true);
  for (const scope of scopes) {
    const remote = await remoteByRel(r2, scope);
    if (empty(scope, remote)) continue;
    const seen = readState(scope.dir), locks = editing(scope), held = new Set();
    let nNew = 0, nUpd = 0, same = 0; const kept = [];
    for (const [rel, o] of remote) {
      if (!withOriginals && scope.heavy(rel)) continue;
      const dest = toLocal(scope, o.key);
      if (existsSync(dest) && await sameContent(dest, o)) { same++; continue; }
      const lock = under(locks, rel);
      if (lock) { held.add(lock[0]); kept.push(rel); continue; }
      if (!force && existsSync(dest) && await editedHere(dest, seen, { ...o, rel })) { kept.push(rel); continue; }
      const buf = await r2.get(o.key);
      if (!buf) continue; // deleted since listing
      const isNew = !existsSync(dest);
      mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, buf);
      isNew ? nNew++ : nUpd++;
      if ((nNew + nUpd) % 25 === 0) console.error(`  …${nNew + nUpd}`);
    }
    const etags = {}; // heavy included: the bucket state this pull saw; kept files keep their old mark
    for (const [rel, o] of remote) etags[rel] = kept.includes(rel) ? seen?.[rel] : o.etag;
    writeState(scope.dir, etags);
    report(scope, deltaSummary('downloaded', nNew, nUpd, same));
    for (const pre of held) console.log(`left ${pre} alone: it is being edited here (its push releases it)`);
    const loose = kept.filter((rel) => !under(locks, rel));
    if (loose.length) {
      console.log(`kept ${nfiles(loose.length)} edited here and not pushed yet (push them, or pull --force to replace them):`);
      for (const rel of loose) console.log('  ' + scope.show(rel));
    }
  }
}

// Deletes bucket copies of a file or folder that no longer exists here; push never deletes.
async function remove(path, ref) {
  const { r2, scopes, isPublic } = requireR2(path);
  const scope = scopes.find((s) => s.kind === 'brand') || scopes[0];
  const rel = String(ref || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!rel) usage(HELP);
  if (existsSync(join(scope.dir, rel))) { console.error(`${rel} still exists here; --remove only clears what is gone locally`); process.exit(1); }
  const gone = [...(await remoteByRel(r2, scope)).keys()].filter((k) => k === rel || k.startsWith(rel + '/'));
  if (!gone.length) { console.log(`nothing under ${rel} in the bucket`); return; }
  for (const k of gone) await r2.remove(`${scope.prefix}/${k}`);
  const seen = readState(scope.dir);
  if (seen) { for (const k of gone) delete seen[k]; writeState(scope.dir, seen); }
  if (isPublic) await writeManifest(r2, scope);
  console.log(`removed ${nfiles(gone.length)} under ${scope.show(rel)} from the bucket`);
}

// Deletes heavy files here that the bucket holds an exact copy of, outside ad folders being edited.
async function free(path, dryRun) {
  const { r2, scopes } = requireR2(path, true);
  const scope = scopes[0], only = onlyFor(path, scope.dir), locks = editing(scope), remote = await remoteByRel(r2, scope);
  let n = 0, mb = 0, kept = 0;
  for (const f of selected(scope, true)) {
    const rel = relOf(scope.dir, f);
    if (!scope.heavy(rel) || !inside(only, rel) || under(locks, rel)) continue;
    const o = remote.get(rel);
    if (!o || !(await sameContent(f, o))) { kept++; continue; }
    if (!dryRun) rmSync(f);
    n++; mb += o.size / 1e6;
  }
  console.log(`${dryRun ? 'would free' : 'freed'} ${nfiles(n)} (${Math.round(mb)} MB)${kept ? ` · kept ${nfiles(kept)} not in the bucket as is (push --originals first)` : ''}`);
}

async function presign(path, ref, expires) {
  if (!ref) usage(HELP);
  const { r2, scopes } = requireR2(path, true);
  const brand = scopes.find((s) => s.kind === 'brand');
  if (!brand) { console.error('--presign takes a brand dir'); process.exit(1); }
  // ref: a 5-digit id, a brand-relative path, or a bare filename under inputs/media/.
  let rel = ref;
  if (/^\d{5}$/.test(ref)) {
    const rec = readRecord(catalogPaths(brand.dir), ref);
    if (!rec) { console.error(`no record ${ref}`); process.exit(1); }
    rel = `inputs/media/${rec.file?.name || ref}`;
  } else if (!/^(inputs|outputs)\//.test(ref)) {
    rel = `inputs/media/${ref}`;
  }
  console.log(r2.presignGet(`${brand.prefix}/${rel}`, expires));
}

async function statusLine(r2, scope) {
  const remote = await remoteByRel(r2, scope);
  if (empty(scope, remote)) return null;
  const seen = readState(scope.dir) || {};
  let match = 0, newerHere = 0, newerCloud = 0, bothChanged = 0, onlyHereLight = 0, onlyHereHeavy = 0, cloudLight = 0, cloudHeavy = 0;
  for (const f of walk(scope.dir)) {
    const rel = relOf(scope.dir, f);
    if (!isSyncable(rel)) continue;
    const o = remote.get(rel);
    if (!o) { scope.heavy(rel) ? onlyHereHeavy++ : onlyHereLight++; continue; }
    remote.delete(rel);
    if (await sameContent(f, o)) { match++; continue; }
    const before = seen[rel];
    if (before && comparable(o.etag)) {
      if (o.etag === before) newerHere++;                  // cloud unchanged since last sync → the edit is ours
      else if ((await hashFile(f, 'md5')) === before) newerCloud++; // we're unchanged since last sync → the edit is theirs
      else bothChanged++;
    } else {
      // no last-seen state: fall back to timestamps
      statSync(f).mtimeMs > Date.parse(o.lastModified || 0) ? newerHere++ : newerCloud++;
    }
  }
  for (const rel of remote.keys()) scope.heavy(rel) ? cloudHeavy++ : cloudLight++;
  const seg = [];
  if (newerHere) seg.push(`${newerHere} newer here`);
  if (newerCloud) seg.push(`${newerCloud} newer in the cloud`);
  if (bothChanged) seg.push(`${bothChanged} changed in both places`);
  if (onlyHereLight) seg.push(`${onlyHereLight} only here (push to send them)`);
  if (onlyHereHeavy) seg.push(`${onlyHereHeavy} only here (push with --originals to send them)`);
  if (cloudLight) seg.push(`${cloudLight} only in the cloud (pull to get them)`);
  if (cloudHeavy) seg.push(`${cloudHeavy} only in the cloud (heavy files not downloaded)`);
  const drift = newerHere + newerCloud + bothChanged + onlyHereLight + onlyHereHeavy + cloudLight;
  if (!drift) return `up to date — ${nfiles(match)} match${seg.length ? ' · ' + seg.join(' · ') : ''}`;
  seg.push(`${match} match`);
  seg[0] = seg[0].replace(/^\d+/, (n) => `${n} file${n === '1' ? '' : 's'}`);
  return seg.join(' · ');
}

async function status(path) {
  const { r2, scopes } = requireR2(path, true);
  for (const scope of scopes) {
    const line = await statusLine(r2, scope);
    if (line) report(scope, line);
  }
}

// Top-level prefixes are brands; names starting with _ (like _custom) aren't.
async function listBrands(workspace) {
  const r2 = r2ForWorkspace(workspace);
  const counts = new Map();
  for (const o of await r2.listWithMeta()) {
    const i = o.key.indexOf('/');
    if (i <= 0 || !isSyncable(o.key)) continue;
    const brand = o.key.slice(0, i);
    if (brand.startsWith('_')) continue;
    counts.set(brand, (counts.get(brand) || 0) + 1);
  }
  if (!counts.size) { console.log(`No brands in the ${workspace} workspace yet — its bucket is empty.`); return; }
  const names = [...counts.keys()].sort((x, y) => x.localeCompare(y));
  const fmt = (n) => n.toLocaleString('en-US');
  const wName = Math.max(...names.map((n) => n.length));
  const wCount = Math.max(...names.map((n) => fmt(counts.get(n)).length));
  console.log(`Brands in the ${workspace} workspace (${names.length}):`);
  for (const n of names) console.log(`  ${n.padEnd(wName)}  ${fmt(counts.get(n)).padStart(wCount)} ${counts.get(n) === 1 ? 'file' : 'files'}`);
  console.log(`Pull one with: node tools/sync-brand.mjs --pull "workspaces/${workspace}/<Brand>"`);
}

const a = parseArgs(process.argv.slice(2), { flags: ['originals', 'force', 'dry-run'], help: HELP });
if (a.brands) {
  const ws = workspaceFrom(a.brands === true ? a._[0] || '' : a.brands);
  if (!ws) usage(HELP);
  await listBrands(ws);
  process.exit(0);
}
const dir = a.push || a.pull || a.presign || a.status || a.remove || a.free;
const path = dir && dir !== true ? dir : a._[0] || null;
if (!path) usage(HELP);
if (a.pull) await pull(path, !!a.originals, !!a.force);
else if (a.push) await push(path, !!a.originals, !!a.force);
else if (a.remove) await remove(path, a.remove === true ? a._[1] : a._[0]);
else if (a.presign) await presign(path, a.presign === true ? a._[1] : a._[0], a.expires ? +a.expires : 3600);
else if (a.status) await status(path);
else if (a.free) await free(path, !!a['dry-run']);
else usage(HELP);
