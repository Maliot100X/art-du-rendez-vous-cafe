// TEMP verification only (delete after use): run the REAL VRM load +
// rest-pose + posed-bounds + camera-framing path from VrmModel.tsx in
// Node, with a stubbed Image (no WebGL needed for loader + math).
// This validates the actual numbers the component will frame from.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import fs from 'node:fs';

// ---- DOM stubs for three's ImageLoader ----
class FakeImage {
  constructor() { this._src = ''; this.onload = null; this.onerror = null; this.width = 1; this.height = 1; this.complete = false; }
  set src(v) { this._src = v; this.complete = true; setTimeout(() => this.onload && this.onload(), 0); }
  get src() { return this._src; }
}
globalThis.Image = FakeImage;
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = {
  createElementNS: () => new FakeImage(),
  createElement: () => ({ getContext: () => null, style: {} }),
};

function rotateBoneWorld(bone, axis, angle) {
  const parentQ = new THREE.Quaternion();
  bone.parent?.getWorldQuaternion(parentQ);
  const qWorld = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  const delta = parentQ.clone().invert().multiply(qWorld).multiply(parentQ);
  bone.quaternion.premultiply(delta);
}

const buf = fs.readFileSync(new URL('./public/vrm/vita.vrm', import.meta.url));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
const gltf = await loader.parseAsync(ab, './');
const vrm = gltf.userData.vrm;
console.log('VRM loaded:', !!vrm, '| version:', vrm.meta?.metaVersion, '| name:', vrm.meta?.name);

VRMUtils.removeUnnecessaryVertices(vrm.scene);
VRMUtils.combineSkeletons(vrm.scene);
vrm.scene.traverse((o) => { o.frustumCulled = false; });
const group = new THREE.Group();
group.add(vrm.scene);

// Face +Z (same as component).
try {
  const faceFront = vrm.lookAt?.faceFront;
  console.log('lookAt faceFront:', faceFront ? faceFront.toArray().map((v) => v.toFixed(2)) : 'none');
  if (faceFront) {
    const q = new THREE.Quaternion().setFromUnitVectors(faceFront.clone().normalize(), new THREE.Vector3(0, 0, 1));
    group.quaternion.premultiply(q);
  }
} catch (e) { console.log('lookAt error', e.message); }
vrm.springBoneManager?.reset();
group.updateMatrixWorld(true);

