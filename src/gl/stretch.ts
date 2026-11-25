/**
 * Otis's taffy renderer (src/face/engine.ts in the Otis zip), kept intact
 * where it counts and pointed at drink photos instead of a face:
 *  - a dense 128×128 UV grid placed and warped in the vertex shader
 *  - up to 4 grab slots, gaussian falloff around each anchor that widens the
 *    longer the pull, so a drag draws the picture out into a tapering tube
 *  - tanh rubber-banding while held, damped-spring snap-back with a wobble on release
 *  - a tap "pokes" the picture so it jiggles
 *  - iterative pick() that undoes the wobble in flight
 * Removed: the face rig (disc cut, cheek flush, expression crossfade).
 * Added: cover-fit UVs, rounded-corner alpha, and a cream sheen where the image stretches.
 */

const GRID = 128;
const SLOTS = 4;
const SIGMA = 0.11; // grab falloff, in image UV (wider than a face: drinks are big shapes)
const SPRING = 260;
const DAMPING = 11;

const vert = `#version 300 es
in vec2 aUv;
uniform vec2 uView;
uniform vec4 uStage; // x, y, w, h in css px
uniform vec4 uGrab[${SLOTS}];
out vec2 vUv;
out float vStretch;
void main() {
  vec2 p = uStage.xy + aUv * uStage.zw;
  float s = 0.0;
  float size = min(uStage.z, uStage.w);
  for (int i = 0; i < ${SLOTS}; i++) {
    vec2 d = (aUv - uGrab[i].xy) * vec2(uStage.z / size, uStage.w / size);
    float len = length(uGrab[i].zw) / size;
    float sig = ${SIGMA} * (1.0 + 0.35 * len);
    float w = exp(-dot(d, d) / (2.0 * sig * sig));
    p += uGrab[i].zw * w;
    s += w * len;
  }
  vUv = aUv;
  vStretch = s;
  vec2 c = p / uView * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;

const frag = `#version 300 es
precision highp float;
in vec2 vUv;
in float vStretch;
uniform sampler2D uTex;
uniform vec4 uCover; // uv scale xy + offset zw (object-fit: cover)
uniform vec2 uSize;  // stage w,h px
uniform float uRadius;
out vec4 outColor;
void main() {
  vec2 uv = vUv * uCover.xy + uCover.zw;
  vec3 c = texture(uTex, uv).rgb;
  // rounded rect alpha in px
  vec2 px = vUv * uSize;
  vec2 q = abs(px - uSize * 0.5) - (uSize * 0.5 - uRadius);
  float d = length(max(q, 0.0)) - uRadius;
  float a = 1.0 - smoothstep(-1.0, 1.0, d);
  // cream sheen where the picture is pulled thin
  float m = clamp(vStretch * 0.8, 0.0, 0.55);
  c = mix(c, vec3(0.97, 0.91, 0.79), m * 0.5) + m * 0.12;
  outColor = vec4(c * a, a);
}`;

type Slot = {pointer: number | null; ax: number; ay: number; ox: number; oy: number; vx: number; vy: number; tx: number; ty: number; live: boolean};

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const prog = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  return prog;
}

export class StretchEngine {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null>;
  private vao: WebGLVertexArrayObject;
  private count: number;
  private tex: WebGLTexture;
  private slots: Slot[] = Array.from({length: SLOTS}, () => ({pointer: null, ax: 0, ay: 0, ox: 0, oy: 0, vx: 0, vy: 0, tx: 0, ty: 0, live: false}));
  private stage = {x: 0, y: 0, w: 1, h: 1};
  private view = {w: 1, h: 1, dpr: 1};
  private cover: [number, number, number, number] = [1, 1, 0, 0];
  private raf = 0;
  private last = 0;
  private idle = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private img: HTMLImageElement,
  ) {
    const gl = canvas.getContext('webgl2', {premultipliedAlpha: true, antialias: true, alpha: true});
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.prog = compile(gl, vert, frag);
    this.u = Object.fromEntries(['uView', 'uStage', 'uGrab', 'uTex', 'uCover', 'uSize', 'uRadius'].map((n) => [n, gl.getUniformLocation(this.prog, n)]));

    const n = GRID + 1;
    const uv = new Float32Array(n * n * 2);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        uv[(y * n + x) * 2] = x / GRID;
        uv[(y * n + x) * 2 + 1] = y / GRID;
      }
    const idx = new Uint16Array(GRID * GRID * 6);
    let k = 0;
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) {
        const a = y * n + x;
        idx.set([a, a + 1, a + n, a + 1, a + n + 1, a + n], k);
        k += 6;
      }
    this.count = idx.length;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, 'aUv');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Canvas covers the card plus a bleed so pulls can leave the frame; the photo sits in `stage`. */
  resize(w: number, h: number, dpr: number, stage: {x: number; y: number; w: number; h: number}) {
    this.view = {w, h, dpr};
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.stage = stage;
    const fa = stage.w / stage.h;
    const ia = this.img.naturalWidth / this.img.naturalHeight;
    const sx = fa > ia ? 1 : fa / ia;
    const sy = fa > ia ? ia / fa : 1;
    this.cover = [sx, sy, (1 - sx) / 2, (1 - sy) / 2];
    this.draw();
  }

  private displace(u: number, v: number) {
    let dx = 0;
    let dy = 0;
    const size = Math.min(this.stage.w, this.stage.h);
    for (const s of this.slots) {
      if (!s.live) continue;
      const len = Math.hypot(s.ox, s.oy) / size;
      const sig = SIGMA * (1 + 0.35 * len);
      const du = ((u - s.ax) * this.stage.w) / size;
      const dv = ((v - s.ay) * this.stage.h) / size;
      const w = Math.exp(-(du * du + dv * dv) / (2 * sig * sig));
      dx += s.ox * w;
      dy += s.oy * w;
    }
    return [dx, dy];
  }

  pick(px: number, py: number) {
    const {x, y, w, h} = this.stage;
    let u = (px - x) / w;
    let v = (py - y) / h;
    for (let i = 0; i < 5; i++) {
      const [dx, dy] = this.displace(u, v);
      u = (px - dx - x) / w;
      v = (py - dy - y) / h;
    }
    return u < 0 || v < 0 || u >= 1 || v >= 1 ? null : {u, v};
  }

  grab(pointer: number, u: number, v: number, px: number, py: number) {
    const free =
      this.slots.find((s) => !s.live) ??
      this.slots.filter((s) => s.pointer === null).sort((a, b) => Math.hypot(a.ox, a.oy) - Math.hypot(b.ox, b.oy))[0];
    if (!free) return;
    Object.assign(free, {pointer, ax: u, ay: v, ox: 0, oy: 0, vx: 0, vy: 0, live: true});
    this.drag(pointer, px, py);
    this.start();
  }

  drag(pointer: number, px: number, py: number) {
    const s = this.slots.find((s) => s.pointer === pointer);
    if (!s) return;
    const {x, y, w, h} = this.stage;
    const size = Math.min(w, h);
    const cx = Math.min(Math.max(px, 4), this.view.w - 4);
    const cy = Math.min(Math.max(py, 4), this.view.h - 4);
    const tx = cx - (x + s.ax * w);
    const ty = cy - (y + s.ay * h);
    const len = Math.hypot(tx, ty);
    const max = size * 0.9;
    const k = len > 0 ? (max * Math.tanh(len / max)) / len : 0;
    s.tx = tx * k;
    s.ty = ty * k;
  }

  release(pointer: number) {
    const s = this.slots.find((s) => s.pointer === pointer);
    if (s) s.pointer = null;
  }

  poke(u: number, v: number, strength = 1) {
    const s = this.slots.find((s) => !s.live);
    if (!s) return;
    const size = Math.min(this.stage.w, this.stage.h);
    Object.assign(s, {pointer: null, ax: u, ay: v, ox: 0, oy: 0, vx: (0.5 - u) * size * 2.2 * strength, vy: size * 0.9 * strength, live: true});
    this.start();
  }

  start() {
    if (this.raf) return;
    const tick = (t: number) => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min((t - (this.last || t)) / 1000, 1 / 30);
      this.last = t;
      this.step(dt);
      this.draw();
      // Sleep once everything has settled.
      if (this.slots.every((s) => !s.live)) {
        if (++this.idle > 10) this.stop();
      } else this.idle = 0;
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
  }

  private step(dt: number) {
    for (const s of this.slots) {
      if (!s.live) continue;
      if (s.pointer !== null) {
        const nx = s.ox + (s.tx - s.ox) * Math.min(1, dt * 38);
        const ny = s.oy + (s.ty - s.oy) * Math.min(1, dt * 38);
        s.vx = dt > 0 ? (nx - s.ox) / dt : 0;
        s.vy = dt > 0 ? (ny - s.oy) / dt : 0;
        s.ox = nx;
        s.oy = ny;
        continue;
      }
      const h = dt / 3;
      for (let i = 0; i < 3; i++) {
        s.vx += (-SPRING * s.ox - DAMPING * s.vx) * h;
        s.vy += (-SPRING * s.oy - DAMPING * s.vy) * h;
        s.ox += s.vx * h;
        s.oy += s.vy * h;
      }
      if (Math.hypot(s.ox, s.oy) < 0.25 && Math.hypot(s.vx, s.vy) < 6) s.live = false;
    }
  }

  draw() {
    const gl = this.gl;
    const {w, h, dpr} = this.view;
    const st = this.stage;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.uView, w, h);
    gl.uniform4f(this.u.uStage, st.x, st.y, st.w, st.h);
    gl.uniform4f(this.u.uCover, ...this.cover);
    gl.uniform2f(this.u.uSize, st.w, st.h);
    gl.uniform1f(this.u.uRadius, 22);
    const g = new Float32Array(SLOTS * 4);
    this.slots.forEach((s, i) => s.live && g.set([s.ax, s.ay, s.ox, s.oy], i * 4));
    gl.uniform4fv(this.u.uGrab, g);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.u.uTex, 0);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
  }

  destroy() {
    this.stop();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
