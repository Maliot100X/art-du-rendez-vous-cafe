/**
 * La carte in 3D: SELENE's pinned reel turned into a carousel wheel. All 59
 * drinks hang as photo cards (photo + name + exact price, painted into each
 * card's texture) around a ring; scroll turns the wheel, the card at the front
 * steps forward and lights up while the rest recede into the look's sky, and
 * every card is mirrored in a glossy lacquer floor. Click a card to add it.
 */
import * as THREE from 'three';
import {disposeScene, makeRenderer, makeStudio} from './kit';
import type {Drink} from '../data/store.js';

const CW = 1.6;
const CH = 2.5;
const TEX_W = 384;
const TEX_H = 600;

const cardVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const cardFrag = `uniform sampler2D uMap; uniform float uLit; uniform float uMirror; varying vec2 vUv;
void main(){
  vec2 uv = uMirror > 0.5 ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
  vec4 c = texture2D(uMap, uv);
  // rounded corners
  vec2 q = abs(vUv - 0.5) - (0.5 - vec2(0.06, 0.04));
  float d = length(max(q, 0.0));
  float a = 1.0 - smoothstep(0.0, 0.012, d - 0.03);
  vec3 col = c.rgb * mix(0.42, 1.06, uLit);
  float alpha = a;
  if (uMirror > 0.5) { alpha *= smoothstep(0.3, 1.0, vUv.y) * 0.45; }
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

function paint(img: HTMLImageElement | null, d: Drink, idx: number, cat: string, price: string) {
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6eedd';
  g.fillRect(0, 0, TEX_W, TEX_H);
  if (img) {
    const ph = 430;
    const s = Math.max(TEX_W / img.naturalWidth, ph / img.naturalHeight);
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    g.drawImage(img, (TEX_W - w) / 2, (ph - h) / 2, w, h);
  }
  g.fillStyle = 'rgba(15,36,27,0.75)';
  g.fillRect(14, 14, g.measureText(cat).width + 80, 30);
  g.fillStyle = '#efe3c8';
  g.font = '500 15px "IBM Plex Mono", monospace';
  g.fillText(cat.toUpperCase(), 24, 34);
  g.fillStyle = '#b98a3e';
  g.font = '400 16px "IBM Plex Mono", monospace';
  g.fillText(String(idx + 1).padStart(2, '0'), 22, 468);
  g.fillStyle = '#2a1d17';
  g.font = '500 30px Fraunces, Georgia, serif';
  const name = d.name.fr.length > 22 ? d.name.fr.slice(0, 21) + '…' : d.name.fr;
  g.fillText(name, 22, 506);
  g.fillStyle = 'rgba(42,29,23,0.55)';
  g.font = '400 17px Manrope, sans-serif';
  g.fillText(d.name.en.length > 30 ? d.name.en.slice(0, 29) + '…' : d.name.en, 22, 534);
  g.fillStyle = '#8f6424';
  g.font = price.length > 10 ? '500 21px Fraunces, Georgia, serif' : '500 30px Fraunces, Georgia, serif';
  g.textAlign = 'right';
  g.fillText(price, TEX_W - 22, 578);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createCarteScene(
  canvas: HTMLCanvasElement,
  opts: {reduced: boolean; drinks: Drink[]; catName: (d: Drink) => string; price: (d: Drink) => string; onPick: (d: Drink) => void},
) {
  const renderer = makeRenderer(canvas);
  renderer.shadowMap.enabled = false;
  const {scene, tick, dispose: disposeStudio} = makeStudio(renderer, {glowDir: [0, 0.1, -1]});
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 160);

  // Lacquer floor
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(60, 96),
    new THREE.MeshPhysicalMaterial({color: '#2a0d05', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, metalness: 0, envMapIntensity: 0.12, transparent: true, opacity: 0.8}),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const N = opts.drinks.length;
  const R = (N * (CW + 0.32)) / (Math.PI * 2);

  const wheel = new THREE.Group();
  scene.add(wheel);
  const geo = new THREE.PlaneGeometry(CW, CH);
  const cards: {mesh: THREE.Mesh; mirror: THREE.Mesh; mat: THREE.ShaderMaterial; mmat: THREE.ShaderMaterial; base: number; d: Drink}[] = [];
  opts.drinks.forEach((d, i) => {
    const tex = paint(null, d, i, opts.catName(d), opts.price(d));
    const mat = new THREE.ShaderMaterial({vertexShader: cardVert, fragmentShader: cardFrag, transparent: true, uniforms: {uMap: {value: tex}, uLit: {value: 0}, uMirror: {value: 0}}});
    const mmat = new THREE.ShaderMaterial({vertexShader: cardVert, fragmentShader: cardFrag, transparent: true, depthWrite: false, uniforms: {uMap: {value: tex}, uLit: {value: 0}, uMirror: {value: 1}}});
    const a = (i / N) * Math.PI * 2;
    const mesh = new THREE.Mesh(geo, mat);
    const mirror = new THREE.Mesh(geo, mmat);
    const holder = new THREE.Group();
    holder.rotation.y = a;
    mesh.position.set(0, CH / 2 + 0.35, R);
    mirror.position.set(0, -(CH / 2 + 0.35), R);
    mesh.userData.i = i;
    holder.add(mesh, mirror);
    wheel.add(holder);
    cards.push({mesh, mirror, mat, mmat, base: a, d});
    // load the photo and repaint the card with it
    const img = new Image();
    img.decoding = 'async';
    img.src = d.img.s;
    img.onload = () => {
      const t = paint(img, d, i, opts.catName(d), opts.price(d));
      mat.uniforms.uMap.value.dispose();
      mat.uniforms.uMap.value = t;
      mmat.uniforms.uMap.value = t;
    };
  });

  // Click → add to the order
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const mouse = {x: 0, y: 0, tx: 0, ty: 0};
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom) return;
    mouse.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.ty = -(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const onClick = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(cards.map((c) => c.mesh))[0];
    if (hit) opts.onPick(cards[hit.object.userData.i].d);
  };
  window.addEventListener('pointermove', onMove, {passive: true});
  canvas.addEventListener('click', onClick);

  let W = 1;
  let H = 1;
  const resize = () => {
    W = canvas.clientWidth || 1;
    H = canvas.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.fov = W / H < 0.8 ? 50 : 32;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const clock = new THREE.Clock();
  /** pos: fractional card index at the front (0..N-1). xShift: px to offset the wheel centre (room for the side panel). */
  function render(pos: number, xShift: number) {
    const time = opts.reduced ? 0 : clock.getElapsedTime();
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    wheel.rotation.y = -(pos / N) * Math.PI * 2;
    const portrait = W / H < 0.8;
    camera.position.set(mouse.x * 0.8, 3.1 + mouse.y * 0.4, R + (portrait ? 9.5 : 10.5));
    camera.lookAt(0, 1.4, R - 2.5);
    if (Math.abs(xShift) > 0.5) camera.setViewOffset(W, H, -xShift, 0, W, H);
    else camera.clearViewOffset();
    cards.forEach((c, i) => {
      let off = i - pos;
      off -= Math.round(off / N) * N;
      const lit = Math.max(0, 1 - Math.abs(off) * 0.55);
      c.mat.uniforms.uLit.value = lit;
      c.mmat.uniforms.uLit.value = lit;
      const s = 1 + lit * 0.14;
      c.mesh.scale.setScalar(s);
      c.mesh.position.y = (CH / 2 + 0.35) * s + lit * 0.15 + Math.sin(time * 0.8 + i) * 0.03;
      c.mesh.position.z = R + lit * 0.6;
      c.mirror.scale.setScalar(s);
      c.mirror.position.y = -c.mesh.position.y;
      c.mirror.position.z = c.mesh.position.z;
      const vis = Math.abs(off) < 9;
      c.mesh.visible = c.mirror.visible = vis;
    });
    tick(time);
    renderer.render(scene, camera);
    (window as unknown as {__carteFrames: number}).__carteFrames = ((window as unknown as {__carteFrames?: number}).__carteFrames ?? 0) + 1;
  }

  return {
    render,
    dispose() {
      window.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('click', onClick);
      ro.disconnect();
      cards.forEach((c) => (c.mat.uniforms.uMap.value as THREE.Texture).dispose());
      disposeScene(scene);
      disposeStudio();
      renderer.dispose();
    },
  };
}
