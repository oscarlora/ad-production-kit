// One chat. GET: its events as SSE, from the start (`event: log`, all so far) then each new one (`event: ev`).
// POST { action: 'send', text, page } | { action: 'stop' } | { action: 'answer', ask, allow, always }.
import { answer, events, send, stop, subscribe } from '../../../../lib/server/agent.js';
import { jsonRes, localPost } from '../../../../lib/server/http.js';

export const dynamic = 'force-dynamic';

const ID = /^[0-9a-f-]{36}$/;
const HEARTBEAT_MS = 25_000;

export async function GET(req, { params }) {
  const { id } = await params;
  if (!ID.test(id)) return jsonRes({ error: 'bad chat id' }, 400);
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event, data) => { if (!closed) try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { closed = true; } };
      const log = await events(id);
      send('log', log); // then, with no await between, every event after it
      const unsub = subscribe(id, (ev) => send('ev', ev));
      const heartbeat = setInterval(() => { if (!closed) try { controller.enqueue(encoder.encode(': hb\n\n')); } catch {} }, HEARTBEAT_MS);
      cleanup = () => { closed = true; unsub(); clearInterval(heartbeat); try { controller.close(); } catch {} };
    },
    cancel() { cleanup(); },
  });
  req.signal.addEventListener('abort', () => cleanup());
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
}

export const POST = localPost(async (req, { params }) => {
  const { id } = await params;
  if (!ID.test(id)) return jsonRes({ error: 'bad chat id' }, 400);
  const body = await req.json();
  if (body.action === 'send' && body.text?.trim()) await send(id, body.text.trim(), body.page);
  else if (body.action === 'stop') await stop(id);
  else if (body.action === 'answer') answer(id, body.ask, !!body.allow, !!body.always);
  else return jsonRes({ error: 'unknown action' }, 400);
  return jsonRes({ ok: true });
});
