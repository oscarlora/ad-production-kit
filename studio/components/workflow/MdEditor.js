'use client';
// A markdown file, an ad's or a brand page's (no ad: under inputs/), edited in place: click a block or table cell to edit it as it reads (rich.js; a comment, code,
// front matter or a rule as raw text; a "**Label:** text" block in a step's view as its title and its text) (Enter in a cell splits
// it into a new row below, and in a text block into a new block; Delete or Backspace in an empty row or block deletes it, and Backspace at its start merges it into the one above;
// Shift+Enter is a line break, Esc is done); an "![title](path)" block is an image, audio or video (path
// relative to the ad folder). Drag the grips to reorder blocks, table rows and columns. Each change saves to disk
// at once; changes on disk show live, and a block being typed in keeps the typing. Clicking a grip selects its
// block, row or column and opens its actions (Delete / Backspace deletes it); several blocks, or table rows, select together (see chosen and rowSel below). Selecting text (or a row's Comment
// action) leaves a comment on it for the agent, as on the video in the Edit step; so does each edit the user finishes
// and each deletion, so the agent brings what depends on it in step.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { apiBase, editApi, fileUrl, mediaType, postJson } from '../../lib/client/api.js';
import { clock } from '../../lib/client/format.js';
import { isTyping, useStored, useUndo } from '../../lib/client/hooks.js';
import { blockKind, inSections, mediaItems, parseDoc, serializeDoc, tableCells, tableRow } from '../../lib/markdown.js';
import { IcClock, IcGrip, IcPanelOpen, IcPause, IcPlay, IcSound, IcText } from '../icons.js';
import Player from '../Player.js';
import Markdown, { Inline } from './Markdown.js';
import { Compose, Comments, openComments, useFileText } from './parts.js';
import RichText from './rich.js';

const SAVE_MS = 300;
let lastId = Date.now(); // not 0: a hot reload restarts the count while old ids live on
let activeEditor = null; // the doc last clicked in, which ⌘A selects all of
const selecting = () => !!window.getSelection()?.toString().trim();

// Ranges of quote in root's blocks and cells (each line of it on its own: a line break isn't in the text).
function findRanges(root, quote) {
  const out = [];
  for (const el of root.querySelectorAll('.mde__view, .mde__cell')) {
    const nodes = [], walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text = '';
    while (walk.nextNode()) { nodes.push([walk.currentNode, text.length]); text += walk.currentNode.data; }
    const at = (i) => { const [n, o] = nodes.findLast(([, s]) => s <= i); return [n, i - o]; };
    for (const seg of quote.split(/\s*\n\s*/).filter((s) => s.length > 1)) {
      for (let i = text.indexOf(seg); i >= 0; i = text.indexOf(seg, i + seg.length)) {
        const r = new Range();
        r.setStart(...at(i));
        r.setEnd(...at(i + seg.length - 1)); r.setEnd(r.endContainer, r.endOffset + 1);
        out.push(r);
      }
    }
  }
  return out;
}

// Marks each pending comment's quote in root (CSS Custom Highlight API; the focused comment darker), again when doc changes.
function useCommentMarks(root, comments, focus, doc) {
  useEffect(() => {
    if (!root.current || !window.CSS?.highlights) return undefined;
    const marks = [], focused = [];
    for (const n of comments) if (n.status !== 'approved' && n.quote) (n.id === focus ? focused : marks).push(...findRanges(root.current, n.quote));
    CSS.highlights.set('mde-comment', new Highlight(...marks));
    CSS.highlights.set('mde-comment-focus', new Highlight(...focused));
    return () => { CSS.highlights.delete('mde-comment'); CSS.highlights.delete('mde-comment-focus'); };
  }, [root, comments, focus, doc]);
}

// The floating "Comment" button over a text selection, then the comment field: { quote, x, y, writing?, text? }.
function CommentField({ ask, setAsk, onSave }) {
  const style = { left: Math.min(ask.x, window.innerWidth - 336), top: ask.y };
  if (!ask.writing) {
    return <button type="button" className="btn btn--mini mde__ask" style={style} onMouseDown={(e) => e.preventDefault()} onClick={() => setAsk({ ...ask, writing: true, text: '' })}>Comment</button>;
  }
  return <Compose className="mde__compose" style={style} placeholder="Leave a comment for the agent" value={ask.text} onChange={(text) => setAsk({ ...ask, text })} onSend={(text) => onSave(ask.quote, text)} onClose={() => setAsk(null)} />;
}

// Remote blocks take the ids of identical local ones, so unchanged blocks stay put.
function withIds(blocks, prev = []) {
  const free = new Map();
  for (const b of prev) free.set(b.src, [...(free.get(b.src) || []), b.id]);
  return blocks.map((b) => ({ ...b, id: free.get(b.src)?.shift() ?? ++lastId }));
}

// Moves the n items at from to before (or after) the item at to; landing() is the index they land at.
const landing = (from, to, after, n = 1) => to - (from < to ? n : 0) + (after ? 1 : 0);
const move = (arr, from, to, after, n = 1) => {
  const out = arr.slice();
  const xs = out.splice(from, n);
  out.splice(landing(from, to, after, n), 0, ...xs);
  return out;
};

