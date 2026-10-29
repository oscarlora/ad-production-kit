// An ad's edit: its versions (edit.json, edit-v2.json, …), review comments (comments/<id>.json), export state and .md
// saves. A comment on a .md (file, quote: the text it's about) or on footage.json (quote: the scene) shares comments/
// with the video's comments (t, box). Each function takes the ad's folder as adDir gives it.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { ORIGIN, compose, endOf, mapTimes, r3 } from '../../engine/doc.js';
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
// Another edit of the same spot joins its open comment (keeping the first from); one that undoes it removes the comment.
// Returns the saved comment (null when removed).
export function saveComment(dir, comment) {
  const t = Number(comment?.t), text = String(comment?.text || '').trim(), file = comment?.file && String(comment.file);
  if (file ? !/^([^/\\\0]+\.md|footage\.json)$/i.test(file) || !existsSync(join(dir, file)) : !Number.isFinite(t) || t < 0) throw new Error('a comment needs a time, a .md file or footage.json');
  if (!text) throw new Error('a comment needs text');
  const edit = file && comment.edit ? { where: String(comment.edit.where || '').slice(0, 200), from: String(comment.edit.from ?? ''), to: String(comment.edit.to ?? '') } : null;
  const same = edit && readComments(dir).find((n) => n.status === 'open' && n.file === file && n.edit?.where === edit.where);
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
    ? { ...prev, id, file, quote: String(comment.quote || prev.quote || '').slice(0, 1000), text, ...(edit && { edit }), ...(comment.check && { check: String(comment.check).slice(0, 20) }), status: 'open', at }
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

// The user trims a media clip in Studio: { plan, id: '<track>.<clip>' (raw indices), in, dur } sets the part of its
// source it plays. Its start stays put; when its end moves, everything after it slides along if the clip sits in a
// sequence (the next clip on its track starts where it ended), and a clip of the same name starting at the same
// time on another track (its voice) gets the same trim. In a hook version, a body clip is trimmed in its base.
export async function trimClip(dir, { plan, id, in: inS, dur }) {
  if (!PLAN.test(plan || '')) throw new Error('bad edit document');
  let f = join(dir, plan), doc = readJson(f, null), [ti, ci] = String(id || '').split('.').map(Number);
  if (doc?.base) {
    const shown = compose(doc, readJson(join(dir, doc.base), {})).tracks[ti]?.clips[ci], o = shown?.[ORIGIN];
    if (!o) throw new Error('no such clip');
    if (!o[0]) {
      const base = doc.base;
      f = join(dir, base); doc = readJson(f, null);
      // A base clip crossing the version's cut shows from the cut: map its in and length back to the base's clock.
      const b = doc?.tracks?.[o[1]]?.clips?.[o[2]], skip = r3((b?.in ?? 0) - (shown.in ?? 0)); // ≤ 0: what the cut hides
      if (skip && b) {
        inS = r3(inS + skip); dur = r3(dur - skip / (b.rate ?? 1));
        if (inS < 0) throw new Error(`this clip is shared with ${base} and starts before the cut there; trim its start in ${base}`);
      }
    }
    [, ti, ci] = o;
  }
  const c = doc?.tracks?.[ti]?.clips?.[ci];
  if (!c?.src) throw new Error('only a media clip can be trimmed');
  if (!(Number.isFinite(inS) && inS >= 0 && Number.isFinite(dur) && dur > 0.05)) throw new Error('bad trim');
  const at = c.at ?? 0;
  const oldEnd = endOf(c), newEnd = r3(at + dur), delta = r3(newEnd - oldEnd);
  const set = (x) => { x.in = r3(inS); x.end = newEnd; delete x.dur; };
  const linked = !c.name ? [] : doc.tracks.flatMap((tr, i) => (i === ti ? [] : tr.clips.filter((x) => x.src && x.name === c.name && Math.abs((x.at ?? 0) - at) < 1e-3)));
  const inSequence = doc.tracks[ti].clips.some((x) => x !== c && Math.abs((x.at ?? 0) - oldEnd) < 0.01);
  const before = readFileSync(f, 'utf8');
  set(c); linked.forEach(set);
  // Like a cut when it shrinks.
  if (inSequence && delta) mapTimes(doc, (t) => (t >= oldEnd - 1e-3 ? r3(t + delta) : delta < 0 && t > newEnd ? newEnd : t), new Set([c, ...linked]));
  const after = JSON.stringify(doc, null, 1) + '\n';
  writeFileSync(f, after);
  (await catalogLib()).markEditing(dir, null);
  return { delta, rippled: inSequence && !!delta, linked: linked.length, undo: { file: basename(f), before, after } };
}

// The user mutes or unmutes a track in Studio: { plan, track (its name), mute }. Unmuting also unmutes its clips, all
// but freeze frames (rate under 0.1). In a hook version without that track, it changes the base's.
export async function muteTrack(dir, { plan, track, mute }) {
  if (!PLAN.test(plan || '')) throw new Error('bad edit document');
  let f = join(dir, plan), doc = readJson(f, null), tr = doc?.tracks?.find((x) => x.name === track);
  if (!tr && doc?.base) { f = join(dir, doc.base); doc = readJson(f, null); tr = doc?.tracks?.find((x) => x.name === track); }
  if (!tr) throw new Error('no such track');
  const before = readFileSync(f, 'utf8');
  if (mute) tr.mute = true;
  else { delete tr.mute; for (const c of tr.clips || []) if (c.mute && !((c.rate ?? 1) < 0.1)) delete c.mute; }
  const after = JSON.stringify(doc, null, 1) + '\n';
  writeFileSync(f, after);
  (await catalogLib()).markEditing(dir, null);
  return { undo: { file: basename(f), before, after } };
}

// Studio's undo / redo of a trim or mute: { file, text, expect } puts back text when the edit document is still expect.
export function restoreEdit(dir, { file, text, expect }) {
  if (!PLAN.test(file || '') || typeof text !== 'string') throw new Error('bad edit document');
  const f = join(dir, file);
  if (readFileSync(f, 'utf8') !== expect) throw new Error('the edit changed since; nothing undone');
  writeFileSync(f, text);
  return { ok: true };
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
  return { ok: true, v: Math.round(statSync(abs).mtimeMs), ...(out !== text && { text: out }) };
}
