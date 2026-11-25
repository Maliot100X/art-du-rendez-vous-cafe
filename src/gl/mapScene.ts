/**
 * Venir: a 3D map. OpenStreetMap tiles (© OpenStreetMap contributors, ODbL)
 * around Rue des Artistes 1A are stitched into one warm-toned canvas laid on
 * a tilted slab under the look's sky; a gold cup-pin bobs over the café and a
 * pulse ring spreads from it; the camera orbits slowly and follows the cursor.
 */
import * as THREE from 'three';
import {disposeScene, lathe, makeRenderer, makeStudio} from './kit';

const Z = 17;
const GRID = 5;

export function createMapScene(canvas: HTMLCanvasElement, opts: {reduced: boolean; lat: number; lng: number}) {
  const renderer = makeRenderer(canvas);
  const {scene, tick, dispose: disposeStudio} = makeStudio(renderer, {glowDir: [0, 0.2, -1]});
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);

  // tile maths
  const n = 2 ** Z;
  const fx = ((opts.lng + 180) / 360) * n;
  const latR = (opts.lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  const tx0 = Math.floor(fx) - (GRID >> 1);
  const ty0 = Math.floor(fy) - (GRID >> 1);
  const TS = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = GRID * TS;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#f3e3cc';
  g.fillRect(0, 0, cv.width, cv.height);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  let loaded = 0;
  const tint = () => {
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgba(255,170,110,0.35)';
    g.fillRect(0, 0, cv.width, cv.height);
    g.restore();
    tex.needsUpdate = true;
  };
  for (let j = 0; j < GRID; j++)
    for (let i = 0; i < GRID; i++) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        g.drawImage(img, i * TS, j * TS);
        tex.needsUpdate = true;
        if (++loaded === GRID * GRID) tint();
      };
      img.onerror = () => {
        if (++loaded === GRID * GRID) tint();
      };
      img.src = `https://tile.openstreetmap.org/${Z}/${tx0 + i}/${ty0 + j}.png`;
    }

  const SIZE = 14;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(SIZE, 0.35, SIZE),
    [
      new THREE.MeshPhysicalMaterial({color: '#3b170a', roughness: 0.5}),
      new THREE.MeshPhysicalMaterial({color: '#3b170a', roughness: 0.5}),
      new THREE.MeshPhysicalMaterial({map: tex, roughness: 0.65, clearcoat: 0.3}),
      new THREE.MeshPhysicalMaterial({color: '#3b170a'}),
      new THREE.MeshPhysicalMaterial({color: '#3b170a', roughness: 0.5}),
      new THREE.MeshPhysicalMaterial({color: '#3b170a', roughness: 0.5}),
    ],
  );
  slab.position.y = -0.175;
  slab.receiveShadow = true;
  scene.add(slab);
  const brass = new THREE.Mesh(new THREE.BoxGeometry(SIZE + 0.2, 0.08, SIZE + 0.2), new THREE.MeshPhysicalMaterial({color: '#d4a24c', metalness: 1, roughness: 0.25}));
  brass.position.y = -0.36;
  scene.add(brass);

  // café position on the slab
  const px = ((fx - tx0) / GRID - 0.5) * SIZE;
  const pz = ((fy - ty0) / GRID - 0.5) * SIZE;
  const pin = new THREE.Group();
  pin.position.set(px, 0, pz);
  const goldM = new THREE.MeshPhysicalMaterial({color: '#e2b25a', metalness: 1, roughness: 0.18});
  const cup = new THREE.Mesh(lathe([[0, 0], [0.32, 0.02], [0.42, 0.3], [0.46, 0.55], [0.4, 0.55], [0, 0.1]], 48), new THREE.MeshPhysicalMaterial({color: '#fbf6ee', roughness: 0.2, clearcoat: 1, side: THREE.DoubleSide}));
  cup.castShadow = true;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.025, 8, 48), goldM);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.55;
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.41, 40), new THREE.MeshPhysicalMaterial({color: '#6b3a1e', roughness: 0.3}));
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = 0.48;
  const stem = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.1, 24), goldM);
  stem.rotation.x = Math.PI;
  stem.position.y = -0.55;
  const head = new THREE.Group();
  head.add(cup, lip, coffee, stem);
  head.position.y = 1.4;
  pin.add(head);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 64), new THREE.MeshBasicMaterial({color: '#ff6a1f', transparent: true}));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  pin.add(ring);
  scene.add(pin);

  // custom-globe-3js (ISC): textured globe with a fresnel glow edge + additive
  // back-side atmosphere, tinted to the look. It opens Venir, then lifts away
  // while the camera dives onto the street map.
  const globe = new THREE.Group();
  const gTex = new THREE.TextureLoader().load('/media/globe/globe.jpg');
  gTex.colorSpace = THREE.SRGBColorSpace;
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(3, 64, 64),
    new THREE.ShaderMaterial({
      uniforms: {uTex: {value: gTex}, uGlow: {value: new THREE.Color('#ffb36b')}},
      vertexShader: `varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D uTex; uniform vec3 uGlow; varying vec2 vUv; varying vec3 vN;
        void main(){ float edge = 1.05 - dot(vN, vec3(0.0,0.0,1.0)); vec3 base = texture2D(uTex, vUv).rgb;
          base = mix(base, vec3(dot(base, vec3(0.3,0.59,0.11))) * vec3(1.15,0.85,0.6), 0.45);
          gl_FragColor = vec4(base + uGlow * pow(edge, 1.5) * 0.9, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(3, 64, 64),
    new THREE.ShaderMaterial({
      uniforms: {uGlow: {value: new THREE.Color('#ff8a3d')}},
      vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 0.9); }`,
      fragmentShader: `uniform vec3 uGlow; varying vec3 vN; void main(){ float i = pow(0.72 - dot(vN, vec3(0.0,0.0,1.0)), 2.0); gl_FragColor = vec4(uGlow, 1.0) * i; }`,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    }),
  );
  atmo.scale.setScalar(1.18);
  const spin = new THREE.Group();
  spin.add(sphere);
  // Brussels marker on the globe
  const lonR = ((opts.lng + 180) / 360) * Math.PI * 2;
  const thR = ((90 - opts.lat) / 180) * Math.PI;
  const bxl = new THREE.Vector3(-Math.cos(lonR) * Math.sin(thR), Math.cos(thR), Math.sin(lonR) * Math.sin(thR));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), new THREE.MeshBasicMaterial({color: '#fff1dc'}));
  dot.position.copy(bxl).multiplyScalar(3.02);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 8), new THREE.MeshBasicMaterial({color: '#ffd59a', transparent: true, opacity: 0.85}));
  beacon.position.copy(bxl).multiplyScalar(3.6);
  beacon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bxl);
  spin.add(dot, beacon);
  globe.add(spin, atmo);
  scene.add(globe);
  const toCam = new THREE.Quaternion();
  const dirCam = new THREE.Vector3();

  let W = 1;
  let H = 1;
  const resize = () => {
    W = canvas.clientWidth || 1;
    H = canvas.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.fov = W / H < 0.8 ? 52 : 36;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const mouse = {x: 0, y: 0, tx: 0, ty: 0};
  const onMove = (e: PointerEvent) => {
    mouse.tx = (e.clientX / innerWidth) * 2 - 1;
    mouse.ty = -((e.clientY / innerHeight) * 2 - 1);
  };
  window.addEventListener('pointermove', onMove, {passive: true});
  const clock = new THREE.Clock();

  function render(k: number) {
    const time = opts.reduced ? 0 : clock.getElapsedTime();
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    const g = THREE.MathUtils.smoothstep(k, 0.05, 0.5); // 0 = globe, 1 = street map
    const a = -0.5 + time * 0.04 + mouse.x * 0.25 + k * 0.8;
    const r = THREE.MathUtils.lerp(17, 11, k);
    const mapPos = new THREE.Vector3(px + Math.sin(a) * r, THREE.MathUtils.lerp(12, 7, k) + mouse.y * 0.8, pz + Math.cos(a) * r);
    globe.position.set(px, 8 + g * 9, pz - 2);
    globe.scale.setScalar(1 - g * 0.6);
    const globePos = new THREE.Vector3(px + mouse.x * 0.8, 8.4 + mouse.y * 0.5, pz + 9.5);
    camera.position.lerpVectors(globePos, mapPos, g);
    const lookG = new THREE.Vector3(px, 8, pz - 2);
    const lookM = new THREE.Vector3(px, 0.6, pz);
    camera.lookAt(lookG.lerp(lookM, g));
    // turn Brussels toward the lens, with a slow drift
    dirCam.copy(camera.position).sub(globe.position).normalize();
    toCam.setFromUnitVectors(bxl, dirCam);
    spin.quaternion.copy(toCam);
    spin.rotateOnAxis(new THREE.Vector3(0, 1, 0), Math.sin(time * 0.3) * 0.25 * (1 - g));
    globe.visible = g < 0.99;
    head.position.y = 1.4 + Math.sin(time * 2) * 0.12;
    head.rotation.y = time * 0.8;
    const s = (time * 0.6) % 1;
    ring.scale.setScalar(1 + s * 6);
    (ring.material as THREE.MeshBasicMaterial).opacity = 1 - s;
    tick(time);
    renderer.render(scene, camera);
  }

  return {
    render,
    dispose() {
      window.removeEventListener('pointermove', onMove);
      ro.disconnect();
      tex.dispose();
      disposeScene(scene);
      disposeStudio();
      renderer.dispose();
    },
  };
}
