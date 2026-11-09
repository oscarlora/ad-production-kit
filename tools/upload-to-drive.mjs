// upload-to-drive.mjs — upload approved ad files to <workspace Drive folder>/<brand>/<ad group>/.
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs, die, markSent, usage } from './lib/catalog.mjs';
import { fetchMissing } from './lib/r2.mjs';
import { driveApi, listChildren, findChild, createFolder, brandFolders, driveForSpec, resolveGroupFolder, uploadFile } from './lib/drive.mjs';

const HELP = `upload-to-drive.mjs — upload approved ad files to <workspace Drive folder>/<brand>/<ad group>/

  node tools/upload-to-drive.mjs [--list] [--confirm] [--create] [--archive] <spec.json>
    --list     show the brand folders and their groups; writes nothing
    (plain)    plan: print what would be written where; writes nothing
    --confirm  upload. Same-named files are replaced, so re-runs never duplicate
    --create   allow creating a missing brand or group folder (ask the user first)
    --archive  move same-named files to the group's "Archived" folder first (revisions)

Spec: skills/upload-ads; the workspace and brand come from its path. Group folder = driveSubfolder,
else name. Brand folder = the brand's inputs/uploads.json drive.folder (exact), else spec.brand.`;
const args = parseArgs(process.argv.slice(2), { flags: ['list', 'confirm', 'create', 'archive'], help: HELP });
const specPath = args._[0];
if (!specPath) usage(HELP);

const { spec, workspace, token, parent, brand, exact } = await driveForSpec(specPath);
if (!brand) die('Spec needs "brand".');

if (args.list) {
  const { all, contains, match } = await brandFolders(parent, brand, token, { exact });
  console.log(`workspace: ${workspace} | parent ${parent} | brand ${exact ? 'pinned' : 'query'} "${brand}"\n`);
  console.log('Brand folders under parent:');
  for (const f of all) console.log(`  ${f === match ? '* ' : contains.includes(f) ? '? ' : '  '}${f.name}  (${f.id})`);
  for (const m of match ? [match] : contains) {
    const kids = await listChildren(m.id, token, { foldersOnly: true });
    console.log(`\nInside "${m.name}" (${m.id}):`);
    if (!kids.length) console.log('  (no subfolders — files would sit directly here)');
    for (const k of kids) console.log(`  [D] ${k.name}  (${k.id})`);
  }
  console.log(match
    ? `\n* = where uploads go. Pin it in inputs/uploads.json: { "drive": { "folder": "${match.name}" } }`
    : `\nNo single brand folder matched. Pin one in inputs/uploads.json: { "drive": { "folder": "<name above>" } }`);
  process.exit(0);
}

const files = spec.images || [];
await fetchMissing(files); // freed here (sync-brand --free): back from the bucket
const missing = files.filter((f) => !existsSync(f));
if (missing.length) die(`Missing local file(s): ${missing.join(', ')}`);
const group = spec.driveSubfolder || spec.name;
if (!group) die('Spec needs "name" (ad-group folder) or "driveSubfolder".');
const { brandFolder, groupFolder } = await resolveGroupFolder({
  parent, brand, exact, group, token, create: !!args.create, plan: !args.confirm,
  hint: 'Re-run with --create to create it, or fix the brand pin / driveSubfolder. (Run --list to inspect.)',
});

if (!args.confirm) {
  console.log(`workspace: ${workspace} | ${brandFolder.name} / ${group}`);
  if (!brandFolder.id) console.log(`  create folder ${brandFolder.name}`);
  if (!groupFolder.id) console.log(`  create folder ${brandFolder.name} / ${group}`);
  for (const f of files) {
    const existing = groupFolder.id && await findChild(groupFolder.id, basename(f), token);
    console.log(`  ${!existing ? 'create' : args.archive ? 'archive the old one, then create' : 'replace'} ${basename(f)}`);
  }
  console.log('\nPLAN ONLY — nothing written. Re-run with --confirm to upload.');
  process.exit(0);
}

console.log(`workspace: ${workspace} | ${brandFolder.name} / ${group} (${groupFolder.id})`);
if (args.archive) {
  let archived;
  for (const f of files) {
    const existing = await findChild(groupFolder.id, basename(f), token);
    if (!existing) continue;
    archived ||= (await findChild(groupFolder.id, 'Archived', token, { foldersOnly: true })) || (await createFolder(groupFolder.id, 'Archived', token));
    await driveApi(`https://www.googleapis.com/drive/v3/files/${existing.id}?addParents=${archived.id}&removeParents=${groupFolder.id}&supportsAllDrives=true&fields=id`, token, { method: 'PATCH' });
    console.log('  archived ' + basename(f));
  }
}
for (const f of files) console.log(`  ${(await uploadFile(groupFolder.id, f, token)).updated ? 'replaced' : 'created'} ${basename(f)}`);
const folderUrl = `https://drive.google.com/drive/folders/${groupFolder.id}`;
markSent(specPath, spec, 'drive', folderUrl);
console.log('done →', folderUrl);