function posedBounds() {
  const box = new THREE.Box3();
  const childBox = new THREE.Box3();
  vrm.scene.traverse((obj) => {
    if (obj.name.startsWith('VRMC_springBone_collider')) return;
    const mesh = obj;
    if (mesh.isSkinnedMesh) {
      mesh.skeleton?.update();
      mesh.computeBoundingBox();
      if (mesh.boundingBox) { childBox.copy(mesh.boundingBox).applyMatrix4(obj.matrixWorld); box.union(childBox); }
      return;
    }
    if (mesh.isMesh && mesh.geometry) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) { childBox.copy(mesh.geometry.boundingBox).applyMatrix4(obj.matrixWorld); box.union(childBox); }
    }
  });
  return box;
}
function armDir(side) {
  const upper = vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`);
  const lower = vrm.humanoid.getNormalizedBoneNode(`${side}LowerArm`);
  group.updateMatrixWorld(true);
  const s = upper.getWorldPosition(new THREE.Vector3());
  const e = lower.getWorldPosition(new THREE.Vector3());
  return { shoulder: s, dir: e.clone().sub(s).normalize(), elbowY: e.y };
}
console.log('BEFORE pose: box', posedBounds().min.toArray().map((v) => v.toFixed(2)), posedBounds().max.toArray().map((v) => v.toFixed(2)));
for (const side of ['left', 'right']) {
  const a = armDir(side);
  console.log(`${side} arm dir before: [${a.dir.toArray().map((v) => v.toFixed(2))}] elbowY=${a.elbowY.toFixed(2)}`);
}

// ---- Rest pose (verbatim from VrmModel.tsx) ----
try {
  const humanoid = vrm.humanoid;
  const faceDir = new THREE.Vector3(0, 0, 1);
  for (const side of ['left', 'right']) {
    const upper = humanoid.getNormalizedBoneNode(`${side}UpperArm`);
    const lower = humanoid.getNormalizedBoneNode(`${side}LowerArm`);
    if (!upper || !lower) continue;
    group.updateMatrixWorld(true);
    const shoulder = upper.getWorldPosition(new THREE.Vector3());
    const elbow = lower.getWorldPosition(new THREE.Vector3());
    const dir = elbow.clone().sub(shoulder).normalize();
    const out = dir.clone();
    out.y = 0;
    if (out.lengthSq() > 1e-6) out.normalize();
    const target = new THREE.Vector3().addScaledVector(out, 0.22).add(new THREE.Vector3(0, -1, 0)).normalize();
    const axis = new THREE.Vector3().crossVectors(dir, target);
    if (axis.lengthSq() > 1e-6) {
      axis.normalize();
      const angle = Math.acos(THREE.MathUtils.clamp(dir.dot(target), -1, 1));
      rotateBoneWorld(upper, axis, angle);
    }
    group.updateMatrixWorld(true);
    const armDir2 = lower.getWorldPosition(new THREE.Vector3()).sub(upper.getWorldPosition(new THREE.Vector3())).normalize();
    const bendAxis = new THREE.Vector3().crossVectors(armDir2, faceDir);
    if (bendAxis.lengthSq() > 1e-6) { bendAxis.normalize(); rotateBoneWorld(lower, bendAxis, 0.22); }
  }
} catch (e) { console.log('pose error', e.message); }
vrm.update(0);
group.updateMatrixWorld(true);
const box = posedBounds();
const size = new THREE.Vector3(); const centre = new THREE.Vector3();
box.getSize(size); box.getCenter(centre);
console.log('AFTER pose: box min', box.min.toArray().map((v) => v.toFixed(3)), 'max', box.max.toArray().map((v) => v.toFixed(3)));
console.log('AFTER pose: size', size.toArray().map((v) => v.toFixed(3)), 'centre', centre.toArray().map((v) => v.toFixed(3)));
for (const side of ['left', 'right']) {
  const a = armDir(side);
  console.log(`${side} arm dir after: [${a.dir.toArray().map((v) => v.toFixed(2))}] elbowY=${a.elbowY.toFixed(2)} (down = [0,-1,0])`);
}
const eyeNode = vrm.humanoid.getNormalizedBoneNode('leftEye');
const eyePos = eyeNode.getWorldPosition(new THREE.Vector3());
console.log('eye world:', eyePos.toArray().map((v) => v.toFixed(3)), '| head bone:', vrm.humanoid.getNormalizedBoneNode('head').getWorldPosition(new THREE.Vector3()).toArray().map((v) => v.toFixed(3)));
// Expressions work?
try { vrm.expressionManager.setValue('aa', 0.5); vrm.expressionManager.setValue('happy', 0.5); vrm.expressionManager.setValue('blink', 1); console.log('expressions aa/happy/blink: OK'); } catch (e) { console.log('expression error:', e.message); }

// ---- Camera framing (verbatim math from VrmModel.tsx layout()) ----
const FOV = 30;
function frame(stageW, stageH, framing) {
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  const aspect = stageW / stageH;
  const halfTan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  let targetY, framedH, framedW;
  if (framing === 'face') { targetY = eyePos.y - 0.1; framedH = 0.62; framedW = 0.55; }
  else { targetY = centre.y; framedH = size.y * 1.03; framedW = size.x * 1.06; }
  const dist = Math.max(framedH / 2 / halfTan, framedW / 2 / (halfTan * aspect));
  camera.aspect = aspect;
  camera.position.set(0, targetY, dist);
  camera.lookAt(0, targetY, 0);
  camera.updateProjectionMatrix();
  const project = (p) => { const v = p.clone().project(camera); return [Math.round(((v.x + 1) / 2) * stageW), Math.round(((1 - (v.y + 1) / 2) * stageH))]; };
  const eyePx = project(eyePos);
  const topPx = project(new THREE.Vector3(0, box.max.y, 0))[1];
  const chinPx = project(new THREE.Vector3(0, eyePos.y - 0.13, 0))[1];
  const feetPx = project(new THREE.Vector3(0, box.min.y, 0))[1];
  const mouthPx = project(new THREE.Vector3(0, eyePos.y - 0.08, 0))[1];
  console.log(`frame ${framing} @ ${stageW}x${stageH}: dist=${dist.toFixed(2)} eye=${eyePx} mouthY=${mouthPx} headTopY=${topPx} chinY=${chinPx} feetY=${feetPx} headH=${chinPx - topPx}px bodyH=${feetPx - topPx}px eyes-to-mouth=${mouthPx - eyePx[1]}px`);
}
frame(358, 520, 'full');
frame(640, 560, 'full');
frame(358, 520, 'face');
frame(640, 560, 'face');

// ---- debug: is the skinning skeleton the same bones I rotated? ----
{
  let checked = 0;
  vrm.scene.traverse((obj) => {
    if (obj.isSkinnedMesh && checked < 3) {
      checked++;
      const sk = obj.skeleton;
      const upper = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
      const inSkeleton = sk.bones.includes(upper);
      console.log(`mesh ${obj.name || '(unnamed)'}: skeleton bones=${sk.bones.length} upperArmInSkeleton=${inSkeleton} boneMatricesLen=${sk.boneMatrices.length}`);
      // hand vertex check: find a vertex strongly weighted to the left hand bone
      const hand = vrm.humanoid.getNormalizedBoneNode('leftHand');
      const handIdx = sk.bones.indexOf(hand);
      const pos = obj.geometry.attributes.position;
      const si = obj.geometry.attributes.skinIndex;
      const sw = obj.geometry.attributes.skinWeight;
      let found = -1;
      for (let i = 0; i < pos.count; i++) {
        for (let k = 0; k < 4; k++) {
          if (si.getComponent(i, k) === handIdx && sw.getComponent(i, k) > 0.5) { found = i; break; }
        }
        if (found >= 0) break;
      }
      if (found >= 0) {
        const v = new THREE.Vector3();
        obj.getVertexPosition(found, v);
        console.log(`  hand vertex #${found} skinned local pos: [${v.toArray().map((x) => x.toFixed(3))}] (bind-pose raw: [${pos.getX(found).toFixed(3)}, ${pos.getY(found).toFixed(3)}, ${pos.getZ(found).toFixed(3)}])`);
      } else console.log('  no hand vertex found, handIdx=', handIdx);
    }
  });
}
