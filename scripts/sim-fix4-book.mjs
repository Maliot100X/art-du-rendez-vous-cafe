/**
 * FIX PASS 4 verification sim — book-in-hand geometry, from the REAL vita.vrm
 * GLB with the REAL rest pose (vrmCache.prepare) and the REAL reading-pose
 * composition (VrmModel.tsx: absolute upper-arm rotation.x + world-axis
 * elbow bend via parent-space quaternions) and the REAL camera math
 * (VrmModel layout(), 'half' framing, FOV 30). No WebGL, no browser —
 * pure three.js math over the glTF node hierarchy.
 *
 * Prints, for each stage size × walk position × blend:
 *   hand world + screen px, book centre/corners screen px, book top vs chin,
 *   whether the whole book is inside the frame, and whether the hand
 *   overlaps the book in screen space (the "gripped" read).
 *
 * Usage: node scripts/sim-fix4-book.mjs
 */
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const VRM_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vrm', 'vita.vrm')

// Fix pass 5: the model group is rotated Ry(180°) — the measured
// faceFront quat from vrmCache.ts (0,1,0,0) — NOT identity. The whole
// sim runs in GROUP space (the hierarchy walk is seeded with
// groupQuat), matching vrmCache.prepare, which does its rest pose in
// group space via getWorldPosition with the group rotation applied.
// Running the walk in scene space was the old "sim-frame" bug: it
// "verified" back-facing geometry as if it faced the camera.
const groupQuat = new THREE.Quaternion(0, 1, 0, 0)
const buf = readFileSync(VRM_PATH)
if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB')
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen))
const nodes = json.nodes

const parent = new Map()
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)))
const localPos = nodes.map((n) => new THREE.Vector3(...(n.translation ?? [0, 0, 0])))
const localQuat0 = nodes.map((n) =>
  n.rotation ? new THREE.Quaternion(n.rotation[0], n.rotation[1], n.rotation[2], n.rotation[3]) : new THREE.Quaternion(),
)
const localScale = nodes.map((n) => new THREE.Vector3(...(n.scale ?? [1, 1, 1])))
const worldPos = nodes.map(() => new THREE.Vector3())
const worldQuat = nodes.map(() => new THREE.Quaternion())

function computeWorld() {
  const roots = json.scenes[0].nodes
  const walk = (idx, pPos, pQuat, pScale) => {
    const q = pQuat.clone().multiply(localQuat[idx])
    const s = new THREE.Vector3(pScale.x * localScale[idx].x, pScale.y * localScale[idx].y, pScale.z * localScale[idx].z)
    const p = pPos.clone().add(new THREE.Vector3().copy(localPos[idx]).multiply(pScale).applyQuaternion(pQuat))
    worldPos[idx].copy(p)
    worldQuat[idx].copy(q)
    ;(nodes[idx].children ?? []).forEach((c) => walk(c, p, q, s))
  }
  roots.forEach((r) => walk(r, new THREE.Vector3(), groupQuat.clone(), new THREE.Vector3(1, 1, 1)))
}
// localQuat is mutated by the rest pose / reading pose; world follows.
const localQuat = localQuat0.map((q) => q.clone())
computeWorld()

const boneIndex = Object.fromEntries(json.extensions.VRM.humanoid.humanBones.map((b) => [b.bone, b.node]))

function descendants(idx) {
  const out = [idx]
  ;(nodes[idx].children ?? []).forEach((c) => out.push(...descendants(c)))
  return out
}
function rotateBoneWorld(idx, axis, angle) {
  const parentQ = parent.has(idx) ? worldQuat[parent.get(idx)] : new THREE.Quaternion()
  const qWorld = new THREE.Quaternion().setFromAxisAngle(axis, angle)
  const delta = parentQ.clone().invert().multiply(qWorld).multiply(parentQ)
  const pivot = worldPos[idx].clone()
  // World-space update is by qWorld itself (the rotation in world
  // space), NOT by delta — delta is the LOCAL change (parent-space),
  // and premultiplying descendants by it is only correct when the
  // parent world quat is identity. With the group-space seed (Ry 180°)
  // it is not, and the arm swung up instead of down. Only the local
  // quat of the bone itself takes delta (via the sync below).
  for (const d of descendants(idx)) {
    worldQuat[d].premultiply(qWorld)
    worldPos[d].sub(pivot).applyQuaternion(qWorld).add(pivot)
  }
  // Keep localQuat in sync for the node itself (world = parentWorld * local).
  const pQ = parent.has(idx) ? worldQuat[parent.get(idx)] : new THREE.Quaternion()
  localQuat[idx].copy(pQ.clone().invert().multiply(worldQuat[idx]))
}

