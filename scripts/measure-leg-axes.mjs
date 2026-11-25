/**
 * Measure Vita's LEG bones in the normalized rig — the same rig the
 * walk in VrmModel.tsx drives (getNormalizedBoneNode + rotation.x/z).
 *
 * Fix pass 6 hypothesis to verify first: pass 5 proved a plain
 * `rotation.x` on the normalized LOWER ARM is NOT a bend — the
 * normalized lower arm's local X runs nearly along the forearm, so it
 * only twists the hand while the forearm stays pointing down (see the
 * ReadRig comment in VrmModel.tsx). The walk drives the knee the same
 * way (`setX(rig.leftLowerLeg, KNEE_SWING * lift)`, rotation.x 0.6)
 * and the thigh lift the same way. If the leg bones share the arm's
 * axis error, the walk's "knee bend" is a shin twist and the pixel
 * check (08:53-09:00 CET: no frame shows a bent knee or a lifted
 * foot) is explained at the rig level.
 *
 * Method — pure three.js math over the GLB, no browser, no WebGL:
 * 1. Raw GLB world pos/quat in GROUP space (seed groupQuat, as
 *    measure-hand-book.mjs / sim-fix4-book.mjs do).
 * 2. Rebuild three-vrm's NORMALIZED rig exactly as VRMHumanoidRig
 *    _setupTransforms does (three-vrm.module.js: rig bone positions
 *    are raw world positions relative to the parent rig bone per
 *    VRMHumanBoneParentMap, local quaternions IDENTITY at rest).
 * 3. Apply vrmCache.prepare()'s rest pose to the rig ARM nodes only
 *    (arms down + 0.22 elbow bend, world-axis rotations) — the legs
 *    are untouched by prepare, exactly as in the app.
 * 4. For each leg bone (+ the elbow as a control): rest world quat,
 *    bone direction, local X/Y/Z axes in world, angle between local X
 *    and the bone direction (twist test: ~0 deg = rotation.x twists,
 *    ~90 deg = rotation.x is a hinge bend), and the hinge axis
 *    (world + in the bone's local frame).
 * 5. Simulate the runtime writes: set a normalized node's local
 *    Euler (rotation.x / .z / .y), recompute the rig, and report the
 *    resulting shin/thigh direction + foot displacement. This is what
 *    the renderer sees — the normalized->raw transfer premultiplies
 *    the raw bone's world quat by the rig quat (VRMHumanoidRig.update:
 *    rawLocal = P^-1 * rigQ * P * boneRot), so a rig rotation IS a
 *    world-space rotation of the skinned bone.
 *
 * Usage: node scripts/measure-leg-axes.mjs
 */
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const groupQuat = new THREE.Quaternion(0, 1, 0, 0) // measured faceFront, vrmCache.ts
const VRM_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vrm', 'vita.vrm')

const buf = readFileSync(VRM_PATH)
if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB')
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen))
const nodes = json.nodes

// ---- Raw GLB world transforms, group space ---------------------------
const rawParent = new Map()
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => rawParent.set(c, i)))
const rawLocalPos = nodes.map((n) => new THREE.Vector3(...(n.translation ?? [0, 0, 0])))
const rawLocalQuat = nodes.map((n) =>
  n.rotation
    ? new THREE.Quaternion(n.rotation[0], n.rotation[1], n.rotation[2], n.rotation[3])
    : new THREE.Quaternion(),
)
const rawLocalScale = nodes.map((n) => new THREE.Vector3(...(n.scale ?? [1, 1, 1])))
const rawWorldPos = nodes.map(() => new THREE.Vector3())
const rawWorldQuat = nodes.map(() => new THREE.Quaternion())
{
  const walk = (idx, pPos, pQuat, pScale) => {
    const q = pQuat.clone().multiply(rawLocalQuat[idx])
    const s = new THREE.Vector3(pScale.x * rawLocalScale[idx].x, pScale.y * rawLocalScale[idx].y, pScale.z * rawLocalScale[idx].z)
    const p = pPos.clone().add(new THREE.Vector3().copy(rawLocalPos[idx]).multiply(pScale).applyQuaternion(pQuat))
    rawWorldPos[idx].copy(p)
    rawWorldQuat[idx].copy(q)
    ;(nodes[idx].children ?? []).forEach((c) => walk(c, p, q, s))
  }
  json.scenes[0].nodes.forEach((r) => walk(r, new THREE.Vector3(), groupQuat.clone(), new THREE.Vector3(1, 1, 1)))
}

const boneIndex = Object.fromEntries(
  json.extensions.VRM.humanoid.humanBones.map((b) => [b.bone, b.node]),
)

