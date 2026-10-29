// Drawing one frame: visual clips, their enter/exit animations, transitions, text and captions.
import { ease, isVisual, live, srcTime, tin, val } from './doc.js';
import { gradeAt } from './grade.js';

// ---- enter / exit animations: state at progress p (0 = hidden, 1 = in place) ----
const ANIM = {
  fade: (p) => ({ o: p }),
  pop: (p) => ({ o: Math.min(1, p * 3), s: 0.6 + 0.4 * ease('back', p) }),
  bounce: (p) => ({ o: Math.min(1, p * 4), s: ease('bounce', p) }),
  zoom: (p) => ({ o: p, s: 1.3 - 0.3 * ease('out', p) }),
  blur: (p) => ({ o: p, b: 24 * (1 - p) }),
  'slide-up': (p) => ({ o: p, dy: 90 * (1 - ease('out', p)) }),
  'slide-down': (p) => ({ o: p, dy: -90 * (1 - ease('out', p)) }),
  'slide-left': (p) => ({ o: p, dx: 90 * (1 - ease('out', p)) }),
  'slide-right': (p) => ({ o: p, dx: -90 * (1 - ease('out', p)) }),
};
const spec = (a) => (typeof a === 'string' ? { type: a } : a);

// Combined animation state of a clip at t (enter at its start, exit at its end).
function animState(c, t, fx) {
  const st = { o: 1, s: 1, dx: 0, dy: 0, b: 0 };
  const mix = (a, p) => {
    const f = ANIM[a.type] || fx?.animations?.[a.type];
    if (!f) return;
    const r = f(Math.min(1, Math.max(0, p)));
    st.o *= r.o ?? 1; st.s *= r.s ?? 1; st.dx += r.dx ?? 0; st.dy += r.dy ?? 0; st.b += r.b ?? 0;
  };
  const en = spec(c.enter), ex = spec(c.exit);
  if (en) mix(en, (t - c.at) / (en.dur ?? 0.4));
  if (ex) mix(ex, (c.end - t) / (ex.dur ?? 0.4));
  return st;
}

// Box of a clip on the canvas: center x,y and size w,h.
const box = (c, t, env) => ({
  x: val(c.x, t, env.W / 2), y: val(c.y, t, env.H / 2),
  w: val(c.w, t, env.W), h: val(c.h, t, env.H),
});

// Track transform + clip transform + animation, then fn() draws content centered on (0,0).
function place(ctx, c, t, env, fn) {
  const tr = c.track.transform;
  ctx.save();
  if (tr) {
    const [ox, oy] = tr.origin || [env.W / 2, env.H / 2];
    ctx.translate(ox + val(tr.x, t, 0), oy + val(tr.y, t, 0));
    ctx.rotate((val(tr.rotate, t, 0) * Math.PI) / 180);
    const s = val(tr.scale, t, 1);
    ctx.scale(s, s);
    ctx.translate(-ox, -oy);
  }
  const a = animState(c, t, env.fx);
  const b = box(c, t, env);
  const [ox, oy] = c.origin || [b.x, b.y];
  ctx.globalAlpha *= val(c.opacity, t, 1) * val(c.track.opacity, t, 1) * a.o;
  const blur = val(c.blur, t, 0) + a.b;
  if (blur > 0.1) ctx.filter = `blur(${blur * env.k}px)`;
  ctx.translate(ox + a.dx, oy + a.dy);
  ctx.rotate((val(c.rotate, t, 0) * Math.PI) / 180);
  const s = val(c.scale, t, 1) * a.s;
  ctx.scale(s, s);
  ctx.translate(b.x - ox, b.y - oy);
  fn(b);
  ctx.restore();
}