// ---- Rest pose: arms down (vrmCache.prepare) ----
const faceDir = new THREE.Vector3(0, 0, 1)
for (const side of ['left', 'right']) {
  const upper = boneIndex[`${side}UpperArm`]
  const lower = boneIndex[`${side}LowerArm`]
  const shoulder = worldPos[upper].clone()
  const elbow = worldPos[lower].clone()
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
  const armDir = worldPos[lower].clone().sub(worldPos[upper]).normalize()
  const bendAxis = new THREE.Vector3().crossVectors(armDir, faceDir)
  if (bendAxis.lengthSq() > 1e-6) {
    bendAxis.normalize()
    rotateBoneWorld(lower, bendAxis, 0.22)
  }
}
// Recompute world from locals (authoritative after the rest pose).
function recomputeWorldFromLocals() {
  const roots = json.scenes[0].nodes
  const walk = (idx, pPos, pQuat, pScale) => {
    const q = pQuat.clone().multiply(localQuat[idx])
    const s = new THREE.Vector3(pScale.x * localScale[idx].x, pScale.y * localScale[idx].y, pScale.z * localScale[idx].z)
    const p = pPos.clone().add(new THREE.Vector3().copy(localPos[idx]).multiply(pScale).applyQuaternion(pQuat))
    worldPos[idx].copy(p)
    worldQuat[idx].copy(q)
    ;(nodes[idx].children ?? []).forEach((c) => walk(c, p, q, s))
  }
  roots.forEach((r) => walk(r, new THREE.Vector3(), groupQuat.clone(), new THREE.Vector3(1, 1, 1)))
}
recomputeWorldFromLocals()

// ---- ReadRig, as VrmModel builds it at load ----
const upperArm = boneIndex.leftUpperArm
const lowerArm = boneIndex.leftLowerArm
const hand = boneIndex.leftHand
const upperEuler = new THREE.Euler().setFromQuaternion(localQuat[upperArm], 'XYZ')
const upperBaseX = upperEuler.x
const lowerRestQuat = localQuat[lowerArm].clone()
const shoulder = worldPos[upperArm].clone()
const elbow = worldPos[lowerArm].clone()
const armDir = elbow.clone().sub(shoulder).normalize()
const hingeWorld0 = new THREE.Vector3().crossVectors(armDir, new THREE.Vector3(0, 0, 1))
if (hingeWorld0.lengthSq() < 1e-6) hingeWorld0.set(0, 1, 0)
hingeWorld0.normalize()
const upperWorldQuat = worldQuat[upperArm].clone()
const hingeLocal = hingeWorld0.clone().applyQuaternion(upperWorldQuat.clone().invert())

const READ_UPPER = 0.6
const READ_ELBOW = 0.3
/** Adduction: swing the raised left arm toward the midline so the open
    26 cm spread (centred on the hand) fits the 0.72 m frame. Sign is
    determined empirically below (try +0.5 first). */
const READ_ADDUCT = 0.5
const eyeY = worldPos[boneIndex.leftEye].y
const chinY = eyeY - 0.13

