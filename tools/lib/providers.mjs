// providers.mjs — the locked model list, kie.ai (the generation provider) with the optional sunra.ai
// and Vercel AI Gateway fallbacks, per-workspace keys, reference hosting and saving results, shared by
// generate-*.mjs.
//
// Submit once: when a provider returns a task id, poll it to the end (a second submission is a second
// charge).

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { brandDirFrom, extForMime, inferBrand, inferWorkspace, loadEnv, mimeOf, sleep, typeOf, wsKey } from './catalog.mjs';
import { fetchMissing, r2FromEnv } from './r2.mjs';

// The only models tools accept by name. kie = its model id (generate-*.mjs add the per-mode suffix);
// sunra = the same model on sunra.ai (https://sunra.ai/models; tools add /<operation>) and gateway =
// its AI Gateway id, each set only where that catalog carries it;
// fallback = the model to switch to when this one can't do the job (only the user switches).
// Request shapes and limits per model live in each tool, from the doc linked here.
export const MODELS = {
  'gpt-image-2.6':         { kind: 'image', kie: 'gpt-image-2-6/flare', sunra: 'openai/gpt-image-2.6-flare', gateway: 'openai/gpt-image-2.6-flare', fallback: 'nano-banana-2.1',
    doc: 'https://docs.kie.ai/market/gpt/gpt-image-2-6-flare-text-to-image.md' }, // + -image-to-image.md
  'nano-banana-2.1':       { kind: 'image', kie: 'nano-banana-2-1', sunra: 'google/gemini-nano-banana-2.1', gateway: 'google/gemini-nano-banana-2.1',
    doc: 'https://docs.kie.ai/market/google/nanobanana-2-1.md' },
  'minimax-h3':            { kind: 'video', kie: 'minimax-h3', sunra: 'minimax/minimax-h3', fallback: 'gemini-omni-1.2-flash',
    doc: 'https://docs.kie.ai/market/minimax-h3/text-to-video.md' }, // + image-to-video.md, reference-to-video.md
  'gemini-omni-1.2-flash': { kind: 'video', kie: 'google/gemini-omni-flash-1-2', sunra: 'google/gemini-omni-1.2-flash', fallback: 'seedance-2.5',
    doc: 'https://docs.kie.ai/market/google/gemini-omni-flash-1-2.md' },
  'seedance-2.5':          { kind: 'video', kie: 'bytedance/seedance-2-5', sunra: 'bytedance/seedance-2.5', gateway: 'bytedance/seedance-2.5',
    doc: 'https://docs.kie.ai/market/bytedance/seedance-2-5.md' },
  'gemini-3.8-flash-tts':  { kind: 'speech', kie: 'google/gemini-3-8-flash-tts', sunra: 'google/gemini-3.8-flash-tts', gateway: 'google/gemini-3.8-flash-tts',
    doc: 'https://docs.kie.ai/market/google/gemini-3-8-flash-tts.md' },
};

const modelNames = (kind) => Object.keys(MODELS).filter((m) => MODELS[m].kind === kind);
const fallbackHint = (name) => (MODELS[name]?.fallback ? ` Fallback: --model ${MODELS[name].fallback} (ask the user first).` : '');

// --model, or --unlisted-model: a raw kie id sent as-is with --model's request shape, unchecked.
export function pickModel(args, kind, fallbackName) {
  const name = String(args.model || fallbackName);
  if (!MODELS[name] || MODELS[name].kind !== kind) throw userError(`--model must be ${modelNames(kind).join(' | ')} (got "${name}").`);
  const raw = args['unlisted-model'];
  if (!raw) return { name, ...MODELS[name] };
  if (raw === true) throw userError('--unlisted-model needs a kie model id.');
  console.error(`WARN: unlisted model ${raw} — sent to kie as-is with ${name}'s request shape; nothing is checked.`);
  return { name: String(raw), kind, kie: String(raw), shape: name, unlisted: true };
}

