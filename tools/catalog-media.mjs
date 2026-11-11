#!/usr/bin/env node
// catalog-media.mjs — media to searchable library in one command. Idempotent: duplicates are skipped
// with their reason. A Drive folder is tracked in drive-sources.json, so re-runs download only new
// files. Each record's source: generated (--generated), the link it was pulled from, or an upload.
// --swipe marks the new files as swipe: ads to replicate, shown on Studio's Swipe page, not in footage searches.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { catalogPaths, mergeRecord, parseArgs, inferWorkspace, loadEnv, readRecord, typeOf, usage } from './lib/catalog.mjs';
import { planAndProbe } from './lib/media-probe.mjs';
import { analyzeMany } from './analyze-media.mjs';
import { embedAll } from './embed-media.mjs';
import { buildIndex } from './record-media.mjs';
import { r2FromEnv } from './lib/r2.mjs';
import { requireKeys, spendText } from './lib/analyze.mjs';
import { readDriveSources, writeDriveSources } from './lib/drive.mjs';

const TOOLS = fileURLToPath(new URL('.', import.meta.url));
const node = (script, args) => spawnSync(process.execPath, [join(TOOLS, script), ...args], { stdio: 'inherit' });

const HELP = `catalog-media.mjs — media to searchable library: pull → probe → analyze → embed → index → previews → push

  node tools/catalog-media.mjs --brand workspaces/<WS>/<Brand> [--source "<folder|Drive link|URL>"]
       [--generated | --swipe] [--jobs 2] [--no-push] [--dry-run]
    --source     what to add; without it, finishes what is pending and pushes
    --generated  the files were made by ADPK (else: the link each was pulled from, or an upload)
    --swipe      the files are ads or content to replicate (Studio's Swipe page; search-media --swipe)
    --jobs       videos probed at once (default 2, 1 on a light computer)
    --no-push    keep the library local (default: push to R2 when the workspace has keys)
    --dry-run    list what a Drive folder pull would download, then stop
Analysis: Gemini on kie.ai (<WS>_KIE_API_KEY; or sunra.ai, <WS>_SUNRA_API_KEY). Search vectors are made locally (no key).`;

const a = parseArgs(process.argv.slice(2), { flags: ['no-push', 'dry-run', 'generated', 'swipe'], help: HELP });
if (!a.brand) usage(HELP);
if (a.jobs) process.env.MEDIA_JOBS = String(a.jobs);
const brand = resolve(a.brand);
const paths = catalogPaths(brand);
const media = paths.media;
if (!a['dry-run']) requireKeys(media); // fail before any work

// 1. Pull — local folders are probed in place; links go through pull-media into a temp cache.
let dir = null, cache = null, drive = null;
if (a.source && !existsSync(a.source)) {
  cache = mkdtempSync(join(tmpdir(), 'catalog-'));
  const ok = node('pull-media.mjs', ['--source', a.source, '--out', cache, '--workspace', inferWorkspace(brand), '--brand', brand, ...(a['dry-run'] ? ['--dry-run'] : [])]).status === 0;
  if (!ok || a['dry-run']) { rmSync(cache, { recursive: true, force: true }); process.exit(ok ? 0 : 1); }
  try { drive = JSON.parse(readFileSync(join(cache, '.drive-pull.json'), 'utf8')); } catch {}
  dir = cache;
} else if (a['dry-run']) { console.error('--dry-run needs a Drive folder --source.'); process.exit(1); }
else if (a.source) {
  if (statSync(a.source).isFile()) { console.error('Pass a folder (put single files in a folder).'); process.exit(1); }
  dir = a.source;
}

const sources = drive ? readDriveSources(paths) : null;
const tracked = drive && (sources[drive.folderId] ||= { folderId: drive.folderId, files: {} });
// pull-media's .links.json (also left in a folder it pulled into earlier) names each file's link.
let links = {};
try { links = JSON.parse(readFileSync(join(dir, '.links.json'), 'utf8')); } catch {}
const sourceOf = (src) => (a.generated ? { kind: 'generated' } : links[basename(src)] ? { kind: 'link', url: links[basename(src)] } : { kind: 'upload' });

let fresh = 0, newIds = [];
try {
  // 2. Probe + place originals.
  if (dir) {
    const manifest = await planAndProbe({ dir, media, sourceOf });
    fresh = manifest.filter((m) => !m.existing).length;
    newIds = manifest.filter((m) => !m.existing).map((m) => m.id);
    if (a.swipe) for (const id of newIds) mergeRecord(paths, { id, swipe: true });
    for (const w of new Set(manifest.flatMap((m) => m.warnings || []))) console.error('WARN: ' + w);
    for (const m of manifest.filter((x) => x.existing && /^same bytes/.test(x.reason))) console.log(`skip ${basename(m.src)} — ${m.reason}`);
    console.log(`${manifest.length} files · ${fresh} new · ${manifest.length - fresh} already cataloged`);

    // Record Drive files now that they have catalog ids.
    if (drive) {
      const idOf = new Map(manifest.map((m) => [basename(m.src), m.id]));
      for (const f of drive.downloaded) tracked.files[f.id] = { name: f.name, modifiedTime: f.modifiedTime, catalogId: idOf.get(f.file) ?? null };
      for (const f of drive.listed) { const t = tracked.files[f.id]; if (t && !t.modifiedTime && f.modifiedTime) t.modifiedTime = f.modifiedTime; }
      writeDriveSources(paths, sources);
    }
  }

  // 3. Analyze new files plus any left unanalyzed.
  const res = await analyzeMany({ media, all: true });

  // 4. Vectors + index.
  await embedAll({ media });
  const n = buildIndex(paths);
  console.log(`catalog: ${n} assets · analysis ${spendText()}${res.failed.length ? ` · ${res.failed.length} failed analysis (re-run to retry)` : ''}`);

  // 5. Studio's preview copies of the new videos (after analysis renamed them; they sync), then push to R2 when the
  // workspace has creds — originals only when some were added or renamed.
  const newVideos = newIds.map((id) => readRecord(paths, id)?.file?.name).filter((f) => f && typeOf(f) === 'video').map((f) => join(media, f));
  if (newVideos.length) node('edit-video.mjs', ['previews', ...newVideos]);
  if (!a['no-push']) {
    if (r2FromEnv(loadEnv(), inferWorkspace(brand))) node('sync-brand.mjs', ['--push', brand, ...(fresh || res.done.length ? ['--originals'] : [])]);
    else console.log('No R2 creds for this workspace — library kept local only.');
  }

  if (drive) {
    console.log(`\nDrive "${drive.folderName}" (${drive.folderId}, via ${drive.via}): ${drive.downloaded.length} new · ${drive.seen} already seen · ${drive.notMedia.length} not media · ${drive.failed.length} failed`);
    console.log(`new catalog ids: ${newIds.join(', ') || 'none'}`);
    for (const f of drive.failed) console.log(`failed: ${f.name} (${f.id}): ${f.error} — retried next run`);
  }
} finally {
  if (cache) rmSync(cache, { recursive: true, force: true });
}
