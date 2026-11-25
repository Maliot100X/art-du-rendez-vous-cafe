/**
 * Le livre: the full carte as a real 3D book on the bar, with page curl.
 * Every sheet is a 48-segment strip bent in the vertex shader along a
 * circular arc whose curvature peaks mid-turn (the free edge lags, then lands
 * flat), shaded by its bent normal, front/back textures chosen by facing.
 * Pages are painted from store.js: all 59 drinks, grouped by category, with
 * every size and the exact menu price. The VRM host stands behind the bar.
 */
import * as THREE from 'three';
import {disposeScene, makeRenderer, makeStudio, marbleTexture} from './kit';
import {loadHost, type Host} from './host';
import type {Category, Drink} from '../data/store.js';

const PW = 2.3;
const PH = 3.05;
const TW = 1024;
const TH = 1358;

export type Page = {kind: 'cover' | 'intro' | 'list' | 'end' | 'back'; cat?: Category; items?: Drink[]; part?: string};

/** Split the carte into pages of ≤8 drinks, each category starting fresh. */
export function paginate(categories: Category[]): Page[] {
  const pages: Page[] = [{kind: 'cover'}, {kind: 'intro'}];
  for (const c of categories) {
    const n = Math.ceil(c.drinks.length / 8);
    const per = Math.ceil(c.drinks.length / n);
    for (let i = 0; i < n; i++) pages.push({kind: 'list', cat: c, items: c.drinks.slice(i * per, (i + 1) * per), part: n > 1 ? `${i + 1}/${n}` : ''});
  }
  pages.push({kind: 'end'});
  if (pages.length % 2) pages.push({kind: 'end'});
  pages.push({kind: 'end'}, {kind: 'back'});
  return pages;
}

const vert = `
uniform float uT; uniform float uPW; uniform float uLift;
varying vec2 vUv; varying vec3 vN; varying float vShade;
void main(){
  vUv = uv;
  float s = position.x;                // arc length from the spine
  float th = uT * 3.14159265;
  float b = min(1.25 * sin(uT * 3.14159265), th);
  float k = -b / uPW;                  // curvature: free edge lags behind
  float a = th + k * s;
  vec3 p;
  if (abs(k) < 1e-4) { p = vec3(s * cos(th), position.y, s * sin(th)); }
  else { p = vec3((sin(a) - sin(th)) / k, position.y, (cos(th) - cos(a)) / k); }
  p.z += uLift;
  vN = normalize(normalMatrix * vec3(-sin(a), 0.0, cos(a)));
  vShade = 0.5 + 0.5 * cos(a - 0.7);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const frag = `