/** Apply the reading pose at blend, return the hand world pos/quat. */
function readingHandPos(blend) {
  // Upper arm: rotation.x = base + READ_UPPER * blend, rotation.z =
  // base + READ_ADDUCT * blend (Euler XYZ, y kept).
  const e = new THREE.Euler(upperBaseX + READ_UPPER * blend, upperEuler.y, upperEuler.z + READ_ADDUCT * blend, 'XYZ')
  localQuat[upperArm].setFromEuler(e)
  recomputeWorldFromLocals()
  // Elbow: world-axis bend, q' = P^-1 * Q * P * qRest (P = upper world quat NOW).
  const parentQ = worldQuat[upperArm].clone()
  const hingeWorld = hingeLocal.clone().applyQuaternion(parentQ)
  const qWorld = new THREE.Quaternion().setFromAxisAngle(hingeWorld, READ_ELBOW * blend)
  localQuat[lowerArm]
    .copy(parentQ)
    .invert()
    .multiply(qWorld)
    .multiply(parentQ)
    .multiply(lowerRestQuat)
  recomputeWorldFromLocals()
  return { pos: worldPos[hand].clone(), quat: worldQuat[hand].clone() }
}
/** Restore the rest pose after a reading-pose measurement. */
function restoreRest() {
  const e = new THREE.Euler(upperBaseX, upperEuler.y, upperEuler.z, 'XYZ')
  localQuat[upperArm].setFromEuler(e)
  localQuat[lowerArm].copy(lowerRestQuat)
  recomputeWorldFromLocals()
}

// ---- Camera: VrmModel layout(), 'half' framing, FOV 30 ----
const FOV = 30
const halfTan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
function makeCamera(stageW, stageH) {
  const aspect = stageW / stageH
  const targetY = eyeY - 0.31
  const framedH = 0.98
  const framedW = 0.6
  const dist = Math.max(framedH / 2 / halfTan, framedW / 2 / (halfTan * aspect))
  return {
    stageW,
    stageH,
    aspect,
    targetY,
    dist,
    halfW: dist * halfTan * aspect, // visible half-width at the model plane
    project(p) {
      const zc = dist - p.z // depth in front of the camera (camera looks -Z)
      const xNdc = p.x / (zc * halfTan * aspect)
      const yNdc = (p.y - targetY) / (zc * halfTan)
      return [((xNdc + 1) / 2) * stageW, ((1 - (yNdc + 1) / 2) * stageH)]
    },
  }
}

const BOOK_W_OPEN = 0.26
const BOOK_W_CARRY = 0.13
const BOOK_H = 0.19
const BOOK_T = 0.016

/** Book corners in world space: centre + world quat, W×H×T box. */
function bookCorners(centre, quat, w) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(quat)
  const xA = new THREE.Vector3().setFromMatrixColumn(m, 0)
  const yA = new THREE.Vector3().setFromMatrixColumn(m, 1)
  const zA = new THREE.Vector3().setFromMatrixColumn(m, 2)
  const out = []
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1])
        out.push(
          centre
            .clone()
            .addScaledVector(xA, (sx * w) / 2)
            .addScaledVector(yA, (sy * BOOK_H) / 2)
            .addScaledVector(zA, (sz * BOOK_T) / 2),
        )
  return out
}

const xAxis = new THREE.Vector3(1, 0, 0)
const yAxis = new THREE.Vector3(0, 1, 0)