// A cell holds line breaks as <br> and pipes as \|.
const cellText = (c = '') => c.replace(/<br\s*\/?>/gi, '\n').replace(/\\\|/g, '|');
const textCell = (t) => t.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
const isRule = (cells) => cells.every((c) => /^:?-+:?$/.test(c));
const cellAt = (src, r, c) => tableCells(src.split('\n')[r] || '')[c] || '';
function setCell(src, r, c, text) {
  const lines = src.split('\n');
  if (r >= lines.length) return src;
  const cells = tableCells(lines[r]);
  while (cells.length <= c) cells.push('');
  cells[c] = textCell(text);
  lines[r] = tableRow(cells);
  return lines.join('\n');
}
// Rewrite every row's cells (padded to the widest row); fn(cells, empty) gets '---' as empty on the rule row.
function mapCols(src, fn) {
  const rows = src.split('\n').map(tableCells);
  const n = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => {
    const empty = isRule(r) ? '---' : '';
    const cells = fn([...r, ...Array(n - r.length).fill(empty)], empty);
    return empty ? `|${cells.join('|')}|` : tableRow(cells);
  }).join('\n');
}
const blankRow = (lines) => tableRow(Array(Math.max(...lines.map((l) => tableCells(l).length))).fill(''));
// A script's spoken length: one hook and every non-hook row of its Line column, estimated at the pace its voice take
// lands at, until a take gives the real length: the voice (app/api/[ws]/[brand]/voice) is asked for 4 words a second
// and reads about 3.3.
const PACE = 3.3;
const rowLabel = (r) => (r[0] || '').replace(/\*/g, '').trim();
function spoken(rows, hookAt) {
  const col = rows[0].findIndex((h) => /^line$/i.test(h.replace(/\*/g, '').trim()));
  if (col < 0) return null;
  const body = rows.slice(1).filter((r) => !isRule(r));
  const isHook = (r) => /^hook/i.test(rowLabel(r));
  const hooks = body.filter(isHook);
  const lines = [hooks[hookAt] || hooks[0], ...body.filter((r) => !isHook(r))].filter(Boolean)
    .map((r) => cellText(r[col]).replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const words = lines.flatMap((l) => l.split(' ')).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const s = Math.round(words / PACE);
  return { words, lines, time: s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, hooks: hooks.map(rowLabel) };
}

// A word in a sentence that opens a list of choices: options [[value, label]]; an invisible select lies over it.
function Pick({ value, options, onChange, label }) {
  return (
    <span className="mde__pick">
      {options.find(([v]) => v === value)?.[1]}
      <select value={value} onChange={(e) => onChange(+e.target.value)} aria-label={label}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </span>
  );
}

// A numbered row label ("**Body 1**", "Hook 2"): [whole, marks, name, number].
const NUMBERED = /^(\**)(.*?\S)\s+(\d+)\1$/;
// A new row under lines[r]: when its label is numbered, the new row takes the next number and that name's later rows
// move up one. Returns the label it took, or ''.
function insertRow(lines, r, row) {
  const m = NUMBERED.exec(tableCells(lines[r] || '')[0] || '');
  lines.splice(r + 1, 0, row);
  if (!m) return '';
  const [, marks, name, k] = m;
  const label = (n) => `${marks}${name} ${n}${marks}`;
  for (let i = r + 2; i < lines.length; i++) {
    const x = NUMBERED.exec(tableCells(lines[i])[0] || '');
    if (x && x[2] === name && +x[3] > +k) lines[i] = setCell(lines[i], 0, 0, label(+x[3] + 1));
  }
  lines[r + 1] = setCell(lines[r + 1], 0, 0, label(+k + 1));
  return `${name} ${+k + 1}`;
}
// Removes lines[r]; when its label is numbered, that name's later rows move down one. Returns the label it had, or ''.
function removeRow(lines, r) {
  const m = NUMBERED.exec(tableCells(lines[r] || '')[0] || '');
  lines.splice(r, 1);
  if (!m) return '';
  const [, marks, name, k] = m;
  for (let i = r; i < lines.length; i++) {
    const x = NUMBERED.exec(tableCells(lines[i])[0] || '');
    if (x && x[2] === name && +x[3] > +k) lines[i] = setCell(lines[i], 0, 0, `${marks}${name} ${+x[3] - 1}${marks}`);
  }
  return `${name} ${k}`;
}
// A table row's name: its label, else its line number.
const rowName = (line, r) => tableCells(line)[0].replace(/\*/g, '').trim() || `row ${r}`;
// The focused block's or cell's text and where it is: "Hook 2 · Line" for a cell, the block's first words otherwise.
function spot(blocks, f) {
  const b = blocks?.find((x) => x.id === f?.id);
  if (!b) return null;
  if (f.r == null) return { where: b.src.split('\n')[0].replace(/[*#>]/g, '').trim().slice(0, 60), text: b.src };
  const name = (r, c) => cellAt(b.src, r, c).replace(/\*/g, '').trim();
  return { where: `${name(f.r, 0)} · ${name(0, f.c)}`, text: cellText(cellAt(b.src, f.r, f.c)) };
}

// A comment's raw text: a textarea that grows with its text and keeps its own draft while focused (a value from
// outside replaces the draft only when it differs by more than `same` allows).
function Area({ value, onChange, onDone, start, same = (a, b) => a === b }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);
  useEffect(() => { setDraft((d) => (same(d, value) ? d : value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { const el = ref.current; el.style.height = '0'; el.style.height = `${el.scrollHeight}px`; }, [draft]);
  useEffect(() => { const el = ref.current, at = start ? 0 : el.value.length; el.focus(); el.setSelectionRange(at, at); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <textarea
      ref={ref} className="mde__area" value={draft} rows={1} spellCheck
      onChange={(e) => { setDraft(e.target.value); onChange(e.target.value); }}
      onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur(); }}
      onBlur={onDone}
    />
  );
}

// Grips: grip(payload) renders a handle that drags to reorder (onto zone(kind, at, axis, onDrop) targets) and,
// clicked, selects payload { kind, from } and opens menuFor(payload): [[label, action]], Delete last; onPick(payload,
// shift) first, true when it took the click.
function useGrips(menuFor, onPick) {
  const drag = useRef(null);
  const [over, setOver] = useState(null);
  const [sel, setSel] = useState(null); // { kind, from, x, y }
  const isSel = (kind, at) => sel?.kind === kind && sel.from === at;
  useEffect(() => {
    if (!sel) return undefined;
    const close = () => setSel(null);
    const onKey = (e) => {
      if (isTyping(e)) return;
      if (e.key === 'Escape') close();
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); menuFor(sel).at(-1)[1](sel); close(); }
    };
    const onDown = (e) => { if (!e.target.closest('.mde__menu, .mde__grip')) close(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); window.removeEventListener('scroll', close, true); };
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const grip = (payload) => (
    <span className="mde__handle">
      <span
        draggable className="mde__grip" title="Drag to move, click for actions" aria-label="Drag to move, click for actions" aria-pressed={isSel(payload.kind, payload.from)}
        onDragStart={(e) => { setSel(null); drag.current = payload; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); }}
        onDragEnd={() => { drag.current = null; setOver(null); }}
        onClick={(e) => {
          e.stopPropagation();
          if (onPick?.(payload, e.shiftKey)) return;
          const rc = e.currentTarget.getBoundingClientRect();
          setSel(isSel(payload.kind, payload.from) ? null : { ...payload, x: rc.left, y: rc.bottom + 4 });
        }}
      ><IcGrip /></span>
      {isSel(payload.kind, payload.from) && (
        <span className="mde__menu" role="menu" style={{ left: sel.x, top: sel.y }}>
          {menuFor(sel).map(([label, run], i, all) => (
            <button key={label} type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); run(sel); setSel(null); }}>
              {label}{i === all.length - 1 && <kbd>Del</kbd>}
            </button>
          ))}
        </span>
      )}
    </span>
  );
  const zone = (kind, at, axis, onDrop) => ({
    'data-drop': over?.kind === kind && over.at === at ? (axis === 'x' ? (over.after ? 'right' : 'left') : (over.after ? 'below' : 'above')) : undefined,
    onDragOver: (e) => {
      if (drag.current?.kind !== kind) return;
      e.preventDefault();
      const rc = e.currentTarget.getBoundingClientRect();
      const after = axis === 'x' ? e.clientX > rc.left + rc.width / 2 : e.clientY > rc.top + rc.height / 2;
      if (over?.kind !== kind || over.at !== at || over.after !== after) setOver({ kind, at, after });
    },
    onDrop: (e) => {
      const d = drag.current;
      if (d?.kind !== kind) return;
      e.preventDefault();
      if (d.from !== at) onDrop(d.from, at, over?.after);
      drag.current = null;
      setOver(null);
    },
  });
  return { grip, zone, isSel };
}

// A table: grips live outside the grid, shown for the hovered row and column: each column's in the strip above
// its header, each row's in the left gutter. Hovering a grip lights its row or column. Selected rows (rowSel) show
// as rows: a drag from one row into another selects the rows between, and Shift+click extends the selection (or
// from the cell being edited) to a row. Dragging a header's right edge sets its column's width (a double click
// clears it), kept in this browser by file, table and column header.
function Table({ b, widthsKey, colRe, focus, setFocus, open, change, done, comment, removed, voice, url, grip, zone, isSel, rowSel, rowsAt, pickRows }) {
  const [hover, setHover] = useState({ r: -1, c: -1, grip: false });
  const lines = b.src.split('\n');
  const rows = lines.map(tableCells);
  const n = Math.max(...rows.map((r) => r.length));
  const cols = [...Array(n).keys()].filter((c) => !colRe || colRe.test((rows[0][c] || '').replace(/\*/g, '').trim()));
  const colKind = `col${b.id}`, rowKind = `row${b.id}`;
  const [widths, setWidths] = useState({});
  const wKey = `ad-production-kit-studio:cols:${widthsKey}:${lines[0]}`;
  useEffect(() => { try { setWidths(JSON.parse(localStorage.getItem(wKey)) || {}); } catch { setWidths({}); } }, [wKey]);
  const keep = (w) => { setWidths(w); try { localStorage.setItem(wKey, JSON.stringify(w)); } catch {} };
  const resize = (e, name) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = e.currentTarget.parentElement.getBoundingClientRect().width;
    let w = widths;
    const onMove = (m) => { w = { ...widths, [name]: Math.max(48, Math.round(w0 + m.clientX - x0)) }; setWidths(w); };
    const swallow = (k) => k.stopPropagation(); // the click that ends the drag doesn't open the cell
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      keep(w);
      window.addEventListener('click', swallow, true);
      setTimeout(() => window.removeEventListener('click', swallow, true));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  const onOver = (e) => {
    const el = e.target.closest('[data-r], [data-c]');
    const r = el?.dataset.r != null ? +el.dataset.r : -1, c = el?.dataset.c != null ? +el.dataset.c : -1, grip = !!e.target.closest('.mde__grip');
    if (r !== hover.r || c !== hover.c || grip !== hover.grip) setHover({ r, c, grip });
  };
  const cell = (r, c, Tag) => {
    const editing = focus?.id === b.id && focus.r === r && focus.c === c;
    const lit = hover.grip && (hover.c < 0 ? hover.r === r : hover.r < 0 && hover.c === c);
    const name = rows[0][c], w = widths[name];
    return (
      <Tag key={c} style={w ? { width: w, minWidth: w, maxWidth: w } : undefined} data-r={r} data-c={c} data-sel={isSel(colKind, c) || undefined} data-lit={lit || undefined} className={editing ? 'mde__cell is-editing' : 'mde__cell'} onClick={(e) => !editing && !selecting() && !(e.shiftKey && rowSel?.id === b.id) && open({ id: b.id, r, c, at: [e.clientX, e.clientY] }, e.currentTarget.closest('tr'))}>
        {editing
          ? <RichText value={cellText(rows[r][c])} at={focus.at} start={focus.start} onChange={(v) => change(b.id, (src) => setCell(src, r, c, v))} onBlur={done} onEnter={r > 0 ? (before, after) => splitRow(r, c, before, after) : undefined} onEmptyDelete={r > 0 && c > 0 ? () => dropRow(r, c) : undefined} onMergeBack={r > 0 && c > 0 ? (text) => mergeRow(r, c, text) : undefined} offset={focus.offset} />
          : cellImage(rows[r][c]) ? <img className="mde__cell-img" src={url(cellImage(rows[r][c]))} alt="" loading="lazy" /> : <Inline text={rows[r][c]} />}
        {r === 0 && <span className="mde__resize" onMouseDown={(e) => resize(e, name)} onDoubleClick={() => { const { [name]: _, ...rest } = widths; keep(rest); }} />}
      </Tag>
    );
  };
  // Dragging a selected row's grip moves the selection; it stays selected where it lands.
  const moveRow = (from, to, after) => {
    const [lo, hi] = rowsAt(b.id, from), n = hi - lo + 1;
    if (to >= lo && to <= hi) return;
    change(b.id, (src) => move(src.split('\n'), lo, to, after, n).join('\n'), true);
    if (n > 1) { const at = landing(lo, to, after, n); pickRows(b.id, at, at + n - 1); }
  };
  const box = useRef(null);
  const rowAt = (el) => { const r = Number(el?.closest('tbody [data-r]')?.dataset.r); return r > 0 && !isRule(rows[r]) && box.current.contains(el) ? r : null; };
  const onDown = (e) => {
    const r = rowAt(e.target);
    if (e.button || r == null || e.target.closest('.mde__handle')) return;
    if (e.shiftKey) {
      const from = rowSel?.id === b.id ? rowSel.a : focus?.id === b.id && focus.r > 0 ? focus.r : null;
      if (from != null) { e.preventDefault(); pickRows(b.id, from, r); }
      return;
    }
    let picking = false;
    const onMove = (m) => {
      const to = rowAt(document.elementFromPoint(m.clientX, m.clientY));
      if (to != null && (picking || to !== r)) { picking = true; pickRows(b.id, r, to); }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (picking) window.getSelection()?.removeAllRanges();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  const picked = (i) => rowSel?.id === b.id && i >= Math.min(rowSel.a, rowSel.b) && i <= Math.max(rowSel.a, rowSel.b);
  const moveCol = (from, to, after) => change(b.id, (src) => mapCols(src, (cells) => move(cells, from, to, after)), true);
  const [hookAt, setHookAt] = useState(0);
  const length = voice && spoken(rows, hookAt);
  // The script's voice take: one button generates it, then plays and pauses it with the time; a changed script makes
  // the button regenerate. A take already made for this wording is found on load.
  const [take, setTake] = useState(null); // { key, src } a take, { key, busy }, { key, error }
  const [play, setPlay] = useState({ on: false, t: 0, dur: 0 });
  const audio = useRef(null), playNext = useRef(false); // a take just generated plays once it loads
  const key = length?.lines.join('\n') || '';
  const stale = take && take.key !== key;
  useEffect(() => {
    if (!key || take?.busy) return undefined;
    const t = setTimeout(() => voice(length.lines, length.hooks.length > 0, true).then((src) => src && setTake({ key, src }), () => {}), 600);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const onVoice = () => {
    if (take?.src && !stale) { const a = audio.current; if (a) (a.paused ? a.play() : a.pause()); return; }
    audio.current?.pause();
    playNext.current = true;
    setTake({ key, busy: true });
    voice(length.lines, length.hooks.length > 0).then((src) => setTake({ key, src }), (e) => setTake({ key, error: String(e.message || e) }));
  };
  const label = take?.busy ? 'Generating voice…' : stale || !take?.src ? (take?.src ? 'Regenerate voice' : 'Generate voice')
    : play.on || play.t ? `${clock(play.t)} / ${clock(play.dur)}` : 'Play voice';
  // Enter in a body cell: the text after the cursor moves into the same column of a new row below, which takes the
  // cursor; a numbered row (Body 1) makes it the next one (Body 2) and renumbers, with a comment to fix what cites them.
  const splitRow = (r, c, before, after) => {
    const from = tableCells(b.src.split('\n')[r])[0].replace(/\*/g, '');
    after = after.trimStart();
    change(b.id, (src) => setCell(src, r, c, before.trimEnd()));
    document.activeElement?.blur(); // finishes this cell (its comment) before the new one opens
    let made = '';
    change(b.id, (src) => {
      const l = src.split('\n');
      made = c > 0 ? insertRow(l, r, setCell(blankRow(l), 0, c, after)) : (l.splice(r + 1, 0, setCell(blankRow(l), 0, c, after)), '');
      return l.join('\n');
    }, true);
    if (made) comment(`You split ${from}: the new row is ${made}, and the later ones moved up one. Update what cites their numbers.`, made);
    setFocus({ id: b.id, r: r + 1, c, start: true });
  };
  // Delete or Backspace in an empty cell of a row with nothing else in it (but its label) deletes the row; a numbered
  // row's later ones move down one, with a comment to fix what cites them. The cursor goes to the row above.
  const RENUMBERED = ', and the later ones moved down one. Update what cites their numbers.';
  const dropRow = (r, c) => {
    const row = b.src.split('\n')[r];
    if (tableCells(row).slice(1).some((x) => x.trim())) return;
    document.activeElement?.blur();
    let gone = '';
    change(b.id, (src) => { const l = src.split('\n'); gone = removeRow(l, r); return l.join('\n'); }, true);
    const where = rowName(row, r);
    removed(`You deleted ${where}${gone ? RENUMBERED : ''}`, where, row);
    if (r - 1 > 0 && !isRule(rows[r - 1])) setFocus({ id: b.id, r: r - 1, c });
  };
  // Backspace at the start of a cell, in a row with nothing else in it (but its label), moves its text onto the end of
  // the same cell in the row above and deletes the row: Enter's split, undone.
  const mergeRow = (r, c, text) => {
    const l = b.src.split('\n');
    if (r - 1 < 1 || isRule(tableCells(l[r - 1])) || tableCells(l[r]).some((x, i) => i > 0 && i !== c && x.trim())) return;
    const head = cellText(cellAt(b.src, r - 1, c)).trimEnd(), offset = shownLength(head) + (head ? 1 : 0);
    document.activeElement?.blur();
    let gone = '';
    change(b.id, (src) => { const x = src.split('\n'); x[r - 1] = setCell(x[r - 1], 0, c, head ? `${head} ${text}` : text); gone = removeRow(x, r); return x.join('\n'); }, true);
    const where = rowName(l[r], r);
    removed(`You merged ${where} into the row above${gone ? RENUMBERED : ''}`, where, l[r]);
    setFocus({ id: b.id, r: r - 1, c, offset });
  };
  const show = (on) => on || undefined;
  return (
    <div ref={box} className="mde__table" data-rows={rowSel?.id === b.id || undefined} onMouseDown={onDown} onMouseMove={onOver} onMouseLeave={() => setHover({ r: -1, c: -1, grip: false })}>
      <div className="md__table">
        <table>
          <thead>
            <tr className="mde__handles">
              <th className="mde__gutter" />
              {cols.map((c) => (
                <th key={c} data-c={c} data-show={show(hover.c === c || isSel(colKind, c))} {...zone(colKind, c, 'x', moveCol)}>{grip({ kind: colKind, from: c })}</th>
              ))}
            </tr>
            <tr>
              <th className="mde__gutter" />
              {cols.map((c) => cell(0, c, 'th'))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (i === 0 || (i === 1 && isRule(r)) ? null : (
              <tr key={i} {...zone(rowKind, i, 'y', moveRow)} data-sel={isSel(rowKind, i) || picked(i) || undefined}>
                <td className="mde__gutter" data-r={i} data-show={show(hover.r === i || isSel(rowKind, i) || picked(i))}>{grip({ kind: rowKind, from: i })}</td>
                {cols.map((c) => cell(i, c, 'td'))}
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      {length && (
        <p className="mde__count">
          <span><IcText />{length.words} words</span>
          <span>
            <IcClock />
            <span>
              {take?.src && !stale && play.dur ? `${clock(play.dur)} voiced` : `${length.time} estimated`}
              {length.hooks.length > 0 && <>, with{' '}
                <Pick value={Math.min(hookAt, length.hooks.length - 1)} options={length.hooks.map((h, i) => [i, h])} onChange={setHookAt} label="Hook" />
              </>}
            </span>
          </span>
          <button type="button" className="btn btn--mini mde__voice" onClick={onVoice} disabled={take?.busy} aria-label={take?.src && !stale ? (play.on ? 'Pause voice' : 'Play voice') : label}>
            {take?.src && !stale ? (play.on ? <IcPause /> : <IcPlay />) : <IcSound />}{label}
          </button>
          {take?.src && (
            <audio
              key={take.src} ref={audio} src={take.src} preload="metadata"
              onPlay={() => setPlay((p) => ({ ...p, on: true }))} onPause={() => setPlay((p) => ({ ...p, on: false }))}
              onEnded={() => setPlay((p) => ({ ...p, on: false, t: 0 }))}
              onTimeUpdate={(e) => { const t = e.currentTarget.currentTime; setPlay((p) => ({ ...p, t })); }}
              onLoadedMetadata={(e) => { setPlay({ on: false, t: 0, dur: e.currentTarget.duration }); if (playNext.current) { playNext.current = false; e.currentTarget.play().catch(() => {}); } }}
            />
          )}
        </p>
      )}
      {take?.error && <p className="mde__error">Could not generate the voice: {take.error}</p>}
    </div>
  );
}

// A media block: each "![label](path)" line as its image, audio or video, and nothing else (a title is its own block).
function Media({ items, url }) {
  return (
    <div className="mde__media">
      {items.map(({ title, path }, i) => (
        <figure key={i}>
          {mediaType(path) === 'image' ? <img src={url(path)} alt={title} loading="lazy" />
            : <Player kind={mediaType(path) === 'audio' ? 'audio' : 'video'} src={url(path)} label={title || path} compact />}
        </figure>
      ))}
    </div>
  );
}
// A table cell holding only an image path in backticks (`references/frames/x.jpg`) shows the image: its path, or null.
const cellImage = (cell) => { const p = /^`([^`\s]+)`$/.exec(cell)?.[1]; return mediaType(p) === 'image' ? p : null; };

// A title block: one bold line, its text in the block under it.
const TITLE = /^\*\*[^*\n]+\*\*$/;
const LINKED = /^\*\*\[[^\]]*\]\([^)]*\)\*\*$/;
const LIST = /^\s*(?:[-*]|\d+\.)\s/m;
// Markdown's length as shown (marks and link targets dropped), for where the cursor lands after a merge.
const shownLength = (md) => md.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|[*`]|<br\s*\/?>/g, '').length;
// In a step's view, an older "**Label:** text" block shows as a title over its text, and edits as the two.
const LABELED = /^\*\*([^*]+?):\*\*\s*([\s\S]*)$/;
function Titled({ src }) {
  const [, title, text] = LABELED.exec(src);
  return <div className="md mde__titled"><h4>{title}</h4><Markdown text={text} /></div>;
}
function TitledEdit({ b, focus, change, done, split, join, untitle }) {
  const [, title, text] = LABELED.exec(b.src) || [null, '', b.src];
  const wrap = useRef(null);
  const set = (part) => (v) => change(b.id, (src) => {
    const [, t, x] = LABELED.exec(src) || [null, title, src];
    return part === 'label' ? `**${v.replace(/\n/g, ' ').trim() || t}:** ${x}` : `**${t}:** ${v}`;
  });
  // Moving between the title and its text keeps the block open.
  const blur = (e) => { if (!e.currentTarget.parentElement.contains(e.relatedTarget)) done(); };
  // Enter in the title goes to its text; Delete at its end, or Backspace at the text's start, joins them into one line.
  return (
    <div className="md mde__titled mde__titled--edit" ref={wrap}>
      <RichText as="h4" value={title} focus={focus.part === 'label'} at={focus.at} onChange={set('label')} onBlur={blur} onEnter={() => wrap.current.lastChild.focus()} onMergeNext={() => join(text)} onEmptyDelete={() => untitle(text)} />
      <RichText value={text} focus={focus.part !== 'label'} at={focus.at} onChange={set('text')} onBlur={blur} onEnter={(before, after) => split(`**${title}:** ${before}`, after)} onMergeBack={join} onEmptyDelete={() => join('')} />
    </div>
  );
}

// file: { name (relative to the ad folder, or inputs/ with no ad), p, v }; media paths are relative to that folder too.
// view (else the whole file), as regex sources: only, the section
// names to show; pick, the blocks among them; cols, a table's columns by header. script: its tables with a Line column
// end with their spoken length and voice.
export default function MdEditor({ ws, brand, ad, file, view, script, comments = [] }) {
  const only = view?.only && new RegExp(view.only, 'i'), pick = view?.pick && new RegExp(view.pick);
  const colRe = view?.cols && new RegExp(view.cols, 'i');
  const remote = useFileText(ws, brand, file.p, file.v);
  const folder = ad ? `outputs/${ad}` : 'inputs';
  const url = (path) => fileUrl(ws, brand, `${folder}/${path}`);
  const api = editApi(ws, brand, ad);
  const [doc, setDoc] = useState(null);
  const [focus, setFocusState] = useState(null); // { id } a block, { id, r, c } a table cell
  const [error, setError] = useState('');
  const docRef = useRef(null), focusRef = useRef(null), baseRef = useRef(''), timer = useRef(0), written = useRef([]), savedV = useRef(0), editRef = useRef(null), synced = useRef(null);
  const [merged, setMerged] = useState(null); // the file as the server merged it (or found it), to take in
  const setFocus = (f) => {
    focusRef.current = f;
    baseRef.current = docRef.current?.blocks.find((b) => b.id === f?.id)?.src || '';
    editRef.current = spot(docRef.current?.blocks, f);
    setFocusState(f);
  };

  const save = () => {
    clearTimeout(timer.current);
    timer.current = 0;
    const text = serializeDoc(docRef.current);
    written.current = [...written.current.slice(-4), text];
    baseRef.current = docRef.current.blocks.find((b) => b.id === focusRef.current?.id)?.src || '';
    const base = synced.current;
    synced.current = text;
    // r.text: the file merged with, or (409) refused for, a change made meanwhile.
    const took = (r) => { if (r.text != null) { synced.current = r.text; setMerged({ text: r.text }); } setError(''); };
    api({ md: { name: file.name, text, base } })
      .then((r) => { savedV.current = Math.max(savedV.current, r.v || 0); took(r); })
      .catch((e) => (e.status === 409 ? took(e.data) : setError(String(e.message || e))));
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => { if (timer.current) saveRef.current(); }, []);

  // Each change is one undo step; typing in one block stays one step until it's done.
  const typingStep = useRef(null);
  const record = useUndo((entry, redo) => {
    const parsed = parseDoc(redo ? entry.after : entry.before);
    typingStep.current = null;
    setFocus(null);
    put({ ...parsed, blocks: withIds(parsed.blocks, docRef.current?.blocks) }, true, false);
  });
  // key: the block being typed in (its changes merge into one step), null for a change of its own, false for none.
  const put = (next, now, key = null) => {
    if (key !== false && docRef.current) {
      const after = serializeDoc(next);
      if (key != null && typingStep.current?.key === key) typingStep.current.after = after;
      else {
        const step = { before: serializeDoc(docRef.current), after, key };
        record(step);
        typingStep.current = key != null ? step : null;
      }
    }
    docRef.current = next;
    setDoc(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveRef.current(), now ? 0 : SAVE_MS);
  };
  const change = (id, fn, now) => put({ ...docRef.current, blocks: docRef.current.blocks.map((b) => (b.id === id ? { ...b, src: fn(b.src) } : b)) }, now, now ? null : id);
  const moveBlock = (from, to, after) => {
    const all = docRef.current.blocks, group = chosenRef.current.includes(from) ? chosenRef.current : [from];
    if (group.includes(to)) return;
    const moving = all.filter((b) => group.includes(b.id)), rest = all.filter((b) => !group.includes(b.id));
    const at = rest.findIndex((b) => b.id === to) + (after ? 1 : 0);
    const blocks = [...rest.slice(0, at), ...moving, ...rest.slice(at)].map((b, i) => ({ ...b, gap: i && !b.gap.length ? [''] : b.gap }));
    put({ ...docRef.current, blocks }, true);
  };
  // Selected table rows: { id: the table block, a: the line the selection started at, b: its other end }.
  const [rowSel, setRowSelState] = useState(null);
  const rowSelRef = useRef(null);
  const setRowSel = (s) => { rowSelRef.current = s; setRowSelState(s); };
  const pickRows = (id, a, b) => {
    const s = rowSelRef.current;
    if (s?.id === id && s.a === a && s.b === b) return;
    if (rootRef.current?.contains(document.activeElement)) document.activeElement.blur(); // finishes a cell being edited
    window.getSelection()?.removeAllRanges();
    setRowSel({ id, a, b });
  };
  // The lines [first, last] an action on line `at` of table `id` covers: the selected rows when it's one of them.
  const rowsAt = (id, at) => {
    const s = rowSelRef.current, lo = Math.min(s?.a, s?.b), hi = Math.max(s?.a, s?.b);
    return s?.id === id && at >= lo && at <= hi ? [lo, hi] : [at, at];
  };
  const editRows = (id, fn) => { change(id, (src) => { const l = src.split('\n'); fn(l); return l.join('\n'); }, true); setRowSel(null); };
  const rowsText = (id, lo, hi) => docRef.current.blocks.find((b) => b.id === id).src.split('\n').slice(lo, hi + 1).join('\n');
  // Every deletion leaves the agent a comment, the removed markdown as its edit's from.
  const removed = (text, where, from) => commentApi({ comment: { file: file.name, quote: from.replace(/\*\*/g, ''), text, edit: { where, from, to: '' }, deleted: true } });
  const deleteRows = (id, lo, hi) => {
    const text = rowsText(id, lo, hi), where = text.split('\n').map((l, i) => rowName(l, lo + i)).join(', ');
    editRows(id, (l) => l.splice(lo, hi - lo + 1));
    removed(`You deleted ${where}`, where, text);
  };
  // A grip's actions; payload kinds: 'block' (from: block id), `row<id>` (from: line), `col<id>` (from: column).
  const menuFor = ({ kind, from }) => {
    const d = docRef.current;
    if (kind === 'block') {
      const group = chosenRef.current.includes(from) ? chosenRef.current : [from];
      const last = Math.max(...group.map((id) => d.blocks.findIndex((b) => b.id === id)));
      const copies = d.blocks.filter((b) => group.includes(b.id)).map((b) => ({ src: b.src, gap: [''], id: ++lastId }));
      return [
        ['Duplicate', () => put({ ...d, blocks: [...d.blocks.slice(0, last + 1), ...copies, ...d.blocks.slice(last + 1)] }, true)],
        ['Delete', () => { removeChosen(group); }],
      ];
    }
    const id = Number(kind.slice(3));
    if (kind.startsWith('row')) {
      const [lo, hi] = rowsAt(id, from), n = hi - lo + 1, rows = n > 1 ? `${n} rows` : 'row';
      const lines = (fn) => editRows(id, fn);
      return [
        ['Comment', ({ x, y }) => setAsk({ quote: rowsText(id, lo, hi).split('\n').map((l) => tableCells(l)[0].replace(/\*/g, '')).join('\n'), x, y, writing: true, text: '' })],
        ['Insert row above', () => lines((l) => l.splice(lo, 0, blankRow(l)))],
        ['Insert row below', () => lines((l) => l.splice(hi + 1, 0, blankRow(l)))],
        [`Duplicate ${rows}`, () => lines((l) => l.splice(hi + 1, 0, ...l.slice(lo, hi + 1)))],
        [`Delete ${rows}`, () => deleteRows(id, lo, hi)],
      ];
    }
    const cols = (fn) => change(id, (src) => mapCols(src, fn), true);
    return [
      ['Insert column left', () => cols((c, empty) => [...c.slice(0, from), empty, ...c.slice(from)])],
      ['Insert column right', () => cols((c, empty) => [...c.slice(0, from + 1), empty, ...c.slice(from + 1)])],
      ['Delete column', () => {
        const cells = d.blocks.find((b) => b.id === id).src.split('\n').map((l) => tableCells(l)[from] || ''), where = `the ${cells[0].replace(/\*/g, '').trim() || 'unnamed'} column`;
        cols((c) => c.filter((_, i) => i !== from));
        removed(`You deleted ${where}`, where, cells.join('\n'));
      }],
    ];
  };
  // Selected blocks: a grip click, Shift+click to extend, a drag from the margin or a text selection across blocks.
  // ↑ / ↓ move it, Shift+↑ / ↓ extend it, ⌘A (Ctrl+A) takes every block, Delete removes them, ⌘C / ⌘X copy or cut
  // their markdown, Esc clears; dragging one of them moves them all.
  const [chosen, setChosenState] = useState([]);
  const chosenRef = useRef([]), anchorRef = useRef(null), shownRef = useRef([]);
  const setChosen = (ids) => { chosenRef.current = ids; setChosenState(ids); };
  const pickRange = (a, b) => {
    const ids = shownRef.current, i = ids.indexOf(a), j = ids.indexOf(b);
    if (i < 0 || j < 0) return;
    anchorRef.current = a;
    setChosen(ids.slice(Math.min(i, j), Math.max(i, j) + 1));
  };
  const removeChosen = (ids) => {
    const gone = docRef.current.blocks.filter((b) => ids.includes(b.id)), where = gone.map((b) => spot(gone, { id: b.id }).where).join(', ');
    put({ ...docRef.current, blocks: docRef.current.blocks.filter((b) => !ids.includes(b.id)) }, true);
    setChosen([]);
    removed(`You deleted ${where}`, where, gone.map((b) => b.src).join('\n\n'));
  };
  const chosenText = () => docRef.current.blocks.filter((b) => chosenRef.current.includes(b.id)).map((b) => b.src).join('\n\n');
  // Enter in a text block (not a list) splits it at the cursor: the rest becomes a new block below, which takes the
  // cursor. Delete or Backspace in an empty block removes it and goes to the block above.
  const splitBlock = (id, before, after) => {
    change(id, () => before.trimEnd(), true);
    document.activeElement?.blur();
    const d = docRef.current, i = d.blocks.findIndex((b) => b.id === id), nb = { src: after.trimStart(), gap: [''], id: ++lastId };
    put({ ...d, blocks: [...d.blocks.slice(0, i + 1), nb, ...d.blocks.slice(i + 1)] }, true);
    setFocus({ id: nb.id, start: true });
  };
  const dropBlock = (id) => {
    const ids = shownRef.current, prev = ids[ids.indexOf(id) - 1];
    document.activeElement?.blur();
    put({ ...docRef.current, blocks: docRef.current.blocks.filter((b) => b.id !== id) }, true);
    const p = docRef.current.blocks.find((b) => b.id === prev);
    if (p && blockKind(p.src) === 'text') setFocus({ id: prev });
  };
  // Backspace at the start of a text block moves its text onto the end of the text block above, which takes the cursor
  // where they meet.
  const mergeBlock = (id, text) => {
    const ids = shownRef.current, prev = docRef.current.blocks.find((b) => b.id === ids[ids.indexOf(id) - 1]);
    if (!prev || blockKind(prev.src) !== 'text' || LIST.test(prev.src)) return;
    const head = prev.src.trimEnd(), offset = shownLength(head) + (head ? 1 : 0);
    document.activeElement?.blur();
    const d = docRef.current;
    put({ ...d, blocks: d.blocks.filter((b) => b.id !== id).map((b) => (b.id === prev.id ? { ...b, src: head ? `${head} ${text}` : text } : b)) }, true);
    setFocus({ id: prev.id, offset });
  };
  // A "**Label:** text" block joined into one line keeps its label bold, with the colon outside so it no longer reads as
  // a title; one whose title is deleted becomes its text.
  const reTitle = (id, src, f) => {
    document.activeElement?.blur();
    const d = docRef.current;
    put({ ...d, blocks: d.blocks.map((b) => (b.id === id ? { ...b, src } : b)) }, true);
    setFocus({ id, ...f });
  };
  const joinTitled = (id, text) => {
    const [, t] = LABELED.exec(docRef.current.blocks.find((b) => b.id === id).src);
    reTitle(id, `**${t}**:${text ? ` ${text}` : ''}`, { offset: t.length + 1 });
  };
  // A block or row grip: Shift+click extends the selection; a plain click selects that block or row (keeping a
  // selection it's in).
  const onPick = ({ kind, from: id }, shift) => {
    if (kind.startsWith('row')) {
      const t = Number(kind.slice(3)), s = rowSelRef.current;
      if (shift && s?.id === t) { pickRows(t, s.a, id); return true; }
      if (rowsAt(t, id)[0] === rowsAt(t, id)[1]) setRowSel({ id: t, a: id, b: id });
      return false;
    }
    if (kind !== 'block') return false;
    if (shift) { pickRange(anchorRef.current ?? id, id); return true; }
    if (!chosenRef.current.includes(id)) { anchorRef.current = id; setChosen([id]); }
    return false;
  };
  const { grip, zone, isSel } = useGrips(menuFor, onPick);
  useEffect(() => {
    const onKey = (e) => {
      if (isTyping(e) || document.querySelector('.mde__menu')) return;
      const mod = e.metaKey || e.ctrlKey, ids = shownRef.current, cur = chosenRef.current;
      if (mod && e.key.toLowerCase() === 'a' && activeEditor === rootRef.current && ids.length) { e.preventDefault(); anchorRef.current = ids[0]; setChosen(ids); return; }
      const rs = rowSelRef.current;
      if (rs) {
        const [lo, hi] = rowsAt(rs.id, rs.a), cut = () => deleteRows(rs.id, lo, hi);
        if (e.key === 'Escape') setRowSel(null);
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); cut(); }
        else if (mod && /^[cx]$/i.test(e.key)) {
          e.preventDefault();
          navigator.clipboard?.writeText(rowsText(rs.id, lo, hi));
          if (e.key.toLowerCase() === 'x') cut();
        }
        return;
      }
      if (!cur.length) return;
      if (e.key === 'Escape') { setChosen([]); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeChosen(cur); return; }
      if (mod && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x')) {
        e.preventDefault();
        navigator.clipboard?.writeText(chosenText());
        if (e.key.toLowerCase() === 'x') removeChosen(cur);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1, end = ids.indexOf(d > 0 ? cur.at(-1) : cur[0]);
        const lead = cur[0] === anchorRef.current ? ids.indexOf(cur.at(-1)) : ids.indexOf(cur[0]);
        if (e.shiftKey) { const to = ids[lead + d]; if (to != null) pickRange(anchorRef.current, to); }
        else { const to = ids[end + d] ?? ids[end]; anchorRef.current = to; setChosen([to]); }
      }
    };
    const onDown = (e) => {
      if (rootRef.current?.contains(e.target)) activeEditor = rootRef.current;
      if (!e.target.closest('.mde__grip, .mde__menu') && !(e.shiftKey && rootRef.current?.contains(e.target))) {
        if (chosenRef.current.length) setChosen([]);
        if (rowSelRef.current) setRowSel(null);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // A drag that starts in the margin (beside or between blocks) selects the blocks it crosses.
  const onMarginDown = (e) => {
    if (e.button !== 0 || e.target.closest('.mde__view, .mde__table, .mde__media, .mde__handle, .mde__rich, .mde__area, a, button')) return;
    e.preventDefault();
    const y0 = e.clientY;
    const els = [...rootRef.current.querySelectorAll(':scope > .mde__block')];
    const onMove = (m) => {
      const lo = Math.min(y0, m.clientY), hi = Math.max(y0, m.clientY);
      const ids = els.filter((el) => { const r = el.getBoundingClientRect(); return r.bottom >= lo && r.top <= hi; }).map((el) => Number(el.dataset.id));
      if (ids.length) { anchorRef.current = ids[0]; setChosen(ids); }
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Comments: select text for the Comment button; the comment field closes on Esc, a save, or a click elsewhere.
  const rootRef = useRef(null);
  const [ask, setAsk] = useState(null);
  const [commentFocus, setCommentFocus] = useState(null);
  useCommentMarks(rootRef, comments, commentFocus, doc);
  useEffect(() => {
    const onUp = (e) => {
      if (e.target.closest?.('.mde__ask, .mde__compose')) return;
      const s = window.getSelection(), quote = s?.toString().trim();
      if (!quote || !rootRef.current?.contains(s.anchorNode) || rowSelRef.current) { setAsk((a) => (a?.writing && a.text ? a : null)); return; }
      const blockOf = (n) => (n?.nodeType === 1 ? n : n?.parentElement)?.closest('.mde__block');
      const a = blockOf(s.anchorNode), b = blockOf(s.focusNode);
      if (a && b && a !== b && rootRef.current.contains(b)) { s.removeAllRanges(); setAsk(null); pickRange(Number(a.dataset.id), Number(b.dataset.id)); return; }
      const r = s.getRangeAt(0).getBoundingClientRect();
      setAsk({ quote: quote.slice(0, 1000), x: r.left, y: r.bottom + 6 });
    };
    const onScroll = () => setAsk((a) => (a?.writing ? a : null));
    document.addEventListener('mouseup', onUp);
    window.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('mouseup', onUp); window.removeEventListener('scroll', onScroll, true); };
  }, []);
  const commentApi = (body) => api(body).catch((e) => setError(String(e.message || e)));
  const saveComment = (quote, text) => {
    window.getSelection()?.removeAllRanges();
    commentApi({ comment: { file: file.name, quote, text } });
  };
  const [line, setLine] = useState([]); // the comments on the row or block clicked last, lit in the list
  const [notesHidden, setNotesHidden] = useStored('ad-production-kit-studio:doc-comments-hidden', false);
  const pickComment = (n) => {
    setCommentFocus(n.id);
    setLine([]);
    findRanges(rootRef.current, n.quote || '')[0]?.startContainer.parentElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  // Clicking a block or table cell edits it, and points to the comments on it (on its row, for a cell): those whose
  // quote is in it, or that are edits of it; the first is focused.
  const open = (f, el) => {
    const row = (where = '') => where.split(' · ')[0];
    const at = row(spot(docRef.current.blocks, f)?.where);
    const ids = openComments(comments).filter((n) => (at && row(n.edit?.where) === at)
      || (n.quote && findRanges(rootRef.current, n.quote).some((r) => el.contains(r.startContainer)))).map((n) => n.id);
    setFocus(f);
    setLine(ids);
    setCommentFocus(ids[0] ?? null);
  };

  // Done with a block: save, re-split it if it now holds blank lines, and comment the change for the agent.
  const done = () => {
    const from = editRef.current, to = spot(docRef.current?.blocks, focusRef.current);
    setFocus(null);
    if (from && to && from.text.trim() !== to.text.trim()) {
      commentApi({ comment: { file: file.name, quote: to.text.replace(/\*\*/g, ''), text: `You edited ${from.where}`, edit: { where: from.where, from: from.text, to: to.text } } });
    }
    if (!docRef.current) return;
    const parsed = parseDoc(serializeDoc(docRef.current));
    const next = { ...parsed, blocks: withIds(parsed.blocks, docRef.current.blocks) };
    typingStep.current = null;
    if (timer.current) put(next, true, false);
    else { docRef.current = next; setDoc(next); }
  };

  // The file changed on disk (not by this editor): take it, keeping the focused block's unsaved typing.
  useEffect(() => {
    // An echo of this editor's own save: its latest, or an older one read before that landed. The same text written
    // later (an agent's revert) is a real change.
    if (remote == null || remote === written.current.at(-1) || (written.current.includes(remote) && file.v <= savedV.current)) return;
    take(remote);
  }, [remote]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (merged) take(merged.text); }, [merged]); // eslint-disable-line react-hooks/exhaustive-deps
  function take(text) {
    synced.current = text;
    const parsed = parseDoc(text);
    const cur = docRef.current, f = focusRef.current;
    const blocks = withIds(parsed.blocks, cur?.blocks);
    const mine = f && cur?.blocks.find((b) => b.id === f.id);
    if (mine && !blocks.some((b) => b.id === f.id)) {
      let j = blocks.findIndex((b) => b.src === baseRef.current);
      if (j < 0) j = Math.min(cur.blocks.indexOf(mine), blocks.length - 1);
      if (j >= 0) {
        const unsaved = !!timer.current;
        const src = !unsaved ? blocks[j].src : f.r != null ? setCell(blocks[j].src, f.r, f.c, cellText(cellAt(mine.src, f.r, f.c))) : mine.src;
        blocks[j] = { ...blocks[j], id: f.id, src };
        baseRef.current = parsed.blocks[j].src;
      }
    }
    // A change from outside to the focused block or cell isn't the user's edit: their edit starts from it.
    const was = spot(cur?.blocks, f), now = spot(blocks, f);
    if (!timer.current && editRef.current && was && now && was.text !== now.text) editRef.current = { ...editRef.current, text: now.text };
    const rs = rowSelRef.current, src = (bs, id) => bs?.find((x) => x.id === id)?.src;
    if (rs && src(blocks, rs.id) !== src(cur?.blocks, rs.id)) setRowSel(null); // its lines may have moved
    docRef.current = { ...parsed, blocks };
    setDoc(docRef.current);
  }

  if (!doc) return <p className="flow-note">Loading</p>;
  const shown = only ? inSections(doc.blocks, only) : null;
  // In a step's view, a picked title block ("**Message**") brings the text block under it.
  // So do the text blocks after that one (a block split with Enter stays in view), up to the next title or label, and
  // the media and linked titles ("**[Clip](url)**") in that run.
  const isTitle = (src) => TITLE.test(src) && !LINKED.test(src);
  const picked = (i) => {
    const src = doc.blocks[i].src, prev = doc.blocks[i - 1]?.src;
    if (pick.test(src)) return true;
    if (!prev || !shown[i - 1]) return false;
    if (blockKind(src) === 'media' || LINKED.test(src)) return picked(i - 1);
    if (blockKind(src) !== 'text') return false;
    return isTitle(prev) ? pick.test(prev) : !isTitle(src) && !LABELED.test(src) && picked(i - 1);
  };
  const blocks = doc.blocks.filter((b, i) => !shown || !b.src.trim() || (shown[i] && (pick ? picked(i) : blockKind(b.src) !== 'comment'))); // a new, empty block stays in view
  shownRef.current = blocks.map((b) => b.id);
  return (
    <div className="mde-doc">
      <div className="mde" ref={rootRef} onMouseDown={onMarginDown}>
        {error && <p className="mde__error">Not saved: {error}</p>}
        {!blocks.length && <p className="flow-note">Not in the brief yet.</p>}
        {blocks.map((b) => {
          const kind = blockKind(b.src);
          return (
            <div key={b.id} data-id={b.id} className="mde__block" {...zone('block', b.id, 'y', moveBlock)} data-sel={isSel('block', b.id) || chosen.includes(b.id) || undefined}>
              {kind !== 'table' && grip({ kind: 'block', from: b.id })}
              {kind === 'media' ? <Media items={mediaItems(b.src)} url={url} />
                : kind === 'table' ? <Table b={b} widthsKey={`${ws}/${brand}/${ad || folder}/${file.name}`} colRe={colRe} focus={focus} setFocus={setFocus} open={open} change={change} done={done} comment={(text, quote) => commentApi({ comment: { file: file.name, quote, text } })} removed={removed} voice={script ? (lines, hook, check) => postJson(`${apiBase(ws, brand)}/voice`, { ad, lines, hook, check }).then((r) => r.p && fileUrl(ws, brand, r.p, r.v)) : null} url={url} grip={grip} zone={zone} isSel={isSel} rowSel={rowSel} rowsAt={rowsAt} pickRows={pickRows} />
                : focus?.id === b.id ? (
                  kind === 'comment' || kind === 'code' ? <Area value={b.src} same={(x, y) => x.trim() === y.trim()} onChange={(v) => change(b.id, () => v)} onDone={done} />
                    : pick && LABELED.test(b.src) ? <TitledEdit b={b} focus={focus} change={change} done={done} split={(before, after) => splitBlock(b.id, before, after)} join={(text) => joinTitled(b.id, text)} untitle={(text) => reTitle(b.id, text, { start: true })} />
                    : <RichText mode="block" className="md mde__area" value={b.src} at={focus.at} start={focus.start} onChange={(v) => change(b.id, () => v)} onBlur={done} onEnter={LIST.test(b.src) ? undefined : (before, after) => splitBlock(b.id, before, after)} onEmptyDelete={() => dropBlock(b.id)} onMergeBack={(text) => mergeBlock(b.id, text)} offset={focus.offset} />
                ) : (
                  <div className="mde__view" onClick={(e) => { if (!e.target.closest('a') && !selecting()) open({ id: b.id, at: [e.clientX, e.clientY], part: e.target.closest('h4') ? 'label' : 'text' }, e.currentTarget); }}>
                    {kind === 'comment' ? <p className="mde__comment">{b.src.replace(/^\s*<!--\s*|\s*-->\s*$/g, '')}</p>
                      : pick && LABELED.test(b.src) ? <Titled src={b.src} /> : <Markdown text={b.src} />}
                  </div>
                )}
            </div>
          );
        })}
      </div>
      {comments.length > 0 && !notesHidden && (
        <div className="mde-doc__side">
          <Comments comments={comments} focus={commentFocus} lit={line} onPick={pickComment} onAction={commentApi} hint="Select text to leave a comment."
            lead={(n) => n.quote && <span className="ed-comment__quote">{n.quote}</span>} onHide={() => setNotesHidden(true)} />
        </div>
      )}
      {comments.length > 0 && notesHidden && (
        <button type="button" className="btn btn--mini mde-doc__show" onClick={() => setNotesHidden(false)} title="Show comments">
          <IcPanelOpen />{openComments(comments).length} comments
        </button>
      )}
      {ask && <CommentField ask={ask} setAsk={setAsk} onSave={saveComment} />}
    </div>
  );
}