// ---- Normalized rig (VRMHumanoidRig._setupTransforms) -----------------
// Parent map copied verbatim from three-vrm.module.js
// (VRMHumanBoneParentMap); only the bones this script needs are listed.
const PARENT_MAP = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  upperChest: 'chest',
  neck: 'upperChest',
  head: 'neck',
  leftShoulder: 'upperChest',
  leftUpperArm: 'leftShoulder',
  leftLowerArm: 'leftUpperArm',
  leftHand: 'leftLowerArm',
  rightShoulder: 'upperChest',
  rightUpperArm: 'rightShoulder',
  rightLowerArm: 'rightUpperArm',
  rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips',
  leftLowerLeg: 'leftUpperLeg',
  leftFoot: 'leftLowerLeg',
  leftToes: 'leftFoot',
  rightUpperLeg: 'hips',
  rightLowerLeg: 'rightUpperLeg',
  rightFoot: 'rightLowerLeg',
  rightToes: 'rightFoot',
}
const BONES = Object.keys(PARENT_MAP).filter((b) => boneIndex[b] !== undefined)
// Rig parent: walk up the map until a present bone is found (as the
// loader does); hips' parent is the rig root (identity, group space).
function rigParent(bone) {
  let cur = PARENT_MAP[bone]
  while (cur !== null && cur !== undefined && !BONES.includes(cur)) cur = PARENT_MAP[cur]
  return cur ?? null
}
// Rig local pos = raw world pos minus parent rig bone's raw world pos;
// rig local quat = IDENTITY at rest (the loader never sets it).
const rigLocalPos = {}
const rigLocalQuat = {}
for (const b of BONES) {
  const p = rigParent(b)
  rigLocalPos[b] = rawWorldPos[boneIndex[b]].clone()
  if (p) rigLocalPos[b].sub(rawWorldPos[boneIndex[p]])
  rigLocalQuat[b] = new THREE.Quaternion()
}
const rigChildren = {}
for (const b of BONES) {
  const p = rigParent(b)
  if (p) (rigChildren[p] ??= []).push(b)
}
const rigWorldPos = {}
const rigWorldQuat = {}
function computeRigWorld() {
  const walk = (b, pPos, pQuat) => {
    const q = pQuat.clone().multiply(rigLocalQuat[b])
    const p = pPos.clone().add(rigLocalPos[b].clone().applyQuaternion(pQuat))
    rigWorldPos[b] = p
    rigWorldQuat[b] = q
    ;(rigChildren[b] ?? []).forEach((c) => walk(c, p, q))
  }
  // Rig root: identity in group space (its parent chain — vrm.scene,
  // group — contributes nothing once the groupQuat seed is accounted
  // for, exactly as the raw walk above).
  for (const b of BONES) if (!rigParent(b)) walk(b, new THREE.Vector3(), new THREE.Quaternion())
}
computeRigWorld()

// Sanity: rig world positions must equal raw world positions.
let maxPosErr = 0
for (const b of BONES) maxPosErr = Math.max(maxPosErr, rigWorldPos[b].distanceTo(rawWorldPos[boneIndex[b]]))
console.log(`rig check: max |rigWorldPos - rawWorldPos| = ${maxPosErr.toExponential(2)} m (must be ~0)`)

// ---- vrmCache.prepare() rest pose, applied to the RIG arm nodes ------
// Same math as vrmCache.ts rotateBoneWorld + the arm loop, but the
// "world" arrays here are the rig's. Only arms are touched — legs stay
// at their identity rest quats, exactly as in the app.
function rotateRigBoneWorld(bone, axis, angle) {
  const parentQ = rigParent(bone) ? rigWorldQuat[rigParent(bone)] : new THREE.Quaternion()
  const qWorld = new THREE.Quaternion().setFromAxisAngle(axis, angle)
  const delta = parentQ.clone().invert().multiply(qWorld).multiply(parentQ)
  rigLocalQuat[bone].premultiply(delta)
  computeRigWorld()
}
{
  const faceDir = new THREE.Vector3(0, 0, 1)
  for (const side of ['left', 'right']) {
    const upper = `${side}UpperArm`
    const lower = `${side}LowerArm`
    const shoulder = rigWorldPos[upper].clone()
    const elbow = rigWorldPos[lower].clone()
    const dir = elbow.clone().sub(shoulder).normalize()
    const out = dir.clone()
    out.y = 0
    if (out.lengthSq() > 1e-6) out.normalize()
    const target = new THREE.Vector3().addScaledVector(out, 0.22).add(new THREE.Vector3(0, -1, 0)).normalize()
    const axis = new THREE.Vector3().crossVectors(dir, target)
    if (axis.lengthSq() > 1e-6) {
      axis.normalize()
      rotateRigBoneWorld(upper, axis, Math.acos(THREE.MathUtils.clamp(dir.dot(target), -1, 1)))
    }
    const armDir = rigWorldPos[lower].clone().sub(rigWorldPos[upper]).normalize()
    const bendAxis = new THREE.Vector3().crossVectors(armDir, faceDir)
    if (bendAxis.lengthSq() > 1e-6) {
      bendAxis.normalize()
      rotateRigBoneWorld(lower, bendAxis, 0.22)
    }
  }
}

