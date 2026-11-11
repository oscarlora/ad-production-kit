// analyze.mjs — the media catalog's JSON calls: Gemini 3.6 Flash on kie.ai (<WS>_KIE_API_KEY), media
// sent inline. When kie still fails after its retries (or the workspace has no kie key), that one call
// goes to the same model on sunra.ai (<WS>_SUNRA_API_KEY), then to Gemini Flash Lite on the Vercel AI
// Gateway (<WS>_AI_GATEWAY_API_KEY).
import { readFileSync } from 'node:fs';
import { loadEnv, inferWorkspace, sleep, wsKey } from './catalog.mjs';
import { PUBLIC_BUCKETS } from './r2.mjs';
import { gatewayClient } from './providers.mjs';

export const ANALYSIS_MODEL = 'gemini-3-6-flash';
const SUNRA_MODEL = 'google/gemini-3.6-flash';
const FALLBACK_MODEL = 'google/gemini-3.1-flash-lite';
// Media travels inline (base64, +33%); kie rejects bodies over 30 MB (sunra 64 MB) and ignores file links.
export const INLINE_MAX = 14 * 1024 * 1024;

// This process's spend: kie credits (1 credit ≈ $0.005), sunra calls (billed per token, shown in its
// dashboard) and Gateway fallback USD.
export const spend = { credits: 0, sunra: 0, usd: 0 };
export const spendText = () => `${spend.credits.toFixed(2)} kie credits${spend.sunra ? ` + ${spend.sunra} sunra calls` : ''}${spend.usd ? ` + $${spend.usd.toFixed(4)} AI Gateway` : ''}`;

// A public workspace (the shared library) borrows any workspace's key when it has none of its own.
function keyFor(anyPath, suffix) {
  const ws = inferWorkspace(anyPath);
  const own = (ws && wsKey(ws, suffix)) || '';
  if (own || !PUBLIC_BUCKETS[ws]) return own;
  return Object.entries({ ...loadEnv(), ...process.env }).find(([k, v]) => k.endsWith(`_${suffix}`) && v)?.[1] || '';
}
export const analysisKeys = (anyPath) => ({ kie: keyFor(anyPath, 'KIE_API_KEY'), sunra: keyFor(anyPath, 'SUNRA_API_KEY'), gateway: keyFor(anyPath, 'AI_GATEWAY_API_KEY') });
export function requireKeys(anyPath) {
  const keys = analysisKeys(anyPath);
  if (!keys.kie && !keys.sunra) {
    console.error(`No kie key: add ${inferWorkspace(anyPath).toUpperCase() || '<WS>'}_KIE_API_KEY=... to .env (https://kie.ai/api-key).`);
    process.exit(2);
  }
  return keys;
}

export const filePart = (path, mime) => ({ inline_data: { mime_type: mime, data: readFileSync(path).toString('base64') } });

// kie answers errors as HTTP 200 + { code, msg }; these codes, network errors and malformed JSON
// (kie doesn't enforce the schema) are worth a retry; a reply cut off at the output limit is not.
const RETRY = new Set([429, 455, 500, 501, 502, 503, 504]);
const fail = (msg, retry) => Object.assign(new Error(msg), { retry });

// One streamed call → { text, used } (output tokens, thinking included). The stream's last data chunk
// carries usageMetadata and credits_consumed.
async function kieCall(key, body) {
  let res, raw;
  try {
    res = await fetch(`https://api.kie.ai/gemini/v1/models/${ANALYSIS_MODEL}:streamGenerateContent`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(600_000),
    });
    raw = await res.text();
  } catch (e) { throw fail(`kie: ${e.cause?.message || e.message}`, true); }
  if (!res.ok) throw fail(`kie: HTTP ${res.status} ${raw.slice(0, 200)}`, res.status === 429 || res.status >= 500);
  const chunks = raw.trimStart().startsWith('{') ? [raw] : raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter((l) => l && l !== '[DONE]');
  let text = '', used = 0;
  for (const c of chunks) {
    let j; try { j = JSON.parse(c); } catch { throw fail(`kie: unreadable stream chunk ${c.slice(0, 120)}`, true); }
    if (j.code && j.code !== 200) throw fail(`kie: code ${j.code}: ${j.msg}`, RETRY.has(j.code));
    for (const p of j.candidates?.[0]?.content?.parts || []) if (!p.thought && p.text) text += p.text;
    if (j.usageMetadata) used = (j.usageMetadata.thinkingTokenCount || 0) + (j.usageMetadata.candidatesTokenCount || 0);
    if (j.credits_consumed) spend.credits += +j.credits_consumed;
  }
  return { text, used };
}

