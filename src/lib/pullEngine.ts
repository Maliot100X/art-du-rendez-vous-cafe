import pullVert from '../shaders/pull.vert.glsl';
import pullFrag from '../shaders/pull.frag.glsl';

/**
 * Pull-the-photo renderer, adapted from the otis FaceEngine
 * (~/workspace/web-design/incoming/sites/otis/src/face/engine.ts).
 *
 * Same warp + spring physics, same constants: a 128x128 grid mesh, 4 grab
 * slots, gaussian falloff SIGMA 0.072 UV widened 35% with pull length,
 * damped spring SPRING 260 / DAMPING 11 with 3 substeps, rubber-band
 * tanh clamp at 1.1x the stage, grab follows the pointer at dt x 38.
 * Distances are measured in units of frame height (aspect-corrected),
 * so the constants mean the same on this 16:9 frame as on otis's
 * square stage.
 *
 * Dropped on purpose — they belong to a face, not a bar photo:
 * the cobalt disc program and cut-out, the skin-aware blush / flush,
 * the expression crossfade (uA/uB/uMix), the alpha hit-test map and
 * the face rig landmarks. The photo is opaque everywhere, so any
 * point inside the frame is a valid grab. One texture, one program.
 */

const GRID = 128;
const SLOTS = 4;
const SIGMA = 0.072; // grab falloff, in image UV (units of frame height)
const SPRING = 260;
const DAMPING = 11;

type Slot = {
  pointer: number | null;
  ax: number;
  ay: number;
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  live: boolean;
};

export type PullStage = { x: number; y: number; w: number; h: number };

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

function uniforms(gl: WebGL2RenderingContext, prog: WebGLProgram, names: string[]) {
  return Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)])) as Record<
    string,
    WebGLUniformLocation | null
  >;
}

export class PullEngine {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null>;
  private vao: WebGLVertexArrayObject;
  private indexCount: number;
  private texture: WebGLTexture;
  private image: HTMLImageElement;
  private slots: Slot[] = Array.from({ length: SLOTS }, () => ({
    pointer: null,
    ax: 0,
    ay: 0,
    ox: 0,
    oy: 0,
    vx: 0,
    vy: 0,
    tx: 0,
    ty: 0,
    live: false,
  }));
  private stage: PullStage = { x: 0, y: 0, w: 1, h: 1 };
  private view = { w: 1, h: 1, dpr: 1 };
  private raf = 0;
  private last = 0;

  constructor(canvas: HTMLCanvasElement, image: HTMLImageElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: true, alpha: false });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.image = image;

    this.prog = compile(gl, pullVert, pullFrag);
    this.u = uniforms(gl, this.prog, ['uView', 'uStage', 'uGrab', 'uTex', 'uCover']);

    // Grid mesh in UV space; the vertex shader places and warps it.
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
    this.indexCount = idx.length;

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

    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  resize(w: number, h: number, dpr: number) {
    this.view = { w, h, dpr };
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  setStage(stage: PullStage) {
    this.stage = stage;
  }

  /** Displacement of a rest UV point from all slots, in px. JS mirror of the vertex shader. */
  private displace(u: number, v: number) {
    let dx = 0;
    let dy = 0;
    const aspect = this.stage.w / this.stage.h;
    for (const s of this.slots) {
      if (!s.live) continue;
      const len = Math.hypot(s.ox, s.oy) / this.stage.h;
      const sig = SIGMA * (1 + 0.35 * len);
      const du = (u - s.ax) * aspect;
      const dv = v - s.ay;
      const w = Math.exp(-(du * du + dv * dv) / (2 * sig * sig));
      dx += s.ox * w;
      dy += s.oy * w;
    }
    return [dx, dy];
  }

  /** Rest UV under a canvas point (undoing any wobble in flight), or null if it misses the photo. */
  pick(px: number, py: number) {
    const { x, y, w, h } = this.stage;
    let u = (px - x) / w;
    let v = (py - y) / h;
    for (let i = 0; i < 5; i++) {
      const [dx, dy] = this.displace(u, v);
      u = (px - dx - x) / w;
      v = (py - dy - y) / h;
    }
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return null;
    return { u, v };
  }

  grab(pointer: number, u: number, v: number, px: number, py: number) {
    const free =
      this.slots.find((s) => !s.live) ??
      this.slots.filter((s) => s.pointer === null).sort((a, b) => Math.hypot(a.ox, a.oy) - Math.hypot(b.ox, b.oy))[0];
    if (!free) return;
    Object.assign(free, { pointer, ax: u, ay: v, ox: 0, oy: 0, vx: 0, vy: 0, live: true });
    this.drag(pointer, px, py);
  }

  drag(pointer: number, px: number, py: number) {
    const s = this.slots.find((s) => s.pointer === pointer);
    if (!s) return;
    const { x, y, w, h } = this.stage;
    // Clamp to the canvas, then rubber-band so the pull gets heavier the further it goes.
    const cx = Math.min(Math.max(px, 4), this.view.w - 4);
    const cy = Math.min(Math.max(py, 4), this.view.h - 4);
    const tx = cx - (x + s.ax * w);
    const ty = cy - (y + s.ay * h);
    const len = Math.hypot(tx, ty);
    const max = h * 1.1;
    const k = len > 0 ? (max * Math.tanh(len / max)) / len : 0;
    s.tx = tx * k;
    s.ty = ty * k;
  }

  release(pointer: number) {
    const s = this.slots.find((s) => s.pointer === pointer);
    if (s) s.pointer = null;
  }

  /** A tap: no stretch, just a jolt so the photo jiggles. */
  poke(u: number, v: number) {
    const s = this.slots.find((s) => !s.live);
    if (!s) return;
    const { w, h } = this.stage;
    Object.assign(s, { pointer: null, ax: u, ay: v, ox: 0, oy: 0, vx: (0.5 - u) * w * 2.2, vy: h * 0.9, live: true });
  }

  get held() {
    return this.slots.some((s) => s.pointer !== null);
  }

  start() {
    if (this.raf) return;
    const tick = (t: number) => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min((t - (this.last || t)) / 1000, 1 / 30);
      this.last = t;
      this.step(dt);
      this.draw();
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
        // Follow the finger almost rigidly; keep the velocity for the release.
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

  private draw() {
    const gl = this.gl;
    const { w, h } = this.view;
    const { x, y, w: sw, h: sh } = this.stage;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.05, 0.04, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Cover-fit: the 3:2 photo fills the 16:9 frame without squashing.
    const imgAspect = this.image.naturalWidth / this.image.naturalHeight;
    const canvasAspect = w / h;
    let sx = 1;
    let sy = 1;
    let ox = 0;
    let oy = 0;
    if (imgAspect > canvasAspect) {
      sx = canvasAspect / imgAspect;
      ox = (1 - sx) / 2;
    } else {
      sy = imgAspect / canvasAspect;
      oy = (1 - sy) / 2;
    }

    gl.useProgram(this.prog);
    gl.uniform2f(this.u.uView, w, h);
    gl.uniform4f(this.u.uStage, x, y, sw, sh);
    const g = new Float32Array(SLOTS * 4);
    this.slots.forEach((s, i) => s.live && g.set([s.ax, s.ay, s.ox, s.oy], i * 4));
    gl.uniform4fv(this.u.uGrab, g);
    gl.uniform4f(this.u.uCover, sx, sy, ox, oy);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.u.uTex, 0);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  destroy() {
    this.stop();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
