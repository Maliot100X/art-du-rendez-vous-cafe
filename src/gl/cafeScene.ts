/**
 * The café, as one live three.js scene. It replaces NAÏADE's pre-rendered frame
 * film: the Stage's playhead (film seconds, remapped from scroll by NAÏADE's
 * timeRemap/timeline engine) now drives a real camera around a real cup.
 *
 * Built on the Halcyon starter's vessel.js recipe (lathe-turned body with wall
 * thickness, MeshPhysical glaze with a generated speckle map, RoomEnvironment
 * PMREM studio light, one shadowing key light, ACES tone mapping, adaptive DPR)
 * and extended into a full set:
 *   - cappuccino cup + saucer (lathe), tube handle, gold lip rings
 *   - liquid surface shader: latte-art heart → hot chocolate → Irish coffee
 *   - whipped-cream crown (Irish coffee), rising steam (noise shader billboards)
 *   - green marble bistro table, backdrop dome, orbiting instanced coffee beans
 *   - the café name set in 3D behind the cup, with a cursor-ripple shader
 *     (re-implementation of the gentlerain.ai ripple idea; no code copied)
 */
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {getLook, makeDome} from './kit';

export type Frame = {
  t: number; // film seconds 0..DURATION
  vel: number; // playhead velocity (film-s/s)
  shiftX: number; // px: where the free area's centre is, relative to canvas centre
  shiftY: number;
  zoom: number;
  dim: number; // 0..1 outro dim
};

const C = {
  ink: '#0f241b',
  bottle: '#16352a',
  cream: '#efe3c8',
  paper: '#f6eedd',
  gold: '#b98a3e',
  espresso: '#2a1d17',
};

