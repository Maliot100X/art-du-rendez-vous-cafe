/**
 * Signatures: four modelled drinks lined up on a green-marble bar, lit like the
 * hero. The section's scroll progress dollies the camera from one drink to the
 * next (with a hold on each), the cursor adds parallax, and each drink exposes
 * a 3D anchor that the DOM price label is pinned to every frame.
 *
 *   01 Cappuccino Chantilly — porcelain cup + saucer, piped whipped-cream swirl, cocoa
 *   02 Aperol Spritz — balloon glass, orange spritz, ice, orange wheel, bubbles
 *   03 Orval — the skittle bottle with its label + the chalice with amber beer and a foam head
 *   04 Kir Royal — tall flute, cassis-to-champagne gradient, rising bubbles
 */
import * as THREE from 'three';
import {glassMaterial, glassShell, lathe, makeRenderer, makeStudio, marbleTexture, disposeScene} from './kit';

export const STATIONS = [-7.5, -2.5, 2.5, 7.5];

const bubbleVert = `
uniform float uTime; attribute float aSeed; varying float vA;
uniform float uTop; uniform float uR;
void main(){
  float t = fract(aSeed*7.13 + uTime*(0.12 + fract(aSeed*3.1)*0.18));
  vec3 p = position;
  p.y = mix(position.y, uTop, t);
  p.x += sin(t*12.0 + aSeed*40.0)*0.02;
  vA = smoothstep(0.0,0.1,t)*(1.0-smoothstep(0.85,1.0,t));
  vec4 mv = modelViewMatrix * vec4(p,1.0);
  gl_PointSize = (2.0 + fract(aSeed*11.0)*3.0) * (8.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const bubbleFrag = `varying float vA; void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c); if(d>0.5) discard; float ring = smoothstep(0.5,0.35,d) - smoothstep(0.3,0.0,d)*0.6; gl_FragColor = vec4(vec3(1.0,0.97,0.9), ring*vA*0.9); }`;

function bubbles(count: number, radius: number, bottom: number, top: number) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    pos.set([Math.cos(a) * r, bottom, Math.sin(a) * r], i * 3);
    seed[i] = Math.random();
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    vertexShader: bubbleVert,
    fragmentShader: bubbleFrag,
    transparent: true,
    depthWrite: false,
    uniforms: {uTime: {value: 0}, uTop: {value: top}, uR: {value: radius}},
  });
  return new THREE.Points(g, m);
}

function labelTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#efe6d2';
  g.fillRect(0, 0, 1024, 256);
  g.fillStyle = '#1f3d78';
  g.fillRect(0, 18, 1024, 6);
  g.fillRect(0, 232, 1024, 6);
  g.textAlign = 'center';
  g.fillStyle = '#b3242a';
  g.font = '700 110px Georgia, serif';
  g.fillText('ORVAL', 512, 150);
  g.fillStyle = '#1f3d78';
  g.font = '400 30px Georgia, serif';
  g.fillText('BIÈRE TRAPPISTE · ABBAYE D’ORVAL', 512, 205);
  // the trout with the ring
  g.strokeStyle = '#1f3d78';
  g.lineWidth = 5;
  g.beginPath();
  g.ellipse(170, 128, 70, 26, 0, 0, Math.PI * 2);
  g.ellipse(854, 128, 70, 26, 0, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.x = 1;
  return t;
}

function orangeWheel() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6a33a';
  g.beginPath();
  g.arc(256, 256, 250, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff1d6';
  g.beginPath();
  g.arc(256, 256, 226, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * Math.PI * 2 + 0.04;
    const a1 = ((i + 1) / 10) * Math.PI * 2 - 0.04;
    const grd = g.createRadialGradient(256, 256, 20, 256, 256, 215);
    grd.addColorStop(0, '#ffb347');
    grd.addColorStop(1, '#f07b12');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(256 + Math.cos((a0 + a1) / 2) * 18, 256 + Math.sin((a0 + a1) / 2) * 18);
    g.arc(256, 256, 212, a0, a1);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createSignaturesScene(canvas: HTMLCanvasElement, opts: {reduced: boolean}) {
  const renderer = makeRenderer(canvas);
  renderer.shadowMap.autoUpdate = false;
  const {scene, tick: tickStudio, look, dispose: disposeStudio} = makeStudio(renderer, {glowDir: [0, 0.1, -1]});
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 140);

  // The bar: one long slab of the same green marble, brass nosing.
  const marble = marbleTexture();
  marble.wrapS = marble.wrapT = THREE.RepeatWrapping;
  marble.repeat.set(3, 0.6);
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(34, 0.5, 6),
    new THREE.MeshPhysicalMaterial({map: marble, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 0.3}),
  );
  bar.position.set(0, -0.25, 0);
  bar.receiveShadow = true;
  scene.add(bar);
  const brass = new THREE.MeshPhysicalMaterial({color: '#c9973f', metalness: 1, roughness: 0.25});
  const nosing = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 34, 16), brass);
  nosing.rotation.z = Math.PI / 2;
  nosing.position.set(0, -0.02, 3.0);
  scene.add(nosing);
  // back-bar: a dark wood panel with a brass rail and soft gold sconce glows
  const wood = new THREE.MeshPhysicalMaterial({color: new THREE.Color(look.bottom).lerp(new THREE.Color('#1a120d'), 0.35), roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15});
  const back = new THREE.Mesh(new THREE.BoxGeometry(40, 9, 0.4), wood);
  back.position.set(0, 4, -5.5);
  back.receiveShadow = true;
  scene.add(back);
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 40, 12), brass);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, 3.2, -5.2);
  scene.add(rail);
  STATIONS.forEach((x) => {
    const l = new THREE.PointLight('#ffb763', 3.5, 7, 2);
    l.position.set(x, 4.2, -3.6);
    scene.add(l);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), new THREE.MeshBasicMaterial({color: '#ffd9a0'}));
    bulb.position.set(x, 4.6, -5.2);
    scene.add(bulb);
  });

  const glass = glassMaterial();
  const porcelain = new THREE.MeshPhysicalMaterial({color: '#efe2c6', roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.8, side: THREE.DoubleSide});
  const gold = new THREE.MeshPhysicalMaterial({color: '#d9a650', metalness: 1, roughness: 0.2});
  const timed: THREE.ShaderMaterial[] = [];
  const groups: THREE.Group[] = [];
  const shadow = (o: THREE.Object3D) => o.traverse((m) => ((m as THREE.Mesh).castShadow = true));

  // ---- 01 Cappuccino Chantilly
  {
    const g = new THREE.Group();
    const saucer = new THREE.Mesh(lathe([[0, 0.02], [0.75, 0], [0.8, 0.06], [1.45, 0.12], [1.62, 0.24], [1.6, 0.27], [1.5, 0.24], [1.2, 0.15], [0, 0.14]], 128), porcelain);
    const cup = new THREE.Mesh(
      glassShell([[0, 0], [0.42, 0], [0.47, 0.06], [0.62, 0.16], [0.86, 0.4], [0.98, 0.75], [1.03, 1.05], [1.05, 1.22]], 0.06, 0.18, 128),
      porcelain,
    );
    cup.position.y = 0.14;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.03, 0.02, 10, 160), gold);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 1.37;
    const handle = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CubicBezierCurve3(new THREE.Vector3(0.98, 1.05, 0), new THREE.Vector3(1.7, 1.15, 0), new THREE.Vector3(1.66, 0.4, 0), new THREE.Vector3(0.82, 0.48, 0)), 60, 0.09, 14),
      porcelain,
    );
    handle.position.y = 0.0;
    // piped cream: a soft-serve lathe whose radius ripples with the angle → star-nozzle ridges
    const creamG = new THREE.LatheGeometry(
      Array.from({length: 40}, (_, i) => {
        const t = i / 39;
        const r = 0.98 * Math.pow(1 - t, 0.9) * (1 - 0.15 * Math.sin(t * Math.PI * 4) ** 2) + 0.001;
        return new THREE.Vector2(r, t * 1.05);
      }),
      160,
    );
    const p = creamG.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const a = Math.atan2(v.z, v.x);
      const k = 1 + 0.08 * Math.sin(a * 8 + v.y * 14);
      p.setXYZ(i, v.x * k, v.y, v.z * k);
    }
    creamG.computeVertexNormals();
    const cocoa = new THREE.CanvasTexture(
      (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const x = c.getContext('2d')!;
        x.fillStyle = '#f3e8d4';
        x.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 900; i++) {
          x.fillStyle = `rgba(${90 + Math.random() * 40},${50 + Math.random() * 20},30,${0.4 + Math.random() * 0.5})`;
          x.fillRect(Math.random() * 256, Math.random() * 90, 2, 2);
        }
        return c;
      })(),
    );
    cocoa.colorSpace = THREE.SRGBColorSpace;
    const cream = new THREE.Mesh(creamG, new THREE.MeshPhysicalMaterial({map: cocoa, roughness: 0.6, sheen: 1, sheenColor: new THREE.Color('#fff7e8')}));
    cream.position.y = 1.28;
    g.add(saucer, cup, lip, handle, cream);
    g.rotation.y = -0.6;
    groups.push(g);
  }

  // ---- 02 Aperol Spritz
  {
    const g = new THREE.Group();
    const outer: [number, number][] = [[0, 0], [0.8, 0], [0.82, 0.04], [0.12, 0.1], [0.07, 0.25], [0.06, 1.3], [0.2, 1.45], [0.7, 1.8], [1.0, 2.3], [1.05, 2.8], [0.98, 3.3], [0.9, 3.6]];
    const shell = new THREE.Mesh(glassShell(outer, 0.03, 1.45, 128), glass);
    shell.renderOrder = 3;
    const liquidProfile: [number, number][] = [[0, 1.47], [0.2, 1.48], [0.66, 1.82], [0.96, 2.3], [1.01, 2.8], [0, 2.8]];
    const liquid = new THREE.Mesh(
      lathe(liquidProfile, 128),
      new THREE.MeshPhysicalMaterial({color: '#ff4a00', roughness: 0.08, transparent: true, opacity: 0.96, clearcoat: 1, emissive: '#7a1d00', emissiveIntensity: 0.35, envMapIntensity: 1.2}),
    );
    liquid.renderOrder = 2;
    const iceMat = new THREE.MeshPhysicalMaterial({color: '#fff6ee', roughness: 0.15, transparent: true, opacity: 0.45, clearcoat: 1, envMapIntensity: 1.5});
    for (let i = 0; i < 4; i++) {
      const ice = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42, 2, 2, 2), iceMat);
      ice.position.set(Math.cos(i * 1.7) * 0.42, 2.45 + (i % 2) * 0.25, Math.sin(i * 1.7) * 0.42);
      ice.rotation.set(i, i * 0.7, i * 0.3);
      ice.renderOrder = 2;
      g.add(ice);
    }
    const wheelTex = orangeWheel();
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.07, 48), [
      new THREE.MeshStandardMaterial({color: '#f08a1c', roughness: 0.5}),
      new THREE.MeshStandardMaterial({map: wheelTex, roughness: 0.45}),
      new THREE.MeshStandardMaterial({map: wheelTex, roughness: 0.45}),
    ]);
    wheel.rotation.set(Math.PI / 2, 0, 0.35);
    wheel.position.set(0.15, 2.75, 0.3);
    const fizz = bubbles(120, 0.75, 1.6, 2.78);
    timed.push(fizz.material as THREE.ShaderMaterial);
    g.add(liquid, wheel, fizz, shell);
    groups.push(g);
  }

  // ---- 03 Orval: bottle + chalice
  {
    const g = new THREE.Group();
    const bottleProfile: [number, number][] = [[0, 0], [0.5, 0], [0.56, 0.06], [0.6, 0.4], [0.62, 1.0], [0.58, 1.45], [0.42, 1.9], [0.27, 2.35], [0.21, 2.8], [0.22, 3.05], [0.2, 3.1]];
    const bottle = new THREE.Mesh(
      lathe(bottleProfile, 96),
      new THREE.MeshPhysicalMaterial({color: '#3a2a12', roughness: 0.12, clearcoat: 1, metalness: 0, transparent: true, opacity: 0.94, envMapIntensity: 1.4}),
    );
    const label = new THREE.Mesh(
      new THREE.CylinderGeometry(0.625, 0.632, 0.55, 96, 1, true),
      new THREE.MeshStandardMaterial({map: labelTexture(), roughness: 0.7}),
    );
    label.position.y = 0.85;
    label.rotation.y = -Math.PI / 2;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.12, 32), new THREE.MeshPhysicalMaterial({color: '#e5e2da', metalness: 0.8, roughness: 0.3}));
    cap.position.y = 3.12;
    bottle.position.x = label.position.x = cap.position.x = -0.9;
    bottle.position.z = label.position.z = cap.position.z = -0.6;
    const chalOuter: [number, number][] = [[0, 0], [0.62, 0], [0.64, 0.04], [0.1, 0.1], [0.08, 0.7], [0.3, 0.85], [0.9, 1.05], [1.12, 1.4], [1.15, 1.85], [1.12, 2.1]];
    const chalice = new THREE.Mesh(glassShell(chalOuter, 0.03, 0.88, 128), glass);
    chalice.renderOrder = 3;
    const beer = new THREE.Mesh(
      lathe([[0, 0.9], [0.3, 0.9], [0.88, 1.08], [1.09, 1.4], [1.11, 1.72], [0, 1.72]], 128),
      new THREE.MeshPhysicalMaterial({color: '#b8600f', roughness: 0.1, transparent: true, opacity: 0.97, emissive: '#5a2a00', emissiveIntensity: 0.4, clearcoat: 1}),
    );
    beer.renderOrder = 2;
    const foam = new THREE.Mesh(
      lathe([[0, 1.71], [1.11, 1.71], [1.13, 1.85], [1.08, 2.02], [0.7, 2.12], [0, 2.14]], 128),
      new THREE.MeshPhysicalMaterial({color: '#f6ecd8', roughness: 0.85, sheen: 1, sheenColor: new THREE.Color('#ffffff')}),
    );
    const fizz = bubbles(90, 0.8, 1.0, 1.7);
    timed.push(fizz.material as THREE.ShaderMaterial);
    const ch = new THREE.Group();
    ch.add(beer, foam, fizz, chalice);
    ch.position.set(0.55, 0, 0.35);
    g.add(bottle, label, cap, ch);
    groups.push(g);
  }

  // ---- 04 Kir Royal
  {
    const g = new THREE.Group();
    const flute: [number, number][] = [[0, 0], [0.62, 0], [0.64, 0.04], [0.09, 0.1], [0.05, 1.5], [0.18, 1.62], [0.42, 2.1], [0.5, 2.9], [0.52, 3.6], [0.5, 3.95]];
    const shell = new THREE.Mesh(glassShell(flute, 0.025, 1.62, 128), glass);
    shell.renderOrder = 3;
    const wineGeo = lathe([[0, 1.64], [0.16, 1.65], [0.4, 2.1], [0.48, 2.9], [0.5, 3.45], [0, 3.45]], 128);
    const wine = new THREE.Mesh(
      wineGeo,
      new THREE.ShaderMaterial({
        transparent: true,
        uniforms: {},
        vertexShader: `varying float vY; varying vec3 vN; varying vec3 vW; void main(){ vY = position.y; vN = normalize(normalMatrix*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
        fragmentShader: `varying float vY; varying vec3 vN; varying vec3 vW;
          void main(){ float t = smoothstep(1.7, 3.4, vY);
            vec3 c = mix(vec3(0.42,0.02,0.09), vec3(0.98,0.62,0.55), t);
            float rim = pow(1.0 - abs(vN.z), 2.0);
            c += rim*0.25;
            gl_FragColor = vec4(c, 0.82);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    wine.renderOrder = 2;
    const fizz = bubbles(140, 0.35, 1.75, 3.42);
    timed.push(fizz.material as THREE.ShaderMaterial);
    g.add(wine, fizz, shell);
    groups.push(g);
  }

  groups.forEach((g, i) => {
    g.position.set(STATIONS[i], 0, 0.4);
    shadow(g);
    scene.add(g);
  });

  /* ------------------------------------------------------------ interaction */
  const mouse = {x: 0, y: 0, tx: 0, ty: 0};
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom) return;
    mouse.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.ty = -(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  window.addEventListener('pointermove', onMove, {passive: true});

  let W = 1;
  let H = 1;
  const resize = () => {
    W = canvas.clientWidth || 1;
    H = canvas.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.fov = W / H < 0.8 ? 48 : 30;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const clock = new THREE.Clock();
  const at = new THREE.Vector3();
  let frame = 0;
  let first = true;

  /** s: station position 0..3 (fractional while travelling). */
  function render(s: number) {
    const time = opts.reduced ? 0 : clock.getElapsedTime();
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    const x = THREE.MathUtils.lerp(STATIONS[0], STATIONS[3], s / 3);
    const travel = Math.sin(Math.PI * (s % 1)); // 0 at each drink, 1 mid-way
    const portrait = W / H < 0.8;
    const dist = portrait ? 15 : 11.5;
    const orbit = -0.32 + Math.sin(s * 1.3) * 0.18 + mouse.x * 0.16;
    camera.position.set(x + Math.sin(orbit) * dist, 3.4 + travel * 1.4 + mouse.y * 0.5, Math.cos(orbit) * dist);
    at.set(x, 1.7 + travel * 0.3, 0.2);
    camera.lookAt(at);
    tickStudio(time);
    groups.forEach((g, i) => {
      const near = Math.max(0, 1 - Math.abs(s - i));
      g.rotation.y = (i === 0 ? -0.6 : 0) + (opts.reduced ? 0 : Math.sin(time * 0.4 + i) * 0.12) + near * mouse.x * 0.3;
    });
    timed.forEach((m) => (m.uniforms.uTime.value = time));
    if (frame++ % 4 === 0) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    (window as unknown as {__sigFrames: number}).__sigFrames = frame;
    if (first) first = false;
  }

  const v = new THREE.Vector3();
  const ANCHOR_Y = [2.2, 2.6, 2.3, 2.8];
  function project(i: number) {
    v.set(STATIONS[i] + 1.2, ANCHOR_Y[i], 0.4).project(camera);
    return {x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, z: v.z};
  }

  return {
    render,
    project,
    dispose() {
      window.removeEventListener('pointermove', onMove);
      ro.disconnect();
      disposeScene(scene);
      disposeStudio();
      marble.dispose();
      renderer.dispose();
    },
  };
}