// Fit a w×h source into box b (centered at 0,0): cover crops, contain letterboxes, fill stretches.
function fitRect(sw, sh, b, fit = 'cover') {
  if (fit === 'fill') return [-b.w / 2, -b.h / 2, b.w, b.h];
  const s = (fit === 'contain' ? Math.min : Math.max)(b.w / sw, b.h / sh);
  return [(-sw * s) / 2, (-sh * s) / 2, sw * s, sh * s];
}

function drawMedia(ctx, c, t, env, frame) {
  place(ctx, c, t, env, (b) => {
    const sw = frame.displayWidth ?? frame.width, sh = frame.displayHeight ?? frame.height;
    const r = fitRect(sw, sh, b, c.fit);
    if (c.w != null || c.h != null || c.radius) { // crop to the box
      ctx.beginPath();
      ctx.roundRect(-b.w / 2, -b.h / 2, b.w, b.h, val(c.radius, t, 0));
      ctx.clip();
    }
    const g = gradeAt(t, c.track.grade, c.grade);
    if (!g) {
      if (frame.draw) frame.draw(ctx, ...r); else ctx.drawImage(frame, ...r);
      return;
    }
    // a phone clip's rotation lives in its metadata, which the grader ignores: draw it upright first
    const vf = frame.rotation ? upright(frame, sw, sh) : frame.toVideoFrame ? frame.toVideoFrame() : frame;
    try { ctx.drawImage(env.grader.apply(vf, sw, sh, g, Math.round(t * env.fps)), ...r); } finally { if (vf.close && vf !== frame) vf.close(); }
  });
}

let uprightCanvas;
function upright(frame, w, h) {
  uprightCanvas ??= new OffscreenCanvas(w, h);
  if (uprightCanvas.width !== w || uprightCanvas.height !== h) { uprightCanvas.width = w; uprightCanvas.height = h; }
  frame.draw(uprightCanvas.getContext('2d'), 0, 0, w, h);
  return uprightCanvas;
}

// ---- text ----
// style: font size weight italic color stroke strokeWidth shadow{color blur x y opacity} align lineHeight
//        maxWidth case accent letterSpacing background{color padX padY radius opacity}
const fontOf = (st, k = 1) => `${st.italic ? 'italic ' : ''}${st.weight || 400} ${st.size * k}px "${st.font || 'Inter'}", sans-serif`;
const cased = (s, st) => (st.case === 'upper' ? s.toUpperCase() : st.case === 'lower' ? s.toLowerCase() : s);

