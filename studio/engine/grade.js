// Color grade on the GPU: one WebGL2 pass per graded clip frame. Neutral values change nothing.
// exposure (stops, 0) · contrast (1) · saturation (1) · temperature, tint (-1..1, 0) · gamma (1)
// match ([gL, ga, gb, oL, oa, ob]: Lab = Lab × g + o, written by `edit-video.mjs match`) · vignette, grain (0..1, 0)
// A matte frame (remove-background: white = keep) becomes the alpha, so only the person draws.
import { val } from './doc.js';

const KEYS = { exposure: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, gamma: 1, vignette: 0, grain: 0 };

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D img, mat;
uniform bool matted;
uniform float exposure, contrast, saturation, temperature, tint, gamma, vignette, grain, seed;
uniform vec3 mg, mo;
uniform bool matched;
float rnd(vec2 q) { return fract(sin(dot(q, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
const mat3 TOXYZ = mat3(0.4124564, 0.2126729, 0.0193339, 0.3575761, 0.7151522, 0.1191920, 0.1804375, 0.0721750, 0.9503041);
const vec3 WHITE = vec3(0.95047, 1.0, 1.08883);
float f(float t) { return t > 0.008856 ? pow(t, 1.0 / 3.0) : (903.3 * t + 16.0) / 116.0; }
float fi(float t) { return t * t * t > 0.008856 ? t * t * t : (116.0 * t - 16.0) / 903.3; }
vec3 toLab(vec3 c) {
  vec3 x = TOXYZ * lin(c) / WHITE;
  vec3 g = vec3(f(x.x), f(x.y), f(x.z));
  return vec3(116.0 * g.y - 16.0, 500.0 * (g.x - g.y), 200.0 * (g.y - g.z));
}
vec3 fromLab(vec3 l) {
  float y = (l.x + 16.0) / 116.0;
  vec3 x = vec3(fi(y + l.y / 500.0), fi(y), fi(y - l.z / 200.0)) * WHITE;
  return srgb(clamp(inverse(TOXYZ) * x, 0.0, 1.0));
}
void main() {
  vec4 s = texture(img, uv);
  vec3 c = s.rgb;
  if (matched) c = fromLab(toLab(c) * mg + mo);
  c *= exp2(exposure);
  c += vec3(temperature, tint, -temperature) * vec3(0.08, 0.06, 0.08);
  c = (c - 0.5) * contrast + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  c = pow(max(c, 0.0), vec3(1.0 / gamma));
  c *= 1.0 - vignette * smoothstep(0.35, 0.95, length(uv - 0.5) * 1.414);
  c += (rnd(uv * 1000.0) - 0.5) * grain * 0.18;
  o = vec4(clamp(c, 0.0, 1.0), matted ? smoothstep(0.2, 0.9, texture(mat, uv).r) : s.a); // tightened: no halo of the old background
}`;

export const NEUTRAL = { ...KEYS, match: null };

// Track grade and clip grade combined at time t; null when neutral.
export function gradeAt(t, ...grades) {
  const g = { ...KEYS, match: null };
  let any = false;
  for (const src of grades) {
    if (!src) continue;
    for (const k of Object.keys(KEYS)) {
      if (src[k] == null) continue;
      const v = val(src[k], t, KEYS[k]);
      if (v === KEYS[k]) continue;
      any = true;
      if (k === 'contrast' || k === 'saturation' || k === 'gamma') g[k] *= v; else g[k] += v;
    }
    if (src.match) { any = true; g.match = src.match; }
  }
  return any ? g : null;
}

export class Grader {
  constructor() {
    this.canvas = new OffscreenCanvas(2, 2);
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available');
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const unit of [1, 0]) { // 1: the matte, 0: the image
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    }
    gl.uniform1i(gl.getUniformLocation(prog, 'mat'), 1);
    this.gl = gl;
    this.u = Object.fromEntries([...Object.keys(KEYS), 'mg', 'mo', 'matched', 'matted', 'seed'].map((k) => [k, gl.getUniformLocation(prog, k)]));
  }

  // source (and matte): a VideoFrame, ImageBitmap or canvas. Returns this.canvas holding the graded image.
  apply(source, w, h, g, seed = 0, matte = null) {
    const { gl, u } = this;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    if (matte) {
      gl.activeTexture(gl.TEXTURE1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, matte);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.uniform1i(u.matted, matte ? 1 : 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    for (const k of Object.keys(KEYS)) gl.uniform1f(u[k], g[k]);
    const m = g.match || [1, 1, 1, 0, 0, 0];
    gl.uniform1i(u.matched, g.match ? 1 : 0);
    gl.uniform3fv(u.mg, m.slice(0, 3));
    gl.uniform3fv(u.mo, m.slice(3, 6));
    gl.uniform1f(u.seed, seed);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}
