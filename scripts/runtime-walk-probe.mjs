/**
 * TEMPORARY PROBE (fix pass 7) — not shipped. Runs the ACTUAL render-loop
 * walk code from VrmModel.tsx against the ACTUAL vita.vrm + ACTUAL
 * three-vrm 3.6.0, headlessly in Node (no WebGL renderer — bone math
 * only). Answers: do the walk block's normalized-node writes survive
 * vrm.update() and reach the raw skinned bones (foot world position)?
 *
 * Usage: node scripts/runtime-walk-probe.mjs
 */
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Node has no `self` (GLTFLoader's loadImageSource uses self.URL).
globalThis.self = globalThis

// GLTFLoader needs an ImageLoader; Node has no document. Textures are
// irrelevant to bone math — stub the image with a 1x1 placeholder.
THREE.ImageLoader.prototype.load = function (_url, onLoad) {
  if (onLoad) onLoad({ width: 1, height: 1 })
  return new THREE.Texture()
}

const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
const { VRMLoaderPlugin, VRMUtils } = await import('@pixiv/three-vrm')

const VRM_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vrm', 'vita.vrm')
const bytes = readFileSync(VRM_PATH)
const loader = new GLTFLoader()
loader.register((parser) => new VRMLoaderPlugin(parser))
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
const vrm = gltf.userData.vrm
if (!vrm) throw new Error('No VRM in file')
console.log('VRM loaded. humanoid present:', !!vrm.humanoid)

// Face the camera like vrmCache.prepare() does (+Z), on a throwaway group.
const group = new THREE.Group()
group.add(vrm.scene)
const faceFrontQuat = new THREE.Quaternion()
try {
  const faceFront = vrm.lookAt?.faceFront
  if (faceFront) {
    faceFrontQuat.setFromUnitVectors(faceFront.clone().normalize(), new THREE.Vector3(0, 0, 1))
    group.quaternion.copy(faceFrontQuat)
  }
} catch { /* default faces +Z */ }
vrm.springBoneManager?.reset()
group.updateMatrixWorld(true)

// Rest pose (arms down) — copied verbatim from vrmCache.ts prepare().
// Legs are untouched by prepare(), exactly as in the app.
function rotateBoneWorld(bone, axis, angle) {
  const parentQ = new THREE.Quaternion()
  bone.parent?.getWorldQuaternion(parentQ)
  const qWorld = new THREE.Quaternion().setFromAxisAngle(axis, angle)
  const delta = parentQ.clone().invert().multiply(qWorld).multiply(parentQ)
  bone.quaternion.premultiply(delta)
}
{
  const humanoid = vrm.humanoid
  const faceDir = new THREE.Vector3(0, 0, 1)
  for (const side of ['left', 'right']) {
    const upper = humanoid.getNormalizedBoneNode(`${side}UpperArm`)
    const lower = humanoid.getNormalizedBoneNode(`${side}LowerArm`)
    if (!upper || !lower) continue
    group.updateMatrixWorld(true)
    const shoulder = upper.getWorldPosition(new THREE.Vector3())
    const elbow = lower.getWorldPosition(new THREE.Vector3())
    const dir = elbow.clone().sub(shoulder).normalize()
    const out = dir.clone()
    out.y = 0
    if (out.lengthSq() > 1e-6) out.normalize()
    const target = new THREE.Vector3().addScaledVector(out, 0.22).add(new THREE.Vector3(0, -1, 0)).normalize()
    const axis = new THREE.Vector3().crossVectors(dir, target)
    if (axis.lengthSq() > 1e-6) {
      axis.normalize()
      rotateBoneWorld(upper, axis, Math.acos(THREE.MathUtils.clamp(dir.dot(target), -1, 1)))
    }
    group.updateMatrixWorld(true)
    const armDir = lower.getWorldPosition(new THREE.Vector3()).sub(upper.getWorldPosition(new THREE.Vector3())).normalize()
    const bendAxis = new THREE.Vector3().crossVectors(armDir, faceDir)
    if (bendAxis.lengthSq() > 1e-6) {
      bendAxis.normalize()
      rotateBoneWorld(lower, bendAxis, 0.22)
    }
  }
}
vrm.update(0)
group.updateMatrixWorld(true)

// ---- Walk rig, EXACTLY as VrmModel.tsx builds it ----
const humanoid = vrm.humanoid
const rigNodes = {
  leftUpperLeg: humanoid.getNormalizedBoneNode('leftUpperLeg'),
  rightUpperLeg: humanoid.getNormalizedBoneNode('rightUpperLeg'),
  leftLowerLeg: humanoid.getNormalizedBoneNode('leftLowerLeg'),
  rightLowerLeg: humanoid.getNormalizedBoneNode('rightLowerLeg'),
  leftUpperArm: humanoid.getNormalizedBoneNode('leftUpperArm'),
  rightUpperArm: humanoid.getNormalizedBoneNode('rightUpperArm'),
}
console.log('rig nodes null?', Object.entries(rigNodes).map(([k, v]) => `${k}:${v ? 'ok' : 'NULL'}`).join(' '))
const baseX = new Map()
const baseZ = new Map()
Object.values(rigNodes).forEach((n) => {
  baseX.set(n, n.rotation.x)
  baseZ.set(n, n.rotation.z)
})
const hips = humanoid.getNormalizedBoneNode('hips')
const leftFoot = humanoid.getNormalizedBoneNode('leftFoot')
const rightFoot = humanoid.getNormalizedBoneNode('rightFoot')
;[hips, leftFoot, rightFoot].forEach((n) => {
  if (n) { baseX.set(n, n.rotation.x); baseZ.set(n, n.rotation.z) }
})
console.log('rest baseX leftUpperLeg/leftLowerLeg:', baseX.get(rigNodes.leftUpperLeg), baseX.get(rigNodes.leftLowerLeg))
console.log('rest baseX leftUpperArm/leftLowerArm:', baseX.get(rigNodes.leftUpperArm), humanoid.getNormalizedBoneNode('leftLowerArm').rotation.x)

// Raw bone nodes (what the skinning actually uses).
const rawLeftFoot = humanoid.getBoneNode('leftFoot')
const rawLeftLowerLeg = humanoid.getBoneNode('leftLowerLeg')
const rawLeftUpperLeg = humanoid.getBoneNode('leftUpperLeg')
console.log('raw nodes null?', { foot: !rawLeftFoot, lower: !rawLeftLowerLeg, upper: !rawLeftUpperLeg })
console.log('normalized === raw for leftLowerLeg?', humanoid.getNormalizedBoneNode('leftLowerLeg') === rawLeftLowerLeg)

// ---- Walk block, copied VERBATIM from VrmModel.tsx loop ----
const HIP_HALF = 0.089
const LEG_LEN = 0.841
const STEP_DURATION = 1.0
const STEP_COUNT = 4
const WALK_DURATION = 4.0
const WALK_LEFT = -0.08
const WALK_RIGHT = 0.14
const KNEE_SWING = 1.0
const THIGH_LIFT = 0.45
const SWING_SPLAY = 0.15
const HIP_BOB = 0.02
const HIP_SWAY = 0.05
const WALK_TURN = 0.3
function stepLift(u) {
  if (u < 0.2) { const s = u / 0.2; return s * s * (3 - 2 * s) }
  if (u <= 0.8) return 1
  const s = (u - 0.8) / 0.2
  return 1 - s * s * (3 - 2 * s)
}
const walkRef = { t: 0, fromX: 0, toX: WALK_RIGHT, step: -1, footL: -HIP_HALF, footR: HIP_HALF }
const rig = { ...rigNodes, hips, leftFoot, rightFoot, baseX, baseZ }

const footPos = new THREE.Vector3()
const kneePos = new THREE.Vector3()
function snapshot(label) {
  group.updateMatrixWorld(true)
  rawLeftFoot.getWorldPosition(footPos)
  rawLeftLowerLeg.getWorldPosition(kneePos)
  const nLL = rigNodes.leftLowerLeg.rotation.x
  const nUL = rigNodes.leftUpperLeg.rotation.x
  const nULz = rigNodes.leftUpperLeg.rotation.z
  console.log(`${label}: norm leftLowerLeg.rot.x=${nLL.toFixed(3)} norm leftUpperLeg.rot.x=${nUL.toFixed(3)} rot.z=${nULz.toFixed(3)} | RAW foot world=(${footPos.x.toFixed(3)}, ${footPos.y.toFixed(3)}, ${footPos.z.toFixed(3)}) knee=(${kneePos.x.toFixed(3)}, ${kneePos.y.toFixed(3)}, ${kneePos.z.toFixed(3)})`)
}

console.log('\n=== FRAME-BY-FRAME (loop order: vrm.update(dt) THEN walk writes, like VrmModel) ===')
const restFoot = new THREE.Vector3()
group.updateMatrixWorld(true)
rawLeftFoot.getWorldPosition(restFoot)
console.log(`rest foot world y = ${restFoot.y.toFixed(3)} m`)
const dt = 1 / 60
let maxFootLift = 0
let maxKneeX = 0
for (let frame = 0; frame <= 200; frame++) {
  const wt = walkRef.t
  // 1) vrm.update FIRST (as in the loop)
  vrm.update(dt)
  // 2) walk block (verbatim logic)
  if (wt < WALK_DURATION) {
    walkRef.t = wt + dt
    const dir = walkRef.toX >= walkRef.fromX ? 1 : -1
    const stepLen = (walkRef.toX - walkRef.fromX) / 2
    const stepIdx = Math.min(STEP_COUNT - 1, Math.floor(wt / STEP_DURATION))
    const u = Math.min(1, (wt - stepIdx * STEP_DURATION) / STEP_DURATION)
    const leadLeft = dir < 0
    const steppingLeft = (stepIdx % 2 === 0) === leadLeft
    if (stepIdx !== walkRef.step) {
      if (steppingLeft) walkRef.footL += stepLen
      else walkRef.footR += stepLen
      walkRef.step = stepIdx
    }
    const uw = Math.min(1, wt / WALK_DURATION)
    const smooth = uw * uw * (3 - 2 * uw)
    group.position.x = walkRef.fromX + (walkRef.toX - walkRef.fromX) * smooth
    const hipX = group.position.x
    const env = Math.min(1, wt / 0.15) * Math.min(1, (WALK_DURATION - wt) / 0.25)
    const lift = stepLift(u)
    const setX = (node, v) => { node.rotation.x = (rig.baseX.get(node) ?? 0) + v * env }
    const setZ = (node, v) => { node.rotation.z = (rig.baseZ.get(node) ?? 0) + v * env }
    const clampA = (a) => Math.asin(THREE.MathUtils.clamp(a, -0.4, 0.4))
    const restL = clampA(-HIP_HALF / LEG_LEN)
    const restR = clampA(HIP_HALF / LEG_LEN)
    const swingFrom = (steppingLeft ? walkRef.footL : walkRef.footR) - stepLen
    const swingTo = steppingLeft ? walkRef.footL : walkRef.footR
    const swingX = swingFrom + (swingTo - swingFrom) * (u * u * (3 - 2 * u))
    const stanceFootX = steppingLeft ? walkRef.footR : walkRef.footL
    const stanceRest = steppingLeft ? restR : restL
    const swingRest = steppingLeft ? restL : restR
    const stanceAngle = clampA((stanceFootX - hipX) / LEG_LEN) - stanceRest
    const swingAngle = clampA((swingX - hipX) / LEG_LEN) - swingRest
    if (steppingLeft) {
      setZ(rig.leftUpperLeg, swingAngle + SWING_SPLAY * lift * dir)
      setZ(rig.rightUpperLeg, stanceAngle)
      setX(rig.leftUpperLeg, -THIGH_LIFT * lift)
      setX(rig.leftLowerLeg, KNEE_SWING * lift)
      setX(rig.rightLowerLeg, 0)
      if (rig.leftFoot) rig.leftFoot.rotation.x = (rig.baseX.get(rig.leftFoot) ?? 0) - 0.35 * lift * env
      if (rig.rightFoot) rig.rightFoot.rotation.x = rig.baseX.get(rig.rightFoot) ?? 0
    } else {
      setZ(rig.rightUpperLeg, swingAngle + SWING_SPLAY * lift * dir)
      setZ(rig.leftUpperLeg, stanceAngle)
      setX(rig.rightUpperLeg, -THIGH_LIFT * lift)
      setX(rig.rightLowerLeg, KNEE_SWING * lift)
      setX(rig.leftLowerLeg, 0)
      if (rig.rightFoot) rig.rightFoot.rotation.x = (rig.baseX.get(rig.rightFoot) ?? 0) - 0.35 * lift * env
      if (rig.leftFoot) rig.leftFoot.rotation.x = rig.baseX.get(rig.leftFoot) ?? 0
    }
    const armPhase = (wt / (STEP_DURATION * 2)) * Math.PI * 2
    const armS = Math.sin(armPhase)
    setX(rig.leftUpperArm, 0.45 * armS)
    setX(rig.rightUpperArm, -0.45 * armS)
    group.position.y = -HIP_BOB * (1 - lift) * env
    if (rig.hips) setZ(rig.hips, HIP_SWAY * Math.sin((wt / STEP_DURATION) * Math.PI))
  } else if (walkRef.t !== Infinity) {
    walkRef.t = Infinity
    rig.baseX.forEach((base, node) => { node.rotation.x = base })
    rig.baseZ.forEach((base, node) => { node.rotation.z = base })
    group.position.y = 0
    group.position.x = walkRef.toX
  }
  // 3) read back AFTER the writes (this is what the NEXT frame's
  // vrm.update() will sync to the raw bones — and what the render
  // shows is the sync from the PREVIOUS frame, so also track max lift
  // across frames AFTER an update has run).
  group.updateMatrixWorld(true)
  rawLeftFoot.getWorldPosition(footPos)
  rawLeftLowerLeg.getWorldPosition(kneePos)
  const liftNow = footPos.y - restFoot.y
  if (frame > 10 && frame < 190) {
    maxFootLift = Math.max(maxFootLift, liftNow)
    maxKneeX = Math.max(maxKneeX, kneePos.x - 0)
  }
  if (frame % 24 === 0 || frame === 200) snapshot(`frame ${String(frame).padStart(3)} t=${wt.toFixed(2)}`)
}
console.log(`\nMAX foot lift during walk (raw bone, after sync): ${maxFootLift.toFixed(3)} m (pass 6 claimed 0.088 m)`)
console.log(`group.position.x end: ${group.position.x.toFixed(3)} (expect ${WALK_RIGHT})`)
