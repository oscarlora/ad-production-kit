'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBase, getJson } from './api.js';
import { columnsFor } from './masonry.js';

export { masonry } from './masonry.js';

// One watch stream per brand for the whole browser: an open stream holds one of the browser's 6 connections to
// Studio, shared by every tab and pane. The tab holding the brand's lock streams and relays each event to the
// others; when it closes, the next takes over. fn('change') on each change, fn('missed') when changes may have
// been missed (the stream reconnected after a Studio restart, or a tab took over).
const watches = new Map();
function watchBrand(ws, brand, fn) {
  const key = `studio-watch:${ws}/${brand}`;
  let w = watches.get(key);
  if (!w) {
    const fns = new Set(), emit = (type) => fns.forEach((f) => f(type));
    const bc = new BroadcastChannel(key), quit = new AbortController();
    bc.onmessage = (e) => emit(e.data);
    navigator.locks.request(key, { signal: quit.signal }, () => !quit.signal.aborted && new Promise((done) => {
      const send = (type) => { emit(type); bc.postMessage(type); };
      let es = null, timer = 0, dropped = false;
      // The browser retries a dropped stream itself, but gives up for good on an error reply
      // (Studio still starting); then reconnect by hand.
      const connect = () => {
        es = new EventSource(`${apiBase(ws, brand)}/watch`);
        es.addEventListener('change', () => send('change'));
        es.addEventListener('open', () => { if (dropped) { dropped = false; send('missed'); } });
        es.addEventListener('error', () => {
          dropped = true;
          if (es.readyState === EventSource.CLOSED && !quit.signal.aborted) timer = setTimeout(connect, 2000);
        });
      };
      connect();
      send('missed');
      quit.signal.addEventListener('abort', () => { clearTimeout(timer); es.close(); done(); });
    })).catch(() => {}); // quit while waiting for the lock
    w = { fns, stop: () => { quit.abort(); bc.close(); watches.delete(key); } };
    watches.set(key, w);
  }
  w.fns.add(fn);
  return () => { w.fns.delete(fn); if (!w.fns.size) w.stop(); };
}

// Load /api/[ws]/[brand]/<kind>; reload on each change in the brand (updatedAt bumps then), and once when
// changes may have been missed.
export function useBrandData(ws, brand, kind) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(0);

  const load = useCallback(
    () => getJson(`${apiBase(ws, brand)}/${kind}`).then((d) => { setData(d); setError(null); }).catch((e) => setError(String(e.message || e))),
    [ws, brand, kind],
  );
  useEffect(() => { load(); }, [load]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => watchBrand(ws, brand, (type) => {
    if (type === 'change') loadRef.current().then(() => setUpdatedAt(Date.now()));
    else loadRef.current();
  }), [ws, brand]);

  return { data, setData, error, load, updatedAt };
}

// A key pressed in a text field or select, which keeps it.
export const isTyping = (e) => !!e.target?.closest?.('input, textarea, select, [contenteditable]');

// Undo / redo (⌘Z / ⌘⇧Z; Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y) of the changes made in the last place the user changed
// something; a field being typed in keeps its own. record(entry) after each change; apply(entry, redo) reverts it
// (redo false) or makes it again.
let undoActive = null;
export function useUndo(apply) {
  const stacks = useRef({ past: [], future: [] });
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const record = useCallback((entry) => {
    const s = stacks.current;
    s.past = [...s.past.slice(-99), entry];
    s.future = [];
    undoActive = stacks;
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (undoActive !== stacks || !(e.metaKey || e.ctrlKey) || e.altKey || isTyping(e)) return;
      const k = e.key.toLowerCase(), redo = (k === 'z' && e.shiftKey) || (k === 'y' && e.ctrlKey);
      if (k !== 'z' && !redo) return;
      const s = stacks.current, from = redo ? s.future : s.past, to = redo ? s.past : s.future;
      if (!from.length) return;
      e.preventDefault();
      const entry = from.pop();
      to.push(entry);
      applyRef.current(entry, redo);
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (undoActive === stacks) undoActive = null; };
  }, []);
  return record;
}

// useState remembered in this browser (localStorage, as JSON); read after mount, so the server render matches.
export function useStored(key, initial) {
  const [value, setValue] = useState(initial);
  useEffect(() => { try { const s = localStorage.getItem(key); if (s != null) setValue(JSON.parse(s)); } catch {} }, [key]);
  const set = useCallback((x) => setValue((cur) => {
    const next = typeof x === 'function' ? x(cur) : x;
    try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
    return next;
  }), [key]);
  return [value, set];
}

// A width dragged on a separator and remembered: [width, dragging, the separator's props]. measure(pointer event) →
// the new width, clamped by the caller; a double click goes back to initial.
export function useDragWidth(key, initial, measure) {
  const [width, setWidth] = useStored(key, initial);
  const [live, setLive] = useState(null);
  const props = {
    role: 'separator', 'aria-orientation': 'vertical',
    onPointerDown: (e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setLive(width); }, // no text selection
    onPointerMove: (e) => { if (live != null) setLive(Math.round(measure(e))); },
    onPointerUp: () => { if (live != null) setWidth(live); setLive(null); },
    onDoubleClick: () => setWidth(initial),
  };
  return [live ?? width, live != null, props];
}

// const [copied, copy] = useCopied()
export function useCopied() {
  const [copied, setCopied] = useState(false);
  const copy = (text) => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {});
  return [copied, copy];
}

// The masonry's column count for the window's width.
export function useColumns() {
  const [n, setN] = useState(4);
  useEffect(() => {
    const on = () => setN(columnsFor(window.innerWidth));
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return n;
}
