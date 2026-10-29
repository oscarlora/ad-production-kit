'use client';
// Edit markdown as it looks: RichText turns a block or cell's markdown into editable text (bold, italic, code,
// links, line breaks; in a block also headings and lists) and writes markdown back on every change.
// mode 'inline': one run of text, a line break is "\n" (cells, a label, its text); 'block': lines, headings, lists.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { INLINE, ITEM } from '../../lib/markdown.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The inline marks Markdown.js's Inline renders, as HTML.
function inlineHtml(text) {
  return String(text || '').split(INLINE).map((t, i) => {
    if (i % 2 === 0) return esc(t.replace(/\\\|/g, '|'));
    if (t.startsWith('<')) return '<br>';
    if (t.startsWith('**')) return `<strong>${inlineHtml(t.slice(2, -2))}</strong>`;
    if (t.startsWith('`')) return `<code>${esc(t.slice(1, -1))}</code>`;
    if (t.startsWith('[')) { const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t); return `<a href="${esc(href)}">${inlineHtml(label)}</a>`; }
    return `<em>${inlineHtml(t.slice(1, -1))}</em>`;
  }).join('');
}

function mdToHtml(md, mode) {
  const lines = String(md || '').split('\n');
  if (mode === 'inline') return lines.map(inlineHtml).join('<br>');
  const out = [];
  for (let i = 0; i < lines.length;) {
    const h = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (h) { out.push(`<h${h[1].length}>${inlineHtml(h[2])}</h${h[1].length}>`); i++; continue; }
    if (ITEM.test(lines[i])) {
      const tag = /^\s*\d+\./.test(lines[i]) ? 'ol' : 'ul', items = [];
      while (i < lines.length && ITEM.test(lines[i])) items.push(`<li>${inlineHtml(lines[i++].replace(ITEM, ''))}</li>`);
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && !/^#{1,6}\s/.test(lines[i]) && !ITEM.test(lines[i])) para.push(inlineHtml(lines[i++]));
    out.push(`<p>${para.join('<br>') || '<br>'}</p>`); // a paragraph's lines stay one, as Markdown.js shows them
  }
  return out.join('');
}

// Marks wrap the text, not the spaces around it ("**word** ", never "**word **").
const wrap = (mark, s) => { const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s); return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : s; };
function inlineMd(node) {
  let s = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { s += n.data.replace(/ /g, ' '); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName, inner = inlineMd(n);
    if (tag === 'BR') s += '\n';
    else if (tag === 'B' || tag === 'STRONG') s += wrap('**', inner);
    else if (tag === 'I' || tag === 'EM') s += wrap('*', inner);
    else if (tag === 'CODE') s += inner ? `\`${inner}\`` : '';
    else if (tag === 'A') s += `[${inner}](${n.getAttribute('href') || ''})`;
    else if (/^(DIV|P|H\d|LI|UL|OL)$/.test(tag)) s += `${s && !s.endsWith('\n') ? '\n' : ''}${inner}`; // a new line typed in
    else s += inner;
  }
  return s;
}
function htmlToMd(root, mode) {
  if (mode === 'inline') return inlineMd(root).replace(/\n+$/, '');
  const lines = [];
  let loose = '';
  const flush = () => { if (loose) lines.push(...loose.split('\n')); loose = ''; };
  for (const n of root.childNodes) {
    const tag = n.nodeType === 1 ? n.tagName : '';
    if (/^H(\d)$/.test(tag)) { flush(); lines.push(`${'#'.repeat(+tag[1])} ${inlineMd(n).replace(/\n/g, ' ')}`); }
    else if (tag === 'UL' || tag === 'OL') { flush(); [...n.children].forEach((li, k) => lines.push(`${tag === 'OL' ? `${k + 1}.` : '-'} ${inlineMd(li).replace(/\n/g, ' ')}`)); }
    else if (tag === 'P' || tag === 'DIV') { flush(); lines.push(...inlineMd(n).split('\n')); }
    else if (tag === 'BR') { loose += '\n'; }
    else { const holder = document.createElement('span'); holder.appendChild(n.cloneNode(true)); loose += inlineMd(holder); }
  }
  flush();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  return lines.join('\n');
}

// The markdown before and after the caret (Enter splits there).
function splitAtCaret(el, mode) {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return [htmlToMd(el, mode), ''];
  const r = sel.getRangeAt(0), part = (start) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    if (start) range.setEnd(r.startContainer, r.startOffset); else range.setStart(r.endContainer, r.endOffset);
    const holder = document.createElement('div');
    holder.appendChild(range.cloneContents());
    return htmlToMd(holder, mode);
  };
  return [part(true), part(false)];
}

// at: [x, y] puts the caret where the user clicked; else start, or the end.
function placeCaret(el, at, start, offset) {
  const sel = window.getSelection();
  let r = at && (document.caretRangeFromPoint?.(at[0], at[1]) || null);
  if (offset != null) { // after the first `offset` characters of its text
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let left = offset;
    while (walk.nextNode()) {
      if (walk.currentNode.length >= left) { r = document.createRange(); r.setStart(walk.currentNode, left); r.collapse(true); break; }
      left -= walk.currentNode.length;
    }
  }
  if (!r || !el.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(el); r.collapse(!!start); }
  sel.removeAllRanges();
  sel.addRange(r);
}

const norm = (s) => String(s || '').trim();

// The editable text. A change from outside replaces it only when it differs from what is typed.
export default function RichText({ value, onChange, onBlur, onEnter, onEmptyDelete, onMergeBack, onMergeNext, offset, mode = 'inline', focus = true, at, start, as: Tag = 'div', className = '' }) {
  const ref = useRef(null), mine = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (mine.current != null && norm(value) === norm(mine.current)) return;
    if (document.activeElement === el && norm(htmlToMd(el, mode)) === norm(value)) return;
    el.innerHTML = mdToHtml(value, mode);
    mine.current = value;
  }, [value, mode]);
  useEffect(() => { if (focus) { ref.current.focus(); placeCaret(ref.current, at, start, offset); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Tag
      ref={ref} className={`mde__rich ${className}`} contentEditable suppressContentEditableWarning spellCheck
      onInput={() => { const md = htmlToMd(ref.current, mode); mine.current = md; onChange(md); }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') e.currentTarget.blur();
        if ((e.key === 'Backspace' || e.key === 'Delete') && onEmptyDelete && !htmlToMd(ref.current, mode).trim()) { e.preventDefault(); onEmptyDelete(); return; }
        if (e.key === 'Backspace' && onMergeBack && window.getSelection()?.isCollapsed) {
          const [before, after] = splitAtCaret(ref.current, mode);
          if (!before.trim() && after.trim()) { e.preventDefault(); onMergeBack(after.trim()); return; }
        }
        if (e.key === 'Delete' && onMergeNext && window.getSelection()?.isCollapsed && !splitAtCaret(ref.current, mode)[1].trim()) { e.preventDefault(); onMergeNext(); return; }
        if (e.key !== 'Enter') return;
        if (!e.shiftKey && onEnter) { e.preventDefault(); onEnter(...splitAtCaret(ref.current, mode)); }
        else if (mode === 'inline') { e.preventDefault(); document.execCommand('insertLineBreak'); }
      }}
      onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }}
      onBlur={onBlur}
    />
  );
}
