// Studio's chat: Claude Code run through the Agent SDK on this computer's Claude login (the user's subscription, never
// an API key), in the repo root so it reads AGENTS.md and the skills. One live SDK session per open chat; the page
// gets its turns as events (see toEvents) over SSE (app/api/agent/[id]/route.js).
import { randomUUID } from 'node:crypto';
import { createSdkMcpServer, getSessionMessages, listSessions, query, renameSession, tagSession, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { repoRoot } from './root.js';

const TAG = 'studio'; // marks the sessions started here, so the chat list leaves out the user's other Claude Code sessions
const PAGE = /\s*<studio-page>[^<]*<\/studio-page>\s*$/; // the page the user was on, sent with each message

const APPEND = `You are the agent in ADPK Studio's chat panel. Studio is open beside this chat, so never launch Studio or open a browser: to show the user a page or an ad, call mcp__studio__open_page with its Studio path: /<Workspace>/<Brand>/<board|media|swipe|workflow>, or /<Workspace>/<Brand>/workflow/<ID> for an ad (folder names as they are under workspaces/). Title the session with mcp__studio__set_title. Each user message ends with <studio-page>: the page the user is looking at.`;

// Live chats outlive a page reload and a dev-mode module reload.
const chats = (globalThis.__adpkChats ||= new Map());
const listeners = (globalThis.__adpkChatListeners ||= new Map()); // id → Set of fn, for chats open or not yet started

// A stream of user messages the SDK reads from; it stays open, so the session keeps running between turns (and hears
// back from background commands).
function inbox() {
  const queue = [];
  let wake = null;
  return {
    push(m) { queue.push(m); wake?.(); },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (queue.length) yield queue.shift();
        await new Promise((r) => { wake = r; });
        wake = null;
      }
    },
  };
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const textOf = (content) => (typeof content === 'string' ? content : (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'));

// What a tool call does, in one line.
function summary(name, input = {}) {
  const v = input.command || input.file_path || input.path || input.pattern || input.url || input.query || input.skill || input.description || input.prompt;
  return clip(String(v ?? JSON.stringify(input)), 400);
}

// One SDK or transcript message → the page's events: user · text · tool · done.
function toEvents(m) {
  if (m.parent_tool_use_id || !m.message) return [];
  const { content } = m.message;
  if (m.type === 'assistant') {
    return content.flatMap((b) => (b.type === 'text' ? [{ kind: 'text', text: b.text }]
      : b.type === 'tool_use' && b.name !== 'ToolSearch' ? [{ kind: 'tool', id: b.id, name: b.name, what: summary(b.name, b.input) }] : []));
  }
  if (m.type !== 'user' || m.isSynthetic || m.isMeta) return [];
  if (typeof content === 'string') return content.startsWith('<') ? [] : [{ kind: 'user', text: content.replace(PAGE, '') }];
  return content.flatMap((b) => (b.type === 'tool_result' ? [{ kind: 'done', id: b.tool_use_id, error: !!b.is_error, out: clip(textOf(b.content), 4000) }]
    : b.type === 'text' && !b.text.startsWith('<') ? [{ kind: 'user', text: b.text.replace(PAGE, '') }] : []));
}

// The chats started here, newest first.
export async function listChats() {
  const all = await listSessions({ dir: repoRoot(), includeWorktrees: false, limit: 200 });
  return all.filter((s) => s.tag === TAG || chats.has(s.sessionId)).slice(0, 50)
    .map((s) => ({ id: s.sessionId, title: s.customTitle || s.summary.replace(PAGE, ''), at: s.lastModified }));
}

async function history(id) {
  const msgs = await getSessionMessages(id, { dir: repoRoot() }).catch(() => []);
  return msgs.flatMap(toEvents);
}

// A chat's events so far (a live chat's own log, which grows), and a way to hear the next ones: subscribe → unsubscribe.
export async function events(id) {
  const chat = chats.get(id);
  if (!chat) return history(id);
  await chat.ready;
  return chat.log;
}
export function subscribe(id, fn) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id).add(fn);
  return () => { listeners.get(id)?.delete(fn); if (!listeners.get(id)?.size) listeners.delete(id); };
}

