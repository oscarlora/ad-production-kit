// An ad's edit: its versions (edit.json, edit-v2.json, …), review comments (comments/<id>.json), export state and .md
// saves. A comment on a .md (file: its path in the folder, quote: the text it's about) or on footage.json (quote: the
// scene) shares comments/ with the video's comments (t, box). Each function takes the ad's folder as adDir gives it;
// the .md saves and comments also take the brand's inputs/ (its pages).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { AD_HEAD } from '../client/format.js';
import { adFolders } from './ads.js';
import { readJson, within } from './brands.js';
import { repoRoot } from './root.js';
import { catalogLib } from './tools.js';

const PLAN = /^edit(-v\d+)?\.json$/i;
const COMMENT_ID = /^n[a-z0-9]{6,16}$/;

// An ad folder name as the client sends it ("<id>_…", one path segment) → its absolute path, or null when the name is
// bad or the folder missing.
// A bare <id> finds the ad's folder, so a link opened before a rename still works.
export function adDir(brandDirAbs, ad) {
  const outputs = join(brandDirAbs, 'outputs');
  const name = typeof ad !== 'string' ? null : /^\d+$/.test(ad) ? adFolders(outputs).find((f) => f.startsWith(`${ad}_`)) : /^\d+_[^/\\\0]+$/.test(ad) ? ad : null;
  const dir = name && join(outputs, name);
  return dir && existsSync(dir) ? dir : null;
}

// edit.json is V1, edit-v2.json V2.
const label = (file) => `V${/^edit-v(\d+)\.json$/i.exec(file)?.[1] || 1}`;

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

function readComments(dir) {
  const cdir = join(dir, 'comments');
  return existsSync(cdir) ? readdirSync(cdir).filter((n) => n.endsWith('.json')).map((n) => readJson(join(cdir, n), null)).filter(Boolean) : [];
}
// The comments on the ad's .md files and footage.json, oldest first.
export const docComments = (dir) => readComments(dir).filter((n) => n.file).sort((a, b) => a.at.localeCompare(b.at));

// null when the ad has no edit document.
export function editInfo(dir) {
  let names = [];
  try { names = readdirSync(dir).filter((n) => PLAN.test(n)); } catch {}
  if (!names.length) return null;
  const mtime = (n) => { try { return Math.round(statSync(join(dir, n)).mtimeMs); } catch { return 0; } };
  // v moves when the document, its base, its fx module or a media file it uses changes, so the preview reloads for
  // any of them; media maps each src to its file's mtime, which the preview's URLs carry (a replaced file refetches).
  const plans = names.sort((a, b) => label(a).localeCompare(label(b), undefined, { numeric: true })).map((n) => {
    const d = readJson(join(dir, n), {});
    const docs = [d, d?.base ? readJson(join(dir, d.base), {}) : null];
    const media = Object.fromEntries([...new Set(docs.flatMap((x) => x?.tracks || []).flatMap((t) => t.clips || []).map((c) => c.src).filter(Boolean))].map((src) => [src, mtime(src)]));
    return { file: n, label: label(n), p: `outputs/${basename(dir)}/${n}`, media, v: Math.max(mtime(n), mtime(d?.fx || 'fx.js'), d?.base ? mtime(d.base) : 0, ...Object.values(media)) };
  });
  const comments = readComments(dir).filter((n) => !n.file).sort((a, b) => a.t - b.t);
  let exp = readJson(join(dir, '.export.json'), null);
  if (exp?.state === 'running' && exp.pid && !alive(exp.pid)) exp = { ...exp, state: 'failed', error: 'The export stopped.' };
  return { plans, comments, export: exp };
}

