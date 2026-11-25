/**
 * La galerie: the café's photos as framed canvases on easels standing along
 * an S-curved path across a lacquer floor under the look's sky. Scroll moves
 * the camera along a CatmullRom spline past each frame; the frame being
 * visited swings toward the lens and lights up.
 */
import * as THREE from 'three';
import {disposeScene, makeRenderer, makeStudio} from './kit';

// Balaji Tech Labs' "lando reveal" lens (MIT), moved into the 3D frames: every
// photo shows as a warm two-tone engraving, and a lens following the cursor
// reveals the real colour photograph through it, edged with a thin gold ring.
const lensVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const lensFrag = `uniform sampler2D uMap; uniform float uLit; uniform vec2 uMouse; uniform float uR; uniform float uOn; varying vec2 vUv;
void main(){
  vec3 c = texture2D(uMap, vUv).rgb;
  float l = dot(c, vec3(0.299,0.587,0.114));
  float hatch = 0.5 + 0.5*sin((vUv.x + vUv.y) * 900.0);
  float ink = smoothstep(0.15, 0.85, l + (hatch - 0.5) * 0.18);
  vec3 duo = mix(vec3(0.16,0.06,0.035), vec3(0.98,0.86,0.68), ink);
  float d = distance(gl_FragCoord.xy, uMouse);
  float m = (1.0 - smoothstep(uR - 2.0, uR + 2.0, d)) * uOn;
  float ring = (smoothstep(uR - 4.0, uR - 1.0, d) - smoothstep(uR + 1.0, uR + 4.0, d)) * uOn;
  vec3 col = mix(duo, c, m) * mix(0.6, 1.08, uLit);
  col = mix(col, vec3(0.89,0.74,0.46), ring * 0.9);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export type Shot = {src: string; w: number; h: number};

export function createGalleryScene(canvas: HTMLCanvasElement, opts: {reduced: boolean; shots: Shot[]}) {
  const renderer = makeRenderer(canvas);
  const {scene, key, tick, dispose: disposeStudio} = makeStudio(renderer, {glowDir: [0, 0.15, -1]});
  scene.fog = new THREE.Fog((scene.fog as THREE.Fog).color, 14, 48);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  const N = opts.shots.length;
  const STEP = 7;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, N * STEP + 60),
    new THREE.MeshPhysicalMaterial({color: '#3a1408', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, metalness: 0, envMapIntensity: 0.12}),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -(N * STEP) / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const loader = new THREE.TextureLoader();
  const gold = new THREE.MeshPhysicalMaterial({color: '#d4a24c', metalness: 1, roughness: 0.25});
  const wood = new THREE.MeshPhysicalMaterial({color: '#3b2216', roughness: 0.5, clearcoat: 0.6});
  const frames: {g: THREE.Group; side: number; mat: THREE.ShaderMaterial; base: number}[] = [];
  const lensU = {uMouse: {value: new THREE.Vector2(-999, -999)}, uR: {value: 150}, uOn: {value: 0}};
  opts.shots.forEach((s, i) => {
    const side = i % 2 ? 1 : -1;
    const z = -i * STEP;
    const x = side * 4.8 + Math.sin(i * 0.9) * 0.4;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = -side * 0.55;
    const H = 3.0;
    const W = (H * s.w) / s.h;
    const tex = loader.load(s.src);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.ShaderMaterial({vertexShader: lensVert, fragmentShader: lensFrag, uniforms: {uMap: {value: tex}, uLit: {value: 0}, ...lensU}});
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    photo.position.set(0, 3.1, 0.06);
    const t = 0.14;
    const bar = (w: number, h: number, px: number, py: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.16), gold);
      m.position.set(px, py, 0);
      m.castShadow = true;
      g.add(m);
    };
    bar(W + 2 * t, t, 0, 3.1 + H / 2 + t / 2);
    bar(W + 2 * t, t, 0, 3.1 - H / 2 - t / 2);
    bar(t, H, -W / 2 - t / 2, 3.1);
    bar(t, H, W / 2 + t / 2, 3.1);
    const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.04), wood);
    back.position.set(0, 3.1, -0.02);
    // easel legs
    [-1, 1].forEach((k) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.8, 8), wood);
      leg.position.set(k * W * 0.32, 2.3, -0.25);
      leg.rotation.set(-0.12, 0, k * -0.05);
      leg.castShadow = true;
      g.add(leg);
    });
    const rear = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 4.6, 8), wood);
    rear.position.set(0, 2.2, -0.9);
    rear.rotation.x = 0.28;
    g.add(photo, back, rear);
    scene.add(g);
    frames.push({g, side, mat, base: -side * 0.55});
  });

  // warm lamp that travels with the camera
  const lamp = new THREE.PointLight('#ffd6a0', 30, 16, 2);
  scene.add(lamp);

  let W = 1;
  let H = 1;
  const resize = () => {
    W = canvas.clientWidth || 1;
    H = canvas.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.fov = W / H < 0.8 ? 58 : 40;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const mouse = {x: 0, y: 0, tx: 0, ty: 0};
  const lens = {x: -999, y: -999, tx: -999, ty: -999};
  const onMove = (e: PointerEvent) => {
    mouse.tx = (e.clientX / innerWidth) * 2 - 1;
    mouse.ty = -((e.clientY / innerHeight) * 2 - 1);
    const r = canvas.getBoundingClientRect();
    const dpr = renderer.getPixelRatio();
    lens.tx = (e.clientX - r.left) * dpr;
    lens.ty = (r.bottom - e.clientY) * dpr;
    if (lens.x < -900) {
      lens.x = lens.tx;
      lens.y = lens.ty;
    }
    lensU.uOn.value = 1;
  };
  window.addEventListener('pointermove', onMove, {passive: true});

  const clock = new THREE.Clock();
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  /** k: 0..1 along the walk; returns the index of the frame being visited. */
  function render(k: number) {
    const time = opts.reduced ? 0 : clock.getElapsedTime();
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    const u = THREE.MathUtils.clamp(k, 0, 1);
    // station = fractional frame index; the camera stands 6.5 in front of it
    const f = u * (N - 1);
    const i = THREE.MathUtils.clamp(Math.round(f), 0, N - 1);
    pos.set(Math.sin(f * Math.PI) * 0.5, 2.5 + Math.sin(f * 1.3) * 0.15, -f * STEP + 7.6);
    const fr = frames[i];
    camera.position.copy(pos).add(new THREE.Vector3(mouse.x * 0.4, mouse.y * 0.25, 0));
    // look between the path ahead and the visited frame
    look.set(0, 2.6, pos.z - 8);
    const fp = new THREE.Vector3(fr.g.position.x, 3.1, fr.g.position.z);
    const near = 1 - Math.min(1, Math.abs(f - i) * 1.6);
    look.lerp(fp, 0.45 + near * 0.47);
    camera.lookAt(look);
    frames.forEach((F, j) => {
      const d = Math.max(0, 1 - Math.abs(f - j));
      F.g.rotation.y = F.base * (1 - d * 0.55) + Math.sin(time * 0.6 + j) * 0.01;
      F.mat.uniforms.uLit.value = d;
    });
    lens.x += (lens.tx - lens.x) * 0.15;
    lens.y += (lens.ty - lens.y) * 0.15;
    lensU.uMouse.value.set(lens.x, lens.y);
    lensU.uR.value = 150 * renderer.getPixelRatio();
    lamp.position.set(pos.x, 5, pos.z - 2.5);
    key.position.set(pos.x - 5, 9, pos.z + 6);
    key.target.position.set(pos.x, 0, pos.z - 4);
    key.target.updateMatrixWorld();
    tick(time);
    renderer.render(scene, camera);
    (window as unknown as {__galFrames: number}).__galFrames = ((window as unknown as {__galFrames?: number}).__galFrames ?? 0) + 1;
    return i;
  }

  return {
    render,
    dispose() {
      window.removeEventListener('pointermove', onMove);
      ro.disconnect();
      disposeScene(scene);
      disposeStudio();
      renderer.dispose();
    },
  };
}
