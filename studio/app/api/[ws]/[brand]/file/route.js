// Serves a brand file by brand-relative path (?p=…); paths outside the brand dir and the shared library 403.
// A media original missing locally (light sync) redirects to a presigned R2 URL when creds exist.
// &w=<px> serves an image fit within px instead, or a light preview copy of a video that wide (for Studio's
// editor; exports read the original): made once per file version; a video's in a hidden .previews folder beside it.
// &tempo=<rate> serves its sound at that speed, pitch kept, and &sound=1 its sound alone (tools/lib/stretch.mjs, as the
// export does). &dl=1 sends it as a download.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { within } from '../../../../../lib/server/brands.js';
import { sharedLibraryDir } from '../../../../../lib/server/root.js';
import { catalogLib, hdrLib, r2For, stretchLib } from '../../../../../lib/server/tools.js';
import { brandRoute, fileResponse, jsonRes } from '../../../../../lib/server/http.js';

// The fitted copy's path, or the original when it isn't an image or video or can't be resized. A copy being made
// is shared by every request for it, so a page asking many times encodes it once. Video copies encode one at a time.
const making = new Map();
let videoQueue = Promise.resolve();
const queued = (fn) => (videoQueue = videoQueue.catch(() => {}).then(fn));
async function fitted(abs, w) {
  const { typeOf, imageFitCmd, videoPreviewCmd, videoPreviewOpts, runAsync, cachedFile } = await catalogLib();
  const type = typeOf(abs);
  if (type !== 'image' && type !== 'video') return abs;
  const px = Math.min(2048, Math.max(64, Math.round(w)));
  const key = `${abs}|${px}`;
  if (!making.has(key)) {
    const job = type === 'image'
      ? cachedFile(abs, { cache: 'ad-production-kit-thumbs', key: px, ext: 'jpg' }, (tmp) => runAsync(...imageFitCmd(abs, px, tmp), { allowFail: true }))
      : cachedFile(abs, videoPreviewOpts(px), (tmp) => queued(() => runAsync(...videoPreviewCmd(abs, px, tmp), { low: true })));
    making.set(key, job.finally(() => making.delete(key)));
  }
  try { return await making.get(key); } catch { return abs; }
}

export const GET = brandRoute(async (req, ctx) => {
  const q = new URL(req.url).searchParams;
  const rel = q.get('p') || '';
  if (!rel || rel.includes('\0')) return jsonRes({ error: 'bad path' }, 400);
  let abs = resolve(ctx.dir, rel);
  if (!within(ctx.dir, abs) && !within(sharedLibraryDir(), abs)) return jsonRes({ error: 'forbidden' }, 403);

  const relPosix = rel.replace(/\\/g, '/');
  if (!existsSync(abs) && relPosix.startsWith('inputs/media/')) {
    const r2 = await r2For(ctx.ws).catch(() => null);
    if (r2) return Response.redirect(r2.presignGet(`${ctx.brand}/${relPosix}`, 3600), 302);
  }
  const { stretched, soundRate } = await stretchLib();
  const { sdrSource } = await hdrLib();
  const rate = soundRate(q);
  if (rate && !existsSync(abs)) return jsonRes({ error: 'not found' }, 404);
  try {
    if (!rate && !q.has('dl') && existsSync(abs)) abs = await sdrSource(abs); // an HDR video's SDR copy, as the export decodes (tools/lib/hdr.mjs)
    return fileResponse(req, rate ? await stretched(abs, rate) : q.get('w') ? await fitted(abs, +q.get('w') || 800) : abs, { download: q.has('dl') });
  } catch (e) {
    return jsonRes({ error: String(e.message || e) }, 500);
  }
});
