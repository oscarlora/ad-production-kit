// Workflow data: each ad's progress through its format's steps, inferred from its outputs/ folder and record.
// Returned paths are brand-relative (POSIX), for the /file route.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { mediaType } from '../client/api.js';
import { blockKind, inSections, isSeparator, parseDoc, tableCells } from '../markdown.js';
import { adFolders } from './ads.js';
import { readJson } from './brands.js';
import { adDir, docComments, editInfo } from './edit.js';

const typeOf = (rel) => mediaType(rel) || /\.(md|txt|pdf)$/i.exec(rel)?.[1].toLowerCase() || 'other';

// Records may hold objects or arrays where strings are expected; flatten them for React.
function displayText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(displayText).join(' · ');
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${displayText(x)}`).join(' · ');
  return String(v);
}

// `<id>_<Concept>_<Format>_<Persona>_<Angle>_<Product>`; older folders carry fewer parts.
function parseFolder(folder) {
  const [id, concept = '', format = '', persona = '', angle = '', ...rest] = folder.split('_');
  return { folder, id: Number(id), concept, format, persona, angle, product: rest.join('_') };
}

// Every file under the ad folder (dot-entries skipped), as { rel, p, v, type }.
function inventory(brandDirAbs, folder) {
  const base = join(brandDirAbs, 'outputs', folder);
  const out = [];
  const walk = (dir, rel, depth) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (depth < 3) walk(join(dir, e.name), r, depth + 1); continue; }
      let v = 0;
      try { v = Math.round(statSync(join(dir, e.name)).mtimeMs); } catch { continue; }
      out.push({ rel: r, p: `outputs/${folder}/${r}`, v, type: typeOf(r) });
    }
  };
  walk(base, '', 0);
  return out.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true }));
}

const readRecord = (brandDirAbs, id) => readJson(join(brandDirAbs, 'outputs', 'json', `${id}.json`), null);

const readText = (brandDirAbs, p) => { try { return readFileSync(join(brandDirAbs, p), 'utf8'); } catch { return ''; } };

// Strip a file entry to what the client renders; a same-stem .txt beside an image is its prompt.
function present(files, all) {
  const byRel = new Map(all.map((f) => [f.rel, f]));
  const prompts = new Set();
  const list = files.map((f) => {
    const txt = f.type === 'image' && byRel.get(f.rel.replace(/\.[^.]+$/, '.txt'));
    if (txt) prompts.add(txt.rel);
    return { name: f.rel, p: f.p, v: f.v, type: f.type, ...(txt ? { prompt: { p: txt.p, v: txt.v } } : {}) };
  });
  return list.filter((f) => !prompts.has(f.name));
}

// ---- storyboard.md ----
// A header, an optional **Blocking** section, then one table (columns in COLS) with bold scene-divider rows ("| **Scene 1** |||||").
const COLS = { '#': 'n', setting: 'setting', 'on screen': 'onScreen', 'what we see': 'see', 'line(s)': 'lines', lines: 'lines', line: 'lines', s: 'secs', sec: 'secs', seconds: 'secs', start: 'from', end: 'to', 'what moves': 'moves', 'what we hear': 'hear', transition: 'transition', camera: 'camera' };

// "ALEX: Stop. / SAM: I swear." → [{ who, text }]; "—" → [].
function splitLines(cell) {
  if (!cell || /^[—–-]$/.test(cell)) return [];
  return cell.split(/\s+\/\s+/).map((part) => {
    const m = /^([A-Z][A-Z0-9 .'’-]*(?:\s*\([^)]*\))?):\s*(.*)$/.exec(part);
    return m ? { who: m[1], text: m[2] } : { who: '', text: part };
  });
}

const blank = (v) => (!v || v === '—' || v === '-' ? '' : v); // "—" marks a deliberately empty cell
function parseStoryboard(md) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*\|/.test(l));
  const pre = (start < 0 ? lines : lines.slice(0, start)).filter((l, i) => !(i === 0 && /^#\s/.test(l))); // the title repeats the page head
  let end = start;
  while (end >= 0 && end < lines.length && /^\s*\|/.test(lines[end])) end++;
  const b = pre.findIndex((l) => /^\*\*Blocking\*\*/.test(l));
  const header = (b < 0 ? pre : pre.slice(0, b)).join('\n').trim();
  const blocking = [...(b < 0 ? [] : pre.slice(b)), ...(start < 0 ? [] : lines.slice(end))].join('\n').trim();

  const rows = [];
  if (start >= 0) {
    const keys = tableCells(lines[start]).map((h) => COLS[h.toLowerCase()] || null);
    let scene = '';
    for (const l of lines.slice(start + 1, end)) {
      const c = tableCells(l);
      if (isSeparator(c)) continue;
      if (/^\*\*/.test(c[0]) && c.slice(1).every((x) => !x)) { scene = c[0].replace(/\*\*/g, '').trim(); continue; }
      const r = {};
      keys.forEach((k, i) => { if (k) r[k] = c[i] || ''; });
      const n = /^\d+$/.test(r.n || '') ? Number(r.n) : null;
      rows.push({ n, scene, setting: r.setting || '', onScreen: r.onScreen || '', see: r.see || '', lines: splitLines(r.lines), secs: r.secs || '', from: r.from || '', to: r.to || '', moves: blank(r.moves), hear: blank(r.hear), transition: blank(r.transition), camera: blank(r.camera) });
    }
  }
  return { header, blocking, rows };
}

// A generated file's <stem>.gen.json sidecar (model, provider, params, prompt, refs), or null.
function readGen(brandDirAbs, byRel, f) {
  const side = byRel.get(f.rel.replace(/\.[^./]+$/, '.gen.json'));
  const g = side && readJson(join(brandDirAbs, side.p), null);
  if (!g) return null;
  const refs = (Array.isArray(g.refs) ? g.refs : []).map(({ role = 'ref', path = '' }) => {
    const p = String(path), name = p.split('?')[0].split('/').pop();
    if (/^https?:\/\//i.test(p)) return { role, name, url: p, type: typeOf(name) };
    try { return { role, name, p, v: Math.round(statSync(join(brandDirAbs, p)).mtimeMs), type: typeOf(p) }; } catch { return { role, name }; }
  });
  return { model: g.model, provider: g.provider, at: g.at, params: g.params || {}, refs, prompt: g.prompt || '' };
}

// Shots matched to frames/frame-NN.* (else the 4:5 draft frame-NN-4x5.*) and clips/{clip,chunk}-NN[-<take>].* (b, c… or preview).
// A clip whose sidecar sent frame refs covers each of those shots; otherwise it belongs to shot NN.
const FRAME = /^frames\/frame-0*(\d+)\.(png|jpe?g|webp)$/i;
const FRAME_4X5 = /^frames\/frame-0*(\d+)-4x5\.(png|jpe?g|webp)$/i;
function shotsWithMedia(brandDirAbs, folder, sb, files) {
  const byRel = new Map(files.map((f) => [f.rel, f]));
  const own = `outputs/${folder}/`;
  const frames = new Map(), drafts = new Map(), clips = new Map();
  for (const f of files) {
    let m;
    if ((m = FRAME.exec(f.rel)) || (m = FRAME_4X5.exec(f.rel))) {
      (FRAME.test(f.rel) ? frames : drafts).set(+m[1], { p: f.p, v: f.v, gen: readGen(brandDirAbs, byRel, f) });
    } else if ((m = /^clips\/(?:clip|chunk)-0*(\d+)(?:-(.+))?\.(mp4|mov|m4v|webm)$/i.exec(f.rel))) {
      const gen = readGen(brandDirAbs, byRel, f);
      const sent = (gen?.refs || []).map((r) => r.p?.startsWith(own) && FRAME.exec(r.p.slice(own.length))).filter(Boolean);
      const shots = sent.length ? [...new Set(sent.map((x) => +x[1]))] : [+m[1]];
      for (const n of shots) clips.set(n, [...(clips.get(n) || []), { model: m[2] || 'orig', p: f.p, v: f.v, gen, shots }]);
    }
  }
  return sb.rows.map((r) => {
    if (r.n == null) return r;
    // A 9:16 frame extended from its 4:5 draft shows the draft's generation: the art's prompt and refs.
    const final = frames.get(r.n), draft = drafts.get(r.n);
    const frame = final ? { ...final, gen: draft?.gen || final.gen } : draft || {};
    return {
      ...r,
      frame: frame.p ? frame : null,
      clips: (clips.get(r.n) || []).sort((a, b) => b.v - a.v), // newest first
    };
  });
}

// ---- footage.json (review-ugc-footage) ----
// { clips: { "<scene>": { file, id? (its media library record), checks?: { line|action|framing|audio: { ok, note?, reshoot? } },
// ticks?: { <check>: bool }, decision? } } }, paths relative to the ad folder. checks are the AI's verdicts (the file
// name's is worked out here); ticks are the user's (set in Studio, or by the agent on their comment), and a check
// without one follows the AI's verdict. A scene with every check ticked is approved, unless the user called a reshoot (decision: 'reshoot').
// Rows follow the brief's scene tables (LINES TO CAMERA or VOICE OVER, B-ROLL); a scene the brief lacks comes last, marked extra.
const SCENE_TABLES = /^(lines to camera|voice ?over|hooks|script|b-?roll)/i;
const baseName = (rel) => rel.split('/').pop();
const sceneKey = (s) => String(s).replace(/\*\*/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const nameKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const aiCheck = (c) => (c && typeof c === 'object' ? { ok: !!c.ok, note: String(c.note || ''), reshoot: !!c.reshoot } : null);
function footageView(brandDirAbs, brief, files) {
  const f = files.find((x) => x.rel === 'footage.json');
  if (!f) return null;
  const doc = readJson(join(brandDirAbs, f.p), {});
  const clips = new Map(Object.entries(doc.clips || {}).map(([k, v]) => [sceneKey(k), v || {}]));
  const blocks = brief ? parseDoc(readText(brandDirAbs, brief.p)).blocks : [];
  const scenes = [];
  inSections(blocks, SCENE_TABLES).forEach((on, i) => {
    if (!on || blockKind(blocks[i].src) !== 'table') return;
    const [head, ...rows] = blocks[i].src.split('\n').map(tableCells);
    const col = (re) => head.findIndex((h) => re.test(h));
    const s = col(/^scene$/i), l = col(/^lines?$/i), a = col(/^action$/i);
    if (s < 0) return;
    for (const r of rows) if (!isSeparator(r) && r[s]) scenes.push({ scene: r[s].replace(/\*\*/g, '').trim(), line: r[l] || '', action: r[a] || '' });
  });
  const known = new Set(scenes.map((x) => sceneKey(x.scene)));
  for (const k of Object.keys(doc.clips || {})) if (!known.has(sceneKey(k))) scenes.push({ scene: k, line: '', action: '', extra: true });
  const byRel = new Map(files.map((x) => [x.rel, x]));
  const rows = scenes.map((sc) => {
    const c = clips.get(sceneKey(sc.scene)) || {};
    const clip = c.file && byRel.get(String(c.file));
    const checks = {
      line: sc.line ? aiCheck(c.checks?.line) : null,
      action: sc.action ? aiCheck(c.checks?.action) : null,
      framing: aiCheck(c.checks?.framing),
      audio: aiCheck(c.checks?.audio),
      file: clip ? (nameKey(baseName(clip.rel).replace(/\.[^.]+$/, '')) === nameKey(sc.scene)
        ? { ok: true }
        : { ok: false, note: `Named "${baseName(clip.rel)}". Rename it before the edit.` }) : null,
    };
    const keys = clip ? Object.keys(checks).filter((k) => checks[k]) : [];
    const ticks = c.ticks && typeof c.ticks === 'object' ? c.ticks : {};
    const checked = keys.filter((k) => (k in ticks ? !!ticks[k] : checks[k].ok));
    return {
      ...sc,
      clip: clip ? { name: baseName(clip.rel), p: clip.p, v: clip.v } : null,
      checks,
      checked,
      decision: c.decision === 'reshoot' ? 'reshoot' : keys.length && checked.length === keys.length ? 'approved' : '',
    };
  });
  return { rows };
}

// ---- steps per format ----
// A step: { key, label, done, count?, panel } where panel holds any of
// { note, md (inline text), fields: [[label, text]], files: [...], view ({ only, pick?, cols? } regex sources: the .md sections to show, the blocks among them, a table's columns by header), storyboard: true, footage: true, editor: true }.
const ROOT_VIDEO = (f) => !f.rel.includes('/') && f.type === 'video' && !/^reference/i.test(f.rel);
const ROOT_EXPORT = (f) => ROOT_VIDEO(f) || (!f.rel.includes('/') && f.type === 'audio');
const ROOT_MD = (f) => !f.rel.includes('/') && f.type === 'md' && !/^analysis\.md$/i.test(f.rel);
const under = (dir, ...types) => (f) => f.rel.startsWith(`${dir}/`) && (!types.length || types.includes(f.type));
const any = (...preds) => (f) => preds.some((p) => p(f));
const EXPORTED = any(ROOT_VIDEO, under('final', 'video')); // edit-video exports to final/
// Each step lists the files that evidence it (and optionally record fields); optional steps show only when they have files.
// A step with a section shows those sections of the newest root .md (the brief); pick narrows them to matching blocks, cols to matching table columns.
// Every ad's brief opens with its concept section (block format: open-studio).
const CONCEPT = { key: 'concept', label: 'Concept', section: /^concept/i, pick: /^(\*\*(Product|Persona|Angle|Message|For|Format|Style|Cast|Concept Overview|Reference)(:|\*\*$))/ };
const SCRIPT_TABLE = { section: /^(lines to camera|voice ?over|hooks|script)/i, pick: /^\|/ };
// Whether a brief has a step's section (with a block it picks), and the view that shows it.
const hasSection = (blocks, def) => !!def.section && inSections(blocks, def.section).some((on, i) => on && (!def.pick || def.pick.test(blocks[i].src)));
const viewOf = (def) => ({ only: def.section.source, pick: def.pick?.source, cols: def.cols?.source });
const FAMILIES = {
  image: [ // make-image-ad
    { key: 'prompt', label: 'Prompt', fields: (rec) => (rec?.generation?.prompt ? [['prompt', displayText(rec.generation.prompt)]] : []) },
    { key: 'drafts', label: 'Drafts', files: any(under('drafts', 'image'), (f) => !f.rel.includes('/') && f.type === 'image') },
    { key: 'final', label: 'Final', files: under('final', 'image'), done: (rec) => rec?.status === 'approved' },
    { key: 'meta', label: 'Meta copy', fields: (rec) => Object.entries(rec?.meta || {}).map(([k, v]) => [k, displayText(v)]) },
  ],
  song: [ // make-ai-song
    { key: 'concept', label: 'Concept', files: ROOT_MD },
    { key: 'lyrics', label: 'Lyrics', files: (f) => /^music\/[^/]*lyrics[^/]*\.txt$/i.test(f.rel) },
    { key: 'song', label: 'Song', files: under('music', 'audio') },
    { key: 'look', label: 'Look', files: under('sheets', 'image') },
    { key: 'storyboard', label: 'Storyboard', files: any(under('storyboards', 'image'), (f) => f.rel === 'storyboard.md') },
    { key: 'clips', label: 'Clips', files: under('clips', 'video') },
    { key: 'edit', label: 'Edit', files: EXPORTED },
  ],
  voice: [ // voiceover / audio-story ads (generate-voice)
    { key: 'script', label: 'Script', files: any(ROOT_MD, under('voice', 'txt')) },
    { key: 'voice', label: 'Voice', files: under('voice', 'audio') },
    { key: 'broll', label: 'B-roll', optional: true, files: under('broll', 'image', 'video') },
    { key: 'export', label: 'Export', files: ROOT_EXPORT },
  ],
  ugc: [ // creator-filmed: write-copy's brief template, built section by section, then the edit
    { key: 'profile', label: 'Profile', optional: true, files: (f) => f.rel === 'references/profile.md' }, // an ad for a known creator: their profile, reels as media blocks
    CONCEPT,
    { key: 'script', label: 'Script', ...SCRIPT_TABLE, cols: /^(scene|lines?|talking points)$/i },
    { key: 'storyboard', label: 'Storyboard', section: /^(lines to camera|voice ?over|slides|b-?roll|visuals)/i, pick: /^\|/, files: under('slides', 'image') },
    { key: 'brief', label: 'Brief', files: any(ROOT_MD, (f) => /^analysis\.md$/i.test(f.rel)) },
    { key: 'footage', label: 'Footage' }, // footage.json, filled in adWorkflow
    { key: 'edit', label: 'Edit', files: ROOT_VIDEO },
  ],
  creator: [ // editor-built formats: a brief, then the delivered video
    { key: 'brief', label: 'Brief', files: any(ROOT_MD, (f) => /^analysis\.md$/i.test(f.rel), under('slides', 'image')) },
    { key: 'video', label: 'Video', files: ROOT_VIDEO },
  ],
  motion: [ // make-motion-graphics: coded, nothing generated but its sounds
    { key: 'script', label: 'Script', section: /^(storyboard|shots)$/i, pick: /^\|/, cols: /^(#|line|what we see)$/i },
    { key: 'sounds', label: 'Sounds', files: any(under('sfx', 'audio'), under('music', 'audio')) },
    { key: 'edit', label: 'Edit', files: EXPORTED },
  ],
  video: [ // other generated video (explainer)
    { key: 'script', label: 'Script', files: any(ROOT_MD, (f) => f.rel === 'script.md', under('voice', 'txt')) },
    { key: 'voice', label: 'Voice', optional: true, files: under('voice', 'audio') },
    { key: 'look', label: 'Look', optional: true, files: (f) => f.type === 'image' && f.rel.includes('/') && !/^(drafts|final|clips|reference)\//.test(f.rel) },
    { key: 'clips', label: 'Clips', files: under('clips', 'video') },
    { key: 'music', label: 'Music', optional: true, files: under('music', 'audio') },
    { key: 'edit', label: 'Edit', files: EXPORTED },
  ],
};

// make-ai-podcast: the set and characters first, then the script.
const [SCRIPT, , LOOK, ...REST] = FAMILIES.video;
FAMILIES.podcast = [LOOK, SCRIPT, ...REST];

function familyOf(format) {
  const f = format.toLowerCase();
  if (f === 'animation' || f === 'slides') return 'animation'; // make-ai-slides shares the storyboard view
  if (f === 'motion') return 'motion';
  if (/song/.test(f)) return 'song';
  if (/podcast/.test(f)) return 'podcast';
  if (/static|image|screenshot|carousel/.test(f)) return 'image';
  if (/voiceover|audio/.test(f)) return 'voice';
  if (/ugc|creator|whitelister/.test(f)) return 'ugc';
  if (/text|handwritten/.test(f)) return 'creator';
  return 'video';
}

function genericSteps(brandDirAbs, family, files, rec) {
  const defs = FAMILIES[family].some((d) => d.key === 'concept') ? FAMILIES[family] : [CONCEPT, ...FAMILIES[family]];
  const brief = files.filter(ROOT_MD).pop();
  const blocks = brief ? parseDoc(readText(brandDirAbs, brief.p)).blocks : [];
  const steps = [];
  for (const def of defs) {
    const sec = hasSection(blocks, def);
    const own = [...(sec ? [brief] : []), ...(def.files ? files.filter(def.files) : [])];
    const fields = own.length ? [] : (def.fields?.(rec) || []).filter(([, v]) => v);
    if (def.optional && !own.length) continue;
    steps.push({
      key: def.key,
      label: def.label,
      done: !!(own.length || fields.length || def.done?.(rec)),
      panel: { ...(fields.length ? { fields } : {}), ...(own.length ? { files: present(own, files) } : {}), ...(sec ? { view: viewOf(def) } : {}) },
    });
  }
  return steps;
}

// make-ai-animation: Concept · Script · Voice · Sheets · Frames · Clips · Edit. storyboard.md holds the concept, the
// notes and the shot table (its STORYBOARD section; Script shows its #, Line and What we see); voice.json the picked take.
// make-ai-slides: Concept · Script · Voices · Storyboard · Sheets · Frames · Clips · Edit, the script in script.md.
const SHOTS = { section: /^(storyboard|shots)$/i, pick: /^\|/, cols: /^(#|line|what we see)$/i };
function animationSteps(brandDirAbs, folder, files, slides) {
  const byRel = new Map(files.map((f) => [f.rel, f]));
  const doc = (rel) => { const f = byRel.get(rel); return f ? { f, blocks: parseDoc(readText(brandDirAbs, f.p)).blocks } : null; };
  const sbDoc = doc('storyboard.md'), scriptDoc = doc('script.md');
  const sb = sbDoc ? parseStoryboard(readText(brandDirAbs, sbDoc.f.p)) : { header: '', blocking: '', rows: [] };
  const rows = shotsWithMedia(brandDirAbs, folder, sb, files);
  const shots = rows.filter((r) => r.n != null);
  const framed = shots.filter((s) => s.frame).length;
  const clipped = shots.filter((s) => s.clips.length).length;
  // A doc's sections for a step (else the whole doc).
  const docPanel = (d, def) => ({ files: present([d.f], files), ...(hasSection(d.blocks, def) ? { view: viewOf(def) } : {}) });
  const conceptDoc = [sbDoc, scriptDoc].find((d) => d && hasSection(d.blocks, CONCEPT));
  const takes = files.filter(any(under('audio', 'audio'), under('voice', 'audio')));
  const picked = readJson(join(brandDirAbs, 'outputs', folder, 'voice.json'), {})?.take;
  const voicesMd = files.filter((f) => f.rel === 'voices.md');
  const sheets = files.filter(under('sheets', 'image')).map((f) => ({ name: f.rel.slice(7), p: f.p, v: f.v, gen: readGen(brandDirAbs, byRel, f) }));
  const edit = files.filter(EXPORTED);
  const progress = (n) => (shots.length ? `${n}/${shots.length}` : '');
  const shotCount = shots.length ? `${shots.length} shot${shots.length === 1 ? '' : 's'}` : '';
  const steps = [
    { key: 'concept', label: 'Concept', done: !!(conceptDoc || sb.header || scriptDoc), panel: conceptDoc ? docPanel(conceptDoc, CONCEPT) : sb.header ? { md: sb.header } : {} },
    ...(slides ? [
      { key: 'script', label: 'Script', done: !!(scriptDoc || shots.some((s) => s.lines.length)), panel: scriptDoc ? docPanel(scriptDoc, SCRIPT_TABLE) : {} },
      { key: 'voices', label: 'Voices', done: takes.length > 0, panel: takes.length ? { files: present(takes, files) } : {} },
      { key: 'storyboard', label: 'Storyboard', done: shots.length > 0, count: shotCount, panel: shots.length ? { storyboard: true } : {} },
    ] : [
      { key: 'script', label: 'Script', done: shots.length > 0, count: shotCount, panel: sbDoc && shots.length ? docPanel(sbDoc, SHOTS) : {} },
      // Narrated: done once a take is picked; dialogue: once the voice blocks are written (the clips make the voices).
      { key: 'voices', label: 'Voice', done: !!picked || (voicesMd.length > 0 && !takes.length), count: takes.length && !picked ? `${takes.length} to pick from` : '',
        panel: { ...(voicesMd.length ? { files: present(voicesMd, files) } : {}), ...(takes.length ? { voices: takes.map((f) => ({ name: f.rel, p: f.p, v: f.v, picked: f.rel === picked })) } : {}) } },
    ]),
    { key: 'sheets', label: 'Sheets', done: sheets.length > 0, count: sheets.length ? String(sheets.length) : '', panel: sheets.length ? { sheets } : {} },
    { key: 'frames', label: 'Frames', done: shots.length > 0 && framed === shots.length, count: progress(framed), panel: shots.length ? { storyboard: true } : {} },
    { key: 'clips', label: 'Clips', done: shots.length > 0 && clipped === shots.length, count: progress(clipped), panel: shots.length ? { storyboard: true } : {} },
    { key: 'edit', label: 'Edit', done: edit.length > 0, panel: edit.length ? { files: present(edit, files) } : {} },
  ];
  return { steps, storyboard: shots.length ? { blocking: sb.blocking, rows } : null };
}

// Done / current / todo: the step after the furthest done step is current; gaps stay todo.
function withStates(steps) {
  let last = -1;
  steps.forEach((s, i) => { if (s.done) last = i; });
  return steps.map((s, i) => ({ ...s, state: s.done ? 'done' : i === last + 1 ? 'current' : 'todo' }));
}

function adWorkflow(brandDirAbs, folder) {
  const head = parseFolder(folder);
  const files = inventory(brandDirAbs, folder);
  const rec = readRecord(brandDirAbs, head.id);
  const family = familyOf(head.format);
  const { steps, storyboard = null } = family === 'animation'
    ? animationSteps(brandDirAbs, folder, files, /slides/i.test(head.format))
    : { steps: genericSteps(brandDirAbs, family, files, rec) };
  const footage = steps.some((s) => s.key === 'footage') ? footageView(brandDirAbs, files.filter(ROOT_MD).pop(), files) : null;
  if (footage) {
    const asked = footage.rows.filter((r) => !r.extra), n = asked.length, clipped = asked.filter((r) => r.clip).length;
    Object.assign(steps.find((s) => s.key === 'footage'), { done: true, count: n ? `${clipped}/${n}` : '', panel: { footage: true } });
  }
  // An edit document turns the last video step into the editor.
  const dir = join(brandDirAbs, 'outputs', folder);
  const edit = family === 'image' ? null : editInfo(dir);
  if (edit) {
    const last = steps[steps.length - 1];
    const open = edit.comments.filter((n) => n.status === 'open' || n.status === 'seen').length;
    const review = edit.comments.filter((n) => n.status === 'done').length;
    const count = open ? `${open} comment${open === 1 ? '' : 's'}` : review ? `${review} to review` : last.count;
    Object.assign(last, { done: true, count, panel: { editor: true } });
  }
  return { ...head, status: rec?.status || '', steps: withStates(steps), storyboard, footage, edit, comments: docComments(dir) };
}

// The ad list: newest (highest id) first, each with its current step.
export function workflowList(brandDirAbs) {
  const ads = adFolders(join(brandDirAbs, 'outputs')).map((folder) => {
    const { steps, storyboard, footage, edit, comments, ...head } = adWorkflow(brandDirAbs, folder);
    const cur = steps.find((s) => s.state === 'current');
    return { ...head, step: cur ? { label: cur.label, count: cur.count } : null, states: steps.map((s) => s.state) };
  });
  return { ads: ads.sort((a, b) => b.id - a.id || a.folder.localeCompare(b.folder)) };
}

export function workflowDetail(brandDirAbs, ad) {
  const dir = adDir(brandDirAbs, ad);
  return dir ? adWorkflow(brandDirAbs, basename(dir)) : null;
}
