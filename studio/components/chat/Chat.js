'use client';
// The chat page (/chat): talk to the agent (lib/server/agent.js) beside Studio. Studio's pages tell it where the user
// is, and it opens pages there, over the PageLink channel.
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { getJson, postJson } from '../../lib/client/api.js';
import { words } from '../../lib/client/format.js';
import Markdown from '../workflow/Markdown.js';
import { IcPen, IcUp, IcX } from '../icons.js';
import { CHANNEL } from './PageLink.js';

const LAST_KEY = 'ad-production-kit-studio:chat';
const SIGN_IN = /log ?in|auth|credential|401|subscription/i;

// Events (see toEvents in lib/server/agent.js) → { items, draft, busy, title }.
function fold(s, ev) {
  switch (ev.kind) {
    case 'log': return ev.log.reduce(fold, { items: [], draft: '', busy: false, title: '' });
    case 'user': return { ...s, items: [...s.items, { type: 'user', text: ev.text }] };
    case 'delta': return { ...s, draft: s.draft + ev.text };
    case 'text': return { ...s, draft: '', items: [...s.items, { type: 'text', text: ev.text }] };
    case 'tool': return { ...s, items: [...s.items, { type: 'tool', ...ev, state: 'run' }] };
    case 'done': return { ...s, items: s.items.map((it) => (it.type === 'tool' && it.id === ev.id ? { ...it, state: ev.error ? 'error' : 'done', out: ev.out } : it)) };
    case 'ask': return { ...s, items: [...s.items, { type: 'ask', ...ev, state: 'open' }] };
    case 'asked': return { ...s, items: s.items.map((it) => (it.type === 'ask' && it.ask === ev.ask ? { ...it, state: ev.allow ? 'allowed' : 'denied' } : it)) };
    case 'busy': return { ...s, busy: ev.busy, draft: ev.busy ? s.draft : '' };
    case 'error': return { ...s, items: [...s.items, { type: 'error', text: ev.text }] };
    case 'open': return { ...s, items: [...s.items, { type: 'open', path: ev.path }] };
    case 'title': return { ...s, title: ev.title };
    default: return s;
  }
}

// "/Acme/Brand/workflow/12" → "Brand · Workflow · 12"
const pageLabel = (p) => decodeURIComponent(p || '').split('/').filter(Boolean).slice(1).map(words).join(' · ');

function Tool({ it }) {
  const [open, setOpen] = useState(false);
  const state = { run: undefined, done: 'done', error: 'warn' }[it.state];
  return (
    <div className="chat__tool">
      <button type="button" className="chat__tool-row" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="dot" data-state={state} />
        <span className="chat__tool-name">{it.name.replace(/^mcp__\w+__/, '')}</span>
        <span className="chat__tool-what">{it.what}</span>
      </button>
      {open && <pre className="chat__out">{it.what}{it.out ? `\n\n${it.out}` : ''}</pre>}
    </div>
  );
}

function Ask({ it, onAnswer }) {
  if (it.state === 'allowed') return null;
  if (it.state === 'denied') return <div className="chat__line">Denied: {it.title}</div>;
  return (
    <div className="chat__ask">
      <p className="chat__ask-title">{it.title}</p>
      <pre className="chat__out">{it.what}</pre>
      <div className="chat__ask-actions">
        <button type="button" className="btn btn--mini btn--primary" onClick={() => onAnswer(it.ask, true)}>Allow</button>
        {it.always && <button type="button" className="btn btn--mini" onClick={() => onAnswer(it.ask, true, true)}>Always allow</button>}
        <button type="button" className="btn btn--mini" onClick={() => onAnswer(it.ask, false)}>Deny</button>
      </div>
    </div>
  );
}