function report(stageName, stageW, stageH, groupX, blend, offRest, offRead) {
  const cam = makeCamera(stageW, stageH)
  // worldPos/worldQuat are already in GROUP space (walk seeded with
  // groupQuat), as are the offsets (z toward the camera).
  const { pos: handPos } = blend > 0 ? readingHandPos(blend) : { pos: worldPos[hand].clone() }
  restoreRest()
  const off = new THREE.Vector3().lerpVectors(new THREE.Vector3(...offRest), new THREE.Vector3(...offRead), blend)
  const centre = handPos.clone().add(off).add(new THREE.Vector3(groupX, 0, 0))
  // Book world orientation, as the FIXED loop composes it (fix pass 5):
  // the book's local +Z is already toward camera, so bookWant is the
  // tilt alone — multiplying by the group quaternion turned the pages
  // away from the camera.
  const tilt = new THREE.Quaternion().setFromAxisAngle(xAxis, -0.35 * blend)
  const bookWant = tilt.clone()
  let quat
  if (blend >= 0.5) quat = bookWant
  else {
    const idle = new THREE.Quaternion().setFromAxisAngle(yAxis, -0.9)
    quat = idle.clone().slerp(bookWant, THREE.MathUtils.clamp(blend * 2, 0, 1))
  }
  const w = blend >= 0.5 ? BOOK_W_OPEN : BOOK_W_CARRY
  const corners = bookCorners(centre, quat, w)
  const px = corners.map((c) => cam.project(c))
  const xs = px.map((p) => p[0])
  const ys = px.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const inFrame = minX >= 0 && maxX <= stageW && minY >= 0 && maxY <= stageH
  const handPx = cam.project(handPos.clone().add(new THREE.Vector3(groupX, 0, 0)))
  const handOverlapsBook = handPx[0] >= minX && handPx[0] <= maxX && handPx[1] >= minY && handPx[1] <= maxY
  const chinPx = cam.project(new THREE.Vector3(groupX, chinY, 0))
  const eyePx = cam.project(new THREE.Vector3(groupX, eyeY, 0))
  const clearanceCm = Math.round(((chinY - (centre.y + BOOK_H / 2)) * 100 + Number.EPSILON) * 10) / 10
  console.log(
    `${stageName} ${stageW}x${stageH} groupX=${groupX >= 0 ? '+' : ''}${groupX} blend=${blend} ` +
      `prop=${blend >= 0.5 ? 'open ' : 'carry'} | hand world y=${handPos.y.toFixed(3)} ` +
      `hand px=(${Math.round(handPx[0])},${Math.round(handPx[1])}) ` +
      `book centre px=(${Math.round(cam.project(centre)[0])},${Math.round(cam.project(centre)[1])}) ` +
      `book rect x[${Math.round(minX)}..${Math.round(maxX)}] y[${Math.round(minY)}..${Math.round(maxY)}] ` +
      `inFrame=${inFrame} handOverlapsBook=${handOverlapsBook} ` +
      `bookTop->chin=${blend >= 0.5 ? clearanceCm + 'cm' : 'n/a'} ` +
      `eye px=(${Math.round(eyePx[0])},${Math.round(eyePx[1])}) chin px y=${Math.round(chinPx[1])}`,
  )
  return { inFrame, handOverlapsBook }
}

console.log('== baseline (rest pose) ==')
console.log('hand world (group):', worldPos[hand].toArray().map((v) => v.toFixed(4)).join(', '))
console.log('eye y:', eyeY.toFixed(4), 'chin y:', chinY.toFixed(4), 'upperBaseX:', upperBaseX.toFixed(4))
const handRead = readingHandPos(1)
console.log('READING blend=1: hand world (group):', handRead.pos.toArray().map((v) => v.toFixed(4)).join(', '))
restoreRest()

const OLD_REST = [0.02, -0.08, 0.03]
const OLD_READ = [0, 0.05, 0.04]
/** NEW: carry rides higher (top edge meets the palm) and BEHIND the hand
    (z -0.01) so the hand renders in front of the cover; reading book
    sits 8.5 cm above the hand so the palm touches its bottom edge. */
const NEW_REST = [0.02, -0.06, -0.01]
const NEW_READ = [0, 0.085, 0.01]

console.log('\n== ADDUCT test: hand at blend=1 with READ_ADDUCT =', READ_ADDUCT, '==')
const handAdd = readingHandPos(1)
console.log('hand world with adduction (group):', handAdd.pos.toArray().map((v) => v.toFixed(4)).join(', '))
restoreRest()

console.log('\n== OLD offsets, OLD walk (±0.32), desktop menu stage 356x480 ==')
for (const gx of [0, -0.32, 0.32]) {
  report('desktop', 356, 480, gx, 0, OLD_REST, OLD_READ)
  report('desktop', 356, 480, gx, 1, OLD_REST, OLD_READ)
}
console.log('\n== NEW offsets, NEW walk (-0.08/+0.14), desktop menu stage 356x480 ==')
for (const gx of [-0.08, 0.14]) {
  report('desktop', 356, 480, gx, 0, NEW_REST, NEW_READ)
  report('desktop', 356, 480, gx, 1, NEW_REST, NEW_READ)
}
console.log('\n== NEW offsets, NEW walk, phone menu stage 358x260 ==')
for (const gx of [-0.08, 0.14]) {
  report('phone', 358, 260, gx, 0, NEW_REST, NEW_READ)
  report('phone', 358, 260, gx, 1, NEW_REST, NEW_READ)
}
console.log('\n== NEW offsets, NEW walk, Livre desktop stage 356x480 ==')
for (const gx of [-0.08, 0.14]) {
  report('livre', 356, 480, gx, 0, NEW_REST, NEW_READ)
  report('livre', 356, 480, gx, 1, NEW_REST, NEW_READ)
}
