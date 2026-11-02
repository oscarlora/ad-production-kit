// Motion graphics kit for an ad's fx layers (env.mg): timing, motion presets and flat outlined shapes, so a
// coded video starts from these instead of a blank fx.js. All deterministic in t, so preview = export.
// set({ ink, lw }) sets the outline color and width for every shape.
import { ease } from './doc.js';

export function mgKit() {
  let ink = '#2B2D42', lw = 7;
  const clamp = (x) => Math.min(1, Math.max(0, x));
  const rand = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

  function path(ctx, fill, draw, width = lw) {
    ctx.beginPath();
    draw();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (width) { ctx.lineWidth = width; ctx.strokeStyle = ink; ctx.lineJoin = ctx.lineCap = 'round'; ctx.stroke(); }
  }
  // Draws draw() scaled by s around (x, y); nothing at s ≈ 0.
  function scaled(ctx, x, y, s, draw) {
    if (s <= 0.001) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.translate(-x, -y); draw(); ctx.restore();
  }

  const kit = {
    set(o) { ink = o.ink ?? ink; lw = o.lw ?? lw; },
    get ink() { return ink; },
    get lw() { return lw; },
    clamp, rand, ease,
    lerp: (a, b, p) => a + (b - a) * p,
    // Progress 0..1 of u through [a, b].
    seg: (u, a, b) => clamp((u - a) / (b - a)),
    // A beat's time in its clip ({ beats: { name: [t, sound] } }); the engine plays its sound then.
    beat: (c, name) => c.beats?.[name]?.[0] ?? 0,

    // ---- motion presets: u is the clip's own time ----
    // Scale for something popping in at a: 0, overshoot, settle at 1.
    pop: (u, a, dur = 0.4) => ease('back', (u - a) / dur),
    // Eased move from a to b over [t0, t1].
    move: (u, t0, t1, a, b, curve = 'ease') => a + (b - a) * ease(curve, (u - t0) / (t1 - t0)),
    // Gentle idle float: an offset in px.
    bob: (t, seed = 0, amp = 6, speed = 5) => Math.sin(t * speed + seed) * amp,
    // Eyes shut for a moment every ~3 s, offset by seed.
    blink: (t, seed = 0) => ((t + seed * 1.37) % 3.1) < 0.13,
    // Squash and stretch for a hit at a: [sx, sy], squashed on impact, springing back.
    squash: (u, a, amt = 0.25, dur = 0.5) => {
      const p = (u - a) / dur;
      if (p < 0 || p > 1) return [1, 1];
      const k = Math.sin(p * Math.PI * 3) * (1 - p) * amt;
      return [1 + k, 1 - k];
    },
    // A shake that dies out after a: [dx, dy] in px.
    shake: (u, a, amp = 14, dur = 0.35) => {
      const p = (u - a) / dur;
      if (p < 0 || p > 1) return [0, 0];
      return [Math.sin(p * 40) * amp * (1 - p), Math.cos(p * 33) * amp * 0.4 * (1 - p)];
    },
    // Follow-through: an angle (rad) that swings past and settles after a move ending at a.
    swing: (u, a, amt = 0.3, dur = 0.8) => {
      const p = (u - a) / dur;
      return p < 0 || p > 1 ? 0 : Math.sin(p * Math.PI * 2.5) * (1 - p) * amt;
    },

    // ---- shapes: filled, outlined in ink ----
    path, scaled,
    circle: (ctx, x, y, r, fill, w) => path(ctx, fill, () => ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2), w),
    ellipse: (ctx, x, y, rx, ry, fill, rot = 0) => path(ctx, fill, () => ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2)),
    rrect: (ctx, x, y, w, h, r, fill) => path(ctx, fill, () => ctx.roundRect(x - w / 2, y - h / 2, w, h, r)),
    star(ctx, x, y, r, fill, n = 5, inner = 0.45) {
      path(ctx, fill, () => {
        for (let i = 0; i < n * 2; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / n, rr = i % 2 ? r * inner : r;
          ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.closePath();
      });
    },
    heart(ctx, x, y, s, fill) {
      path(ctx, fill, () => {
        ctx.moveTo(x, y + s * 0.9);
        ctx.bezierCurveTo(x - s * 1.4, y, x - s * 0.9, y - s * 1.05, x, y - s * 0.4);
        ctx.bezierCurveTo(x + s * 0.9, y - s * 1.05, x + s * 1.4, y, x, y + s * 0.9);
      });
    },
    // A limb or tube: an outlined stroke through pts.
    limb(ctx, pts, color, w) {
      for (const [col, width] of [[ink, w + lw * 2], [color, w]]) {
        ctx.beginPath(); ctx.moveTo(...pts[0]); for (const p of pts.slice(1)) ctx.lineTo(...p);
        ctx.strokeStyle = col; ctx.lineWidth = width; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke();
      }
    },

    // ---- faces ----
    eyes(ctx, x, y, gap, size, closed = false, look = [0, 0]) {
      for (const sx of [-1, 1]) {
        const ex = x + sx * gap + look[0], ey = y + look[1];
        if (closed) {
          ctx.beginPath(); ctx.arc(ex, ey - size * 0.3, size, 0.2 * Math.PI, 0.8 * Math.PI);
          ctx.strokeStyle = ink; ctx.lineWidth = lw * 0.9; ctx.lineCap = 'round'; ctx.stroke();
        } else {
          ctx.beginPath(); ctx.ellipse(ex, ey, size * 0.75, size, 0, 0, Math.PI * 2); ctx.fillStyle = ink; ctx.fill();
          ctx.beginPath(); ctx.arc(ex + size * 0.25, ey - size * 0.35, size * 0.3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
        }
      }
    },
    // kind: smile | open | o
    mouth(ctx, x, y, w, kind = 'smile') {
      if (kind === 'open') { path(ctx, '#8C2F39', () => { ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x, y + w * 1.8, x + w, y); ctx.closePath(); }); return; }
      if (kind === 'o') { kit.ellipse(ctx, x, y + w * 0.3, w * 0.45, w * 0.6, '#8C2F39'); return; }
      ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x, y + w * 0.9, x + w, y);
      ctx.strokeStyle = ink; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke();
    },
    cheeks(ctx, x, y, gap, r, color = '#FF7A8A') {
      ctx.save(); ctx.globalAlpha *= 0.45; ctx.fillStyle = color;
      for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + sx * gap, y, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    },

    // ---- effects ----
    // Four-point stars bursting out of (x, y) from time a.
    sparkles(ctx, x, y, u, a, r = 160, color = '#FFC94A') {
      const p = clamp((u - a) / 0.7);
      if (p <= 0 || p >= 1) return;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + 0.3, d = r * ease('out', p), sx = x + Math.cos(ang) * d, sy = y + Math.sin(ang) * d;
        scaled(ctx, sx, sy, 1 - p, () => kit.star(ctx, sx, sy, 22, color, 4, 0.35));
      }
    },
    // Horizontal motion lines trailing left of (x, y).
    speedLines(ctx, x, y, len, n = 3, alpha = 1) {
      if (alpha <= 0) return;
      ctx.save(); ctx.globalAlpha *= Math.min(1, alpha);
      for (let i = 0; i < n; i++) path(ctx, null, () => { const yy = y + (i - (n - 1) / 2) * 34; ctx.moveTo(x - len - (i % 2) * 40, yy); ctx.lineTo(x, yy); }, lw * 0.85);
      ctx.restore();
    },
  };
  return kit;
}