const fmt = (v) => `[${v.toArray().map((x) => x.toFixed(4)).join(', ')}]`
const deg = (r) => (THREE.MathUtils.radToDeg(r)).toFixed(1)
const angleBetween = (a, b) => Math.acos(THREE.MathUtils.clamp(a.clone().normalize().dot(b.clone().normalize()), -1, 1))
const CHILD = { hips: 'spine', leftUpperLeg: 'leftLowerLeg', rightUpperLeg: 'rightLowerLeg', leftLowerLeg: 'leftFoot', rightLowerLeg: 'rightFoot', leftFoot: 'leftToes', rightFoot: 'rightToes', leftUpperArm: 'leftLowerArm', rightUpperArm: 'rightLowerArm', leftLowerArm: 'leftHand', rightLowerArm: 'rightHand' }
const boneDir = (b) => rigWorldPos[CHILD[b]].clone().sub(rigWorldPos[b]).normalize()
const localAxis = (b, ax) => ax.clone().applyQuaternion(rigWorldQuat[b])

console.log('\n=== REST AXES (normalized rig, after prepare rest pose, GROUP space: +Z toward camera) ===')
for (const b of ['hips', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'leftLowerArm']) {
  const dir = boneDir(b)
  const lx = localAxis(b, new THREE.Vector3(1, 0, 0))
  const ly = localAxis(b, new THREE.Vector3(0, 1, 0))
  const lz = localAxis(b, new THREE.Vector3(0, 0, 1))
  // Knee/elbow hinge: world axis perpendicular to the bone in the
  // sagittal plane — cross(boneDir, faceDir), same construction the
  // elbow code uses. Hinge in the bone's LOCAL frame:
  const hingeWorld = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1))
  const hingeLocal = hingeWorld.lengthSq() > 1e-6
    ? hingeWorld.clone().normalize().applyQuaternion(rigWorldQuat[b].clone().invert())
    : new THREE.Vector3(0, 0, 0)
  console.log(`${b}:`)
  console.log(`  rest world pos ${fmt(rigWorldPos[b])}  rest world quat ${fmt(rigWorldQuat[b])}`)
  console.log(`  bone dir (to child) ${fmt(dir)}`)
  console.log(`  local X in world ${fmt(lx)}  angle(X, boneDir) = ${deg(angleBetween(lx, dir))} deg`)
  console.log(`  local Y in world ${fmt(ly)}  angle(Y, boneDir) = ${deg(angleBetween(ly, dir))} deg`)
  console.log(`  local Z in world ${fmt(lz)}  angle(Z, boneDir) = ${deg(angleBetween(lz, dir))} deg`)
  console.log(`  hinge axis world ${fmt(hingeWorld.lengthSq() > 1e-6 ? hingeWorld.normalize() : hingeWorld)}  hinge local ${fmt(hingeLocal)}`)
  console.log(`  VERDICT: rotation.x is ${angleBetween(lx, dir) < Math.PI / 4 ? 'A TWIST (local X ~parallel to bone)' : 'A HINGE BEND (local X ~perpendicular to bone)'}; rotation.z is ${angleBetween(lz, dir) < Math.PI / 4 ? 'A TWIST' : 'A HINGE BEND (sideways swing)'}; rotation.y is ${angleBetween(ly, dir) < Math.PI / 4 ? 'A TWIST (local Y ~parallel to bone)' : 'A HINGE BEND'}`)
}

// ---- Simulate the runtime writes --------------------------------------
// Snapshot rest local quats; each test sets one node's local Euler,
// recomputes the rig, and reports the skinned result.
const restLocal = Object.fromEntries(BONES.map((b) => [b, rigLocalQuat[b].clone()]))
function resetRig() {
  for (const b of BONES) rigLocalQuat[b].copy(restLocal[b])
  computeRigWorld()
}