/* ------------------------------------------------------------- textures */
function speckle(base: string, dots: string[], n = 2200, size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    g.fillStyle = dots[i % dots.length];
    g.globalAlpha = 0.25 + Math.random() * 0.5;
    g.beginPath();
    g.arc(Math.random() * size, Math.random() * size, Math.random() * 1.4 + 0.3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Dark green Belgian bistro marble with cream and gold veins. */
function marble() {
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

/** "Art du / Rendez-Vous" set in Fraunces on a transparent canvas. */
function titleTexture() {
  const W = 2048;
  const H = 820;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = getLook().small;
  g.font = `italic 300 150px Fraunces, Georgia, serif`;
  g.fillText('Art du', W / 2, 250);
  const gold = g.createLinearGradient(0, 300, 0, 720);
  gold.addColorStop(0, '#f1d59a');
  gold.addColorStop(0.55, '#c9973f');
  gold.addColorStop(1, '#8a6224');
  g.fillStyle = gold;
  g.font = `500 380px Fraunces, Georgia, serif`;
  // Tighten the tracking by hand: canvas letterSpacing isn't everywhere yet.
  const word = 'Rendez-Vous';
  const widths = [...word].map((ch) => g.measureText(ch).width);
  const track = -14;
  const total = widths.reduce((a, b) => a + b, 0) + track * (word.length - 1);
  let x = W / 2 - total / 2;
  g.textAlign = 'left';
  [...word].forEach((ch, i) => {
    g.fillText(ch, x, 640);
    x += widths[i] + track;
  });
  g.fillStyle = 'rgba(239,227,200,0.55)';
  g.font = `400 34px "IBM Plex Mono", monospace`;
  g.textAlign = 'center';
  g.fillText('C A F É   ·   R U E   D E S   A R T I S T E S   1 A   ·   L A E K E N', W / 2, 760);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* -------------------------------------------------------------- shaders */
const NOISE = /* glsl */ `
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
`;

const liquidVert = /* glsl */ `
varying vec2 vUv; varying vec3 vWorld;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const liquidFrag = /* glsl */ `
uniform float uTime; uniform float uDrink; uniform vec3 uLight;
varying vec2 vUv; varying vec3 vWorld;
${NOISE}
float heart(vec2 p){ // classic heart SDF-ish, p in [-1,1]
  p.y -= 0.15; p.x = abs(p.x);
  float a = atan(p.x, p.y)/3.14159; float r = length(p);
  float h = abs(a); float d = (13.0*h - 22.0*h*h + 10.0*h*h*h)/(6.0-5.0*h);
  return r - d*0.62;
}
void main(){
  vec2 p = (vUv - 0.5) * 2.0; float r = length(p);
  float ang = uTime*0.04; mat2 R = mat2(cos(ang),-sin(ang),sin(ang),cos(ang));
  vec2 q = R * p;
  // --- latte (0): crema ring + a poured "tulip" heart (stacked heart layers) with micro-foam edge
  vec3 crema = mix(vec3(0.62,0.38,0.19), vec3(0.38,0.2,0.09), smoothstep(0.45, 1.0, r));
  crema *= 0.92 + 0.16*fbm(q*7.0);
  vec2 hp = q*1.12 + vec2(0.0, 0.06) + 0.012*vec2(sin(q.y*14.0+uTime*0.8), 0.0);
  float hh = heart(hp);
  float foam = 1.0 - smoothstep(-0.03, 0.025, hh);
  // layered heart: thin crema lines following the heart's outline inside it
  float layers = smoothstep(0.55, 0.8, sin(hh*34.0 + 1.2)) * smoothstep(-0.02, -0.08, hh) * smoothstep(-0.42, -0.2, hh);
  foam *= 1.0 - layers*0.75;
  vec3 latte = mix(crema, vec3(0.97,0.93,0.85), foam);
  latte = mix(latte, vec3(0.92,0.84,0.7), smoothstep(0.84,0.97,r)*0.55);
  // --- chocolate (1): glossy cocoa with a cream spiral and cocoa dust
  float sp = sin(atan(q.y,q.x)*1.0 + r*14.0 - uTime*0.6);
  vec3 choc = mix(vec3(0.20,0.09,0.05), vec3(0.30,0.15,0.08), fbm(q*3.0+uTime*0.05));
  choc = mix(choc, vec3(0.86,0.74,0.58), smoothstep(0.85,0.97,sp)*smoothstep(0.95,0.2,r)*0.85);
  choc *= 1.0 - 0.35*step(0.9, hash(floor(q*90.0)));
  // --- irish (2): thick cream float
  vec3 irish = mix(vec3(0.93,0.88,0.77), vec3(0.83,0.75,0.6), fbm(q*4.0)*0.6);
  vec3 col = uDrink < 1.0 ? mix(latte, choc, uDrink) : mix(choc, irish, uDrink-1.0);
  // light: soft spec from the key light on a glossy surface + meniscus darkening
  vec3 N = normalize(vec3(0.03*(fbm(q*8.0+uTime*0.2)-0.5), 1.0, 0.03*(fbm(q*8.0-uTime*0.2)-0.5)));
  vec3 V = normalize(cameraPosition - vWorld); vec3 L = normalize(uLight);
  float spec = pow(max(dot(reflect(-L,N),V),0.0), 80.0);
  float gloss = mix(0.25, 0.9, clamp(uDrink, 0.0, 1.0)) * (1.0 - clamp(uDrink-1.0, 0.0, 1.0)*0.8);
  col *= 0.8 + 0.35*max(dot(N, L), 0.0);
  col += spec * gloss * 0.9;
  col *= mix(1.0, 0.55, smoothstep(0.9, 1.0, r));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const steamVert = /* glsl */ `
uniform float uTime; uniform vec2 uWind; uniform float uSeed;
varying vec2 vUv;
void main(){
  vUv = uv; vec3 p = position;
  float h = uv.y;
  p.x += (sin(h*4.0 + uTime*0.9 + uSeed*3.0)*0.18 + uWind.x*1.2) * h*h;
  p.z += uWind.y * h*h*0.6;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
}`;
const steamFrag = /* glsl */ `
uniform float uTime; uniform float uOpacity; uniform float uSeed;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 uv = vUv;
  float n = fbm(vec2(uv.x*3.0 + uSeed*7.0, uv.y*2.2 - uTime*0.35));
  float wisp = smoothstep(0.5, 0.9, fbm(vec2(uv.x*2.0 + n*1.4, uv.y*1.3 - uTime*0.22 + uSeed)));
  float mask = exp(-pow((uv.x-0.5)*4.2, 2.0)) * smoothstep(0.0, 0.18, uv.y) * (1.0 - smoothstep(0.55, 1.0, uv.y));
  float a = wisp * mask * uOpacity;
  gl_FragColor = vec4(vec3(1.0, 0.97, 0.9), a);
}`;

const titleVert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const titleFrag = /* glsl */ `
uniform sampler2D uMap; uniform float uTime; uniform vec2 uMouse; uniform float uHover; uniform float uOpacity;
varying vec2 vUv;
void main(){
  vec2 uv = vUv; vec2 asp = vec2(2.5, 1.0);
  // ripple rings spreading from the cursor
  float d = length((uv - uMouse)*asp);
  float wave = sin(d*38.0 - uTime*5.0) * exp(-d*4.5) * 0.010 * uHover;
  // and two slow ambient drops so the type is never quite still
  vec2 c1 = vec2(0.3+0.1*sin(uTime*0.3), 0.45); vec2 c2 = vec2(0.72, 0.6+0.1*cos(uTime*0.27));
  float d1 = length((uv-c1)*asp), d2 = length((uv-c2)*asp);
  wave += sin(d1*30.0 - uTime*2.4)*exp(-d1*3.0)*0.0035 + sin(d2*26.0 - uTime*2.0)*exp(-d2*3.0)*0.003;
  vec2 dir = normalize((uv - uMouse)*asp + 1e-5);
  vec2 o = dir * wave;
  float split = abs(wave) * 0.35 * uHover;
  vec4 a = texture2D(uMap, uv + o + vec2(split, 0.0));
  vec4 b = texture2D(uMap, uv + o);
  vec4 cc = texture2D(uMap, uv + o - vec2(split, 0.0));
  vec4 col = vec4(a.r, b.g, cc.b, b.a);
  // a gold sheen sweeping across the letters
  float sheen = smoothstep(0.0, 0.06, 0.06 - abs(fract(uv.x*0.6 - uTime*0.07) - 0.5 + uv.y*0.2 - 0.1));
  col.rgb += sheen * 0.35 * b.a + max(wave, 0.0) * 18.0 * b.a;
  gl_FragColor = vec4(col.rgb, col.a * uOpacity);
  #include <colorspace_fragment>
}`;

const domeFrag = /* glsl */ `
uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uGlow; uniform vec3 uGlowDir;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y*0.5+0.5, 0.0, 1.0);
  vec3 col = mix(uBottom, uTop, smoothstep(0.35, 0.95, h));
  float g = pow(max(dot(d, normalize(uGlowDir)), 0.0), 14.0);
  col += uGlow * g * 0.16;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;
const domeVert = /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

/* ------------------------------------------------------------ geometry */
const CUP_OUTER: [number, number][] = [
  [0, 0], [0.52, 0], [0.58, 0.04], [0.57, 0.11], [0.72, 0.17], [0.97, 0.33], [1.14, 0.56], [1.24, 0.86], [1.29, 1.16], [1.31, 1.42], [1.32, 1.5],
];
const WALL = 0.065;
const RIM_Y = 1.5;
const LIQUID_Y = 1.3;

function cupGeometry() {
  const outer = CUP_OUTER.map(([r, y]) => new THREE.Vector2(r, y));
  const lip = [new THREE.Vector2(1.31, 1.525), new THREE.Vector2(1.285, 1.53)];
  const inner = CUP_OUTER.slice(2)
    .reverse()
    .map(([r, y]) => new THREE.Vector2(Math.max(0.02, r - WALL), Math.max(0.2, y)));
  const g = new THREE.LatheGeometry([...outer, ...lip, ...inner, new THREE.Vector2(0, 0.2)], 160);
  g.computeVertexNormals();
  return g;
}
function innerRadiusAt(y: number) {
  for (let i = 1; i < CUP_OUTER.length; i++) {
    const [r0, y0] = CUP_OUTER[i - 1];
    const [r1, y1] = CUP_OUTER[i];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0) - WALL;
  }
  return CUP_OUTER[CUP_OUTER.length - 1][0] - WALL;
}
function saucerGeometry() {
  const P: [number, number][] = [
    [0, 0.02], [0.95, 0.0], [1.02, 0.05], [1.06, 0.1], [1.7, 0.15], [2.04, 0.27], [2.13, 0.32], [2.12, 0.35], [2.02, 0.32], [1.66, 0.21], [1.08, 0.17], [0.0, 0.17],
  ];
  const g = new THREE.LatheGeometry(P.map(([r, y]) => new THREE.Vector2(r, y)), 160);
  g.computeVertexNormals();
  return g;
}
function beanGeometry() {
  const g = new THREE.SphereGeometry(0.16, 28, 18);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.set(v.x * 0.78, v.y * 0.62, v.z * 1.1);
    if (v.y > 0) v.y -= 0.055 * Math.exp(-Math.pow(v.x / 0.028, 2)) * (1 - Math.pow(v.z / 0.18, 2));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
function creamGeometry(radius: number) {
  const g = new THREE.SphereGeometry(radius, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    const h = v.y / radius;
    const swirl = 1 + 0.06 * Math.sin(a * 8 + h * 9) * (1 - h);
    v.x *= swirl;
    v.z *= swirl;
    v.y *= 0.32;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/* ---------------------------------------------------------------- camera path */
// [filmSecond, position, lookAt]. 0 hero · 5 crane up · 10 latte macro · 15 low side (chocolate) · 20 three-quarter back (Irish)
const SHOTS: [number, [number, number, number], [number, number, number]][] = [
  [0, [0.0, 3.7, 11.2], [0, 1.75, 0]],
  [5, [-3.6, 6.2, 6.4], [0, 1.4, 0]],
  [10, [0.25, 7.4, 1.6], [0, 1.3, 0]],
  [15, [5.0, 4.4, 3.6], [0, 1.35, 0]],
  [20, [-4.2, 4.6, -3.4], [0, 1.6, 0]],
];

export type CafeScene = ReturnType<typeof createCafeScene>;

export function createCafeScene(canvas: HTMLCanvasElement, opts: {reduced: boolean; onProgress: (p: number) => void}) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false, powerPreference: 'high-performance'});
  const dpr = () => Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(dpr());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Beans move, so the shadow map can't be baked once like Halcyon's vase; refresh it every third frame.
  renderer.shadowMap.autoUpdate = false;
  opts.onProgress(0.2);

  const look = getLook();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(look.bottom);
  scene.fog = new THREE.Fog(look.fog, 20, 60);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environment = env;
  opts.onProgress(0.45);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);

  // Lights: warm key (shadows), gold rim from behind, cool-green fill from the room.
  const key = new THREE.DirectionalLight('#fff1dc', 2.6);
  key.position.set(-5, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, {left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30});
  scene.add(key);
  const rim = new THREE.DirectionalLight(look.rim, 2.4);
  rim.position.set(4, 4, -7);
  scene.add(rim);
  const fill = new THREE.HemisphereLight('#cfe8da', '#1a0f0a', 0.35);
  scene.add(fill);
  const glow = new THREE.PointLight('#ffb763', 6, 9, 2);
  glow.position.set(0, 3.2, 0.8);
  scene.add(glow);

  // Backdrop dome: the art direction's flowing gradient sky (kit.ts LOOKS)
  const dome = makeDome(look);
  scene.add(dome);

  // Table: round green-marble bistro top with a brass edge
  const marbleTex = marble();
  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(8, 8, 0.32, 128),
    new THREE.MeshPhysicalMaterial({map: marbleTex, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12, metalness: 0, envMapIntensity: 0.28}),
  );
  table.position.y = -0.16;
  table.receiveShadow = true;
  scene.add(table);
  const brass = new THREE.MeshPhysicalMaterial({color: '#c9973f', metalness: 1, roughness: 0.28});
  const edge = new THREE.Mesh(new THREE.TorusGeometry(8, 0.07, 12, 200), brass);
  edge.rotation.x = Math.PI / 2;
  edge.position.y = -0.01;
  scene.add(edge);

  // Porcelain
  const glazeMap = speckle('#808080', ['#6a6a6a', '#9a9a9a'], 1800);
  const porcelain = new THREE.MeshPhysicalMaterial({
    color: '#efe2c6',
    envMapIntensity: 0.8,
    roughness: 0.28,
    roughnessMap: glazeMap,
    bumpMap: glazeMap,
    bumpScale: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    sheen: 0.3,
    sheenColor: new THREE.Color(C.cream),
    side: THREE.DoubleSide,
  });
  const gold = new THREE.MeshPhysicalMaterial({color: '#d9a650', metalness: 1, roughness: 0.2, clearcoat: 0.6, envMapIntensity: 0.9});

  const set = new THREE.Group();
  scene.add(set);

  const saucer = new THREE.Mesh(saucerGeometry(), porcelain);
  saucer.castShadow = saucer.receiveShadow = true;
  set.add(saucer);
  const saucerRim = new THREE.Mesh(new THREE.TorusGeometry(2.125, 0.022, 10, 220), gold);
  saucerRim.rotation.x = Math.PI / 2;
  saucerRim.position.y = 0.335;
  set.add(saucerRim);

  const cup = new THREE.Group();
  cup.position.y = 0.17;
  set.add(cup);
  const body = new THREE.Mesh(cupGeometry(), porcelain);
  body.castShadow = body.receiveShadow = true;
  cup.add(body);
  const lipRing = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.024, 12, 220), gold);
  lipRing.rotation.x = Math.PI / 2;
  lipRing.position.y = RIM_Y + 0.015;
  cup.add(lipRing);
  const handleCurve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(1.27, 1.22, 0),
    new THREE.Vector3(2.15, 1.38, 0),
    new THREE.Vector3(2.12, 0.42, 0),
    new THREE.Vector3(1.05, 0.5, 0),
  );
  const handle = new THREE.Mesh(new THREE.TubeGeometry(handleCurve, 80, 0.115, 20), porcelain);
  handle.scale.z = 0.8;
  handle.castShadow = true;
  cup.add(handle);
  const handleGold = new THREE.Mesh(new THREE.TubeGeometry(handleCurve, 80, 0.03, 8), gold);
  handleGold.position.z = 0.0;
  handleGold.scale.set(1.012, 1.0, 1);
  cup.add(handleGold);

  const liquidR = innerRadiusAt(LIQUID_Y) - 0.005;
  const liquidMat = new THREE.ShaderMaterial({
    vertexShader: liquidVert,
    fragmentShader: liquidFrag,
    uniforms: {uTime: {value: 0}, uDrink: {value: 0}, uLight: {value: key.position.clone().normalize()}},
  });
  const liquid = new THREE.Mesh(new THREE.CircleGeometry(liquidR, 96), liquidMat);
  liquid.rotation.x = -Math.PI / 2;
  liquid.position.y = LIQUID_Y;
  cup.add(liquid);

  const creamMat = new THREE.MeshPhysicalMaterial({color: '#eadcc0', roughness: 0.62, sheen: 1, sheenColor: new THREE.Color('#fff7e8'), sheenRoughness: 0.5});
  const cream = new THREE.Mesh(creamGeometry(liquidR * 0.9), creamMat);
  cream.position.y = LIQUID_Y;
  cream.castShadow = true;
  cream.scale.setScalar(0.001);
  cup.add(cream);

  // Steam: three bent noise billboards
  const steams: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  const steamGeo = new THREE.PlaneGeometry(1.6, 3.6, 1, 40);
  steamGeo.translate(0, 1.8, 0);
  for (let i = 0; i < 3; i++) {
    const m = new THREE.ShaderMaterial({
      vertexShader: steamVert,
      fragmentShader: steamFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {uTime: {value: 0}, uOpacity: {value: 0.45}, uSeed: {value: i * 1.7}, uWind: {value: new THREE.Vector2()}},
    });
    const s = new THREE.Mesh(steamGeo, m);
    s.position.set((i - 1) * 0.35, cup.position.y + LIQUID_Y + 0.05, (i - 1) * 0.12);
    s.renderOrder = 5;
    set.add(s);
    steams.push(s);
  }

  // Beans orbiting the set
  const BEANS = 30;
  const beanMat = new THREE.MeshPhysicalMaterial({color: '#3a2318', roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.35, envMapIntensity: 0.6});
  const beans = new THREE.InstancedMesh(beanGeometry(), beanMat, BEANS);
  beans.castShadow = true;
  const seeds = Array.from({length: BEANS}, (_, i) => {
    const rnd = (k: number) => {
      const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    return {
      r: 3.1 + rnd(1) * 2.9,
      a: rnd(2) * Math.PI * 2,
      y: 0.35 + rnd(3) * 3.4,
      s: 0.45 + rnd(4) * 0.45,
      sp: (0.08 + rnd(5) * 0.12) * (rnd(6) > 0.5 ? 1 : -1),
      rx: rnd(7) * 6.28,
      ry: rnd(8) * 6.28,
      bob: rnd(9) * 6.28,
    };
  });
  scene.add(beans);

  // Title in the scene, behind the cup
  const titleTex = titleTexture();
  const titleMat = new THREE.ShaderMaterial({
    vertexShader: titleVert,
    fragmentShader: titleFrag,
    transparent: true,
    depthWrite: false,
    uniforms: {uMap: {value: titleTex}, uTime: {value: 0}, uMouse: {value: new THREE.Vector2(0.5, 0.5)}, uHover: {value: 0}, uOpacity: {value: 1}},
  });
  const title = new THREE.Mesh(new THREE.PlaneGeometry(13.5, 5.4), titleMat);
  title.position.set(0, 2.75, -4.8);
  scene.add(title);
  const redrawTitle = () => {
    const fresh = titleTexture();
    titleMat.uniforms.uMap.value = fresh;
    titleTex.dispose();
  };
  if (document.fonts) {
    Promise.all([
      document.fonts.load('500 380px Fraunces'),
      document.fonts.load('italic 300 150px Fraunces'),
      document.fonts.load('400 34px "IBM Plex Mono"'),
    ])
      .then(redrawTitle)
      .catch(() => {});
  }
  opts.onProgress(0.7);

  /* ------------------------------------------------------------ interaction */
  const mouse = {x: 0, y: 0, tx: 0, ty: 0, hover: 0, thover: 0};
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    mouse.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.ty = -(((e.clientY - r.top) / r.height) * 2 - 1);
    ndc.set(mouse.tx, mouse.ty);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(title)[0];
    if (hit?.uv) {
      titleMat.uniforms.uMouse.value.copy(hit.uv);
      mouse.thover = 1;
    } else mouse.thover = 0;
  };
  window.addEventListener('pointermove', onMove, {passive: true});

  /* --------------------------------------------------------------- sizing */
  let W = 1;
  let H = 1;
  const resize = () => {
    W = canvas.clientWidth || 1;
    H = canvas.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.fov = W / H < 0.8 ? 44 : 30;
    camera.updateProjectionMatrix();
    const portrait = W / H < 0.8;
    title.scale.setScalar(portrait ? 0.62 : 1);
    title.position.y = portrait ? 3.5 : 2.75;
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  /* -------------------------------------------------------------- per frame */
  const posCurve = new THREE.CatmullRomCurve3(SHOTS.map((s) => new THREE.Vector3(...s[1])), false, 'centripetal');
  const tgtCurve = new THREE.CatmullRomCurve3(SHOTS.map((s) => new THREE.Vector3(...s[2])), false, 'centripetal');
  const END = SHOTS[SHOTS.length - 1][0];
  const tmpP = new THREE.Vector3();
  const tmpT = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sv = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const clock = new THREE.Clock();
  let first = true;
  let slow = 0;
  let lowered = false;
  let lastNow = 0;
  let frameNo = 0;

  const smooth = (a: number, b: number, x: number) => {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };

  function render(f: Frame) {
    const now = performance.now();
    // Adaptive resolution (Halcyon): on a weak GPU drop the pixel ratio once.
    if (!lowered && lastNow && now - lastNow > 40) {
      if (++slow > 30) {
        lowered = true;
        renderer.setPixelRatio(Math.min(1, dpr()) * 0.75);
        resize();
      }
    } else slow = Math.max(0, slow - 1);
    if (frameNo++ % 3 === 0) renderer.shadowMap.needsUpdate = true;
    lastNow = now;

    const time = opts.reduced ? 0 : clock.getElapsedTime();
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    mouse.hover += (mouse.thover - mouse.hover) * 0.05;
    const u = Math.min(1, Math.max(0, f.t / END));

    // Camera on its rail, plus cursor parallax and a breathing drift.
    posCurve.getPoint(u, tmpP);
    tgtCurve.getPoint(u, tmpT);
    const breathe = opts.reduced ? 0 : Math.sin(time * 0.35) * 0.12;
    tmpP.x += mouse.x * 0.9 + breathe;
    tmpP.y += mouse.y * 0.55 + Math.cos(time * 0.3) * 0.06;
    camera.position.copy(tmpP);
    camera.lookAt(tmpT);
    camera.zoom = f.zoom;
    // Keep the cup centred in whatever area the slide-in card leaves free.
    if (Math.abs(f.shiftX) > 0.5 || Math.abs(f.shiftY) > 0.5) camera.setViewOffset(W, H, -f.shiftX, -f.shiftY, W, H);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();

    // Drink morph keyed to the shots: latte at 10 s, chocolate at 15 s, Irish at 20 s.
    const drink = smooth(11.2, 14, f.t) + smooth(16.2, 19, f.t);
    liquidMat.uniforms.uDrink.value = drink;
    liquidMat.uniforms.uTime.value = time;
    const irish = smooth(16.2, 19, f.t);
    cream.scale.set(Math.max(0.001, irish), Math.max(0.001, irish), Math.max(0.001, irish));

    // The cup turns slowly and leans toward the cursor.
    set.rotation.y = -0.5 + (opts.reduced ? 0 : time * 0.05) + mouse.x * 0.18;
    set.rotation.x = -mouse.y * 0.04;

    // Steam: thins out from above (it would fog the latte art) and bends with the cursor and scroll speed.
    const topDown = smooth(4, 8, f.t) * (1 - smooth(11.5, 14, f.t));
    steams.forEach((s, i) => {
      s.quaternion.copy(camera.quaternion);
      e.setFromQuaternion(s.quaternion, 'YXZ');
      s.rotation.set(0, e.y - set.rotation.y, 0);
      s.material.uniforms.uTime.value = time + i * 3.1;
      s.material.uniforms.uWind.value.set(mouse.x * 0.5 + Math.min(1.2, f.vel * 0.06), mouse.y * 0.2);
      s.material.uniforms.uOpacity.value = (0.5 - i * 0.08) * (1 - 0.85 * topDown) * (1 - f.dim * 0.6);
    });

    // Beans: slow orbit; scrolling fast spreads them out like a pour.
    const spread = 1 + Math.min(0.6, f.vel * 0.03);
    seeds.forEach((b, i) => {
      const a = b.a + time * b.sp + f.t * 0.06;
      const r = b.r * spread;
      sv.set(Math.cos(a) * r, b.y + Math.sin(time * 0.7 + b.bob) * 0.18 + mouse.y * 0.25, Math.sin(a) * r);
      e.set(b.rx + time * 0.4 * Math.sign(b.sp), b.ry + time * 0.3, 0);
      q.setFromEuler(e);
      pv.setScalar(b.s);
      m4.compose(sv, q, pv);
      beans.setMatrixAt(i, m4);
    });
    beans.instanceMatrix.needsUpdate = true;

    // Title: full in the hero, gone once the camera cranes over the cup.
    titleMat.uniforms.uTime.value = time;
    (dome.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    titleMat.uniforms.uHover.value = mouse.hover;
    titleMat.uniforms.uOpacity.value = (1 - smooth(2.2, 5.5, f.t)) * (1 - f.dim) + smooth(19.2, 20, f.t) * 0;
    title.visible = titleMat.uniforms.uOpacity.value > 0.003;

    glow.intensity = 6 + Math.sin(time * 1.3) * 0.6;
    renderer.toneMappingExposure = 1.0 * (1 - f.dim * 0.55);
    renderer.render(scene, camera);
    (window as unknown as {__frames: number}).__frames = ((window as unknown as {__frames?: number}).__frames ?? 0) + 1;
    if (first) {
      first = false;
      opts.onProgress(1);
    }
  }

  /** Screen position (px, canvas space) of a point on the cup, for DOM annotations. */
  const anchor = new THREE.Vector3();
  function project(local: [number, number, number]) {
    anchor.set(...local);
    cup.localToWorld(anchor);
    anchor.project(camera);
    return {x: (anchor.x * 0.5 + 0.5) * W, y: (-anchor.y * 0.5 + 0.5) * H, z: anchor.z};
  }

  return {
    render,
    project,
    dispose() {
      window.removeEventListener('pointermove', onMove);
      ro.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      [marbleTex, glazeMap, titleMat.uniforms.uMap.value as THREE.Texture, env].forEach((t) => t.dispose());
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
