/**
 * The café host: a VRM avatar (VRoid AvatarSample_B, pixiv, commercial use OK)
 * rendered with three-vrm (MIT) inside the book scene, so she shares its light.
 *
 * Bug-proofing, after studying YuriOS / utsuwa / airi / Soul-of-Waifu idles:
 *  - VRM0 models face -Z: VRMUtils.rotateVRM0 turns them to face the camera.
 *  - Only the *normalized* humanoid is posed (rig-independent, no bone-roll
 *    surprises); vrm.update() copies it onto the raw skeleton.
 *  - T-pose fix: arms lowered at the shoulder + upper arm with a small elbow
 *    and wrist bend, angles kept short of the hips so nothing clips.
 *  - Idle = layered low-frequency sines (breath in chest/spine/shoulders,
 *    weight-shift sway in hips, counter-rotation in spine so the head stays
 *    level), randomised blinks with the occasional double blink, eye look-at
 *    on a smoothed target + a damped head turn toward it.
 *  - Lip-sync ready: setMouth(0..1) and setViseme('aa'|'ih'|'ou'|'ee'|'oh').
 *  - MToon materials come from VRMLoaderPlugin as authored.
 */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VRMLoaderPlugin, VRMUtils} from '../vendor/three-vrm.js';

type Viseme = 'aa' | 'ih' | 'ou' | 'ee' | 'oh';
const VISEMES: Viseme[] = ['aa', 'ih', 'ou', 'ee', 'oh'];

export type Host = {
  object: THREE.Object3D;
  update(dt: number, time: number): void;
  lookAt(world: THREE.Vector3): void;
  setMouth(v: number): void;
  setViseme(v: Viseme, w: number): void;
  speak(seconds: number): void;
  wave(): void;
  dispose(): void;
};