// ---- Framing: are the knees/feet even inside the compact stage? ----
// VrmModel layout(): 'half' (compact default) targetY = eyeY - 0.31,
// framedH = 0.98 -> window [targetY - 0.49, targetY + 0.49]; 'full'
// frames the whole posed box. If the knee (0.57 m) and foot (0.14 m)
// sit below the half window, no knee bend can ever be seen on the
// menu tab, whatever the walk constants are.
console.log('\n=== FRAMING (VrmModel layout(), FOV 30) ===')
{
  const eye = rawWorldPos[boneIndex.leftEye]
  const head = rawWorldPos[boneIndex.head]
  const boxMinY = Math.min(...BONES.map((b) => rigWorldPos[b].y))
  console.log(`eye y = ${eye.y.toFixed(3)} m  head bone y = ${head.y.toFixed(3)} m  hips y = ${rigWorldPos.hips.y.toFixed(3)} m  knee y = ${rigWorldPos.leftLowerLeg.y.toFixed(3)} m  foot y = ${rigWorldPos.leftFoot.y.toFixed(3)} m`)
  const halfTarget = eye.y - 0.31
  console.log(`'half' (compact default): window y [${(halfTarget - 0.49).toFixed(3)}, ${(halfTarget + 0.49).toFixed(3)}] — knees (${rigWorldPos.leftLowerLeg.y.toFixed(2)} m) and feet (${rigWorldPos.leftFoot.y.toFixed(2)} m) are ${rigWorldPos.leftLowerLeg.y < halfTarget - 0.49 ? 'BELOW the frame' : 'inside the frame'}`)
  console.log(`'full': window covers the whole posed box (min y ~${boxMinY.toFixed(2)} m) — knees and feet inside`)
}
function setEuler(bone, x, y, z) {
  rigLocalQuat[bone].setFromEuler(new THREE.Euler(x, y, z, 'XYZ'))
  computeRigWorld()
}
function shinReport(label) {
  const knee = rigWorldPos.leftLowerLeg
  const foot = rigWorldPos.leftFoot
  const restKnee = rigWorldPos.leftLowerLeg // placeholder, replaced by caller via closure values
  return { knee, foot }
}
// Rest references (recomputed per test from a fresh reset).
function restState() {
  resetRig()
  return {
    hipL: rigWorldPos.leftUpperLeg.clone(),
    kneeL: rigWorldPos.leftLowerLeg.clone(),
    footL: rigWorldPos.leftFoot.clone(),
    shinDir: boneDir('leftLowerLeg'),
    thighDir: boneDir('leftUpperLeg'),
  }
}
console.log('\n=== SIMULATED RUNTIME WRITES (left leg; rest foot y = ? — see below) ===')
const rest = restState()
console.log(`rest: hipL ${fmt(rest.hipL)} kneeL ${fmt(rest.kneeL)} footL ${fmt(rest.footL)} (thigh ${(rest.hipL.distanceTo(rest.kneeL)).toFixed(3)} m, shin ${(rest.kneeL.distanceTo(rest.footL)).toFixed(3)} m)`)
function test(label, apply) {
  const r = restState()
  apply()
  const knee = rigWorldPos.leftLowerLeg.clone()
  const foot = rigWorldPos.leftFoot.clone()
  const shin = boneDir('leftLowerLeg')
  const thigh = boneDir('leftUpperLeg')
  const dFoot = foot.clone().sub(r.footL)
  const dKnee = knee.clone().sub(r.kneeL)
  // Front-view foreshortening: projected shin length in the XY plane
  // (what the straight-on camera sees) vs rest.
  const proj = (d) => Math.hypot(d.x, d.y)
  const shinLen = r.kneeL.distanceTo(r.footL)
  const projRest = proj(r.footL.clone().sub(r.kneeL)) / shinLen
  const projNow = proj(foot.clone().sub(knee)) / shinLen
  console.log(`${label}:`)
  console.log(`  shin dir ${fmt(shin)} (angle from rest ${deg(angleBetween(shin, r.shinDir))} deg)  thigh dir ${fmt(thigh)} (angle from rest ${deg(angleBetween(thigh, r.thighDir))} deg)`)
  console.log(`  foot d = (${dFoot.x.toFixed(3)}, ${dFoot.y.toFixed(3)}, ${dFoot.z.toFixed(3)}) m  [x sideways, y LIFT (+ = off the floor), z toward camera]`)
  console.log(`  knee d = (${dKnee.x.toFixed(3)}, ${dKnee.y.toFixed(3)}, ${dKnee.z.toFixed(3)}) m  front-projected shin length ${(projNow * 100).toFixed(0)}% of rest (${(projRest * 100).toFixed(0)}%)`)
}
test('A. lowerLeg.rotation.x = +0.60  (current KNEE_SWING)', () => setEuler('leftLowerLeg', 0.6, 0, 0))
test('B. lowerLeg.rotation.x = +0.80  (proposed KNEE_SWING)', () => setEuler('leftLowerLeg', 0.8, 0, 0))
test('C. lowerLeg.rotation.z = +0.60  (control: sideways)', () => setEuler('leftLowerLeg', 0, 0, 0.6))
test('D. lowerLeg.rotation.y = +0.60  (control: twist)', () => setEuler('leftLowerLeg', 0, 0.6, 0))
test('E. upperLeg.rotation.x = -0.35  (proposed THIGH_LIFT)', () => setEuler('leftUpperLeg', -0.35, 0, 0))
test('F. upperLeg.rotation.z = +0.13  (sidestep splay, control)', () => setEuler('leftUpperLeg', 0, 0, 0.13))
// Combined stepping pose at peak lift, as the walk block composes it
// (upperLeg x + z, lowerLeg x), old vs proposed constants.
function combined(label, thighLift, kneeSwing, zSwing) {
  const r = restState()
  setEuler('leftUpperLeg', -thighLift, 0, zSwing)
  setEuler('leftLowerLeg', kneeSwing, 0, 0)
  const foot = rigWorldPos.leftFoot.clone()
  const dFoot = foot.clone().sub(r.footL)
  const knee = rigWorldPos.leftLowerLeg.clone()
  const dKnee = knee.clone().sub(r.kneeL)
  console.log(`${label}: foot d = (${dFoot.x.toFixed(3)}, ${dFoot.y.toFixed(3)}, ${dFoot.z.toFixed(3)}) m  knee d = (${dKnee.x.toFixed(3)}, ${dKnee.y.toFixed(3)}, ${dKnee.z.toFixed(3)}) m  => foot lift ${dFoot.y.toFixed(3)} m, sideways ${dFoot.x.toFixed(3)} m`)
}
console.log('\n=== COMBINED PEAK-STEP POSE (upperLeg x=-lift, z=+splay; lowerLeg x=+knee) ===')
combined('OLD constants (lift 0.25, knee 0.60, z 0.13)', 0.25, 0.6, 0.13)
combined('NEW constants (lift 0.35, knee 0.80, z 0.13)', 0.35, 0.8, 0.13)
combined('FINAL (lift 0.35, knee 0.80, z 0.13 solved + 0.15 splay = 0.28)', 0.35, 0.8, 0.28)

