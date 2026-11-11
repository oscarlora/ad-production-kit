// Minimal markdown → React (headings, lists, tables, quotes, rules, code blocks, front matter shown as code, inline
// marks, <br>; no other HTML).
import { INLINE, isSeparator, isTable, ITEM, tableCells } from '../../lib/markdown.js';

export function Inline({ text }) {
  return String(text || '').split(INLINE).map((t, i) => {
    if (i % 2 === 0) return t.replace(/\\\|/g, '|');
    if (t.startsWith('<')) return <br key={i} />;
    if (t.startsWith('**')) return <strong key={i}><Inline text={t.slice(2, -2)} /></strong>;
    if (t.startsWith('`')) return <code key={i}>{t.slice(1, -1)}</code>;
    if (t.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);
      return /^https?:/.test(href) ? <a key={i} href={href} target="_blank" rel="noreferrer">{label}</a> : label;
    }
    return <em key={i}>{t.slice(1, -1)}</em>;
  });
}

const isHeading = (l) => /^#{1,6}\s/.test(l);
const FENCE = /^\s*```/;
const QUOTE = /^\s*>\s?/;
const isRule = (l) => /^\s*(?:-{3,}|\*{3,})\s*$/.test(l);
// Where a paragraph or list ends.
const breaks = (l) => !l.trim() || isTable(l) || isHeading(l) || FENCE.test(l) || QUOTE.test(l) || isRule(l);

function blocks(md) {
  const lines = String(md || '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const out = [];
  let i = 0;
  // Front matter (a DESIGN.md's tokens) shows as code.
  const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  if (end > 0) { out.push({ code: lines.slice(1, end).join('\n') }); i = end + 1; }
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (isRule(l)) { out.push({ rule: true }); i++; continue; }
    if (QUOTE.test(l)) {
      const quote = [];
      while (i < lines.length && QUOTE.test(lines[i])) quote.push(lines[i++].replace(QUOTE, ''));
      out.push({ quote: quote.join('<br>') });
      continue;
    }
    if (FENCE.test(l)) {
      const code = [];
      while (++i < lines.length && !FENCE.test(lines[i])) code.push(lines[i]);
      out.push({ code: code.join('\n') });
      i++;
      continue;
    }
    if (isHeading(l)) { out.push({ h: l.replace(/^#+\s*/, ''), level: /^#+/.exec(l)[0].length }); i++; continue; }
    if (isTable(l)) {
      const rows = [];
      while (i < lines.length && isTable(lines[i])) rows.push(tableCells(lines[i++]));
      const body = rows.slice(1).filter((r) => !isSeparator(r));
      out.push({ table: { head: rows[0], body } });
      continue;
    }
    if (ITEM.test(l)) {
      const items = [];
      while (i < lines.length && !breaks(lines[i])) {
        if (ITEM.test(lines[i])) items.push(lines[i].replace(ITEM, ''));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      out.push({ list: items });
      continue;
    }
    const para = [];
    while (i < lines.length && !breaks(lines[i]) && !ITEM.test(lines[i])) para.push(lines[i++].trim());
    out.push({ p: para.join('<br>') }); // a line break stays one, as in the doc it came from
  }
  return out;
}

export default function Markdown({ text }) {
  return (
    <div className="md">
      {blocks(text).map((b, i) => {
        if (b.h != null) { const H = `h${b.level}`; return <H key={i}><Inline text={b.h} /></H>; }
        if (b.code != null) return <pre key={i}><code>{b.code}</code></pre>;
        if (b.rule) return <hr key={i} />;
        if (b.quote != null) return <blockquote key={i}><Inline text={b.quote} /></blockquote>;
        if (b.list) return <ul key={i}>{b.list.map((t, k) => <li key={k}><Inline text={t} /></li>)}</ul>;
        if (b.table) {
          return (
            <div key={i} className="md__table">
              <table>
                <thead><tr>{b.table.head.map((c, k) => <th key={k}><Inline text={c} /></th>)}</tr></thead>
                <tbody>{b.table.body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}><Inline text={c} /></td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        return <p key={i}><Inline text={b.p} /></p>;
      })}
    </div>
  );
}