// Registered at once, so a second message sent while it loads joins the same session.
function start(id) {
  const chat = { log: [], inbox: inbox(), asks: new Map() };
  chats.set(id, chat);
  chat.ready = run(id, chat);
  return chat;
}

async function run(id, chat) {
  const log = (chat.log = await history(id));
  chat.tagged = log.length > 0;
  const emit = (ev) => {
    if (ev.kind !== 'delta') chat.log.push(ev);
    for (const fn of listeners.get(id) || []) fn(ev);
  };
  chat.emit = emit;

  const studio = createSdkMcpServer({
    name: 'studio',
    tools: [
      tool('open_page', 'Show the user a Studio page beside the chat.', { path: z.string().describe('Studio path, e.g. /<Workspace>/<Brand>/workflow/<ID>') },
        async ({ path }) => { emit({ kind: 'open', path }); return { content: [{ type: 'text', text: `Opened ${path}` }] }; }),
      tool('set_title', 'Set the title of this chat.', { title: z.string() },
        async ({ title }) => { await renameSession(id, title, { dir: repoRoot() }); emit({ kind: 'title', title }); return { content: [{ type: 'text', text: 'Titled.' }] }; }),
    ],
  });

  // Ask the page before a tool runs (the user's Claude Code settings decide which ones need asking).
  const canUseTool = (name, input, { signal, suggestions, title }) => new Promise((resolve) => {
    const ask = randomUUID();
    const settle = (allow, always) => {
      if (!chat.asks.delete(ask)) return;
      emit({ kind: 'asked', ask, allow });
      resolve(allow ? { behavior: 'allow', updatedInput: input, ...(always && suggestions ? { updatedPermissions: suggestions } : {}) }
        : { behavior: 'deny', message: 'The user said no. Ask them in chat what to do instead.' });
    };
    chat.asks.set(ask, settle);
    signal.addEventListener('abort', () => settle(false));
    emit({ kind: 'ask', ask, title: title || name, what: summary(name, input), always: !!suggestions?.length });
  });

  // State events say when a turn, background work included, is over.
  const env = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'adpk-studio', CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' };
  delete env.ANTHROPIC_API_KEY; // the subscription, not a key that may sit in the shell

  chat.q = query({
    prompt: chat.inbox,
    options: {
      cwd: repoRoot(),
      ...(log.length ? { resume: id } : { sessionId: id }),
      env,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: APPEND },
      mcpServers: { studio },
      allowedTools: ['mcp__studio__open_page', 'mcp__studio__set_title'],
      disallowedTools: ['AskUserQuestion'], // AGENTS.md: questions go in chat
      canUseTool,
      includePartialMessages: true,
    },
  });

  (async () => {
    try {
      for await (const m of chat.q) {
        if (m.type === 'stream_event' && !m.parent_tool_use_id && m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta') {
          emit({ kind: 'delta', text: m.event.delta.text });
        } else if (m.type === 'system' && m.subtype === 'session_state_changed') {
          emit({ kind: 'busy', busy: m.state !== 'idle' });
        } else if (m.type === 'result') {
          if (m.subtype !== 'success' || m.is_error) emit({ kind: 'error', text: (m.errors || []).join('\n') || String(m.result || m.subtype) });
          if (!chat.tagged) { chat.tagged = true; tagSession(id, TAG, { dir: repoRoot() }).catch(() => {}); }
        } else if ((m.type === 'assistant' || m.type === 'user') && !m.isReplay) {
          for (const ev of toEvents(m)) emit(ev);
        }
      }
    } catch (e) {
      emit({ kind: 'error', text: String(e?.message || e) });
    } finally {
      chats.delete(id);
      emit({ kind: 'busy', busy: false });
      for (const settle of chat.asks.values()) settle(false);
    }
  })();
}

export async function send(id, text, page) {
  const chat = chats.get(id) || start(id);
  await chat.ready;
  chat.emit({ kind: 'user', text });
  chat.emit({ kind: 'busy', busy: true });
  chat.inbox.push({
    type: 'user',
    message: { role: 'user', content: page ? `${text}\n\n<studio-page>${page}</studio-page>` : text },
    parent_tool_use_id: null,
    session_id: id,
  });
}

export async function stop(id) {
  await chats.get(id)?.q.interrupt();
}

export function answer(id, ask, allow, always) {
  chats.get(id)?.asks.get(ask)?.(allow, always);
}