// An error whose message is the whole story: errorText prints it without a stack.
export const userError = (message) => Object.assign(new Error(message), { quiet: true });
// Marks a failure before anything was generated, so the next provider may run; blocked(why) is one
// found locally (a request that provider can't take), before anything is uploaded.
const preSubmit = (e) => Object.assign(e instanceof Error ? e : new Error(String(e)), { preSubmit: true });
export const blocked = (why) => preSubmit(userError(why));
const firstLine = (m) => String(m || '').replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0];
// Our own and the Gateway's errors print without a stack.
export const errorText = (e) => (e?.quiet || /^Gateway/.test(e?.name || '') ? `${e.name && e.name !== 'Error' ? e.name + ': ' : ''}${e.message}` : e?.stack || String(e));

// In fallback order.
const PROVIDER_KEY = { kie: 'KIE_API_KEY', sunra: 'SUNRA_API_KEY', gateway: 'AI_GATEWAY_API_KEY' };
const PROVIDER_NAME = { kie: 'kie', sunra: 'sunra', gateway: 'the AI Gateway' };

// Only the inferred workspace's <WS>_* keys are used (no shared fallback). Sets the unprefixed names
// the clients read; returns { W, keys } (key presence).
export function workspaceKeys(paths, from = '--out') {
  const ws = [paths].flat().filter(Boolean).map((p) => inferWorkspace(String(p))).find(Boolean);
  if (!ws) throw userError(`Could not infer the workspace from ${from} (expected workspaces/<Workspace>/...).`);
  const W = ws.toUpperCase();
  const keys = {};
  for (const [q, name] of Object.entries(PROVIDER_KEY)) keys[q] = !!(process.env[name] = wsKey(W, name) || '');
  return { W, keys };
}

// --num and --timeout, as every generate-*.mjs reads them; runHelp is their --help lines, with
// --unlisted-model (unless unlisted is false) and --provider, plus a line of the fallbacks' limits
// (providers); envHelp the key line.
export const runOpts = (args, timeout) => ({ num: Math.max(1, parseInt(args.num || '1', 10)), timeout: parseInt(args.timeout || String(timeout), 10) });
export const runHelp = (timeout, { num = 'Variations (default 1)', providers = '', unlisted = true } = {}) => [
  `  --num <n>                ${num}`,
  `  --timeout <seconds>      Max wait per task (default ${timeout})`,
  ...(unlisted ? [
    "  --unlisted-model <id>    A kie model id outside the list, sent as-is with --model's request shape",
    "                           and no checks. Only with the user's yes",
  ] : []),
  '  --provider <p>           kie | sunra | gateway: force one. By default kie; a request it rejects',
  '                           before generating goes on to sunra.ai (<WS>_SUNRA_API_KEY), then the',
  '                           AI Gateway (<WS>_AI_GATEWAY_API_KEY)',
  ...(providers ? [`                           ${providers}`] : []),
].join('\n');
export const envHelp = (from = '--out') => `Env: <WORKSPACE>_KIE_API_KEY (or _SUNRA_API_KEY alone); the workspace comes from ${from}.`;