// sunra's OpenAI-style chat API (https://docs.sunra.ai/llm/chat.md), streamed: its edge drops a request
// that is silent for ~2 minutes. Media goes as data URLs, audio as input_audio.
async function sunraCall(key, { parts, schema, temperature, maxOutputTokens }) {
  const content = parts.map((p) => {
    if (p.text != null) return { type: 'text', text: p.text };
    const { mime_type: mime, data } = p.inline_data;
    if (mime.startsWith('audio/')) return { type: 'input_audio', input_audio: { data, format: mime === 'audio/mpeg' ? 'mp3' : mime.split('/')[1] } };
    const type = mime.startsWith('video/') ? 'video_url' : 'image_url';
    return { type, [type]: { url: `data:${mime};base64,${data}` } };
  });
  let res, raw;
  try {
    res = await fetch('https://api-llm.sunra.ai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: SUNRA_MODEL, stream: true, temperature, messages: [{ role: 'user', content }],
        response_format: { type: 'json_schema', json_schema: { name: 'reply', schema } },
        ...(maxOutputTokens ? { max_completion_tokens: maxOutputTokens } : {}),
      }),
      signal: AbortSignal.timeout(600_000),
    });
    raw = await res.text();
  } catch (e) { throw fail(`sunra: ${e.cause?.message || e.message}`, true); }
  if (!res.ok) throw fail(`sunra: HTTP ${res.status} ${raw.slice(0, 200)}`, res.status === 429 || res.status >= 500);
  spend.sunra++;
  let text = '', finish = '';
  for (const line of raw.split('\n')) {
    const d = line.startsWith('data:') ? line.slice(5).trim() : '';
    if (!d || d === '[DONE]') continue;
    let j; try { j = JSON.parse(d); } catch { throw fail(`sunra: unreadable stream chunk ${d.slice(0, 120)}`, true); }
    if (j.error) throw fail(`sunra: ${j.error.message || JSON.stringify(j.error)}`, true);
    text += j.choices?.[0]?.delta?.content || '';
    finish = j.choices?.[0]?.finish_reason || finish;
  }
  return { text, cut: finish === 'length' };
}

async function viaGateway(key, { parts, schema, temperature, maxOutputTokens }) {
  const { ai, gw } = await gatewayClient(key);
  const content = parts.map((p) => (p.text != null ? { type: 'text', text: p.text } : { type: 'file', data: p.inline_data.data, mediaType: p.inline_data.mime_type }));
  const { output, providerMetadata } = await ai.generateText({
    model: gw(FALLBACK_MODEL), output: ai.Output.object({ schema: ai.jsonSchema(schema) }),
    messages: [{ role: 'user', content }], temperature, maxOutputTokens, maxRetries: 2,
  });
  spend.usd += +(providerMetadata?.gateway?.cost ?? 0);
  return output;
}

// → { out, model }. Up to TRIES calls on kie with a short backoff, then up to 2 on sunra, then the
// Gateway, each when the workspace has its key. An unparseable reply throws "unparseable JSON".
const TRIES = 4;
export async function generateJSON(keys, { parts, schema, temperature = 0, maxOutputTokens }) {
  const req = { parts, schema, temperature, maxOutputTokens };
  const body = {
    stream: true,
    contents: [{ role: 'user', parts: [...parts, { text: `Reply with only a JSON object matching this JSON Schema:\n${JSON.stringify(schema)}` }] }],
    generationConfig: { temperature, responseMimeType: 'application/json', responseJsonSchema: schema, ...(maxOutputTokens ? { maxOutputTokens } : {}) },
  };
  const kie = async () => { const { text, used } = await kieCall(keys.kie, body); return { text, cut: maxOutputTokens && used >= maxOutputTokens * 0.98 }; };
  const calls = [...(keys.kie ? [['kie', TRIES, kie]] : []), ...(keys.sunra ? [['sunra', 2, () => sunraCall(keys.sunra, req)]] : [])];
  let err = new Error('no kie or sunra key for the analysis');
  for (const [who, tries, call] of calls) {
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        const { text, cut } = await call();
        let json; try { json = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw fail(`${who}: unparseable JSON reply${cut ? ' (cut off at the output limit)' : ''}`, !cut); }
        return { out: fit(Array.isArray(json) && schema.type === 'object' ? json[0] : json, schema), model: ANALYSIS_MODEL };
      } catch (e) {
        err = e;
        if (!e.retry || attempt === tries) break;
        console.error(`${e.message} — retrying ${who} (${attempt}/${tries - 1})`);
        await sleep(2000 * 2 ** attempt);
      }
    }
    if (who === 'kie' && keys.sunra) console.error(`${err.message} — kie failed, trying sunra`);
  }
  if (!keys.gateway) throw err;
  console.error(`${err.message} — falling back to the AI Gateway (${FALLBACK_MODEL})`);
  return { out: await viaGateway(keys.gateway, req), model: FALLBACK_MODEL };
}

// kie accepts responseJsonSchema but doesn't enforce it: coerce the reply to the schema (numbers from
// "20.6s" or "1:05", safe defaults for missing fields, `scene_id` read as `index`).
function fit(v, s) {
  if (s.type === 'object') {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    return Object.fromEntries(Object.entries(s.properties).map(([k, p]) => [k, fit(o[k] ?? (k === 'index' ? o.scene_id : undefined), p)]));
  }
  if (s.type === 'array') return Array.isArray(v) ? v.map((x) => fit(x, s.items)) : [];
  if (s.type === 'number' || s.type === 'integer') {
    const n = typeof v === 'string' && v.includes(':') ? v.split(':').reduce((a, x) => a * 60 + parseFloat(x), 0) : parseFloat(v);
    return Number.isFinite(n) ? (s.type === 'integer' ? Math.round(n) : n) : 0;
  }
  if (s.type === 'boolean') return v === true || v === 'true';
  return v == null ? '' : String(v);
}
