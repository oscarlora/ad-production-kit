#!/usr/bin/env node
// record-ad.mjs — owns the ad record schema and builds the ads index.
// One record per ad at <Brand>/outputs/json/<id>.json. The agent writes the creative fields;
// generate-image.mjs --record stamps the generation.
//
//   {
//     "id": 41,
//     "status": "in-progress | pending-review | approved",    // making it · made, waiting for the user · approved
//     "concept":   { "product": "", "persona": "", "awareness": "", "angle": "", "format": "" },
//     "swipe":     "00198",                                           // the swipe item (catalog id) it replicates
//     "meta":      { "headline": "", "primary_text": "" },            // Meta in-platform copy, copied from the ad's meta.md (write-meta-copy)
//     "generation": {
//       "model": "gpt-image-2.6", "resolution": "2K", "aspect": "4:5",
//       "prompt": "the exact prompt", "refs": ["inputs/media/.../x.png"],
//       "output": "workspaces/<WS>/Acme/outputs/41_..._.png",      // the generator's --out as stamped:
//       "outputs": ["workspaces/<WS>/Acme/outputs/41_..._.png"],   //   repo-relative, or absolute
//       "generatedAt": "<iso>"
//     },
//     "sentTo":    { "drive": "<url>", "notion": "<url>" }             // where it was uploaded (upload-to-*)
//   }
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanImage } from './lib/clean-image.mjs';
import { REPO_ROOT, indexMarkdown, parseArgs, readRecords, usage } from './lib/catalog.mjs';
import { refreshShare } from './lib/share.mjs';

const HELP = `record-ad.mjs — rebuild a brand's ads index

  node tools/record-ad.mjs --index <brand outputs/ dir>   outputs/index.md from json/*.json; also strips
                                                          metadata from the images of approved ads and brings
                                                          the brand's review link up to date (share-ads.mjs)`;

const args = parseArgs(process.argv.slice(2), { flags: ['index'], help: HELP });
const dir = args._[0];
if (!args.index || !dir) usage(HELP);

const outputs = resolve(dir.replace(/\/(json|index\.md)\/?$/, ''));
const jsonDir = join(outputs, 'json');
if (!existsSync(jsonDir)) { console.error('no json/ dir at ' + jsonDir); process.exit(1); }

const recs = readRecords({ json: jsonDir }).sort((a, b) => (a.id || 0) - (b.id || 0));
// Hook 1 from the ad's brief (the newest .md in its folder). An ad's words live in its brief or its prompt.
const folders = readdirSync(outputs, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
function hook(r) {
  const dir = folders.find((n) => n.startsWith(`${r.id}_`));
  const mds = dir ? readdirSync(join(outputs, dir)).filter((n) => /\.md$/i.test(n) && !['analysis.md', 'meta.md'].includes(n)).map((n) => join(outputs, dir, n)) : [];
  const brief = mds.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  return brief && /^\|\s*\**Hook\s*1?\**\s*\|([^|]*)\|/im.exec(readFileSync(brief, 'utf8'))?.[1].trim();
}
// meta.md (**Headline** then **Primary text**, each a bold label over its text) → the record's meta.
for (const r of recs) {
  const dir = folders.find((n) => n.startsWith(`${r.id}_`));
  const md = dir && join(outputs, dir, 'meta.md');
  if (!md || !existsSync(md)) continue;
  const part = (label) => new RegExp(`^\\*\\*${label}\\*\\*\\s*$([\\s\\S]*?)(?=^\\*\\*[^*\\n]+\\*\\*\\s*$|(?![\\s\\S]))`, 'im').exec(readFileSync(md, 'utf8'))?.[1].trim() || '';
  const meta = { headline: part('Headline'), primary_text: part('Primary text') };
  if (JSON.stringify(meta) === JSON.stringify(r.meta)) continue;
  r.meta = meta;
  const file = join(jsonDir, `${r.id}.json`);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), meta }, null, 2) + '\n');
}
writeFileSync(join(outputs, 'index.md'), indexMarkdown({
  title: 'Ads index', noun: 'ad', from: 'outputs/json/*.json',
  cols: ['ID', 'Status', 'Product', 'Persona', 'Awareness', 'Angle', 'Format', 'Hook', 'Output'],
  rows: recs.map((r) => [r.id, r.status, r.concept?.product, r.concept?.persona, r.concept?.awareness, r.concept?.angle, r.concept?.format, hook(r), r.generation?.output]),
}));
console.log(`wrote ${join(outputs, 'index.md')} (${recs.length} ads)`);

// Output paths are repo-relative or absolute, as the generator stamped them.
const locate = (p) => { const abs = resolve(REPO_ROOT, p); return existsSync(abs) ? abs : null; };
let cleaned = 0;
for (const r of recs.filter((x) => x.status === 'approved')) {
  for (const out of new Set([r.generation?.output, ...(r.generation?.outputs || [])].filter(Boolean))) {
    const file = locate(out);
    if (!file) continue;
    const before = readFileSync(file);
    const after = cleanImage(before);
    if (after.length !== before.length) { writeFileSync(file, after); cleaned++; }
  }
}
if (cleaned) console.log(`stripped metadata from ${cleaned} approved image${cleaned === 1 ? '' : 's'}`);

// The brand's review link (share-ads.mjs), when it has one, shows the approved ads as they are now.
const shared = await refreshShare(resolve(outputs, '..')).catch((e) => console.error(`WARN: the review link didn't update: ${e.message}`));
if (shared) console.log(`review link: ${shared.ads.length} ads`);
