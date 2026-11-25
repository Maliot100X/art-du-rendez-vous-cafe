/**
 * Shared studio for every 3D section after the hero: the same recipe as
 * cafeScene.ts (Halcyon vessel.js lineage): ACES + sRGB renderer, RoomEnvironment
 * PMREM reflections, warm shadowing key + gold rim + room fill, bottle-green
 * backdrop dome, green-marble bistro table with a brass edge.
 */
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

export const PAL = {ink: '#0f241b', bottle: '#16352a', cream: '#efe3c8', paper: '#f6eedd', gold: '#b98a3e', espresso: '#2a1d17'};

export function makeRenderer(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false, powerPreference: 'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export function marbleTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(S / 2, S / 2, 40, S / 2, S / 2, S * 0.7);
  grd.addColorStop(0, '#1d4234');
  grd.addColorStop(1, '#0c1f17');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const vein = (color: string, alpha: number, width: number, count: number) => {
    g.strokeStyle = color;
    for (let i = 0; i < count; i++) {
      g.globalAlpha = alpha * (0.4 + Math.random() * 0.6);
      g.lineWidth = width * (0.4 + Math.random());
      let x = Math.random() * S;
      let y = Math.random() * S;
      let a = Math.random() * Math.PI * 2;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 60; s++) {
        a += (Math.random() - 0.5) * 0.5;
        x += Math.cos(a) * 14;
        y += Math.sin(a) * 14;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  };
  vein('#2f5c49', 0.5, 7, 40);
  vein('#e9dcc0', 0.22, 1.6, 26);
  vein('#c99a4c', 0.35, 0.9, 18);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Three art directions, each lifted from a colourful reference in the toolkit:
 *  A "Apéro"   gentlerain.ai's tangerine field + cream type, espresso accents
 *  B "Atelier" Yash Chauhan's portfolio-3d peach/cream lit studio with orange props
 *  C "Nuit"    Nishat's cyan rim light + GAME OVER's lime, on a deep indigo bar at night
 * Pick with ?look=a|b|c (default a). The sky is an animated flowing-gradient dome.
 */
export type Look = {id: 'a' | 'b' | 'c'; name: string; top: string; mid: string; bottom: string; orb1: string; orb2: string; fog: string; rim: string; key: string; exposure: number; ui: string; small: string};
export const LOOKS: Record<string, Look> = {
  a: {id: 'a', name: 'Apéro', top: '#ff7a2f', mid: '#ff5a1f', bottom: '#5a1e10', orb1: '#ffd27a', orb2: '#ff3d6e', fog: '#a8401a', rim: '#ffd59a', key: '#fff1dc', exposure: 1.0, ui: '#ff6a1f', small: '#fff1dc'},
  b: {id: 'b', name: 'Atelier', top: '#ffe9d6', mid: '#f7c9a3', bottom: '#d9845a', orb1: '#fff6e8', orb2: '#ff9b5e', fog: '#e8b08a', rim: '#ffffff', key: '#fff6ea', exposure: 1.05, ui: '#f08a3c', small: '#7a3b1c'},
  c: {id: 'c', name: 'Nuit', top: '#120d3a', mid: '#2a1670', bottom: '#05040f', orb1: '#22e3ff', orb2: '#b6ff3b', fog: '#140f3f', rim: '#5cf0ff', key: '#ffe8cf', exposure: 1.0, ui: '#22e3ff', small: '#eaf6ff'},
};
export const getLook = (): Look => {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('look') : null;
  const look = LOOKS[(q ?? 'a').toLowerCase()] ?? LOOKS.a;
  if (typeof document !== 'undefined') document.documentElement.dataset.look = look.id;
  return look;
};

const domeVert = `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const domeFrag = `
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom; uniform vec3 uOrb1; uniform vec3 uOrb2; uniform float uTime;
varying vec3 vDir;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
void main(){
  vec3 d = normalize(vDir);
  float az = atan(d.x, -d.z);
  vec2 uv = vec2(az*1.2, d.y*2.0);
  float flow = fbm(uv*1.4 + vec2(uTime*0.03, -uTime*0.02) + fbm(uv*2.0 - uTime*0.02));
  float h = clamp(d.y*0.6 + 0.35 + (flow-0.5)*0.35, 0.0, 1.0);
  vec3 col = mix(uBottom, uMid, smoothstep(0.0, 0.5, h));
  col = mix(col, uTop, smoothstep(0.45, 1.0, h));
  // two soft light orbs drifting behind the set
  vec2 o1 = vec2(sin(uTime*0.05)*0.6 - 0.3, 0.32); vec2 o2 = vec2(cos(uTime*0.04)*0.7 + 0.5, 0.05);
  col += uOrb1 * exp(-pow(length((uv - o1*vec2(1.0,2.0))*vec2(0.9,1.4)), 2.0)*2.2) * 0.45;
  col += uOrb2 * exp(-pow(length((uv - o2*vec2(1.0,2.0))*vec2(0.9,1.4)), 2.0)*2.6) * 0.35;
  col *= 0.94 + 0.12*flow;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function makeDome(look: Look) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(70, 64, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: domeVert,
      fragmentShader: domeFrag,
      uniforms: {
        uTop: {value: new THREE.Color(look.top)},
        uMid: {value: new THREE.Color(look.mid)},
        uBottom: {value: new THREE.Color(look.bottom)},
        uOrb1: {value: new THREE.Color(look.orb1)},
        uOrb2: {value: new THREE.Color(look.orb2)},
        uTime: {value: 0},
      },
    }),
  );
}