export default function Chat() {
  const [id, setId] = useState(null);
  const [chats, setChats] = useState([]);
  const [s, dispatch] = useReducer(fold, { items: [], draft: '', busy: false, title: '' });
  const [text, setText] = useState('');
  const [page, setPage] = useState('');
  const [error, setError] = useState(null);
  const logRef = useRef(null);
  const stuck = useRef(true); // keep the log scrolled to the end while the user hasn't scrolled up
  const channel = useRef(null);

  const loadChats = () => getJson('/api/agent').then((d) => setChats(d.chats)).catch(() => {});
  const newChat = () => setId(crypto.randomUUID());

  useEffect(() => {
    let last = null;
    try { last = localStorage.getItem(LAST_KEY); } catch {}
    setId(last || crypto.randomUUID());
    loadChats();
    const ch = (channel.current = new BroadcastChannel(CHANNEL));
    ch.onmessage = (e) => { if (e.data?.page) setPage(e.data.page); };
    ch.postMessage({ where: true });
    return () => ch.close();
  }, []);

  useEffect(() => {
    if (!id) return undefined;
    try { localStorage.setItem(LAST_KEY, id); } catch {}
    dispatch({ kind: 'log', log: [] });
    const es = new EventSource(`/api/agent/${id}`);
    es.addEventListener('log', (e) => dispatch({ kind: 'log', log: JSON.parse(e.data) }));
    es.addEventListener('ev', (e) => {
      const ev = JSON.parse(e.data);
      if (ev.kind === 'open') channel.current?.postMessage({ open: ev.path });
      if (ev.kind === 'title' || (ev.kind === 'busy' && !ev.busy)) loadChats();
      dispatch(ev);
    });
    return () => es.close();
  }, [id]);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [s]);

  const act = (body) => postJson(`/api/agent/${id}`, body).then(() => setError(null)).catch((e) => setError(e.message));
  const sendText = () => {
    if (!text.trim()) return;
    stuck.current = true;
    act({ action: 'send', text, page });
    setText('');
  };
  const answer = (ask, allow, always) => act({ action: 'answer', ask, allow, always });
  const title = s.title || chats.find((c) => c.id === id)?.title || 'New chat';

  return (
    <div className="chat">
      <header className="chat__bar">
        <span className="chat__pick" title={title}>
          <span className="chat__title">{title}</span>
          <select className="chat__select" aria-label="Chats" value={id || ''} onChange={(e) => setId(e.target.value)}>
            {!chats.some((c) => c.id === id) && <option value={id || ''}>{title}</option>}
            {chats.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </span>
        <button type="button" className="btn btn--icon" title="New chat" aria-label="New chat" onClick={newChat}><IcPen /></button>
      </header>

      <div className="chat__log" ref={logRef} onScroll={(e) => { const el = e.currentTarget; stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {!s.items.length && !s.busy && <p className="chat__empty">Ask for an ad, a brand's research, or a change to anything open beside this chat.</p>}
        {s.items.map((it, i) => {
          if (it.type === 'user') return <div key={i} className="chat__you">{it.text}</div>;
          if (it.type === 'text') return <Markdown key={i} text={it.text} />;
          if (it.type === 'tool') return <Tool key={it.id} it={it} />;
          if (it.type === 'ask') return <Ask key={it.ask} it={it} onAnswer={answer} />;
          if (it.type === 'open') return <div key={i} className="chat__line">Opened {pageLabel(it.path)}</div>;
          return (
            <div key={i} className="chat__error">
              {it.text}
              {SIGN_IN.test(it.text) && <p>Sign in to Claude: in the Mac app, Ad Production Kit menu ▸ Sign in to Claude…; elsewhere, run <code>claude</code> in Terminal and type <code>/login</code>.</p>}
            </div>
          );
        })}
        {s.draft && <Markdown text={s.draft} />}
        {s.busy && !s.draft && <div className="chat__line chat__working">Working…</div>}
      </div>

      <div className="chat__compose">
        {page && <div className="chat__page" title={decodeURIComponent(page)}>On {pageLabel(page) || 'Home'}</div>}
        {error && <div className="chat__error">{error}</div>}
        <div className="chat__field">
          <textarea
            rows={1} value={text} placeholder="Message the agent" aria-label="Message"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendText(); } }}
          />
          {s.busy && !text.trim()
            ? <button type="button" className="chat__send" title="Stop" aria-label="Stop" onClick={() => act({ action: 'stop' })}><IcX /></button>
            : <button type="button" className="chat__send" title="Send" aria-label="Send" disabled={!text.trim()} onClick={sendText}><IcUp /></button>}
        </div>
      </div>
    </div>
  );
}
