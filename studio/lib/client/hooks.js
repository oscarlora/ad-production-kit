'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBase, getJson } from './api.js';

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

// const [copied, copy] = useCopied()
export function useCopied() {
  const [copied, setCopied] = useState(false);
  const copy = (text) => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {});
  return [copied, copy];
}

// Masonry columns step down with the screen width: 4 > 3 > 2 > 1.
const columnsFor = (vw) => (vw < 640 ? 1 : vw < 900 ? 2 : vw < 1200 ? 3 : 4);
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

// Deal items into n columns, each to the shortest so far, so the order still reads left to right.
// heightOf: an item's height per unit of width (1 / its ratio); CSS sizes the cards.
export function masonry(items, n, heightOf) {
  const cols = Array.from({ length: n }, () => ({ items: [], h: 0 }));
  for (const item of items) {
    const col = cols.reduce((a, b) => (b.h < a.h ? b : a));
    col.items.push(item);
    col.h += heightOf(item);
  }
  return cols.map((c) => c.items);
}