export function makeStudio(renderer: THREE.WebGLRenderer, opts: {table?: number; glowDir?: [number, number, number]} = {}) {
  const look = getLook();
  renderer.toneMappingExposure = look.exposure;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(look.bottom);
  scene.fog = new THREE.Fog(look.fog, 22, 60);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environment = env;

  const key = new THREE.DirectionalLight(look.key, 2.6);
  key.position.set(-5, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, {left: -12, right: 12, top: 10, bottom: -10, near: 1, far: 40});
  scene.add(key);
  const rim = new THREE.DirectionalLight(look.rim, 2.4);
  rim.position.set(4, 4, -7);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight('#cfe8da', '#1a0f0a', 0.35));

  const dome = makeDome(look);
  scene.add(dome);

  let marble: THREE.Texture | null = null;
  if (opts.table) {
    marble = marbleTexture();
    marble.wrapS = marble.wrapT = THREE.RepeatWrapping;
    const r = opts.table;
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.32, 160),
      new THREE.MeshPhysicalMaterial({map: marble, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.28}),
    );
    table.position.y = -0.16;
    table.receiveShadow = true;
    scene.add(table);
    const edge = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 12, 260), new THREE.MeshPhysicalMaterial({color: '#c9973f', metalness: 1, roughness: 0.28}));
    edge.rotation.x = Math.PI / 2;
    edge.position.y = -0.01;
    scene.add(edge);
  }
  return {
    scene,
    key,
    look,
    tick(time: number) {
      (dome.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    },
    dispose() {
      env.dispose();
      pmrem.dispose();
      marble?.dispose();
    },
  };
}

/** Lathe from [r, y] pairs. */
export const lathe = (pts: [number, number][], seg = 96) => {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.computeVertexNormals();
  return g;
};

/** A hollow glass: outer profile, lip, inner wall offset by `wall`. */
export const glassShell = (outer: [number, number][], wall = 0.03, floor = 0.08, seg = 96) => {
  const lip = outer[outer.length - 1];
  const inner = outer
    .slice(1)
    .reverse()
    .filter(([, y]) => y > floor)
    .map(([r, y]) => [Math.max(0.01, r - wall), y] as [number, number]);
  return lathe([...outer, [lip[0] - wall * 0.5, lip[1] + 0.01], ...inner, [0, floor]], seg);
};

export const glassMaterial = () =>
  new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.04,
    metalness: 0,
    transparent: true,
    opacity: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.1,
    side: THREE.FrontSide,
    depthWrite: false,
  });

export function disposeScene(scene: THREE.Scene) {
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose?.();
  });
}
