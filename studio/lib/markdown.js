// Studio's markdown grammar and document parsing, shared by the renderer (components/workflow/Markdown.js), the editor
// (MdEditor.js, rich.js) and the server (Board and Workflow data).

// Inline marks: <br>, **bold**, `code`, [label](href), *italic*.
export const INLINE = /(<br\s*\/?>|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*)/gi;
// A list item's marker ("- ", "* ", "1. ").
export const ITEM = /^\s*(?:[-*]|\d+\.)\s+/;
export const isTable = (l) => /^\s*\|/.test(l);

// "| a | b \\| c |" → ['a', 'b \\| c'].
export const tableCells = (l) => l.trim().replace(/^\||(?<!\\)\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
// ['a', ''] → "| a | |".
export const tableRow = (cells) => `|${cells.map((c) => (c ? ` ${c} ` : ' ')).join('|')}|`;
// "|---|:-:|", or a row of empty cells.
export const isSeparator = (cells) => cells.every((c) => /^:?-*:?$/.test(c));

// ---- an editable document ----
// Blocks split on blank lines; a table and an <!-- HTML comment --> are blocks of their own.
// parseDoc → { blocks: [{ src, gap }], tail } (gap and tail: the blank lines before a block and at the end); serializeDoc reverses it exactly.
const isComment = (l) => l.trimStart().startsWith('<!--');
export function parseDoc(text) {
  const lines = String(text).split('\n');
  const blocks = [];
  let gap = [];
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { gap.push(lines[i++]); continue; }
    const start = i;
    if (isComment(lines[i])) { while (i < lines.length && !lines[i].includes('-->')) i++; i++; }
    else if (isTable(lines[i])) while (i < lines.length && isTable(lines[i])) i++;
    else while (i < lines.length && lines[i].trim() && !isTable(lines[i]) && !isComment(lines[i])) i++;
    blocks.push({ src: lines.slice(start, i).join('\n'), gap });
    gap = [];
  }
  return { blocks, tail: gap };
}
export const serializeDoc = (doc) => doc.blocks.filter((b) => b.src.trim())
  .flatMap((b) => [...b.gap, ...b.src.split('\n')]).concat(doc.tail).join('\n');
// A media block: one or more "![title](path)" lines, path relative to the ad folder.
const MEDIA = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
export const mediaItems = (src) => {
  const lines = src.split('\n').map((l) => MEDIA.exec(l.trim()));
  return lines.every(Boolean) ? lines.map(([, title, path]) => ({ title, path })) : null;
};
// 'code': front matter (a DESIGN.md's tokens), a fenced block or a rule, edited as raw text.
const isCode = (src) => /^(?:---|```)/.test(src.trimStart()) || /^\*{3,}\s*$/.test(src.trim());
export const blockKind = (src) => (isTable(src) ? 'table' : isComment(src) ? 'comment' : mediaItems(src) ? 'media' : isCode(src) ? 'code' : 'text');

// A section starts at a heading or a whole-line bold caps label ("**LINES TO CAMERA**") and runs to the next one.
const SECTION = /^(?:#{1,6}\s+(.+?)|\*\*([^a-z*]+?):?\*\*:?)\s*$/;
// For each block, whether it falls in a section whose name matches re.
export function inSections(blocks, re) {
  let cur = '';
  return blocks.map(({ src }) => {
    const m = blockKind(src) === 'text' && SECTION.exec(src.split('\n')[0]);
    if (m) cur = m[1] || m[2];
    return !!cur && re.test(cur);
  });
}
