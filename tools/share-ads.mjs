#!/usr/bin/env node
// share-ads.mjs — a brand's review link, hosted by the workspace's Cloudflare Worker (share/) on its R2 bucket, so it
// works with this computer off. What it shows and the comment bridge: lib/share.mjs.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT, brandDirFrom, die, inferWorkspace, parseArgs, usage, wsKey } from './lib/catalog.mjs';
import { readShare, refreshShare, shareR2, sharePrefix, writeShare } from './lib/share.mjs';

const WRANGLER = 'wrangler@4.151.3';
const HELP = `share-ads.mjs — the brand's review link: one link that shows every approved ad (its record's status), with
each version (its final/ images and videos) and why it was made (its CONCEPT section). Whoever has it downloads
them and comments (a box on an image; a moment or stretch, and a box, on a video). Comments reach the ad's review
loop (edit-video.mjs comments) and its replies show on the page. record-ad.mjs --index keeps it current.

  node tools/share-ads.mjs <brand dir>              the link (made the first time, the same one after), brought up to date
  node tools/share-ads.mjs <brand dir> --list       the link and the ads on it
  node tools/share-ads.mjs <brand dir> --revoke     the link stops working (its comments stay); running it again
                                                    makes a new one
  node tools/share-ads.mjs --deploy <workspace>     put the page online, once per workspace (and after a change to
                                                    share/); needs <WS>_CLOUDFLARE_API_TOKEN and <WS>_R2_*; prints
                                                    the URL to set as <WS>_SHARE_URL`;

const args = parseArgs(process.argv.slice(2), { flags: ['list', 'revoke'], help: HELP });

if (args.deploy) {
  const ws = String(args.deploy === true ? args._[0] || '' : args.deploy), W = ws.toUpperCase();
  if (!ws) usage(HELP);
  const token = wsKey(ws, 'CLOUDFLARE_API_TOKEN'), account = wsKey(ws, 'R2_ACCOUNT_ID'), bucket = wsKey(ws, 'R2_BUCKET');
  if (!token || !account || !bucket) die(`set ${W}_CLOUDFLARE_API_TOKEN (Cloudflare → API Tokens → "Edit Cloudflare Workers"), ${W}_R2_ACCOUNT_ID and ${W}_R2_BUCKET in .env`);
  // share/wrangler.json with this workspace's bucket and name: a renamed Worker keeps its name (the first part of
  // <WS>_SHARE_URL's workers.dev host).
  const dir = join(REPO_ROOT, 'share'), base = JSON.parse(readFileSync(join(dir, 'wrangler.json'), 'utf8'));
  const tmp = mkdtempSync(join(tmpdir(), 'adpk-share-')), config = join(tmp, 'wrangler.json'), assets = join(tmp, 'public');
  // The page's files, with the masonry grid it shares with Studio's Board and Media.
  cpSync(join(dir, base.assets.directory), assets, { recursive: true });
  cpSync(join(REPO_ROOT, 'studio', 'lib', 'client', 'masonry.js'), join(assets, 'masonry.js'));
  cpSync(join(REPO_ROOT, 'studio', 'app', 'gallery.css'), join(assets, 'gallery.css'));
  const name = /^https:\/\/([\w-]+)\.[\w-]+\.workers\.dev/.exec(wsKey(ws, 'SHARE_URL') || '')?.[1] || `adpk-share-${ws.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
  writeFileSync(config, JSON.stringify({ ...base, name, main: join(dir, base.main),
    assets: { ...base.assets, directory: assets }, r2_buckets: [{ ...base.r2_buckets[0], bucket_name: bucket }] }));
  const r = spawnSync('npx', ['--yes', WRANGLER, 'deploy', '--config', config], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32',
    env: { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account }, stdio: ['inherit', 'pipe', 'inherit'] });
  process.stdout.write(r.stdout || '');
  const url = /https:\/\/[\w.-]+\.workers\.dev/.exec(r.stdout || '')?.[0];
  if (r.status || !url) die('the deploy failed (above)');
  console.log(`\nPut this line in .env:\n${W}_SHARE_URL=${url}`);
  process.exit(0);
}

const brand = args._[0] && brandDirFrom(args._[0]);
if (!brand || !existsSync(join(brand, 'outputs'))) usage(HELP);
const ws = inferWorkspace(brand), W = ws.toUpperCase();
const link = (token) => `${(wsKey(ws, 'SHARE_URL') || `<${W}_SHARE_URL>`).replace(/\/+$/, '')}/s/${token}`;
let s = readShare(brand);

if (args.list) {
  console.log(!s ? 'no link yet' : s.revoked ? `revoked ${s.revoked.slice(0, 10)}` : `${link(s.token)}\nads: ${s.ads.join(', ') || 'none approved yet'}`);
  process.exit(0);
}

const r2 = shareR2(brand) || die(`the review link lives in the workspace's R2 bucket: set ${W}_R2_* in .env (see .env.example)`);
if (args.revoke) {
  if (!s || s.revoked) die('no live link');
  for (const o of await r2.listWithMeta(`${sharePrefix(s.token)}files/`)) await r2.remove(o.key);
  await r2.remove(`${sharePrefix(s.token)}manifest.json`);
  writeShare(brand, { ...s, revoked: new Date().toISOString() });
  console.log('revoked: the link no longer opens');
  process.exit(0);
}

if (!s || s.revoked) writeShare(brand, (s = { token: randomBytes(24).toString('base64url'), created: new Date().toISOString(), ads: [] }));
const m = await refreshShare(brand, r2);
console.log(`${link(s.token)}\nads: ${m.ads.map((a) => a.id).join(', ') || 'none approved yet'}`);
if (!wsKey(ws, 'SHARE_URL')) console.error(`(no ${W}_SHARE_URL yet: put the page online with --deploy ${ws})`);