// The providers that carry the model and whose key the workspace has, in PROVIDER_KEY's order; the
// next one runs only on a pre-submit rejection. The Gateway is never first. `blocker` = why kie can't
// take this request (checked locally, so nothing is uploaded); the other runners throw blocked(why).
// --provider forces one. Returns { results, provider }.
export async function runProviders({ entry, provider = 'auto', ws, blocker, ...run }) {
  const p = String(provider).toLowerCase();
  const names = Object.keys(PROVIDER_KEY);
  if (p !== 'auto' && !names.includes(p)) throw userError(`--provider must be ${names.join(' | ')} (got "${provider}").`);
  const carries = (q) => run[q] && (q === 'kie' || entry[q]);
  const keyed = (q) => process.env[PROVIDER_KEY[q]];
  if (p !== 'auto') {
    if (!carries(p)) throw userError(`${entry.name} isn't on ${PROVIDER_NAME[p]}.`);
    if (!keyed(p)) throw userError(`Workspace ${ws} has no ${p} key. Add ${ws}_${PROVIDER_KEY[p]}=... to .env.`);
  }
  const chain = p !== 'auto' ? [p] : names.filter((q) => carries(q) && keyed(q));
  if (p === 'auto' && (!chain.length || chain[0] === 'gateway')) throw userError(`Workspace ${ws} has no kie key. Add ${ws}_KIE_API_KEY=... to .env.`);
  for (const [i, q] of chain.entries()) {
    try {
      if (q === 'kie' && blocker) throw blocked(`${entry.name} on kie: ${blocker}.`);
      return { results: await run[q](), provider: q };
    } catch (e) {
      if (!e?.preSubmit) throw e;
      const next = chain[i + 1];
      if (!next) throw userError(`${e.message}${entry.unlisted ? '' : fallbackHint(entry.name)}`);
      console.error(`note      ${q} rejected it before generating (${firstLine(e.message).slice(0, 160)}) — using ${PROVIDER_NAME[next]}.`);
    }
  }
}

// Retry a submit that failed before the job was accepted; `fatal` errors throw at once.
// Never wrap a poll in this: that would be a second paid generation.
export async function retryTransient(submit) {
  for (let attempt = 1; ; attempt++) {
    try { return await submit(); }
    catch (e) {
      if (e?.fatal || attempt >= 3) throw e;
      console.error(`  submit failed (attempt ${attempt}/3): ${firstLine(e.message)} — retrying...`);
      await sleep(3000);
    }
  }
}

// ---------- Gateway ----------
// Imported lazily so the kie path needs no npm install. Node's fetch drops a request after 5 min of
// silence, too short for video renders, hence the undici agent. Call sites pass maxRetries: 0: an SDK
// retry after a timeout is a second paid generation.
export async function gatewayClient(apiKey, timeoutSec = 1800) {
  let ai, createGateway;
  try { ai = await import('ai'); ({ createGateway } = await import('@ai-sdk/gateway')); }
  catch { throw new Error('The Gateway needs the AI SDK — run `npm install` in the repo root.'); }
  let fetchImpl;
  try {
    // undici's own fetch: its Agent can't drive Node's bundled (older) undici.
    const { Agent, fetch: undiciFetch } = await import('undici');
    const dispatcher = new Agent({ headersTimeout: timeoutSec * 1000, bodyTimeout: timeoutSec * 1000 });
    fetchImpl = (url, init) => undiciFetch(url, { ...init, dispatcher });
  } catch { /* undici missing: default fetch timeouts */ }
  return { ai, gw: createGateway({ apiKey, ...(fetchImpl ? { fetch: fetchImpl } : {}) }) };
}

// Unsupported settings are warnings on the Gateway, not errors.
export function logGatewayWarnings(warnings) {
  for (const w of warnings || []) console.error(`WARN: gateway ${w.feature || w.setting || w.type}: ${w.details || w.message || ''}`.trim());
}