function rgba(color, a = 1) {
  if (!color || a >= 1 || !/^#/.test(color)) return color;
  const h = color.length === 4 ? [...color.slice(1)].map((x) => x + x).join('') : color.slice(1, 7);
  const n = parseInt(h, 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// One word at font scale sc: shadow under the outline, outline under the fill. px = canvas pixels per doc
// pixel (shadows ignore the transform).
function glyphs(ctx, s, x, y, st, color, sc, px) {
  ctx.font = fontOf(st, sc);
  if (st.letterSpacing) ctx.letterSpacing = `${st.letterSpacing * sc}px`;
  const sh = st.shadow;
  if (sh) {
    ctx.shadowColor = rgba(sh.color || '#000000', sh.opacity ?? 0.5);
    ctx.shadowBlur = (sh.blur ?? 0) * px * sc; ctx.shadowOffsetX = (sh.x ?? 0) * px * sc; ctx.shadowOffsetY = (sh.y ?? 3) * px * sc;
  }
  if (st.stroke && st.strokeWidth) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = st.strokeWidth * 2 * sc; // drawn centered on the edge: half shows outside the fill
    ctx.strokeStyle = st.stroke;
    ctx.strokeText(s, x, y);
    ctx.shadowColor = 'transparent';
  }
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  ctx.shadowColor = 'transparent';
  ctx.letterSpacing = '0px';
}

// Lay words into rows no wider than maxWidth. tokens: [{ s, w (width), …}]; returns rows of tokens with x set.
function rows(tokens, maxWidth, space) {
  const out = [];
  let row = [], width = 0;
  const gap = (tk) => (row.length && !tk.glue ? space : 0);
  for (const tk of tokens) {
    if (row.length && (tk.br || (!tk.glue && width + gap(tk) + tk.w > maxWidth))) { out.push({ row, width }); row = []; width = 0; }
    width += gap(tk) + tk.w;
    row.push(tk);
  }
  if (row.length) out.push({ row, width });
  for (const r of out) { let x = -r.width / 2; r.row.forEach((tk, i) => { if (i && !tk.glue) x += space; tk.x = x; x += tk.w; }); }
  return out;
}

const DEFAULT_TEXT = { size: 64, color: '#FFFFFF', lineHeight: 1.15 };

// "Line one\nsome {accent} words, {any color|#FF3B30}": tokens with their color and line breaks.
function parseText(text, accent) {
  const out = [];
  String(text ?? '').split('\n').forEach((line, li) => {
    let inside = false, first = true, open = false; // open: the last part ended mid-word ("{belly fat}:" glues the ":")
    for (const part of line.split(/([{}])/)) {
      if (part === '{' || part === '}') { inside = part === '{'; continue; }
      const [words, color] = inside ? part.split('|') : [part];
      words.split(/\s+/).forEach((word, i) => {
        if (!word) return;
        out.push({ s: word, br: li > 0 && first, glue: i === 0 && open, ...(inside && { color: color?.trim() || accent }) });
        first = false;
      });
      if (words) open = !/\s$/.test(words);
    }
  });
  return out;
}

// Instagram's text background: a box per line, each as wide as its line, joined into one shape whose outer and
// inner (where a shorter line meets a longer one) corners are both rounded. half: each line's half width.
function lineBoxes(ctx, widths, y0, lh, padY, radius) {
  // Neighbours too close in width to round the step between them share the wider width.
  const half = [...widths];
  for (let i = 1; i < half.length; i++) {
    if (Math.abs(half[i] - half[i - 1]) >= 2 * radius) continue;
    let j = i; while (j > 0 && Math.abs(half[j] - half[j - 1]) < 2 * radius) j--;
    const w = Math.max(...half.slice(j, i + 1));
    for (let k = j; k <= i; k++) half[k] = w;
  }
  const n = half.length, ys = half.map((_, i) => y0 + i * lh);
  const top = y0 - padY, bottom = y0 + n * lh + padY;
  const pts = [[-half[0], top], [half[0], top]];
  for (let i = 1; i < n; i++) pts.push([half[i - 1], ys[i]], [half[i], ys[i]]);
  pts.push([half[n - 1], bottom], [-half[n - 1], bottom]);
  for (let i = n - 1; i > 0; i--) pts.push([-half[i], ys[i]], [-half[i - 1], ys[i]]);
  const p = pts.filter((q, i) => { const r = pts[(i + 1) % pts.length]; return Math.hypot(q[0] - r[0], q[1] - r[1]) > 0.5; });
  const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  ctx.moveTo((p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2);
  for (let i = 1; i <= p.length; i++) {
    const a = p[i - 1], b = p[i % p.length], c = p[(i + 1) % p.length];
    ctx.arcTo(b[0], b[1], c[0], c[1], Math.min(radius, len(a, b) / 2, len(b, c) / 2));
  }
  ctx.closePath();
}

function drawTextBlock(ctx, tokens, st, px, color, bg) {
  ctx.font = fontOf(st);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const space = ctx.measureText(' ').width;
  for (const tk of tokens) { ctx.font = fontOf(st, tk.scale || 1); tk.w = ctx.measureText(cased(tk.s, st)).width; }
  const lh = st.size * (st.lineHeight || 1.15);
  const laid = rows(tokens, st.maxWidth || 960, space);
  const top = (-(laid.length - 1) * lh) / 2;
  if (bg) {
    ctx.save();
    ctx.globalAlpha *= bg.opacity ?? 1;
    ctx.fillStyle = bg.color || '#000000';
    ctx.beginPath();
    lineBoxes(ctx, laid.map((r) => r.width / 2 + (bg.padX ?? 28)), top - lh / 2, lh, bg.padY ?? 16, bg.radius ?? 12);
    ctx.fill();
    ctx.restore();
  }
  laid.forEach((r, i) => {
    for (const tk of r.row) {
      if (tk.hidden) continue;
      const sc = tk.scale || 1;
      ctx.save();
      ctx.globalAlpha *= tk.opacity ?? 1;
      ctx.translate(tk.x + tk.w / 2, top + i * lh);
      glyphs(ctx, cased(tk.s, st), -tk.w / 2, 0, st, tk.color || color, sc, px);
      ctx.restore();
    }
  });
}

function drawText(ctx, c, t, env) {
  const st = { ...DEFAULT_TEXT, ...c.style };
  place(ctx, c, t, env, () => {
    drawTextBlock(ctx, parseText(c.text, st.accent || '#FFD400'), st, env.k, val(st.color, t), st.background);
  });
}

// Captions: one line at a time; with word times, the spoken word takes `active` (color, scale) and
// `upcoming` styles unsaid words (color, opacity; opacity 0 reveals word by word). Each line enters with `enter`.
function drawCaptions(ctx, c, t, env) {
  const line = (c.lines || []).find((l) => t >= l.at && t < l.end);
  if (!line) return;
  const st = { ...DEFAULT_TEXT, ...c.style };
  // words: [word, start, end, color?]; a line without them may color words with {markup}.
  const words = line.words?.length ? line.words : parseText(line.text, st.accent || '#FFD400').map((tk) => [tk.s, null, null, tk.color]);
  const timed = words.some((w) => w[1] != null);
  let act = -1;
  if (timed) for (let i = 0; i < words.length; i++) if (words[i][1] != null && words[i][1] <= t) act = i;
  const A = c.active || {}, U = c.upcoming;
  const tokens = words.map(([s, ws, , color], i) => {
    const tk = { s, color };
    if (!timed) return tk;
    if (i === act) {
      const p = (t - ws) / (A.dur ?? 0.12);
      tk.color = A.color ?? color;
      tk.scale = 1 + ((A.scale ?? 1) - 1) * ease(A.ease || 'back', p);
    } else if (i > act && U) {
      tk.color = U.color ?? color;
      tk.opacity = U.opacity ?? 1;
      if (tk.opacity === 0) tk.hidden = true;
    }
    return tk;
  });
  const lineClip = { ...c, at: line.at, end: line.end, exit: line.exit ?? c.exit, enter: line.enter ?? c.enter };
  place(ctx, lineClip, t, env, () => drawTextBlock(ctx, tokens, st, env.k, st.color, st.background));
}

function drawRect(ctx, c, t, env) {
  place(ctx, c, t, env, (b) => {
    ctx.fillStyle = val(c.color, t, '#000000');
    ctx.beginPath();
    ctx.roundRect(-b.w / 2, -b.h / 2, b.w, b.h, val(c.radius, t, 0));
    ctx.fill();
  });
}

// Hides what the tracks below drew inside a box (a competitor's label, a face): x, y (center), w, h; style
// pixelate (cells of `cell` px, default 16: soft, the object still reads) or blur (`amount` px, default 30).
function drawHide(ctx, c, t, env) {
  const k = env.k, w = val(c.w, t, 200), h = val(c.h, t, 200);
  const sx = Math.max(0, Math.round((val(c.x, t, env.W / 2) - w / 2) * k)), sy = Math.max(0, Math.round((val(c.y, t, env.H / 2) - h / 2) * k));
  const sw = Math.min(ctx.canvas.width - sx, Math.round(w * k)), sh = Math.min(ctx.canvas.height - sy, Math.round(h * k));
  if (sw <= 0 || sh <= 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (c.style === 'blur') {
    ctx.beginPath();
    ctx.rect(sx, sy, sw, sh);
    ctx.clip();
    ctx.filter = `blur(${val(c.amount, t, 30) * k}px)`;
    ctx.drawImage(ctx.canvas, 0, 0);
  } else {
    const cell = val(c.cell, t, 16) * k, tw = Math.max(1, Math.round(sw / cell)), th = Math.max(1, Math.round(sh / cell));
    const small = (env.scratch.hide ??= new OffscreenCanvas(1, 1));
    small.width = tw; small.height = th;
    small.getContext('2d').drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, tw, th, sx, sy, sw, sh);
  }
  ctx.restore();
}

// ---- transitions: (ctx, paintA, paintB, p 0..1, env, params) ----
const DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
function moveBy(ctx, env, dir, amt, paint) {
  const [x, y] = DIRS[dir] || DIRS.left;
  ctx.save();
  ctx.translate(x * env.W * amt, y * env.H * amt);
  paint(ctx);
  ctx.restore();
}

// A clip drawn alone onto a scratch canvas (for transitions that need pixels).
function offscreen(env, key, paint) {
  const cv = (env.scratch[key] ??= new OffscreenCanvas(env.cw, env.ch));
  const x = cv.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, cv.width, cv.height);
  x.setTransform(env.k, 0, 0, env.k, 0, 0);
  paint(x);
  return cv;
}

const TRANSITIONS = {
  fade(ctx, A, B, p) { A(ctx); ctx.save(); ctx.globalAlpha *= p; B(ctx); ctx.restore(); },
  dip(ctx, A, B, p, env, tr) {
    (p < 0.5 ? A : B)(ctx);
    ctx.save();
    ctx.globalAlpha = 1 - Math.abs(1 - 2 * p);
    ctx.fillStyle = tr.color || '#000000';
    ctx.fillRect(0, 0, env.W, env.H);
    ctx.restore();
  },
  slide(ctx, A, B, p, env, tr) { const d = tr.dir || 'left'; A(ctx); moveBy(ctx, env, oppo(d), 1 - p, B); },
  push(ctx, A, B, p, env, tr) { const d = tr.dir || 'left'; moveBy(ctx, env, d, p, A); moveBy(ctx, env, oppo(d), 1 - p, B); },
  wipe(ctx, A, B, p, env, tr) {
    A(ctx);
    const d = tr.dir || 'left', { W, H } = env;
    const r = { left: [W * (1 - p), 0, W * p, H], right: [0, 0, W * p, H], up: [0, H * (1 - p), W, H * p], down: [0, 0, W, H * p] }[d];
    ctx.save(); ctx.beginPath(); ctx.rect(...r); ctx.clip(); B(ctx); ctx.restore();
  },
  zoom(ctx, A, B, p, env) {
    const at = (s, a, paint) => { ctx.save(); ctx.globalAlpha *= a; ctx.translate(env.W / 2, env.H / 2); ctx.scale(s, s); ctx.translate(-env.W / 2, -env.H / 2); paint(ctx); ctx.restore(); };
    at(1 + 0.6 * p, 1, A);
    at(0.7 + 0.3 * p, p, B);
  },
  blur(ctx, A, B, p, env) {
    const k = env.k;
    ctx.save(); ctx.filter = `blur(${30 * p * k}px)`; A(ctx); ctx.restore();
    ctx.save(); ctx.globalAlpha *= p; ctx.filter = `blur(${30 * (1 - p) * k}px)`; B(ctx); ctx.restore();
  },
  // Card flip around the vertical axis with perspective, drawn as depth-scaled strips.
  flip(ctx, A, B, p, env, tr) {
    const th = p * Math.PI, first = th < Math.PI / 2;
    const src = offscreen(env, first ? 'a' : 'b', first ? A : B);
    const ang = first ? th : th - Math.PI, W = env.W, H = env.H, n = 160;
    const d = (tr.perspective ?? 2.5) * W, sw = W / n, cos = Math.cos(ang), sin = Math.sin(ang);
    const proj = (x) => { const s = d / (d + x * sin); return [W / 2 + x * cos * s, s]; };
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < n; i++) {
      const x0 = i * sw - W / 2;
      const [X0, s0] = proj(x0), [X1, s1] = proj(x0 + sw), h = (H * (s0 + s1)) / 2;
      ctx.drawImage(src, i * sw * env.k, 0, sw * env.k, H * env.k, Math.min(X0, X1), (H - h) / 2, Math.abs(X1 - X0) + 0.6, h);
    }
    ctx.restore();
  },
};
const oppo = (d) => ({ left: 'right', right: 'left', up: 'down', down: 'up' }[d] || 'right');

// ---- one frame ----
// An ad's fx.js (doc.fx) may export layers { name(ctx, clip, t, env) }, transitions
// { name(ctx, paintA, paintB, p, env, params) } and animations { name(p) -> { o, s, dx, dy, b } }.
// A layer animates with env.motion (GSAP timelines, Three.js scenes; see motion.js).
// frames: clip id -> its decoded frame or image. Tracks draw bottom-up: the first track is on top.
export function drawFrame(ctx, doc, t, frames, env) {
  ctx.setTransform(env.k, 0, 0, env.k, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.fillStyle = doc.background;
  ctx.fillRect(0, 0, doc.W, doc.H);
  const paint = (c) => (x) => {
    if (c.type === 'video' || c.type === 'image') { const f = frames.get(c.id); if (f) drawMedia(x, c, t, env, f); }
    else if (c.type === 'text') drawText(x, c, t, env);
    else if (c.type === 'captions') drawCaptions(x, c, t, env);
    else if (c.type === 'rect') drawRect(x, c, t, env);
    else if (c.type === 'hide') drawHide(x, c, t, env);
    else if (c.type === 'custom') env.fx?.layers?.[c.draw]?.(x, c, t, env);
  };
  for (let i = doc.tracks.length - 1; i >= 0; i--) {
    const tr = doc.tracks[i];
    if (tr.hidden) continue;
    const on = tr.clips.filter((c) => isVisual(c) && live(c, t));
    for (const c of on) {
      if (c.next && on.includes(c.next) && inTransition(c.next, t)) continue; // drawn with its successor
      if (!inTransition(c, t) || !on.includes(c.prev)) { if (t >= c.at && t < c.end) paint(c)(ctx); continue; }
      const tr2 = c.transition, d = tin(c);
      const p = ease(tr2.ease || 'ease', (t - (c.at - d / 2)) / d);
      const fn = TRANSITIONS[tr2.type] || env.fx?.transitions?.[tr2.type] || TRANSITIONS.fade;
      fn(ctx, paint(c.prev), paint(c), p, env, tr2);
    }
  }
}
const inTransition = (c, t) => tin(c) > 0 && c.prev && t >= c.at - tin(c) / 2 && t < c.at + tin(c) / 2;

// Clips whose pixels this frame needs, with the source time to decode. With ahead (s), also the media clips
// starting within that time, at their first frame, so playback doesn't stall at cuts.
export function needs(doc, t, ahead = 0) {
  const out = [];
  for (const tr of doc.tracks) {
    if (tr.hidden) continue;
    // Through a transition a clip holds its first and last frames: past its trim the source may already show another shot.
    for (const c of tr.clips) {
      if (c.type !== 'video' && c.type !== 'image') continue;
      if (live(c, t)) out.push({ c, ts: srcTime(c, Math.min(Math.max(t, c.at), c.end - 1 / doc.fps)) });
      else if (ahead && c.at - tin(c) / 2 > t && c.at - tin(c) / 2 <= t + ahead) out.push({ c, ts: srcTime(c, c.at), soon: true });
    }
  }
  return out;
}
