#!/usr/bin/env node
// record-media.mjs — owns the media record schema and builds the catalog index.
// One record per file at inputs/media/_catalog/json/<id>.json. lib/media-probe.mjs writes the
// technical fields, analyze-media.mjs the analysis and transcript (embed-media.mjs keeps the search
// vectors apart, in _catalog/vectors.json).
//
// Schema (video/audio add scenes, transcript, sprites):
//   {
//     "id": "00042", "sha256": "<hex>",
//     "file": { "name","type":"image|video|audio","mime","bytes","width","height",
//               "orientation","aspect","duration","original" },   // original = the file name it came in as
//     "source": { "kind":"generated|link|upload", "url" },   // url = where a link file was pulled from
//     "swipe": true,                   // an ad or post to replicate (catalog-media --swipe), not footage
//     "products": [], "people": [], "unknown_people": [{ "ref","description" }],
//     "analysis": "",                  // video: its scenes, "[start–end s] description" each
//     "analyzed_by": { "model","at" },
//     "scenes": [{ "start","end","keyframe","description" }],
//     "transcript": { "language","text","segments":[{start,end,speaker,text}],"model",
//                     "words":[{start,end,word,speaker}],"words_model" },   // Whisper's words when it ran
//     "sprites": { "sheet","cols","rows","interval","frameW","frameH" },
//     "phash": "<hex>" | { "duration", "frames":[{t,h}] },  // near-duplicate fingerprint (lib/media-probe)
//     "status": "probed|cataloged"
//   }
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { catalogPaths, indexMarkdown, parseArgs, readRecords, usage } from './lib/catalog.mjs';

const HELP = `record-media.mjs — the media catalog's records and index (lib/catalog.mjs reads and writes them)

  node tools/record-media.mjs --index <media dir, or any path under it>   rebuild _catalog/index.md`;

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const dur = (s) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

export function buildIndex(paths) {
  const recs = readRecords(paths).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const rows = recs.map((r) => [
    r.id, r.file?.type, r.file?.orientation || '', r.source?.kind,
    (r.products || []).join(', '), [...(r.people || []), ...(r.unknown_people || []).map(() => '?')].join(', '),
    dur(r.file?.duration), clip(String(r.analysis || r.transcript?.text || '').replace(/\n/g, ' '), 70),
  ]);
  writeFileSync(paths.index, indexMarkdown({
    title: 'Media catalog index', noun: 'asset', from: '_catalog/json/*.json',
    cols: ['ID', 'Type', 'Orientation', 'Source', 'Products', 'People', 'Length', 'Analysis'], rows,
  }));
  return recs.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2), { help: HELP });
  const dir = args.index === true ? args._[0] : args.index;
  if (!dir) usage(HELP);
  const n = buildIndex(catalogPaths(dir));
  console.log(`wrote ${catalogPaths(dir).index} (${n} assets)`);
}
