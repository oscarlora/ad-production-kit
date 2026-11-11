// The review link's server (tools/share-ads.mjs makes a brand's link; layout in tools/lib/share.mjs). The long random token
// in /s/<token> is the only key: anyone with the link sees its ads, downloads them and comments.
//   /s/<token>                 the page (public/)
//   /s/<token>/manifest.json   what the link shows
//   /s/<token>/f/<ad>/<path>   a listed file (Range for seeking; ?dl=1 downloads it)
//   /s/<token>/comments        GET every comment, POST a new one
const ROUTE = /^\/s\/([A-Za-z0-9_-]{22,64})(?:\/(.*))?$/;
const MAX_BODY = 8000, MAX_TEXT = 2000, MAX_NAME = 60;
const HEADERS = { 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' };

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (error, status = 400) => json({ error }, status);
const readJson = async (env, key) => { const o = await env.BUCKET.get(key); return o ? o.json() : null; };

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), m = ROUTE.exec(url.pathname);
    if (!m) return new Response('Not found', { status: 404, headers: HEADERS });
    const [, token, rest = ''] = m, base = `_shares/${token}/`;
    if (!rest) return env.ASSETS.fetch(new Request(new URL('/', url), req));
    const manifest = await readJson(env, `${base}manifest.json`);
    if (!manifest) return fail('gone', 404);
    if (rest === 'manifest.json') return json(manifest);
    if (rest.startsWith('f/')) return file(req, env, manifest, base, decodeURIComponent(rest.slice(2)), url.searchParams.has('dl'), ctx);
    if (rest === 'comments' && req.method === 'GET') return listComments(env, base);
    if (rest === 'comments' && req.method === 'POST') return addComment(req, env, manifest, base);
    return fail('not found', 404);
  },
};

// A listed file of an ad: a version, or (served, never commented on) a reference.
const findFile = (manifest, ad, path, refs = false) => {
  const a = manifest.ads.find((x) => x.id === ad);
  return [...(a?.files || []), ...(refs ? a?.about?.reference?.media || [] : [])].find((f) => f.path === path || (refs && (f.preview === path || f.stream === path)));
};

async function file(req, env, manifest, base, rel, download, ctx) {
  const [ad, ...parts] = rel.split('/'), path = parts.join('/');
  if (!findFile(manifest, ad, path, true)) return fail('not found', 404);
  // A versioned file (?v=) asked for whole is kept at Cloudflare's edge, so the next viewer gets it from close by.
  const edge = req.method === 'GET' && !req.headers.has('range') && new URL(req.url).searchParams.has('v') && caches.default;
  const hit = edge && await edge.match(req);
  if (hit) return hit;
  const key = `${base}files/${ad}/${path}`;
  const obj = req.method === 'HEAD' ? await env.BUCKET.head(key) : await env.BUCKET.get(key, { range: req.headers, onlyIf: req.headers });
  if (!obj) return fail('not found', 404);
  const h = new Headers(HEADERS);
  obj.writeHttpMetadata(h);
  h.set('etag', obj.httpEtag);
  h.set('accept-ranges', 'bytes');
  // ?v= is the file's version (the manifest's at), so a versioned URL never changes.
  h.set('cache-control', new URL(req.url).searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'private, max-age=300');
  if (download) h.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.split('/').pop())}`);
  if (req.method === 'HEAD') { h.set('content-length', obj.size); return new Response(null, { headers: h }); }
  if (!('body' in obj)) return new Response(null, { status: 304, headers: h });
  const r = obj.range;
  if (r && req.headers.has('range')) {
    const offset = r.suffix != null ? obj.size - r.suffix : r.offset ?? 0;
    const length = r.length ?? obj.size - offset;
    h.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    h.set('content-length', length);
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set('content-length', obj.size);
  const res = new Response(obj.body, { headers: h });
  if (edge) ctx.waitUntil(edge.put(req, res.clone()));
  return res;
}

async function listComments(env, base) {
  const keys = [];
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix: `${base}comments/`, cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : null;
  } while (cursor && keys.length < 2000);
  const all = await Promise.all(keys.map((k) => readJson(env, k).catch(() => null)));
  return json(all.filter(Boolean).sort((a, b) => a.at.localeCompare(b.at)));
}

// { ad, src (a file's path in the ad), text, by, box?: [x, y, w, h] (fractions), t?, to? (a video's moment or stretch, s) }
async function addComment(req, env, manifest, base) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return fail('too long', 413);
  let b;
  try { b = JSON.parse(raw); } catch { return fail('bad json'); }
  const ad = String(b?.ad ?? ''), src = String(b?.src ?? ''), f = findFile(manifest, ad, src);
  const text = String(b?.text ?? '').trim(), by = String(b?.by ?? '').trim();
  if (!f) return fail('no such file');
  if (!text || text.length > MAX_TEXT) return fail('text: 1 to 2000 characters');
  if (!by || by.length > MAX_NAME) return fail('name: 1 to 60 characters');
  const c = { id: newId(), ad, src, by, text, status: 'open', at: new Date().toISOString() };
  if (b.box != null) {
    const x = b.box;
    if (!Array.isArray(x) || x.length !== 4 || !x.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) || x[2] <= 0 || x[3] <= 0 || x[0] + x[2] > 1.001 || x[1] + x[3] > 1.001) return fail('bad box');
    c.box = x.map((v) => +v.toFixed(4));
  }
  if (f.kind === 'video') {
    const t = Number(b.t), to = b.to == null ? null : Number(b.to), end = (f.duration || 36000) + 1;
    if (!Number.isFinite(t) || t < 0 || t > end) return fail('bad time');
    c.t = +t.toFixed(3);
    if (to != null) { if (!Number.isFinite(to) || to <= t || to > end) return fail('bad stretch'); c.to = +to.toFixed(3); }
  }
  await env.BUCKET.put(`${base}comments/${ad}/${c.id}.json`, JSON.stringify(c), { httpMetadata: { contentType: 'application/json' } });
  return json(c, 201);
}

// Like Studio's comment ids (n + base 36), so the ad's comments/ takes it as is.
function newId() {
  const r = crypto.getRandomValues(new Uint8Array(4)), tail = [...r].map((x) => (x % 36).toString(36)).join('');
  return `n${Date.now().toString(36)}${tail}`;
}
