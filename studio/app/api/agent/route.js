// The chats started in Studio, newest first.
import { listChats } from '../../../lib/server/agent.js';
import { jsonRes } from '../../../lib/server/http.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try { return jsonRes({ chats: await listChats() }); } catch (e) { return jsonRes({ error: String(e?.message || e) }, 500); }
}