// comment: { id?, t, to? (a stretch), box?, text, plan } on the video, or { id?, file, quote, text, edit? } on a .md or footage.json (file
// relative to the ad folder; on footage.json, quote is the scene and check the checklist point it replies on); edit: { where, from, to } is the user's own change to it, so the agent brings what depends on it in step.
// deleted: the change deleted rows, a column or blocks (to is ''). Another edit of the same spot joins its open comment (keeping the first from); one that undoes it removes the comment. Deletions never join.
// Returns the saved comment (null when removed).
export function saveComment(dir, comment) {
  const t = Number(comment?.t), text = String(comment?.text || '').trim(), file = comment?.file && String(comment.file);
  if (file ? !/^([^\\\0]+\.md|footage\.json)$/i.test(file) || file.split('/').includes('..') || !existsSync(join(dir, file)) : !Number.isFinite(t) || t < 0) throw new Error('a comment needs a time, a .md file or footage.json');
  if (!text) throw new Error('a comment needs text');
  const edit = file && comment.edit ? { where: String(comment.edit.where || '').slice(0, 200), from: String(comment.edit.from ?? ''), to: String(comment.edit.to ?? '') } : null;
  const deleted = !!(edit && comment.deleted);
  const same = edit && !deleted && readComments(dir).find((n) => n.status === 'open' && n.file === file && !n.deleted && n.edit?.where === edit.where);
  if (same) edit.from = same.edit.from;
  let id = same?.id || comment.id;
  if (!COMMENT_ID.test(id || '')) id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  if (same && edit.from.trim() === edit.to.trim()) { removeComment(dir, id); return null; }
  const cdir = join(dir, 'comments');
  mkdirSync(cdir, { recursive: true });
  const prev = readJson(join(cdir, `${id}.json`), {});
  const at = prev.at || new Date().toISOString();
  const box = Array.isArray(comment.box) && comment.box.length === 4 && comment.box.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) ? comment.box.map((x) => +x.toFixed(4)) : null;
  const out = file
    ? { ...prev, id, file, quote: String(comment.quote || prev.quote || '').slice(0, 1000), text, ...(edit && { edit }), ...(deleted && { deleted }), ...(comment.check && { check: String(comment.check).slice(0, 20) }), status: 'open', at }
    : { ...prev, id, t: +t.toFixed(3), box, text, plan: String(comment.plan || prev.plan || 'edit.json'), status: 'open', at };
  const to = Number(comment.to);
  if (!file) { if (Number.isFinite(to) && to > t + 0.01) out.to = +to.toFixed(3); else delete out.to; }
  delete out.reply;
  writeFileSync(join(cdir, `${id}.json`), JSON.stringify(out, null, 1) + '\n');
  return out;
}

// The user approves a done comment: it leaves the list and stays in the history.
export function approveComment(dir, id) {
  if (!COMMENT_ID.test(id || '')) throw new Error('bad comment id');
  const f = join(dir, 'comments', `${id}.json`), comment = readJson(f, null);
  if (!comment) throw new Error('no such comment');
  writeFileSync(f, JSON.stringify({ ...comment, status: 'approved' }, null, 1) + '\n');
}

// The user sends a done comment back with what's still off: it opens again with that text, and the round before (the
// comment and the agent's reply) joins its history, oldest first.
export function sendBackComment(dir, id, text) {
  if (!COMMENT_ID.test(id || '')) throw new Error('bad comment id');
  if (!String(text || '').trim()) throw new Error('say what is still off');
  const f = join(dir, 'comments', `${id}.json`), comment = readJson(f, null);
  if (!comment) throw new Error('no such comment');
  const { reply, span, ...rest } = comment;
  const history = [...(comment.history || []), { text: comment.text, ...(reply && { reply }) }];
  writeFileSync(f, JSON.stringify({ ...rest, history, text: String(text).trim(), status: 'open' }, null, 1) + '\n');
}

export function removeComment(dir, id) {
  if (!COMMENT_ID.test(id || '')) throw new Error('bad comment id');
  rmSync(join(dir, 'comments', `${id}.json`), { force: true });
}

// The user picks the voiceover take (an animation's Voice step): voice.json { take } (relative to the ad folder), with a
// comment on the storyboard so the agent retimes it to that take.
export function pickVoice(dir, take) {
  const rel = String(take || '');
  if (!/^(voice|audio)\/[^/\\\0]+\.(mp3|wav|m4a|aac|ogg)$/i.test(rel) || !existsSync(join(dir, rel))) throw new Error('no such voice take');
  writeFileSync(join(dir, 'voice.json'), JSON.stringify({ take: rel }, null, 2) + '\n');
  if (existsSync(join(dir, 'storyboard.md'))) saveComment(dir, { file: 'storyboard.md', text: `Picked the voice take ${basename(rel)}: retime the storyboard to it.` });
}

// The user's review of a footage.json scene: ticks ({ <check>: bool }, merged into theirs) and/or decision ('approved'
// clears a reshoot, 'reshoot' calls one, null clears it), with an optional comment. A call leaves a comment on the scene,
// so the agent's review loop hears it.
export function decideScene(dir, { scene, ticks, decision, text }) {
  if (decision != null && decision !== 'approved' && decision !== 'reshoot') throw new Error('bad decision');
  const f = join(dir, 'footage.json'), doc = readJson(f, null);
  const key = Object.keys(doc?.clips || {}).find((k) => k.trim().toLowerCase() === String(scene || '').trim().toLowerCase());
  if (!key) throw new Error('no such scene');
  const clip = doc.clips[key];
  if (ticks && typeof ticks === 'object') clip.ticks = { ...clip.ticks, ...Object.fromEntries(Object.entries(ticks).map(([k, v]) => [k, !!v])) };
  if (decision === 'reshoot') clip.decision = 'reshoot';
  else if (decision !== undefined) delete clip.decision;
  writeFileSync(f, JSON.stringify(doc, null, 2) + '\n');
  if (!decision) return null;
  const said = String(text || '').trim();
  return saveComment(dir, { file: 'footage.json', quote: key, text: `${decision === 'approved' ? 'Approved' : 'Reshoot'}${said ? `: ${said}` : ''}` });
}