uniform sampler2D uFront; uniform sampler2D uBack; uniform vec3 uLight; uniform float uT;
varying vec2 vUv; varying vec3 vN; varying float vShade;
void main(){
  vec4 c = gl_FrontFacing ? texture2D(uFront, vUv) : texture2D(uBack, vec2(1.0 - vUv.x, vUv.y));
  vec3 n = normalize(gl_FrontFacing ? vN : -vN);
  float d = clamp(dot(n, normalize(vec3(-0.3, 0.9, 0.5))), 0.0, 1.0);
  float gutter = smoothstep(0.0, 0.08, vUv.x);   // shadow into the binding
  vec3 col = c.rgb * uLight * (0.55 + 0.5 * d) * mix(0.72, 1.0, gutter);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

function canvasTex(draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = TW;
  c.height = TH;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function paper(g: CanvasRenderingContext2D) {
  g.fillStyle = '#f6eedd';
  g.fillRect(0, 0, TW, TH);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(120,90,50,${Math.random() * 0.035})`;
    g.fillRect(Math.random() * TW, Math.random() * TH, 2, 2);
  }
  g.strokeStyle = 'rgba(185,138,62,0.55)';
  g.lineWidth = 2;
  g.strokeRect(46, 46, TW - 92, TH - 92);
}

type Fmt = {price: (n: number) => string; size: (k: string | null) => string; total: number; address: string};

function paintPage(page: Page, idx: number, imgs: Map<string, HTMLImageElement>, f: Fmt) {
  return canvasTex((g) => {
    if (page.kind === 'cover' || page.kind === 'back') {
      const grad = g.createLinearGradient(0, 0, TW, TH);
      grad.addColorStop(0, '#1d3a2e');
      grad.addColorStop(1, '#0c1c15');
      g.fillStyle = grad;
      g.fillRect(0, 0, TW, TH);
      for (let i = 0; i < 5000; i++) {
        g.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
        g.fillRect(Math.random() * TW, Math.random() * TH, 2, 2);
      }
      g.strokeStyle = '#c9973f';
      g.lineWidth = 4;
      g.strokeRect(60, 60, TW - 120, TH - 120);
      g.lineWidth = 1.5;
      g.strokeRect(78, 78, TW - 156, TH - 156);
      g.textAlign = 'center';
      if (page.kind === 'cover') {
        g.fillStyle = '#e2bd76';
        g.font = '500 30px "IBM Plex Mono", monospace';
        g.fillText('L A   C A R T E', TW / 2, 330);
        g.font = 'italic 300 110px Fraunces, Georgia, serif';
        g.fillText('Art du', TW / 2, 560);
        g.font = '500 150px Fraunces, Georgia, serif';
        g.fillText('Rendez-', TW / 2, 720);
        g.fillText('Vous', TW / 2, 870);
        g.font = '400 30px Manrope, sans-serif';
        g.fillStyle = 'rgba(239,227,200,0.8)';
        g.fillText(`${f.total} boissons · Laeken`, TW / 2, 1060);
      } else {
        g.fillStyle = '#e2bd76';
        g.font = 'italic 300 64px Fraunces, Georgia, serif';
        g.fillText('À bientôt.', TW / 2, TH / 2);
      }
      return;
    }
    paper(g);
    g.textAlign = 'left';
    const L = 110;
    const R = TW - 110;
    if (page.kind === 'intro') {
      g.fillStyle = '#8f6424';
      g.font = '500 26px "IBM Plex Mono", monospace';
      g.fillText('SOMMAIRE', L, 200);
      g.fillStyle = '#2a1d17';
      g.font = 'italic 300 84px Fraunces, Georgia, serif';
      g.fillText('Bienvenue', L, 320);
      g.font = '400 30px Manrope, sans-serif';
      g.fillStyle = 'rgba(42,29,23,0.7)';
      ['Du premier café au dernier verre :', 'glissez ou tirez la page pour feuilleter.'].forEach((l, i) => g.fillText(l, L, 400 + i * 44));
      g.font = '400 24px Manrope, sans-serif';
      g.fillText(f.address, L, TH - 120);
      return;
    }
    if (page.kind === 'end') {
      g.textAlign = 'center';
      g.fillStyle = 'rgba(42,29,23,0.55)';
      g.font = 'italic 300 54px Fraunces, Georgia, serif';
      g.fillText(idx % 2 ? '' : 'Santé !', TW / 2, TH / 2);
      return;
    }
    const c = page.cat!;
    g.fillStyle = '#8f6424';
    g.font = '500 24px "IBM Plex Mono", monospace';
    g.fillText(`0${c.index + 1} · ${c.count} BOISSONS${page.part ? ' · ' + page.part : ''}`, L, 170);
    g.fillStyle = '#2a1d17';
    g.font = 'italic 300 78px Fraunces, Georgia, serif';
    g.fillText(c.title.fr, L, 260);
    g.fillStyle = 'rgba(42,29,23,0.45)';
    g.font = '400 26px Manrope, sans-serif';
    g.fillText(c.title.en, L, 304);
    const rows = page.items!;
    const top = 370;
    const rowH = Math.min(118, (TH - top - 110) / rows.length);
    rows.forEach((d, i) => {
      const y = top + i * rowH;
      const img = imgs.get(d.id);
      const r = 40;
      g.save();
      g.beginPath();
      g.arc(L + r, y + r, r, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = '#e4d6b8';
      g.fillRect(L, y, r * 2, r * 2);
      if (img) {
        const s = Math.max((r * 2) / img.naturalWidth, (r * 2) / img.naturalHeight);
        g.drawImage(img, L + r - (img.naturalWidth * s) / 2, y + r - (img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
      }
      g.restore();
      const x = L + r * 2 + 26;
      g.fillStyle = '#2a1d17';
      g.font = '500 36px Fraunces, Georgia, serif';
      g.fillText(d.name.fr, x, y + 36);
      const nameW = g.measureText(d.name.fr).width;
      g.fillStyle = 'rgba(42,29,23,0.5)';
      g.font = '400 22px Manrope, sans-serif';
      g.fillText(d.name.en, x, y + 70);
      // prices, right-aligned, one line per size
      g.textAlign = 'right';
      g.fillStyle = '#8f6424';
      const pl = d.priceList;
      pl.forEach((p, j) => {
        g.font = '500 34px Fraunces, Georgia, serif';
        const txt = f.price(p.value);
        g.fillText(txt, R, y + 36 + j * 36);
        if (p.key) {
          const w = g.measureText(txt).width;
          g.font = '500 18px "IBM Plex Mono", monospace';
          g.fillStyle = 'rgba(42,29,23,0.5)';
          g.fillText(f.size(p.key).toUpperCase(), R - w - 14, y + 34 + j * 36);
          g.fillStyle = '#8f6424';
        }
      });
      g.textAlign = 'left';
      // dotted leader
      g.fillStyle = 'rgba(42,29,23,0.25)';
      const lx = x + nameW + 16;
      const rx = R - (pl.length > 1 ? 230 : 140);
      for (let dx = lx; dx < rx; dx += 12) g.fillRect(dx, y + 32, 3, 3);
    });
  });
}

export function createBookScene(
  canvas: HTMLCanvasElement,
  opts: {reduced: boolean; vrm?: boolean; pages: Page[]; drinks: Drink[]; fmt: Fmt; onHost?: (h: Host) => void; onPageChange?: (spread: number) => void},
) {
  const renderer = makeRenderer(canvas);
  const {scene, key, look, tick, dispose: disposeStudio} = makeStudio(renderer, {table: 0, glowDir: [0.3, 0.2, -1]});
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 160);

  // the bar: marble top + lacquered front so the host stands behind it
  const marble = marbleTexture();
  const top = new THREE.Mesh(new THREE.BoxGeometry(16, 0.4, 5.2), new THREE.MeshPhysicalMaterial({map: marble, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.6}));
  top.position.set(0, -0.2, 0.4);
  top.receiveShadow = true;
  scene.add(top);
  const front = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 0.3), new THREE.MeshPhysicalMaterial({color: '#1d140f', roughness: 0.35, clearcoat: 0.8}));
  front.position.set(0, -3.4, 2.85);
  scene.add(front);
  const brass = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 16, 16), new THREE.MeshPhysicalMaterial({color: '#d9a650', metalness: 1, roughness: 0.2}));
  brass.rotation.z = Math.PI / 2;
  brass.position.set(0, -0.12, 3.02);
  scene.add(brass);

  // Book
  const book = new THREE.Group();
  book.rotation.x = -Math.PI / 2;
  const tilt = new THREE.Group();
  tilt.position.set(1.15, 0.06, 0.9);
  tilt.rotation.x = 0.22; // raise the far edge toward the reader
  tilt.add(book);
  scene.add(tilt);
  const boardMat = new THREE.MeshPhysicalMaterial({color: '#173328', roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color('#2f5a48')});
  const boardL = new THREE.Mesh(new THREE.BoxGeometry(PW + 0.08, PH + 0.12, 0.05), boardMat);
  boardL.position.set(-(PW + 0.08) / 2, 0, -0.03);
  const boardR = boardL.clone();
  boardR.position.x = (PW + 0.08) / 2;
  const blockMat = new THREE.MeshStandardMaterial({color: '#efe5cf', roughness: 0.9});
  const blockR = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, 0.06), blockMat);
  blockR.position.set(PW / 2, 0, 0.03);
  const blockL = blockR.clone();
  blockL.position.x = -PW / 2;
  [boardL, boardR, blockR, blockL].forEach((m) => {
    m.castShadow = true;
    m.receiveShadow = true;
  });
  book.add(boardL, boardR, blockR, blockL);

  const S = opts.pages.length / 2;
  const imgs = new Map<string, HTMLImageElement>();
  const geo = new THREE.PlaneGeometry(PW, PH, 48, 1);
  geo.translate(PW / 2, 0, 0);
  const light = new THREE.Color(look.key).lerp(new THREE.Color('#ffffff'), 0.5);
  const sheets = Array.from({length: S}, (_, i) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.DoubleSide,
      uniforms: {
        uT: {value: 0},
        uPW: {value: PW},
        uLift: {value: 0},
        uLight: {value: light},
        uFront: {value: paintPage(opts.pages[2 * i], 2 * i, imgs, opts.fmt)},
        uBack: {value: paintPage(opts.pages[2 * i + 1], 2 * i + 1, imgs, opts.fmt)},
      },
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.z = 0.065;
    book.add(m);
    return mat;
  });
  // photos arrive → repaint the pages that show them
  const repaint = () =>
    sheets.forEach((mat, i) => {
      for (const side of [0, 1] as const) {
        const p = opts.pages[2 * i + side];
        if (p.kind !== 'list') continue;
        const u = side ? mat.uniforms.uBack : mat.uniforms.uFront;
        u.value.dispose();
        u.value = paintPage(p, 2 * i + side, imgs, opts.fmt);
      }
    });
  let pending = opts.drinks.length;
  let repaintTimer = 0;
  opts.drinks.forEach((d) => {
    const img = new Image();
    img.src = d.img.s;
    img.onload = img.onerror = () => {
      if (img.naturalWidth) imgs.set(d.id, img);
      pending--;
      clearTimeout(repaintTimer);
      repaintTimer = window.setTimeout(repaint, pending ? 400 : 0);
    };
  });
  document.fonts?.ready.then(repaint);

  // Host
  let host: Host | null = null;
  if (opts.vrm) loadHost('/models/host.vrm').then((h) => {
    host = h;
    h.object.scale.setScalar(2.35);
    h.object.position.set(-3.1, -2.55, -1.1);
    h.object.rotation.y = 0.32;
    scene.add(h.object);
    opts.onHost?.(h);
  });

  // pointer: cursor look-at + drag to turn
  const mouse = {x: 0, y: 0, tx: 0, ty: 0};
  let flip = 0; // current, in sheets
  let target = 0;
  let drag: {x: number; base: number; t: number; last: number; v: number} | null = null;
  let W = 1;
  let H = 1;
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    mouse.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.ty = -(((e.clientY - r.top) / r.height) * 2 - 1);
    if (drag) {
      const dx = e.clientX - drag.x;
      const now = performance.now();
      drag.v = (e.clientX - drag.last) / Math.max(1, now - drag.t);
      drag.last = e.clientX;
      drag.t = now;
      target = THREE.MathUtils.clamp(drag.base - dx / (W * 0.32), 0, S - 1);
    }
  };
  const onDown = (e: PointerEvent) => {
    drag = {x: e.clientX, base: target, t: performance.now(), last: e.clientX, v: 0};
    canvas.setPointerCapture(e.pointerId);
  };
  const onUp = () => {
    if (!drag) return;
    const bias = drag.v < -0.3 ? 0.5 : drag.v > 0.3 ? -0.5 : 0;
    target = THREE.MathUtils.clamp(Math.round(target + bias), 0, S - 1);
    drag = null;
  };
  window.addEventListener('pointermove', onMove, {passive: true});
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);

  const resize = () => {
    W = canvas.clientWidth || 1;
    H = canvas.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.fov = W / H < 0.8 ? 46 : 30;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  const lookPt = new THREE.Vector3();
  let lastSpread = -1;
  let flipping = 0;

  function render(enter: number) {
    const dt = Math.min(0.05, clock.getDelta());
    const time = opts.reduced ? 0 : clock.elapsedTime;
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    const prev = flip;
    flip += (target - flip) * (drag ? 0.35 : 1 - Math.exp(-dt * 5));
    flipping = Math.abs(flip - prev) > 0.002 ? 1 : flipping * 0.9;
    sheets.forEach((m, i) => {
      const t = THREE.MathUtils.clamp(flip - i, 0, 1);
      m.uniforms.uT.value = t;
      // stack: unturned sheets sit lower the later they are; turned ones the reverse
      m.uniforms.uLift.value = THREE.MathUtils.lerp((S - i) * 0.0035, i * 0.0035, t);
    });
    const spread = Math.round(flip);
    if (spread !== lastSpread) {
      lastSpread = spread;
      opts.onPageChange?.(spread);
    }

    // camera: dolly in on entry, parallax on the cursor
    const portrait = W / H < 0.8;
    const e = 1 - Math.pow(1 - THREE.MathUtils.clamp(enter, 0, 1), 3);
    const dist = THREE.MathUtils.lerp(portrait ? 16 : 12.5, portrait ? 11.5 : 8.4, e);
    camera.position.set((portrait ? 1.1 : 0.2) + mouse.x * 0.5, THREE.MathUtils.lerp(7.5, 5.6, e) + mouse.y * 0.3, dist);
    camera.lookAt(portrait ? 1.15 : 0.5, portrait ? 0.4 : 0.55, 0.6);

    if (host) {
      // look at the reader's cursor, or at the page while it turns
      tmp.set(mouse.x, mouse.y, 0.5).unproject(camera).sub(camera.position).normalize();
      lookPt.copy(camera.position).addScaledVector(tmp, 9);
      if (flipping > 0.3) lookPt.lerp(new THREE.Vector3(1.2, 0.2, 1.0), 0.8);
      host.lookAt(lookPt);
      host.update(dt, time);
    }
    key.position.set(-5, 9, 6);
    tick(time);
    renderer.render(scene, camera);
    (window as unknown as {__bookFrames: number}).__bookFrames = ((window as unknown as {__bookFrames?: number}).__bookFrames ?? 0) + 1;
  }

  return {
    render,
    sheets: S,
    go(n: number) {
      target = THREE.MathUtils.clamp(n, 0, S - 1);
    },
    get target() {
      return target;
    },
    get host() {
      return host;
    },
    dispose() {
      window.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      ro.disconnect();
      host?.dispose();
      sheets.forEach((m) => {
        m.uniforms.uFront.value.dispose();
        m.uniforms.uBack.value.dispose();
      });
      disposeScene(scene);
      disposeStudio();
      renderer.dispose();
    },
  };
}
