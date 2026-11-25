/**
 * Commande: the host behind the bar, close up, in the shared studio. A back
 * shelf of lathe bottles catches the rim light; the avatar's mouth is driven
 * by the agent's audio level (setMouth) and she watches the cursor.
 */
import * as THREE from 'three';
import {disposeScene, lathe, makeRenderer, makeStudio, marbleTexture} from './kit';
import {loadHost, type Host} from './host';

export function createHostStage(canvas: HTMLCanvasElement, opts: {reduced: boolean; vrm?: boolean; onHost?: (h: Host) => void}) {
  const renderer = makeRenderer(canvas);
  const {scene, tick, dispose: disposeStudio} = makeStudio(renderer, {glowDir: [-0.3, 0.2, -1]});
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 120);

  const marble = marbleTexture();
  const top = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 2.4), new THREE.MeshPhysicalMaterial({map: marble, roughness: 0.25, clearcoat: 1, envMapIntensity: 0.6}));
  top.position.set(0, 1.72, 1.2);
  top.receiveShadow = true;
  const front = new THREE.Mesh(new THREE.BoxGeometry(12, 1.6, 0.2), new THREE.MeshPhysicalMaterial({color: '#2a1009', roughness: 0.4, clearcoat: 0.6, envMapIntensity: 0.25}));
  front.position.set(0, 0.8, 2.35);
  scene.add(top, front);
  // back shelf with bottles
  const shelfMat = new THREE.MeshPhysicalMaterial({color: '#3b2216', roughness: 0.45, clearcoat: 0.6});
  const colors = ['#2f6b3a', '#7a2e12', '#d9a650', '#1b3f5e', '#a8321e', '#e8d9b0', '#4a1a3a'];
  [3.4, 4.9].forEach((y, row) => {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(10, 0.08, 0.7), shelfMat);
    shelf.position.set(0, y, -2.2);
    scene.add(shelf);
    for (let i = 0; i < 12; i++) {
      const x = -4.5 + i * 0.82 + (row ? 0.4 : 0);
      const h = 0.7 + ((i * 7 + row * 3) % 5) * 0.08;
      const g = lathe([[0, 0], [0.16, 0], [0.17, h * 0.6], [0.06, h * 0.8], [0.05, h], [0, h]], 32);
      const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({color: colors[(i + row * 2) % colors.length], roughness: 0.08, transmission: 0.35, thickness: 0.3, clearcoat: 1}));
      m.position.set(x, y + 0.04, -2.2);
      scene.add(m);
    }
  });
  const lamp = new THREE.PointLight('#ffcf94', 18, 10, 2);
  lamp.position.set(1.5, 6, 2);
  scene.add(lamp);

  let host: Host | null = null;
  if (opts.vrm) loadHost('/models/host.vrm').then((h) => {
    host = h;
    h.object.position.set(0, 0, 0);
    h.object.scale.setScalar(1.85);
    scene.add(h.object);
    opts.onHost?.(h);
  });

  let W = 1;
  let H = 1;
  const resize = () => {
    W = canvas.clientWidth || 1;
    H = canvas.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
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
  const v = new THREE.Vector3();
  const lp = new THREE.Vector3();

  function render() {
    const dt = Math.min(0.05, clock.getDelta());
    const time = opts.reduced ? 0 : clock.elapsedTime;
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    camera.position.set(mouse.x * 0.35, 2.85 + mouse.y * 0.15, 7.8);
    camera.lookAt(0, 2.45, 0);
    if (host) {
      v.set(mouse.x, mouse.y, 0.5).unproject(camera).sub(camera.position).normalize();
      lp.copy(camera.position).addScaledVector(v, 6);
      host.lookAt(lp);
      host.update(dt, time);
    }
    tick(time);
    renderer.render(scene, camera);
  }

  return {
    render,
    get host() {
      return host;
    },
    dispose() {
      window.removeEventListener('pointermove', onMove);
      ro.disconnect();
      host?.dispose();
      marble.dispose();
      disposeScene(scene);
      disposeStudio();
      renderer.dispose();
    },
  };
}
