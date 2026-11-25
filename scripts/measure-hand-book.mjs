/**
 * Measure Vita's left-hand bone in the POSED state (file T-pose + the
 * rest-pose arm rotations VrmModel.tsx applies), straight from the VRM
 * GLB — no browser, no WebGL. Pure three.js math (Quaternion/Vector3)
 * over the glTF node hierarchy.
 *
 * Outputs the left hand's world position/quaternion in GROUP space
 * (the hierarchy walk is seeded with groupQuat, matching
 * vrmCache.prepare, which does its rest pose in group space) plus the
 * book prop's LOCAL offset/quaternion for a chosen world-space offset
 * from the hand, so handBook.ts can parent the book to the hand bone
 * with measured constants instead of guessed ones. Fix pass 5: the
 * offsets are stated in GROUP space (z toward the camera) and the
 * model group is rotated Ry(180°) — the measured faceFront quat
 * (0,1,0,0) from vrmCache.ts — so scene-space values must go through
 * groupQuat; seeding the walk with it keeps every later step in
 * group space. The old script ran in scene space and "verified"
 * back-facing geometry.
 *
 * Usage: node scripts/measure-hand-book.mjs
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

// ---- Hierarchy -------------------------------------------------------
const parent = new Map()
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)))

const localPos = nodes.map((n) => new THREE.Vector3(...(n.translation ?? [0, 0, 0])))
const localQuat = nodes.map((n) =>
  n.rotation
    ? new THREE.Quaternion(n.rotation[0], n.rotation[1], n.rotation[2], n.rotation[3])
    : new THREE.Quaternion(),
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
computeWorld()

const boneIndex = Object.fromEntries(
  json.extensions.VRM.humanoid.humanBones.map((b) => [b.bone, b.node]),
)

// ---- rotateBoneWorld, exactly as VrmModel.tsx -------------------------
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
}

// ---- Rest pose: arms down (copy of VrmModel.tsx) ----------------------
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

// ---- Report -----------------------------------------------------------
const fmt = (v) => `[${v.toArray().map((x) => x.toFixed(4)).join(', ')}]`
const hand = boneIndex.leftHand
const eye = boneIndex.leftEye
const head = boneIndex.head
const chest = boneIndex.chest
console.log('leftHand node:', nodes[hand].name, 'index', hand)
console.log('leftHand world pos (group space):', fmt(worldPos[hand]))
console.log('leftHand world quat (group space):', fmt(worldQuat[hand]))
console.log('left elbow world pos:', fmt(worldPos[boneIndex.leftLowerArm]))
console.log('left shoulder world pos:', fmt(worldPos[boneIndex.leftUpperArm]))
console.log('eye world pos:', fmt(worldPos[eye]), 'eye y =', worldPos[eye].y.toFixed(3))
console.log('head world pos:', fmt(worldPos[head]))
console.log('chest world pos:', fmt(worldPos[chest]))
const eyeY = worldPos[eye].y
console.log(
  'compact half-frame window (targetY eye-0.28, framedH 0.95):',
  `[${(eyeY - 0.28 - 0.475).toFixed(3)}, ${(eyeY - 0.28 + 0.475).toFixed(3)}]`,
)

// ---- Book local transform for a chosen world offset from the hand -----
// Book centre in GROUP space = hand pos + offset (x: out/in, y: down,
// z: forward toward the camera). The hand grips the book's top edge, so
// the centre sits mostly below the hand joint. Hand pos/quat are now in
// GROUP space too, and the desired book orientation is identity in
// group space (pages toward the camera), so the local quat is simply
// the inverse of the hand's group-space quat.
function bookLocal(offset) {
  const off = new THREE.Vector3(...offset)
  const localPosBook = off.clone().applyQuaternion(worldQuat[hand].clone().invert())
  const localQuatBook = worldQuat[hand].clone().invert() // desired group-space quat = identity (faces +Z)
  const centreGroup = worldPos[hand].clone().add(off)
  return { localPosBook, localQuatBook, centreGroup }
}
for (const offset of [
  [0.02, -0.08, 0.03],
  [0.0, -0.07, 0.04],
]) {
  const { localPosBook, localQuatBook, centreGroup } = bookLocal(offset)
  console.log(`offset ${JSON.stringify(offset)} -> book centre group ${fmt(centreGroup)}`)
  console.log(`  book local pos: ${fmt(localPosBook)}`)
  console.log(`  book local quat: ${fmt(localQuatBook)}`)
}