export async function loadHost(url: string, onProgress?: (p: number) => void): Promise<Host> {
  const loader = new GLTFLoader();
  loader.register((parser: any) => new VRMLoaderPlugin(parser));
  const gltf: any = await loader.loadAsync(url, (e: ProgressEvent) => e.total && onProgress?.(e.loaded / e.total));
  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o: any) => {
    o.frustumCulled = false;
    if (o.isMesh) o.castShadow = true;
  });

  const H = vrm.humanoid;
  const bone = (n: string) => H.getNormalizedBoneNode(n) as THREE.Object3D | null;
  const B = {
    hips: bone('hips'),
    spine: bone('spine'),
    chest: bone('chest'),
    upperChest: bone('upperChest'),
    neck: bone('neck'),
    head: bone('head'),
    lSh: bone('leftShoulder'),
    rSh: bone('rightShoulder'),
    lUA: bone('leftUpperArm'),
    rUA: bone('rightUpperArm'),
    lLA: bone('leftLowerArm'),
    rLA: bone('rightLowerArm'),
    lH: bone('leftHand'),
    rH: bone('rightHand'),
  };
  // finger curl so hands don't sit flat like a mannequin
  const fingers = ['Index', 'Middle', 'Ring', 'Little'].flatMap((f) =>
    ['Proximal', 'Intermediate', 'Distal'].flatMap((seg) => [bone(`left${f}${seg}`), bone(`right${f}${seg}`)]),
  );

  // Look-at target the eyes track
  const target = new THREE.Object3D();
  vrm.scene.add(target);
  target.position.set(0, 1.4, 2);
  if (vrm.lookAt) vrm.lookAt.target = target;
  const want = new THREE.Vector3(0, 1.4, 2);
  const local = new THREE.Vector3();

  const em = vrm.expressionManager;
  const has = (n: string) => !!em?.getExpression(n);
  let nextBlink = 1.5;
  let blinkT = -1;
  let doubleBlink = false;
  let mouth = 0;
  let mouthTarget = 0;
  let speakUntil = 0;
  let viseme: Viseme = 'aa';
  let waveT = -1;
  let clock = 0;

  const poseRest = (time: number) => {
    const br = Math.sin(time * 1.6) * 0.5 + 0.5; // ~15 breaths/min
    const sway = Math.sin(time * 0.45);
    const sway2 = Math.sin(time * 0.31 + 1.3);
    // T-pose fix: arms down along the body, slight elbow bend, never into the hips
    if (B.lUA) B.lUA.rotation.set(0.08, 0, -1.22 + br * 0.025);
    if (B.rUA) B.rUA.rotation.set(0.08, 0, 1.22 - br * 0.025);
    if (B.lLA) B.lLA.rotation.set(0, -0.32, -0.08);
    if (B.rLA) B.rLA.rotation.set(0, 0.32, 0.08);
    if (B.lH) B.lH.rotation.set(0, 0, -0.08);
    if (B.rH) B.rH.rotation.set(0, 0, 0.08);
    if (B.lSh) B.lSh.rotation.set(0, 0, -br * 0.03);
    if (B.rSh) B.rSh.rotation.set(0, 0, br * 0.03);
    fingers.forEach((f, i) => f && f.rotation.set(0, 0, (i % 2 ? -1 : 1) * 0.18));
    // breathing + weight shift with counter-rotation so the head stays level
    if (B.hips) {
      B.hips.rotation.set(0, sway2 * 0.03, sway * 0.025);
      B.hips.position.x = sway * 0.012;
    }
    if (B.spine) B.spine.rotation.set(-br * 0.02, -sway2 * 0.015, -sway * 0.02);
    if (B.chest) B.chest.rotation.set(-br * 0.025, 0, -sway * 0.006);
    if (B.upperChest) B.upperChest.rotation.set(-br * 0.012, 0, 0);
  };

  const host: Host = {
    object: vrm.scene,
    update(dt, time) {
      clock = time;
      poseRest(time);

      // wave hello: right arm up, forearm swings
      if (waveT >= 0) {
        waveT += dt;
        const k = Math.min(1, waveT / 0.4) * Math.min(1, Math.max(0, (2.4 - waveT) / 0.4));
        if (B.rUA) B.rUA.rotation.set(0.08, 0, THREE.MathUtils.lerp(1.22, -0.25, k));
        if (B.rLA) B.rLA.rotation.set(0, THREE.MathUtils.lerp(0.32, 0.2, k), THREE.MathUtils.lerp(0.08, -1.6 + Math.sin(waveT * 9) * 0.35, k));
        if (waveT > 2.4) waveT = -1;
      }

      // eyes + damped head follow
      const lerp = 1 - Math.exp(-dt * 5);
      target.position.lerp(want, lerp);
      local.copy(target.position);
      const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, Math.max(0.3, local.z)), -0.6, 0.6);
      const pitch = THREE.MathUtils.clamp(Math.atan2(local.y - 1.45, Math.max(0.3, local.z)), -0.4, 0.35);
      if (B.neck) B.neck.rotation.set(-pitch * 0.3, yaw * 0.3, 0);
      if (B.head) B.head.rotation.set(-pitch * 0.35, yaw * 0.4, Math.sin(time * 0.5) * 0.02);

      if (em) {
        // blinks: 2-6 s apart, ~150 ms, sometimes double
        if (blinkT < 0 && time > nextBlink) blinkT = 0;
        let blink = 0;
        if (blinkT >= 0) {
          blinkT += dt;
          blink = Math.sin(Math.min(1, blinkT / 0.16) * Math.PI);
          if (blinkT > 0.16) {
            blinkT = -1;
            if (!doubleBlink && Math.random() < 0.2) {
              doubleBlink = true;
              nextBlink = time + 0.12;
            } else {
              doubleBlink = false;
              nextBlink = time + 2 + Math.random() * 4;
            }
          }
        }
        if (has('blink')) em.setValue('blink', blink);
        // procedural speech when no audio drives the mouth
        if (time < speakUntil) {
          const syll = Math.sin(time * 15) * 0.5 + 0.5;
          mouthTarget = 0.15 + syll * 0.6 * (0.6 + 0.4 * Math.sin(time * 3.3));
          if (Math.random() < dt * 5) viseme = VISEMES[(Math.random() * VISEMES.length) | 0];
        }
        mouth += (mouthTarget - mouth) * (1 - Math.exp(-dt * 18));
        VISEMES.forEach((v) => has(v) && em.setValue(v, v === viseme ? mouth : 0));
        if (has('relaxed')) em.setValue('relaxed', 0.25);
        if (time >= speakUntil) mouthTarget = 0;
      }
      vrm.update(dt);
    },
    lookAt(world) {
      want.copy(world);
      vrm.scene.worldToLocal(want);
    },
    setMouth(v) {
      mouthTarget = THREE.MathUtils.clamp(v, 0, 1);
    },
    setViseme(v, w) {
      viseme = v;
      mouthTarget = w;
    },
    speak(seconds) {
      speakUntil = clock + seconds;
    },
    wave() {
      waveT = 0;
    },
    dispose() {
      VRMUtils.deepDispose(vrm.scene);
    },
  };
  host.update(0.016, 0);
  return host;
}