// A local reference as a public URL for the Gateway: a 1-hour signed R2 URL (uploaded first if R2
// doesn't have it), or, for a workspace without R2, kie's or sunra's file hosting.
export async function presignRef(refPath, contextPath) {
  if (/^https?:\/\//i.test(refPath)) return refPath;
  const abs = resolve(refPath);
  if (!existsSync(abs)) throw userError(`reference not found: ${refPath}`);
  const brandDir = brandDirFrom(contextPath);
  const workspace = inferWorkspace(brandDir);
  const brand = inferBrand(brandDir);
  const r2 = workspace && r2FromEnv(loadEnv(), workspace);
  if (!r2) {
    if (process.env.KIE_API_KEY) return kieUpload(abs);
    if (process.env.SUNRA_API_KEY) return sunraUpload(abs);
    throw userError(`Local references need a public URL: add R2 or a kie key for workspace ${workspace || '?'}, or pass an https URL.`);
  }
  const rel = relative(brandDir, abs).replace(/\\/g, '/');
  if (!brand || rel.startsWith('../') || rel === '..')
    throw userError(`Local references must live inside ${brandDir} to get a signed R2 URL; move/catalog the file there or pass an https URL.`);
  const key = `${brand}/${rel}`;
  if (!(await r2.head(key))) {
    console.error(`not yet in R2, uploading ${basename(abs)} (${key})`);
    await r2.putFile(key, abs, mimeOf(abs));
  }
  const url = r2.presignGet(key, 3600);
  console.error(`presigned ${basename(abs)} from R2`);
  return url;
}

// ---------- kie.ai ----------
// Every call is HTTP 200 with a body `code` (200 = ok); results: GET /api/v1/jobs/recordInfo
// (https://docs.kie.ai/market/common/get-task-detail.md). Results are kept 14 days, uploads 24 hours.
export async function kie(path, { base = 'https://api.kie.ai', ...opts } = {}) {
  const res = await fetch(base + path, { ...opts, headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}`, ...opts.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw userError(`${path} -> HTTP ${res.status} ${JSON.stringify(json)}`);
  return json;
}

// One at a time, so the hosted URLs keep the refs' order. upload = kieUpload or sunraUpload.
export async function uploadAll(refs, upload = kieUpload) {
  const urls = [];
  for (const r of refs) urls.push(await upload(r));
  return urls;
}

// A local file the upload needs (a URL passes through as-is), else null.
async function localRef(refPath) {
  if (/^https?:\/\//i.test(refPath)) return null;
  const abs = resolve(refPath);
  await fetchMissing(abs);
  if (!existsSync(abs)) throw userError(`reference not found: ${refPath}`);
  return abs;
}

// https://docs.kie.ai/file-upload-api/upload-file-stream.md
export async function kieUpload(refPath) {
  const abs = await localRef(refPath);
  if (!abs) return refPath;
  const fd = new FormData();
  fd.append('file', new Blob([await readFile(abs)], { type: mimeOf(abs) }), basename(abs));
  fd.append('uploadPath', `${{ image: 'images', video: 'videos' }[typeOf(abs)] || 'audio'}/ad-production-kit`);
  const json = await kie('/api/file-stream-upload', { method: 'POST', body: fd, base: 'https://kieai.redpandaai.co' });
  const url = json?.data?.downloadUrl;
  if (!url) throw new Error(`upload failed for ${refPath}: ${JSON.stringify(json)}`);
  console.error(`uploaded  ${basename(abs)} -> ${url}`);
  return url;
}

// A createTask code other than 200 means no task was made (nothing billed): a pre-submit rejection,
// retried on 5xx and 429. pick(record, taskId) = the results of a successful task (default: its URLs).
export const kieUrls = (d) => JSON.parse(d.resultJson || '{}').resultUrls;
export async function kieJob(model, input, timeoutSec, { pollMs = 5000, pick = kieUrls } = {}) {
  const taskId = await retryTransient(async () => {
    const json = await kie('/api/v1/jobs/createTask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input }) });
    if (json?.code !== 200 || !json?.data?.taskId)
      throw Object.assign(preSubmit(userError(`kie rejected ${model} before generating: ${json?.msg || JSON.stringify(json)} (code ${json?.code})`)), { fatal: !(json?.code === 429 || json?.code >= 500) });
    return json.data.taskId;
  });
  console.error(`task      ${model} -> ${taskId}`);
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const d = (await kie(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`))?.data || {};
    if (d.state === 'success') {
      const results = pick(d, taskId) || [];
      if (!results.length) throw new Error(`task ${taskId} succeeded with no results`);
      console.error(`done      ${taskId}${d.creditsConsumed != null ? `  ${d.creditsConsumed} credits` : ''}`);
      return results;
    }
    if (d.state === 'fail') throw userError(`task ${taskId} failed: ${d.failMsg || 'unknown'}${d.failCode ? ` (failCode ${d.failCode})` : ''}`);
    if (Date.now() > deadline) throw new Error(`task ${taskId} timed out after ${timeoutSec}s (state=${d.state}); it may still finish and bill — check kie's logs before resubmitting`);
    console.error(`  ${taskId} ${d.state || 'pending'}${d.progress ? ` ${d.progress}%` : ''}`);
    await sleep(pollMs);
  }
}