// ---- World-axis bend equivalence (the elbow discipline, q' = P^-1 Q P qRest)
console.log('\n=== WORLD-AXIS KNEE BEND (elbow discipline) vs LOCAL rotation.x ===')
{
  const r = restState()
  // Hinge in world: cross(shinDir, faceDir); P = upperLeg world quat NOW (rest here).
  const hingeWorld = new THREE.Vector3().crossVectors(r.shinDir, new THREE.Vector3(0, 0, 1)).normalize()
  const P = rigWorldQuat.leftUpperLeg.clone()
  const Q = new THREE.Quaternion().setFromAxisAngle(hingeWorld, -0.8) // hinge is -X: -0.8 about -X == +0.8 about +X
  const qPrime = P.clone().invert().multiply(Q).multiply(P).multiply(restLocal.leftLowerLeg)
  rigLocalQuat.leftLowerLeg.copy(qPrime)
  computeRigWorld()
  const footW = rigWorldPos.leftFoot.clone()
  const dW = footW.clone().sub(r.footL)
  const shinW = boneDir('leftLowerLeg')
  const r2 = restState()
  setEuler('leftLowerLeg', 0.8, 0, 0)
  const footL = rigWorldPos.leftFoot.clone()
  const dL = footL.clone().sub(r2.footL)
  const shinL = boneDir('leftLowerLeg')
  console.log(`hinge world ${fmt(hingeWorld)}  hinge local ${fmt(hingeWorld.clone().applyQuaternion(P.clone().invert()))}`)
  console.log(`world-axis bend -0.8 about hinge: shin ${fmt(shinW)} foot d = (${dW.x.toFixed(3)}, ${dW.y.toFixed(3)}, ${dW.z.toFixed(3)})`)
  console.log(`local rotation.x 0.8: shin ${fmt(shinL)} foot d = (${dL.x.toFixed(3)}, ${dL.y.toFixed(3)}, ${dL.z.toFixed(3)})`)
  console.log(`shin-dir angle between the two methods: ${deg(angleBetween(shinW, shinL))} deg (0 = identical)`)
}
resetRig()