// The brand's saved text styles (the editor's templates): inputs/text-styles.json, a list of looks (a text style's
// font, weight, colors, stroke, background and shadow).
export function saveLooks(inputs, looks) {
  if (!Array.isArray(looks) || looks.length > 48 || looks.some((k) => !k || typeof k !== 'object' || Array.isArray(k))) throw new Error('bad styles');
  writeFileSync(join(inputs, 'text-styles.json'), JSON.stringify(looks, null, 1) + '\n');
  return { ok: true };
}

// Studio's manual edits (made in the browser: studio/engine/ops.js) and their undo: { file, text, expect } writes text
// when the edit document still reads expect, so a change made on disk since is never overwritten.
export async function saveEdit(dir, { file, text, expect }) {
  if (!PLAN.test(file || '') || typeof text !== 'string') throw new Error('bad edit document');
  JSON.parse(text);
  const f = join(dir, file);
  if (readFileSync(f, 'utf8') !== expect) throw new Error('the edit changed on disk since; nothing saved');
  writeFileSync(f, text);
  (await catalogLib()).markEditing(dir, null);
  return { ok: true };
}

// An image ad's Approve / Unapprove: moves a render (with its same-stem prompt and its sidecar) between drafts/ and final/,
// numbering it as the next V there (finals stay V1, V2, … with no gaps; a Story keeps its 4:5's V), repoints the record and the prompt's File name,
// sets the record's status (approved while final/ holds a render, else pending-review) and refreshes the index.
// Rebuild the brand's ads index (tools/record-ad.mjs), which also copies each ad's meta.md into its record.
const refreshIndex = (outputs) => spawn(process.execPath, [join(repoRoot(), 'tools', 'record-ad.mjs'), '--index', outputs], { cwd: repoRoot(), stdio: 'ignore' }).on('error', () => {});
const IMG = /\.(png|jpe?g|webp|gif)$/i;
const VER = new RegExp(`^(${AD_HEAD.source.slice(1)}V)(\\d+)(_.*)$`); // <id>_<initials>_V<n>_<rest>
const STORY = /_Story$/;
export function moveRender(dir, file) {
  const m = /^(drafts|final)\/([^/\\\0]+)\.(png|jpe?g|webp|gif)$/i.exec(String(file || ''));
  if (!m || !existsSync(join(dir, file))) throw new Error('no such render');
  const [, from, stem] = m, to = from === 'drafts' ? 'final' : 'drafts';
  mkdirSync(join(dir, to), { recursive: true });
  const stems = (d) => readdirSync(join(dir, d)).filter((n) => IMG.test(n)).map((n) => n.replace(IMG, ''));
  const renames = []; // [from rel stem, to rel stem]
  const num = (n) => +(VER.exec(n)?.[2] || 0), setNum = (n, k) => n.replace(VER, (_, a, __, c) => `${a}${k}${c}`);
  // A Story (<4:5 name>_Story) keeps its 4:5's V; anything else becomes the next V there.
  const next = STORY.test(stem) ? num(stem) : Math.max(0, ...stems(to).map(num)) + 1;
  renames.push([`${from}/${stem}`, `${to}/${setNum(stem, next)}`]);
  if (from === 'final') { // close the gap: the finals left become V1, V2, … in their order, a Story with its 4:5
    const left = stems('final').filter((n) => n !== stem && VER.test(n));
    const order = [...new Set(left.map(num))].sort((x, y) => x - y);
    left.forEach((n) => renames.push([`final/${n}`, `final/${setNum(n, order.indexOf(num(n)) + 1)}`]));
  }
  // Through a temporary name first, so a renumbering never lands on a file not yet moved. The sidecar goes to the new
  // folder's gen/ (sidecarOf in tools/lib/providers.mjs), from there or from beside the render.
  const moves = renames.filter(([x, y]) => x !== y).map(([x, y], i) => {
    const [d, s0] = x.split('/'), files = readdirSync(join(dir, d)).filter((n) => n.startsWith(`${s0}.`) && /^([a-z]+|gen\.json)$/i.test(n.slice(s0.length + 1)));
    files.forEach((n) => renameSync(join(dir, d, n), join(dir, d, `.moving${i}${n.slice(s0.length)}`)));
    const side = join(dir, d, 'gen', `${s0}.gen.json`), hasSide = existsSync(side);
    if (hasSide) renameSync(side, join(dir, d, 'gen', `.moving${i}.gen.json`));
    return { x, y, d, files: files.map((n) => n.slice(s0.length)), hasSide, i };
  });
  for (const { x, y, d, files, hasSide, i } of moves) {
    const [d2, s1] = y.split('/'), s0 = x.split('/')[1];
    const sides = [...files.filter((e) => e === '.gen.json').map(() => join(dir, d, `.moving${i}.gen.json`)), ...(hasSide ? [join(dir, d, 'gen', `.moving${i}.gen.json`)] : [])];
    for (const ext of files.filter((e) => e !== '.gen.json')) {
      const dest = join(dir, d2, `${s1}${ext}`);
      renameSync(join(dir, d, `.moving${i}${ext}`), dest);
      if (ext === '.txt') writeFileSync(dest, readFileSync(dest, 'utf8').split(s0).join(s1)); // its File name line
    }
    if (sides.length) {
      const dest = join(dir, d2, 'gen', `${s1}.gen.json`);
      mkdirSync(join(dir, d2, 'gen'), { recursive: true });
      renameSync(sides.at(-1), dest); // the gen/ one wins over an older one beside the render
      sides.slice(0, -1).forEach((p) => rmSync(p));
      writeFileSync(dest, readFileSync(dest, 'utf8').split(s0).join(s1));
    }
  }
  const folder = basename(dir), outputs = resolve(dir, '..');
  const rec = join(outputs, 'json', `${folder.split('_')[0]}.json`);
  if (existsSync(rec)) {
    // Every move at once (placeholders first), so one rename's new path is never renamed again.
    let t = readFileSync(rec, 'utf8');
    moves.forEach(({ x, i }) => { t = t.split(`${folder}/${x}.`).join(`\0${i}\0`); });
    moves.forEach(({ y, i }) => { t = t.split(`\0${i}\0`).join(`${folder}/${y}.`); });
    const r = JSON.parse(t);
    r.status = stems('final').length ? 'approved' : 'pending-review';
    writeFileSync(rec, JSON.stringify(r, null, 2) + '\n');
    refreshIndex(outputs);
  }
  return { to, file: `${renames[0][1]}.${m[3]}` };
}