// ---------- sunra.ai ----------
// Plain REST (https://docs.sunra.ai/multimodal/queue.md). A submit answered with a 4xx made no
// prediction; a failed prediction is never billed. Uploads are public and never expire.
export async function sunra(path, { body, ...opts } = {}) {
  const res = await fetch(`https://api.sunra.ai/v1${path}`, {
    ...opts, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    headers: { Authorization: `Key ${process.env.SUNRA_API_KEY}`, 'Content-Type': 'application/json', ...opts.headers },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(userError(`sunra ${path} -> HTTP ${res.status} ${json.error?.code || ''}: ${json.error?.message || JSON.stringify(json)}`), { status: res.status });
  return json;
}

// https://docs.sunra.ai/platform/file-upload.md: the same content type on both calls; only the
// file name's extension is kept.
export async function sunraUpload(refPath) {
  const abs = await localRef(refPath);
  if (!abs) return refPath;
  const type = mimeOf(abs);
  const { upload_url, file_url } = await sunra('/storage/upload/initiate', { body: { file_name: `ref${extname(abs).toLowerCase()}`, content_type: type } });
  const put = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': type }, body: await readFile(abs) });
  if (!put.ok) throw new Error(`upload failed for ${refPath}: HTTP ${put.status}`);
  console.error(`uploaded  ${basename(abs)} -> ${file_url}`);
  return file_url;
}

// One prediction on <model>/<operation>, polled to the end; returns the model's output object (its
// schema: the model's API tab on sunra.ai). A bad key stops here; another 4xx on submit, or a failed
// schema check, counts as pre-submit.
export async function sunraJob(path, input, timeoutSec, { pollMs = 5000 } = {}) {
  const id = await retryTransient(async () => {
    try { return (await sunra(`/queue/${path}`, { body: input })).request_id; }
    catch (e) {
      if (e.status >= 400 && e.status < 500 && e.status !== 429) Object.assign(e.status === 401 ? e : preSubmit(e), { fatal: true });
      throw e;
    }
  });
  if (!id) throw new Error(`sunra ${path} returned no request_id`);
  console.error(`task      ${path} -> ${id}`);
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    // A status call that fails on the network or the server is retried: the prediction keeps running.
    const s = await sunra(`/queue/requests/${id}/status`).catch((e) => {
      if (e.status && e.status < 500 && e.status !== 429) throw e;
      console.error(`  ${id} status check failed (${firstLine(e.message)}) — retrying`);
      return {};
    });
    if (s.status === 'COMPLETED') {
      if (!s.success) {
        const err = s.error || {};
        const fail = userError(`sunra ${id} failed: ${err.message || 'unknown'} (${[err.code, err.reason].filter(Boolean).join(', ')})`);
        throw err.reason === 'input_validation_failed' ? preSubmit(fail) : fail;
      }
      const out = await sunra(`/queue/requests/${id}`);
      console.error(`done      ${id}${s.billing?.amount != null ? `  $${s.billing.amount}` : ''}`);
      return out;
    }
    if (s.status === 'CANCELED') throw userError(`sunra ${id} was canceled`);
    if (Date.now() > deadline) throw new Error(`sunra ${id} timed out after ${timeoutSec}s (status=${s.status}); it may still finish and bill — check sunra's dashboard before resubmitting`);
    console.error(`  ${id} ${s.status || 'pending'}${s.queue_position ? ` (queue ${s.queue_position})` : ''}`);
    await sleep(pollMs);
  }
}

// n calls of fn at once (one per variation), flattened: kie returns a list per task.
export const times = async (n, fn) => (await Promise.all(Array.from({ length: n }, fn))).flat();

// ---------- saving results ----------
// foo.png + index 1 -> foo_2.png
export const suffixed = (p, i) => (i === 0 ? p : join(dirname(p), `${basename(p, extname(p))}_${i + 1}${extname(p)}`));

async function writeAs(outPath, ext, bytes) {
  const finalPath = `${outPath.replace(/\.[^./]+$/, '')}.${ext}`;
  await mkdir(dirname(resolve(finalPath)), { recursive: true });
  await writeFile(resolve(finalPath), bytes);
  return finalPath;
}

// A result's bytes and extension. The extension follows the actual bytes (from the content type, else
// the URL; '' if neither says): providers may return jpg for a png request.
export async function fetchResult(url) {
  const res = await fetch(url);
  if (!res.ok) throw userError(`download ${url} -> HTTP ${res.status}`);
  const ext = extForMime(res.headers.get('content-type')) || extname(new URL(url).pathname).slice(1).toLowerCase();
  return { bytes: Buffer.from(await res.arrayBuffer()), ext };
}
export async function downloadTo(url, outPath, { fallbackExt, transform = (b) => b } = {}) {
  const { bytes, ext } = await fetchResult(url);
  return writeAs(outPath, ext || fallbackExt, transform(bytes));
}

// Results are URLs (kie) or { bytes, mediaType | ext } (Gateway). Prints "Saved: <path>" per file.
export async function saveResults(results, out, { fallbackExt, transform = (b) => b } = {}) {
  const saved = [];
  for (const [i, r] of results.entries()) {
    const path = typeof r === 'string'
      ? await downloadTo(r, suffixed(out, i), { fallbackExt, transform })
      : await writeAs(suffixed(out, i), r.ext || extForMime(r.mediaType) || fallbackExt, transform(Buffer.from(r.bytes)));
    console.log('Saved: ' + path);
    saved.push(path);
  }
  return saved;
}

// A path relative to its brand folder when it is in one (URLs and other paths as given).
export const brandRel = (p) => (/^https?:\/\//i.test(p) || !inferBrand(p) ? p : relative(brandDirFrom(p), resolve(p)).replace(/\\/g, '/'));

// A file's sidecar: gen/<stem>.gen.json in its folder, so the folder holds only media (older ones sit beside the file).
// studio/lib/server/workflow.js and edit.js follow the same rule.
export const sidecarOf = (p) => join(dirname(p), 'gen', basename(p).replace(/\.[^.]+$/, '') + '.gen.json');
export const findSidecar = (p) => [sidecarOf(p), p.replace(/\.[^./]+$/, '') + '.gen.json'].find((s) => existsSync(s));

// A sidecar for each saved file, read by the Studio. Ref paths are brand-relative when possible.
// each[i] adds fields to saved[i]'s sidecar only.
export async function writeSidecars(saved, { tool, model, provider, params = {}, refs = [], prompt, each = [] }) {
  const common = {
    tool, model, provider, at: new Date().toISOString(),
    params: Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')),
    refs: refs.map(({ role, path }) => ({ role, path: brandRel(String(path)) })),
    prompt,
  };
  for (const [i, p] of saved.entries()) {
    const side = resolve(sidecarOf(p));
    await mkdir(dirname(side), { recursive: true })
      .then(() => writeFile(side, JSON.stringify({ ...common, ...each[i] }, null, 2) + '\n'))
      .catch((e) => console.error(`WARN: no sidecar for ${p}: ${e.message}`)); // never fail a paid generation over it
  }
}
