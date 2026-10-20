// URL and request helpers (the pure ones serve the server too). Every path segment and query value is encoded once,
// here (brand names have spaces).
export const brandUrl = (ws, brand, tab) => `/${encodeURIComponent(ws)}/${encodeURIComponent(brand)}/${tab}`;

// ad = its outputs/ folder name.
export const workflowUrl = (ws, brand, ad) => `${brandUrl(ws, brand, 'workflow')}/${encodeURIComponent(ad)}`;

export const apiBase = (ws, brand) => `/api/${encodeURIComponent(ws)}/${encodeURIComponent(brand)}`;

// v = cache-buster for overwritten renders; w = serve an image fit within w px (a thumbnail).
export const fileUrl = (ws, brand, p, v, w) =>
  `${apiBase(ws, brand)}/file?p=${encodeURIComponent(p)}${v ? `&v=${encodeURIComponent(v)}` : ''}${w ? `&w=${w}` : ''}`;

// A media-library file (relative to inputs/media/) as a brand-relative path, and its URL.
export const mediaPath = (p) => `inputs/media/${p}`;
export const mediaUrl = (ws, brand, p) => fileUrl(ws, brand, mediaPath(p));

// A file's kind by its extension, as a browser shows it: 'image', 'video', 'audio' or ''. Keep the lists in step with
// typeOf in tools/lib/catalog.mjs (the browser can't import tools/).
export const mediaType = (p) => (/\.(png|jpe?g|webp|gif|avif)$/i.test(p) ? 'image' : /\.(mp4|mov|m4v|webm)$/i.test(p) ? 'video'
  : /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(p) ? 'audio' : '');

// A file's sound: a video's as the server's sound-only copy (sound=1), not the whole video. u: a file URL, its path
// in ?p= (Studio) or the URL path (the export server).
export const soundUrl = (u) => {
  const url = new URL(u, 'http://x');
  return mediaType(url.searchParams.get('p') || decodeURIComponent(url.pathname)) === 'video' ? `${u}${u.includes('?') ? '&' : '?'}sound=1` : u;
};

// A 404 without a JSON error means the server isn't serving the route (dev route-table drift): say restart.
const MISSING_ROUTE = 'Studio needs a restart: the server is not serving this part of the app. Stop it and run it again, then try once more.';

// A failed request throws an Error carrying the response's status and data.
async function request(url, init) {
  const r = await fetch(url, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(r.status === 404 && !data.error ? MISSING_ROUTE : (data.error || `HTTP ${r.status}`)), { status: r.status, data });
  return data;
}

export const getJson = (url) => request(url, { cache: 'no-store' });

export const postJson = (url, body) =>
  request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// mode: 'open' (default app) or 'reveal' (file manager).
export const openFile = (ws, brand, p, mode) => postJson(`${apiBase(ws, brand)}/open`, { path: p, mode });

// An ad's edit route: the returned function posts { ad, ...body } (the actions: app/api/[ws]/[brand]/edit/route.js).
export const editApi = (ws, brand, ad) => (body) => postJson(`${apiBase(ws, brand)}/edit`, { ad, ...body });