// Run tools/edit-video.mjs export in the background; its progress lands in .export.json.
export function startExport(dir, plan) {
  if (!PLAN.test(plan || '')) throw new Error('bad edit document');
  const cur = readJson(join(dir, '.export.json'), null);
  if (cur?.state === 'running' && cur.pid && alive(cur.pid)) throw new Error('An export is already running.');
  const child = spawn(process.execPath, [join(repoRoot(), 'tools', 'edit-video.mjs'), 'export', join(dir, plan)], { cwd: repoRoot(), detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  writeFileSync(join(dir, '.export.json'), JSON.stringify({ plan, state: 'running', progress: 0, pid: child.pid, at: Date.now() }));
}

// The markdown editor's save of a .md in the ad folder: { name (relative to the folder), text, base (the file as the
// editor last had it) }. A change made on disk since is merged in line by line; lines added or removed on both sides
// can't be lined up, so then it returns { error: 'changed', text: the file } for the editor to apply its typing to.
// Otherwise { ok, v (the file's version, as the workflow gives it), text (only when merged) }.
export function saveMd(dir, { name, text, base } = {}) {
  const abs = resolve(dir, String(name || ''));
  if (!within(dir, abs) || !/\.md$/i.test(abs) || !existsSync(abs) || typeof text !== 'string') throw new Error('bad file');
  const cur = readFileSync(abs, 'utf8');
  let out = text;
  if (typeof base === 'string' && cur !== base && cur !== text) {
    const [b, mine, theirs] = [base, text, cur].map((t) => t.split('\n'));
    if (b.length !== mine.length || b.length !== theirs.length) return { error: 'changed', text: cur };
    out = mine.map((l, i) => (l !== b[i] ? l : theirs[i])).join('\n');
  }
  writeFileSync(abs, out);
  if (basename(abs) === 'meta.md') refreshIndex(resolve(dir, '..'));
  return { ok: true, v: Math.round(statSync(abs).mtimeMs), ...(out !== text && { text: out }) };
}
