// Route helpers: brand-scoped handlers, guarded writes, JSON responses, Range-aware file streaming.
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import { brandCtx } from './brands.js';
import { catalogLib } from './tools.js';

export const jsonRes = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// Wrap an /api/[ws]/[brand]/* handler: 404 on unknown brand, 500 on throw. ctx = { ws, brand, dir }.
export const brandRoute = (handler) => async (req, { params }) => {
  try {
    const ctx = await brandCtx(params);
    if (!ctx) return jsonRes({ error: 'unknown brand' }, 404);
    return await handler(req, ctx);
  } catch (e) {
    return jsonRes({ error: String(e?.message || e) }, 500);
  }
};

// Writes come only from this machine's pages: requiring JSON forces a CORS preflight (never granted) for
// cross-site requests, and local Origin + Host checks stop DNS rebinding and LAN access.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
function refuseForeign(req) {
  const type = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return jsonRes({ error: 'Content-Type must be application/json' }, 415);
  const origin = req.headers.get('origin');
  let originHost = '';
  try { originHost = origin ? new URL(origin).host : ''; } catch {}
  if ((origin && !LOCAL_HOST.test(originHost)) || !LOCAL_HOST.test(req.headers.get('host') || '')) {
    return jsonRes({ error: 'forbidden: local requests only' }, 403);
  }
  return null;
}

// brandRoute for non-GET handlers.
export const brandPost = (handler) => brandRoute((req, ctx) => refuseForeign(req) || handler(req, ctx));

// A guarded write outside a brand (the chat).
export const localPost = (handler) => async (req, ctx) => {
  try { return refuseForeign(req) || await handler(req, ctx); } catch (e) { return jsonRes({ error: String(e?.message || e) }, 500); }
};

// A file's bytes as a web stream that stops reading when the browser hangs up (a video scrubbed away mid-load):
// Readable.toWeb throws "Controller is already closed" there, an uncaught exception in the server.
function fileStream(req, abs, opts) {
  const node = createReadStream(abs, opts);
  return new ReadableStream({
    start(c) {
      req.signal?.addEventListener('abort', () => node.destroy());
      node.on('data', (b) => { try { c.enqueue(new Uint8Array(b)); if (c.desiredSize <= 0) node.pause(); } catch { node.destroy(); } });
      node.on('end', () => { try { c.close(); } catch {} });
      node.on('error', (e) => { try { c.error(e); } catch {} });
    },
    pull() { node.resume(); },
    cancel() { node.destroy(); },
  });
}

// download: send it as a file to save (Content-Disposition: attachment), not to show.
export async function fileResponse(req, abs, { download = false } = {}) {
  let st = null;
  try { st = abs && statSync(abs); } catch {}
  if (!st?.isFile()) return jsonRes({ error: 'not found' }, 404);
  const { mimeOf } = await catalogLib();
  const size = st.size;
  const type = mimeOf(abs);
  // The browser keeps what it fetched and asks again with this tag; an unchanged file answers 304, with no body.
  const etag = `"${size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
  const cache = { ETag: etag, 'Last-Modified': st.mtime.toUTCString(), 'Cache-Control': 'no-cache' };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: cache });
  const range = req.headers.get('range');
  let start = 0, end = size - 1;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
    start = m[1] ? +m[1] : 0;
    end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
  }
  return new Response(fileStream(req, abs, range ? { start, end } : {}), {
    status: range ? 206 : 200,
    headers: {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      ...cache,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      ...(download ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(basename(abs))}` } : {}),
    },
  });
}
