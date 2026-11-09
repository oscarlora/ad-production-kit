// Serves a brand file by brand-relative path (?p=…); paths outside the brand dir and the shared library 403.
// A brand file missing here (light sync, sync-brand --free) redirects to a presigned R2 URL when the workspace has a
// bucket; a video asked with &w, &tempo or &sound plays from its preview copy instead, here or fetched from the bucket.
// &w=<px> serves an image fit within px instead, or a light preview copy of a video that wide (for Studio's
// editor; exports read the original): made once per file version; a video's in a .previews folder beside it, which syncs.
// &tempo=<rate> serves its sound at that speed, pitch kept, and &sound=1 its sound alone (tools/lib/stretch.mjs, as the
// export does). &dl=1 sends it as a download.
import { existsSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { within } from '../../../../../lib/server/brands.js';
import { sharedLibraryDir } from '../../../../../lib/server/root.js';
import { catalogLib, hdrLib, r2For, stretchLib } from '../../../../../lib/server/tools.js';
import { brandRoute, fileResponse, jsonRes } from '../../../../../lib/server/http.js';

// A copy being made (or fetched) is shared by every request for it, so a page asking many times makes it once.
// Video copies encode one at a time.
const making = new Map();
const once = (key, fn) => {
  if (!making.has(key)) making.set(key, fn().finally(() => making.delete(key)));
  return making.get(key);
};
let videoQueue = Promise.resolve();
const queued = (fn) => (videoQueue = videoQueue.catch(() => {}).then(fn));
const pxOf = (w) => Math.min(2048, Math.max(64, Math.round(w)));

// The fitted copy's path, or the original when it isn't an image or video or can't be resized.
async function fitted(abs, w) {
  const { typeOf, imageFitCmd, videoPreviewCmd, videoPreviewOpts, runAsync, cachedFile } = await catalogLib();
  const { sdrSource } = await hdrLib();
  const type = typeOf(abs), px = pxOf(w);
  if (type !== 'image' && type !== 'video') return abs;
  try {
    return await once(`${abs}|${px}`, () => (type === 'image'
      ? cachedFile(abs, { cache: 'ad-production-kit-thumbs', key: px, ext: 'jpg' }, (tmp) => runAsync(...imageFitCmd(abs, px, tmp), { allowFail: true }))
      : cachedFile(abs, videoPreviewOpts(px), (tmp) => queued(async () => runAsync(...videoPreviewCmd(await sdrSource(abs), px, tmp), { low: true })))));
  } catch { return abs; }
}

// A video missing here: its preview copy px wide, here or fetched from the bucket into place, else null. The
// original's size names the copy; it is asked of the bucket once a minute at most.
const sizes = new Map();
async function remotePreview(r2, key, abs, px) {
  const { cachedFile, cachedPath, videoPreviewOpts } = await catalogLib();
  if (!sizes.has(key)) { sizes.set(key, r2.head(key).then((h) => h?.size).catch(() => null)); setTimeout(() => sizes.delete(key), 60e3); }
  const size = await sizes.get(key);
  if (!size) return null;
  const opts = { ...videoPreviewOpts(pxOf(px)), size }, out = cachedPath(abs, opts);
  if (existsSync(out)) return out;
  const copyKey = `${key.replace(/[^/]+$/, '')}.previews/${basename(out)}`;
  return once(copyKey, async () => {
    const buf = await r2.get(copyKey);
    return buf && cachedFile(abs, opts, (tmp) => writeFileSync(tmp, buf));
  }).catch(() => null);
}

export const GET = brandRoute(async (req, ctx) => {
  const q = new URL(req.url).searchParams;
  const rel = q.get('p') || '';
  if (!rel || rel.includes('\0')) return jsonRes({ error: 'bad path' }, 400);
  let abs = resolve(ctx.dir, rel);
  if (!within(ctx.dir, abs) && !within(sharedLibraryDir(), abs)) return jsonRes({ error: 'forbidden' }, 403);

  const { stretched, soundRate } = await stretchLib();
  const rate = soundRate(q), w = q.get('w') ? +q.get('w') || 800 : 0;
  try {
    if (!existsSync(abs)) {
      const r2 = within(ctx.dir, abs) && await r2For(ctx.ws).catch(() => null);
      if (!r2) return jsonRes({ error: 'not found' }, 404);
      const key = `${ctx.brand}/${relative(ctx.dir, abs).split(sep).join('/')}`;
      const { typeOf, PREVIEW_PX } = await catalogLib();
      const copy = (w || rate) && typeOf(abs) === 'video' && await remotePreview(r2, key, abs, w || PREVIEW_PX);
      if (copy) return fileResponse(req, rate ? await stretched(copy, rate) : copy);
      return Response.redirect(r2.presignGet(key, 3600), 302);
    }
    const { sdrSource } = await hdrLib();
    if (!rate && !w && !q.has('dl')) abs = await sdrSource(abs); // an HDR video's SDR copy, as the export decodes (tools/lib/hdr.mjs)
    return fileResponse(req, rate ? await stretched(abs, rate) : w ? await fitted(abs, w) : abs, { download: q.has('dl') });
  } catch (e) {
    return jsonRes({ error: String(e.message || e) }, 500);
  }
});
