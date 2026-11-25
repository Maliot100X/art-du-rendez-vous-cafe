/**
 * FIX PASS 8 — worker 1 (WALK) probe. NOT shipped.
 *
 * Replays the REAL runtime sequence against the REAL vita.vrm + real
 * three-vrm 3.6.0, headless in Node (no WebGL renderer — bone math +
 * skinning math only):
 *   per frame: vrm.update(dt) -> walk writes (verbatim VrmModel) ->
 *   humanoid.update() [pass-7 second sync] -> updateMatrixWorld ->
 *   skeleton.update() [what the renderer does] -> measure
 *
 * Measures, at mid-step peaks (t = 0.5 / 1.5 / 2.5 / 3.5 s):
 *  (a) normalized knee rotation.x (what the DOM readout shows),
 *  (b) RAW bone world positions hip/knee/ankle + the TRUE 3D knee angle
 *      and the FRONT-PROJECTED (camera-plane XY) knee angle — the angle
 *      a viewer actually sees in pixels,
 *  (c) REAL SKINNED VERTICES: leg-region vertices grouped by dominant
 *      skin-weight bone (thigh / shin / foot incl. shoes), world
 *      positions before vs at peak, and their front-camera pixel
 *      positions (FOV 30, walk-window framing, 356x480 stage),
 *  (d) variant B: flipped bend signs (thigh +0.45 / shin -1.0),
 *  (e) variant C: humanoid.update() skipped — does the readout still
 *      say 57 deg while raw bones + vertices stay at rest?
 *  (f) base drift: unmount mid-walk (peak knee 1.0), remount capturing
 *      base from the live nodes, replay peak.
 *
 * Usage: node scripts/fix8-walk-probe.mjs
 */
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

globalThis.self = globalThis
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

// ---- vrmCache.prepare() verbatim (incl. combineSkeletons) ----
function rotateBoneWorld(bone, axis, angle) {
  const parentQ = new THREE.Quaternion()
  bone.parent?.getWorldQuaternion(parentQ)
  const qWorld = new THREE.Quaternion().setFromAxisAngle(axis, angle)
  const delta = parentQ.clone().invert().multiply(qWorld).multiply(parentQ)
  bone.quaternion.premultiply(delta)
}
VRMUtils.removeUnnecessaryVertices(vrm.scene)
VRMUtils.combineSkeletons(vrm.scene)
vrm.scene.traverse((o) => { o.frustumCulled = false })
const group = new THREE.Group()
group.add(vrm.scene)
const faceFrontQuat = new THREE.Quaternion()
try {
  const faceFront = vrm.lookAt?.faceFront
  if (faceFront) {
    faceFrontQuat.setFromUnitVectors(faceFront.clone().normalize(), new THREE.Vector3(0, 0, 1))
    group.quaternion.copy(faceFrontQuat)
  }
} catch { /* default */ }
console.log('faceFrontQuat (group rotation):', group.quaternion.toArray().map((n) => n.toFixed(3)).join(', '))
vrm.springBoneManager?.reset()
group.updateMatrixWorld(true)
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
    const out = dir.clone(); out.y = 0
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
    if (bendAxis.lengthSq() > 1e-6) { bendAxis.normalize(); rotateBoneWorld(lower, bendAxis, 0.22) }
  }
}
vrm.update(0)
group.updateMatrixWorld(true)
// Posed bounds (vrmCache way)
const box = new THREE.Box3()
const childBox = new THREE.Box3()
vrm.scene.traverse((obj) => {
  if (obj.name.startsWith('VRMC_springBone_collider')) return
  const mesh = obj
  if (mesh.isSkinnedMesh) {
    mesh.skeleton?.update()
    mesh.computeBoundingBox()
    if (mesh.boundingBox) { childBox.copy(mesh.boundingBox).applyMatrix4(obj.matrixWorld); box.union(childBox) }
    return
  }
  if (mesh.isMesh && mesh.geometry) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    if (mesh.geometry.boundingBox) { childBox.copy(mesh.geometry.boundingBox).applyMatrix4(obj.matrixWorld); box.union(childBox) }
  }
})
const size = new THREE.Vector3(); const centre = new THREE.Vector3()
box.getSize(size); box.getCenter(centre)
console.log(`posed bounds size=(${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}) centre=(${centre.x.toFixed(2)}, ${centre.y.toFixed(2)}, ${centre.z.toFixed(2)})`)

// ---- camera: walk-window framing, 356x480 stage (desktop Menu) ----
const STAGE_W = 356; const STAGE_H = 480
const FOV = 30
const camera = new THREE.PerspectiveCamera(FOV, STAGE_W / STAGE_H, 0.1, 60)
{
  const halfTan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
  const framedH = size.y * 1.03; const framedW = size.x * 1.06
  const dist = Math.max(framedH / 2 / halfTan, framedW / 2 / (halfTan * (STAGE_W / STAGE_H)))
  camera.position.set(0, centre.y, dist)
  camera.lookAt(0, centre.y, 0)
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
  console.log(`camera dist=${dist.toFixed(2)} targetY=${centre.y.toFixed(2)} — 1 m vertical = ${(STAGE_H / framedH).toFixed(1)} px`)
}
const projectPx = (p) => {
  const v = p.clone().project(camera)
  return [((v.x + 1) / 2) * STAGE_W, ((1 - (v.y + 1) / 2) * STAGE_H)]
}

// ---- walk rig, exactly as VrmModel builds it at mount ----
const humanoid = vrm.humanoid
function buildRig() {
  const nodes = {
    leftUpperLeg: humanoid.getNormalizedBoneNode('leftUpperLeg'),
    rightUpperLeg: humanoid.getNormalizedBoneNode('rightUpperLeg'),
    leftLowerLeg: humanoid.getNormalizedBoneNode('leftLowerLeg'),
    rightLowerLeg: humanoid.getNormalizedBoneNode('rightLowerLeg'),
    leftUpperArm: humanoid.getNormalizedBoneNode('leftUpperArm'),
    rightUpperArm: humanoid.getNormalizedBoneNode('rightUpperArm'),
  }
  const baseX = new Map(); const baseZ = new Map()
  Object.values(nodes).forEach((n) => { baseX.set(n, n.rotation.x); baseZ.set(n, n.rotation.z) })
  const hips = humanoid.getNormalizedBoneNode('hips')
  const leftFoot = humanoid.getNormalizedBoneNode('leftFoot')
  const rightFoot = humanoid.getNormalizedBoneNode('rightFoot')
  ;[hips, leftFoot, rightFoot].forEach((n) => { if (n) { baseX.set(n, n.rotation.x); baseZ.set(n, n.rotation.z) } })
  return { ...nodes, hips, leftFoot, rightFoot, baseX, baseZ }
}
let rig = buildRig()
console.log('normalized===raw leftLowerLeg?', humanoid.getNormalizedBoneNode('leftLowerLeg') === humanoid.getRawBoneNode('leftLowerLeg'))
console.log('rest baseX legs L/R upper/lower:', [rig.leftUpperLeg, rig.rightUpperLeg, rig.leftLowerLeg, rig.rightLowerLeg].map((n) => rig.baseX.get(n).toFixed(3)).join(' '))
console.log('normalizedRestPose legs (quats):',
  ['leftUpperLeg', 'leftLowerLeg'].map((n) => `${n}=${(humanoid.normalizedRestPose?.[n]?.rotation ?? []).map((q) => q.toFixed(2)).join(',')}`).join(' | '))

// Raw bone nodes (what skinning uses)
const raw = {
  hipL: humanoid.getRawBoneNode('leftUpperLeg'),
  kneeL: humanoid.getRawBoneNode('leftLowerLeg'),
  ankL: humanoid.getRawBoneNode('leftFoot'),
  hipR: humanoid.getRawBoneNode('rightUpperLeg'),
  kneeR: humanoid.getRawBoneNode('rightLowerLeg'),
  ankR: humanoid.getRawBoneNode('rightFoot'),
}

// ---- skinned-vertex groups by dominant skin-weight bone ----
const LEG_BONES = ['leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot']
const boneIndexByName = new Map() // raw bone name -> skeleton index (per mesh skeleton)
const vertexGroups = {} // key: side+segment -> { mesh, indices: [] }
{
  const skinned = []
  vrm.scene.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o) })
  console.log(`skinned meshes: ${skinned.length}, skeletons: ${new Set(skinned.map((m) => m.skeleton)).size}`)
  for (const mesh of skinned) {
    const matName = Array.isArray(mesh.material) ? mesh.material.map((m) => m.name).join('+') : mesh.material.name
    const isLegRelevant = /SKIN|Shoes|CLOTH/i.test(matName) && mesh.name.startsWith('Bodybaked')
    if (!isLegRelevant) continue
    const skel = mesh.skeleton
    const nameToIdx = new Map(skel.bones.map((b, i) => [b.name, i]))
    const pos = mesh.geometry.attributes.position
    const skinIdx = mesh.geometry.attributes.skinIndex
    const skinW = mesh.geometry.attributes.skinWeight
    if (!skinIdx || !skinW) continue
    for (let vi = 0; vi < pos.count; vi++) {
      let best = -1; let bestW = 0; let bestBone = ''
      for (let k = 0; k < 4; k++) {
        const w = skinW.getComponent(vi, k)
        if (w > bestW) { bestW = w; best = skinIdx.getComponent(vi, k); bestBone = skel.bones[best]?.name ?? '' }
      }
      const m = bestBone.match(/^J_Bip_([LR])_(UpperLeg|LowerLeg|Foot)/)
      if (!m || bestW < 0.5) continue
      const key = `${m[1] === 'L' ? 'left' : 'right'}${m[2]}` // leftUpperLeg etc
      const y = pos.getY(vi)
      // keep only vertices in the leg region (below hip 0.95, above shoe sole)
      if (y > 0.95 || y < -0.01) continue
      if (!vertexGroups[key]) vertexGroups[key] = []
      vertexGroups[key].push({ mesh, index: vi })
    }
  }
  // cap sample size (even stride) for speed
  for (const k of Object.keys(vertexGroups)) {
    const arr = vertexGroups[k]
    const stride = Math.max(1, Math.floor(arr.length / 150))
    vertexGroups[k] = arr.filter((_, i) => i % stride === 0)
  }
  console.log('vertex groups (dominant bone, w>=0.5, y<0.95):',
    Object.entries(vertexGroups).map(([k, v]) => `${k}:${v.length}`).join(' '))
}
const _v = new THREE.Vector3()
const _m4 = new THREE.Matrix4()
const _p1 = new THREE.Vector3()
const _s = new THREE.Vector3()
/** Manual skinning, exactly as three's skinning shader does:
 *  p1 = bindMatrix * p; s = sum(w_i * boneMatrices[i] * p1);
 *  p' = bindMatrixInverse * s. boneMatrices are refreshed by
 *  skeleton.update() (what the renderer does each frame). */
function skinnedVertex(mesh, index, target) {
  const pos = mesh.geometry.attributes.position
  const skinIdx = mesh.geometry.attributes.skinIndex
  const skinW = mesh.geometry.attributes.skinWeight
  _p1.set(pos.getX(index), pos.getY(index), pos.getZ(index)).applyMatrix4(mesh.bindMatrix)
  _s.set(0, 0, 0)
  const bm = mesh.skeleton.boneMatrices
  for (let k = 0; k < 4; k++) {
    const w = skinW.getComponent(index, k)
    if (w === 0) continue
    const bi = skinIdx.getComponent(index, k)
    _m4.fromArray(bm, bi * 16)
    _v.copy(_p1).applyMatrix4(_m4).multiplyScalar(w)
    _s.add(_v)
  }
  return target.copy(_s).applyMatrix4(mesh.bindMatrixInverse)
}
function groupMeanWorld(key) {
  const arr = vertexGroups[key]
  if (!arr || !arr.length) return null
  const mean = new THREE.Vector3()
  for (const { mesh, index } of arr) {
    skinnedVertex(mesh, index, _v)
    _v.applyMatrix4(mesh.matrixWorld)
    mean.add(_v)
  }
  mean.divideScalar(arr.length)
  return mean
}
function groupMinY(key) {
  const arr = vertexGroups[key]
  if (!arr || !arr.length) return null
  let min = Infinity
  for (const { mesh, index } of arr) {
    skinnedVertex(mesh, index, _v)
    _v.applyMatrix4(mesh.matrixWorld)
    if (_v.y < min) min = _v.y
  }
  return min
}
function refreshSkinning() {
  group.updateMatrixWorld(true)
  const seen = new Set()
  vrm.scene.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton && !seen.has(o.skeleton)) { seen.add(o.skeleton); o.skeleton.update() }
  })
}
refreshSkinning()
const restMeans = {}
for (const k of Object.keys(vertexGroups)) restMeans[k] = groupMeanWorld(k)
const restShoeMinY = { left: groupMinY('leftFoot'), right: groupMinY('rightFoot') }
console.log('rest vertex means:', Object.entries(restMeans).map(([k, p]) => `${k}=(${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)})`).join(' '))
console.log('rest shoe-vertex minY L/R:', restShoeMinY.left?.toFixed(3), restShoeMinY.right?.toFixed(3))

// ---- walk constants (VrmModel verbatim) ----
const HIP_HALF = 0.089, LEG_LEN = 0.841, STEP_DURATION = 1.0, STEP_COUNT = 4
const WALK_DURATION = 4.0, WALK_LEFT = -0.08, WALK_RIGHT = 0.14
const KNEE_SWING_BASE = 1.0, THIGH_LIFT_BASE = 0.45
const SWING_SPLAY = 0.15, HIP_BOB = 0.02, HIP_SWAY = 0.05, WALK_TURN = 0.3
// SHIPPED envelope (fix pass 8): hold 10-90% of each step.
function stepLift(u) {
  if (u < 0.1) { const s = u / 0.1; return s * s * (3 - 2 * s) }
  if (u <= 0.9) return 1
  const s = (u - 0.9) / 0.1
  return 1 - s * s * (3 - 2 * s)
}
const deg = (r) => (r * 180) / Math.PI
const _a = new THREE.Vector3(); const _b = new THREE.Vector3(); const _c = new THREE.Vector3()

function measureSnapshot(label) {
  refreshSkinning()
  const hipL = raw.hipL.getWorldPosition(new THREE.Vector3())
  const kneeL = raw.kneeL.getWorldPosition(new THREE.Vector3())
  const ankL = raw.ankL.getWorldPosition(new THREE.Vector3())
  const hipR = raw.hipR.getWorldPosition(new THREE.Vector3())
  const kneeR = raw.kneeR.getWorldPosition(new THREE.Vector3())
  const ankR = raw.ankR.getWorldPosition(new THREE.Vector3())
  const kneeAngle3D = (hip, knee, ank) => {
    _a.copy(hip).sub(knee).normalize(); _b.copy(ank).sub(knee).normalize()
    return deg(Math.acos(THREE.MathUtils.clamp(_a.dot(_b), -1, 1)))
  }
  const kneeAngleXY = (hip, knee, ank) => {
    _a.copy(hip).sub(knee); _a.z = 0; _a.normalize()
    _b.copy(ank).sub(knee); _b.z = 0; _b.normalize()
    return deg(Math.acos(THREE.MathUtils.clamp(_a.dot(_b), -1, 1)))
  }
  const normKneeL = deg(rig.leftLowerLeg.rotation.x)
  const normKneeR = deg(rig.rightLowerLeg.rotation.x)
  const normThighL = deg(rig.leftUpperLeg.rotation.x)
  const kneeLPx = projectPx(kneeL); const ankLPx = projectPx(ankL); const hipLPx = projectPx(hipL)
  const kneeRPx = projectPx(kneeR); const ankRPx = projectPx(ankR)
  const lm = groupMeanWorld('leftLowerLeg'); const lf = groupMeanWorld('leftFoot')
  const rm = groupMeanWorld('rightLowerLeg'); const rf = groupMeanWorld('rightFoot')
  const lmPx = lm ? projectPx(lm) : [0, 0]; const lfPx = lf ? projectPx(lf) : [0, 0]
  console.log(`--- ${label} ---`)
  console.log(`  NORMALIZED readout: kneeL=${normKneeL.toFixed(1)} deg kneeR=${normKneeR.toFixed(1)} deg thighL=${normThighL.toFixed(1)} deg (DOM shows max=${Math.max(normKneeL, normKneeR).toFixed(0)} deg)`)
  console.log(`  RAW bones L: hip=(${hipL.x.toFixed(3)},${hipL.y.toFixed(3)},${hipL.z.toFixed(3)}) knee=(${kneeL.x.toFixed(3)},${kneeL.y.toFixed(3)},${kneeL.z.toFixed(3)}) ank=(${ankL.x.toFixed(3)},${ankL.y.toFixed(3)},${ankL.z.toFixed(3)})`)
  console.log(`  RAW bones R: knee=(${kneeR.x.toFixed(3)},${kneeR.y.toFixed(3)},${kneeR.z.toFixed(3)}) ank=(${ankR.x.toFixed(3)},${ankR.y.toFixed(3)},${ankR.z.toFixed(3)})`)
  console.log(`  TRUE knee angle L: 3D=${kneeAngle3D(hipL, kneeL, ankL).toFixed(1)} deg (180=straight) | FRONT-PROJECTED XY=${kneeAngleXY(hipL, kneeL, ankL).toFixed(1)} deg | R projected=${kneeAngleXY(hipR, kneeR, ankR).toFixed(1)} deg`)
  console.log(`  PIXELS (356x480): L hip=(${hipLPx[0].toFixed(0)},${hipLPx[1].toFixed(0)}) knee=(${kneeLPx[0].toFixed(0)},${kneeLPx[1].toFixed(0)}) ank=(${ankLPx[0].toFixed(0)},${ankLPx[1].toFixed(0)}) | R knee=(${kneeRPx[0].toFixed(0)},${kneeRPx[1].toFixed(0)}) ank=(${ankRPx[0].toFixed(0)},${ankRPx[1].toFixed(0)})`)
  if (lm && lf) {
    const dLm = lm.clone().sub(restMeans.leftLowerLeg); const dLf = lf.clone().sub(restMeans.leftFoot)
    console.log(`  SKINNED VERTICES L: shin mean moved (${dLm.x.toFixed(3)}, ${dLm.y.toFixed(3)}, ${dLm.z.toFixed(3)}) m | XY-plane ${Math.hypot(dLm.x, dLm.y).toFixed(3)} m = ${(Math.hypot(dLm.x, dLm.y) * (STAGE_H / (size.y * 1.03))).toFixed(1)} px; foot mean moved (${dLf.x.toFixed(3)}, ${dLf.y.toFixed(3)}, ${dLf.z.toFixed(3)}) m; foot mean px=(${lfPx[0].toFixed(0)},${lfPx[1].toFixed(0)}) shin mean px=(${lmPx[0].toFixed(0)},${lmPx[1].toFixed(0)})`)
    console.log(`  SHOE minY: L=${groupMinY('leftFoot')?.toFixed(3)} (rest ${restShoeMinY.left?.toFixed(3)}) R=${groupMinY('rightFoot')?.toFixed(3)} (rest ${restShoeMinY.right?.toFixed(3)})`)
  }
  return { normKneeL, normKneeR }
}

function runWalk({ label, kneeSwing, thighLift, syncHumanoid = true, thighSplay = SWING_SPLAY, shinSplay = 0 }) {
  // reset to clean rest: restore normalized quats captured at load
  console.log(`\n########## ${label} (KNEE_SWING=${kneeSwing} THIGH_LIFT=${thighLift} thighSplay=${thighSplay} shinSplay=${shinSplay} second-humanoid.update=${syncHumanoid}) ##########`)
  const dt = 1 / 60
  const w = { t: 0, fromX: 0, toX: WALK_RIGHT, step: -1, footL: -HIP_HALF, footR: HIP_HALF }
  let walkTurn = 0
  let maxFootLiftL = -Infinity; let maxProjBendL = 0; let maxProjBendR = 0
  const peaks = [0.5, 1.5, 2.5, 3.5]
  let peakIdx = 0
  for (let frame = 0; frame <= 240; frame++) {
    const wt = w.t
    vrm.update(dt) // top of loop
    if (wt < WALK_DURATION) {
      w.t = wt + dt
      const dir = w.toX >= w.fromX ? 1 : -1
      const stepLen = (w.toX - w.fromX) / 2
      const stepIdx = Math.min(STEP_COUNT - 1, Math.floor(wt / STEP_DURATION))
      const u = Math.min(1, (wt - stepIdx * STEP_DURATION) / STEP_DURATION)
      const leadLeft = dir < 0
      const steppingLeft = (stepIdx % 2 === 0) === leadLeft
      if (stepIdx !== w.step) {
        if (steppingLeft) w.footL += stepLen; else w.footR += stepLen
        w.step = stepIdx
      }
      const uw = Math.min(1, wt / WALK_DURATION)
      const smooth = uw * uw * (3 - 2 * uw)
      group.position.x = w.fromX + (w.toX - w.fromX) * smooth
      const hipX = group.position.x
      const env = Math.min(1, wt / 0.15) * Math.min(1, (WALK_DURATION - wt) / 0.25)
      const lift = stepLift(u)
      const setX = (node, v) => { node.rotation.x = (rig.baseX.get(node) ?? 0) + v * env }
      const setZ = (node, v) => { node.rotation.z = (rig.baseZ.get(node) ?? 0) + v * env }
      const clampA = (a) => Math.asin(THREE.MathUtils.clamp(a, -0.4, 0.4))
      const restL = clampA(-HIP_HALF / LEG_LEN)
      const restR = clampA(HIP_HALF / LEG_LEN)
      const swingFrom = (steppingLeft ? w.footL : w.footR) - stepLen
      const swingTo = steppingLeft ? w.footL : w.footR
      const swingX = swingFrom + (swingTo - swingFrom) * (u * u * (3 - 2 * u))
      const stanceFootX = steppingLeft ? w.footR : w.footL
      const stanceRest = steppingLeft ? restR : restL
      const swingRest = steppingLeft ? restL : restR
      const stanceAngle = clampA((stanceFootX - hipX) / LEG_LEN) - stanceRest
      const swingAngle = clampA((swingX - hipX) / LEG_LEN) - swingRest
      if (steppingLeft) {
        setZ(rig.leftUpperLeg, swingAngle + thighSplay * lift * dir)
        setZ(rig.rightUpperLeg, stanceAngle)
        setX(rig.leftUpperLeg, -thighLift * lift)
        setX(rig.leftLowerLeg, kneeSwing * lift)
        setZ(rig.leftLowerLeg, shinSplay * lift * dir)
        setX(rig.rightLowerLeg, 0)
        if (rig.leftFoot) rig.leftFoot.rotation.x = (rig.baseX.get(rig.leftFoot) ?? 0) - 0.35 * lift * env
        if (rig.rightFoot) rig.rightFoot.rotation.x = rig.baseX.get(rig.rightFoot) ?? 0
      } else {
        setZ(rig.rightUpperLeg, swingAngle + thighSplay * lift * dir)
        setZ(rig.leftUpperLeg, stanceAngle)
        setX(rig.rightUpperLeg, -thighLift * lift)
        setX(rig.rightLowerLeg, kneeSwing * lift)
        setZ(rig.rightLowerLeg, shinSplay * lift * dir)
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
      walkTurn = WALK_TURN * dir * Math.sin(Math.PI * uw)
    } else if (w.t !== Infinity) {
      w.t = Infinity
      rig.baseX.forEach((base, node) => { node.rotation.x = base })
      rig.baseZ.forEach((base, node) => { node.rotation.z = base })
      group.position.y = 0
      group.position.x = w.toX
      walkTurn = 0
    }
    // kneeDeg readout as VrmModel computes it (AFTER writes, BEFORE 2nd sync)
    const readoutDeg = Math.max(rig.leftLowerLeg.rotation.x, rig.rightLowerLeg.rotation.x) * 180 / Math.PI
    if (syncHumanoid) vrm.humanoid?.update() // pass-7 second sync, before render
    group.rotation.y = walkTurn
    // render-equivalent: skeleton matrices refresh
    refreshSkinning()
    // track maxima (raw, after sync)
    const ankL = raw.ankL.getWorldPosition(new THREE.Vector3())
    maxFootLiftL = Math.max(maxFootLiftL, ankL.y - 0.141)
    // peak snapshots
    if (peakIdx < peaks.length && wt >= peaks[peakIdx]) {
      console.log(`  [readout just before 2nd sync: ${readoutDeg.toFixed(1)} deg]`)
      measureSnapshot(`PEAK t=${peaks[peakIdx].toFixed(1)}s (frame ${frame})`)
      peakIdx++
    }
  }
  console.log(`MAX raw left-ankle lift over walk: ${maxFootLiftL.toFixed(3)} m`)
  console.log(`group.position.x end: ${group.position.x.toFixed(3)} (expect ${WALK_RIGHT})`)
}

// Rest snapshot first
measureSnapshot('REST (before walk)')
// A: current shipped constants
runWalk({ label: 'RUN A — shipped constants (thigh -0.45 / knee +1.0)', kneeSwing: KNEE_SWING_BASE, thighLift: THIGH_LIFT_BASE, syncHumanoid: true })
// C: same, but WITHOUT the second humanoid.update() — is the readout lying?
runWalk({ label: 'RUN C — shipped constants, second humanoid.update() SKIPPED', kneeSwing: KNEE_SWING_BASE, thighLift: THIGH_LIFT_BASE, syncHumanoid: false })
// B: flipped signs (anatomical: knee forward, shin back)
runWalk({ label: 'RUN B — FLIPPED signs (thigh +0.45 / knee -1.0)', kneeSwing: -KNEE_SWING_BASE, thighLift: -THIGH_LIFT_BASE, syncHumanoid: true })
// D: flipped signs + front-plane shin splay (shin angles opposite the thigh in XY)
runWalk({ label: 'RUN D — FLIPPED + shin splay -0.50', kneeSwing: -KNEE_SWING_BASE, thighLift: -THIGH_LIFT_BASE, syncHumanoid: true, shinSplay: -0.50 })
// E: flipped signs + bigger thigh splay + shin splay
runWalk({ label: 'RUN E — FLIPPED + thigh splay 0.30 + shin splay -0.50', kneeSwing: -KNEE_SWING_BASE, thighLift: -THIGH_LIFT_BASE, syncHumanoid: true, thighSplay: 0.30, shinSplay: -0.50 })
// F: middle ground — moderate splays
runWalk({ label: 'RUN F — FLIPPED + thigh splay 0.20 + shin splay -0.30', kneeSwing: -KNEE_SWING_BASE, thighLift: -THIGH_LIFT_BASE, syncHumanoid: true, thighSplay: 0.20, shinSplay: -0.30 })

// ---- (f) base drift across a mid-walk unmount ----
console.log('\n########## BASE DRIFT: unmount at peak, remount, replay ##########')
// leave the model at the end of run B (restored to base by walk-finish), then
// simulate: mount, walk to peak, UNMOUNT mid-walk (no restore — as VrmModel cleanup does today)
{
  const dt = 1 / 60
  const w = { t: 0, fromX: 0, toX: WALK_RIGHT, step: -1, footL: -HIP_HALF, footR: HIP_HALF }
  for (let frame = 0; frame < 90; frame++) { // 1.5 s -> mid step 2, left knee at peak
    const wt = w.t
    vrm.update(dt)
    if (wt < WALK_DURATION) {
      w.t = wt + dt
      const u = Math.min(1, (wt - 1.0) / 1.0)
      const lift = stepLift(Math.max(0, Math.min(1, u)))
      const env = 1
      rig.leftUpperLeg.rotation.x = (rig.baseX.get(rig.leftUpperLeg) ?? 0) - 0.45 * lift * env
      rig.leftLowerLeg.rotation.x = (rig.baseX.get(rig.leftLowerLeg) ?? 0) + 1.0 * lift * env
      rig.rightLowerLeg.rotation.x = rig.baseX.get(rig.rightLowerLeg) ?? 0
    }
    vrm.humanoid?.update()
  }
  console.log(`at "unmount": normalized left knee rotation.x = ${rig.leftLowerLeg.rotation.x.toFixed(3)} rad = ${deg(rig.leftLowerLeg.rotation.x).toFixed(1)} deg (cleanup restores NOTHING today)`)
  // remount: VrmModel captures base from the LIVE nodes
  const rig2 = buildRig()
  console.log(`remount captures baseX left knee = ${rig2.baseX.get(rig2.leftLowerLeg).toFixed(3)} rad`)
  const peak = rig2.baseX.get(rig2.leftLowerLeg) + 1.0
  console.log(`next walk peak readout = base + 1.0 = ${peak.toFixed(3)} rad = ${deg(peak).toFixed(1)} deg  <-- explains 76/95/115 deg sightings`)
  console.log(`and the REST pose now holds a bent knee: rest readout = ${deg(rig2.baseX.get(rig2.leftLowerLeg)).toFixed(1)} deg instead of 0`)
}

// ---- FIX PASS 9 — RUN G: shipped walk, camera-projected readout + arrival latch ----
// Replays the CURRENT VrmModel walk block verbatim (fix-8 constants,
// fix-9 status write incl. the arrival latch) and measures, per peak
// and per frame:
//   (a) the NEW panel number: camera-projected bend (NDC through the
//       walk-window camera, aspect-corrected = pixel-space angle),
//   (b) the same projection WITHOUT the aspect correction (raw NDC),
//   (c) the world-XY projected bend (fix-8's measure),
//   (d) the TRUE 3D bend (the pass-8 panel number — must no longer
//       be what the panel shows),
//   (e) the status-write sequence: pas 4/4 while walking, the first
//       held "Arrivee" frame, the hold across a simulated 1 s
//       reading, and the return to ready on resetWalkStatus().
// The store itself is exercised for real by scripts/fix9-status-harness.mjs;
// here the sameWalkStatus dedupe + latch logic is replicated to show
// the exact write sequence the loop produces.
console.log('\n########## RUN G — FIX PASS 9: shipped walk + projected readout + arrival latch ##########')
{
  // Restore the TRUE rest bases — the drift test above left the nodes bent.
  // NOTE: do NOT touch group.rotation here (no rotation.set(0,0,0)):
  // the group's quaternion is faceFrontQuat (0,1,0,0) = 180° about Y,
  // which three.js exposes as Euler (π, 0, π) — and the runtime loop
  // only ever writes rotation.y, so the (π,·,π) orientation survives.
  // A rotation.set(0,0,0) would face the model AWAY from the camera
  // (knee z −0.145 instead of +0.148) and the projected bend would
  // measure the back view — that exact mistake made the first RUN G
  // read a 21.5° peak instead of the real 31–42°.
  rig.baseX.forEach((base, node) => { node.rotation.x = base })
  rig.baseZ.forEach((base, node) => { node.rotation.z = base })
  group.position.set(0, 0, 0)
  group.quaternion.copy(faceFrontQuat)
  vrm.humanoid?.update()
  refreshSkinning()

  const _ph = new THREE.Vector3(); const _pk = new THREE.Vector3(); const _pa = new THREE.Vector3()
  const _wp = new THREE.Vector3()
  /** Runtime projectedKneeBend, verbatim (fix pass 9): NDC through the
      current camera, x scaled by aspect so the angle is the screen angle. */
  function bendCam(hip, knee, ank, aspectCorrect = true) {
    hip.getWorldPosition(_ph).project(camera)
    knee.getWorldPosition(_pk).project(camera)
    ank.getWorldPosition(_pa).project(camera)
    const sx = aspectCorrect ? (camera.aspect || 1) : 1
    const ax = (_ph.x - _pk.x) * sx; const ay = _ph.y - _pk.y
    const bx = (_pa.x - _pk.x) * sx; const by = _pa.y - _pk.y
    const la = Math.hypot(ax, ay); const lb = Math.hypot(bx, by)
    if (la < 1e-6 || lb < 1e-6) return 0
    return 180 - deg(Math.acos(THREE.MathUtils.clamp((ax * bx + ay * by) / (la * lb), -1, 1)))
  }
  /** World-XY projected bend (fix-8's measure: camera looks down -Z). */
  function bendXY(hip, knee, ank) {
    _a.copy(hip.getWorldPosition(_wp)).sub(knee.getWorldPosition(_ph)); _a.z = 0
    const hipKnee = _a.clone()
    _b.copy(ank.getWorldPosition(_wp)).sub(knee.getWorldPosition(_ph)); _b.z = 0
    hipKnee.normalize(); _b.normalize()
    return 180 - deg(Math.acos(THREE.MathUtils.clamp(hipKnee.dot(_b), -1, 1)))
  }
  /** True 3D bend (pass-8 panel number). */
  function bend3D(hip, knee, ank) {
    _a.copy(hip.getWorldPosition(_wp)).sub(knee.getWorldPosition(_ph)).normalize()
    _b.copy(ank.getWorldPosition(_wp)).sub(knee.getWorldPosition(_ph)).normalize()
    return 180 - deg(Math.acos(THREE.MathUtils.clamp(_a.dot(_b), -1, 1)))
  }
  /** Pixel-space bend from stage-pixel positions — ground truth for
      "what the eye sees". Must equal bendCam(..., true). */
  function bendPx(hip, knee, ank) {
    const hp = projectPx(hip.getWorldPosition(new THREE.Vector3()))
    const kp = projectPx(knee.getWorldPosition(new THREE.Vector3()))
    const ap = projectPx(ank.getWorldPosition(new THREE.Vector3()))
    const ax = hp[0] - kp[0]; const ay = hp[1] - kp[1]
    const bx = ap[0] - kp[0]; const by = ap[1] - kp[1]
    const la = Math.hypot(ax, ay); const lb = Math.hypot(bx, by)
    if (la < 1e-6 || lb < 1e-6) return 0
    return 180 - deg(Math.acos(THREE.MathUtils.clamp((ax * bx + ay * by) / (la * lb), -1, 1)))
  }
  const bendAll = () => ({
    cam: Math.max(bendCam(raw.hipL, raw.kneeL, raw.ankL), bendCam(raw.hipR, raw.kneeR, raw.ankR)),
    camRawNdc: Math.max(bendCam(raw.hipL, raw.kneeL, raw.ankL, false), bendCam(raw.hipR, raw.kneeR, raw.ankR, false)),
    px: Math.max(bendPx(raw.hipL, raw.kneeL, raw.ankL), bendPx(raw.hipR, raw.kneeR, raw.ankR)),
    xy: Math.max(bendXY(raw.hipL, raw.kneeL, raw.ankL), bendXY(raw.hipR, raw.kneeR, raw.ankR)),
    d3: Math.max(bend3D(raw.hipL, raw.kneeL, raw.ankL), bend3D(raw.hipR, raw.kneeR, raw.ankR)),
    camL: bendCam(raw.hipL, raw.kneeL, raw.ankL),
    camR: bendCam(raw.hipR, raw.kneeR, raw.ankR),
  })
  const fmtB = (b) => `panel(cam)=${b.cam.toFixed(1)} rawNDC=${b.camRawNdc.toFixed(1)} px=${b.px.toFixed(1)} XY=${b.xy.toFixed(1)} 3D=${b.d3.toFixed(1)} (L=${b.camL.toFixed(1)} R=${b.camR.toFixed(1)})`

  // Rest, before the walk.
  const restB = bendAll()
  console.log(`REST before walk: ${fmtB(restB)}`)

  // Store replica (sameWalkStatus + listener log, walkStatus.ts verbatim logic).
  const sameStatus = (a, b) => a.walking === b.walking && a.step === b.step && a.steps === b.steps &&
    Math.round(a.x * 100) === Math.round(b.x * 100) && a.tick === b.tick &&
    Math.round(a.kneeDeg / 5) === Math.round(b.kneeDeg / 5)
  let store = { walking: false, step: 0, steps: 4, x: 0, tick: 0, kneeDeg: 0 }
  const notified = []
  const setStatus = (next) => {
    if (sameStatus(next, store)) return
    store = { ...next }
    notified.push({ ...store })
  }
  const resetStatus = () => {
    const next = { ...store, walking: false, step: 0, tick: 0, kneeDeg: 0 }
    if (sameStatus(next, store)) return
    store = next
    notified.push({ ...store })
  }

  // Shipped constants (VrmModel verbatim).
  const KNEE_SWING = 1.0; const THIGH_LIFT = 0.45
  const SWING_SPLAY = 0.2; const SHIN_SPLAY = 0.3
  const HIP_BOB = 0.02; const HIP_SWAY = 0.05; const WALK_TURN = 0.3
  const dt = 1 / 60
  const TICK = 7
  const w = { t: 0, fromX: 0, toX: WALK_RIGHT, step: -1, footL: -HIP_HALF, footR: HIP_HALF }
  let arrived = false
  let walkStep = 0
  let kneeBendDeg = 0
  const peaks = [0.5, 1.5, 2.5, 3.5]
  let peakIdx = 0
  let maxCam = -Infinity; let maxCamFrame = -1
  let max3D = -Infinity
  let maxRawNdc = -Infinity
  let firstHeldFrame = -1; let firstHeldWt = -1
  let sawStep4Walking = false
  let heldFrames = 0
  // 6 s: 4 s walk + 1 s held arrival (simulated reading) + reset + 1 s idle.
  for (let frame = 0; frame <= 360; frame++) {
    const wt = w.t
    vrm.update(dt) // top of loop
    if (wt < WALK_DURATION) {
      w.t = wt + dt
      if (w.t >= WALK_DURATION) arrived = true // fix-9 crossing-frame latch
      const dir = w.toX >= w.fromX ? 1 : -1
      const stepLen = (w.toX - w.fromX) / 2
      const stepIdx = Math.min(STEP_COUNT - 1, Math.floor(wt / STEP_DURATION))
      walkStep = stepIdx + 1
      const u = Math.min(1, (wt - stepIdx * STEP_DURATION) / STEP_DURATION)
      const leadLeft = dir < 0
      const steppingLeft = (stepIdx % 2 === 0) === leadLeft
      if (stepIdx !== w.step) {
        if (steppingLeft) w.footL += stepLen; else w.footR += stepLen
        w.step = stepIdx
      }
      const uw = Math.min(1, wt / WALK_DURATION)
      const smooth = uw * uw * (3 - 2 * uw)
      group.position.x = w.fromX + (w.toX - w.fromX) * smooth
      const hipX = group.position.x
      const env = Math.min(1, wt / 0.15) * Math.min(1, (WALK_DURATION - wt) / 0.25)
      const lift = stepLift(u)
      const setX = (node, v) => { node.rotation.x = (rig.baseX.get(node) ?? 0) + v * env }
      const setZ = (node, v) => { node.rotation.z = (rig.baseZ.get(node) ?? 0) + v * env }
      const clampA = (a) => Math.asin(THREE.MathUtils.clamp(a, -0.4, 0.4))
      const restL = clampA(-HIP_HALF / LEG_LEN)
      const restR = clampA(HIP_HALF / LEG_LEN)
      const swingFrom = (steppingLeft ? w.footL : w.footR) - stepLen
      const swingTo = steppingLeft ? w.footL : w.footR
      const swingX = swingFrom + (swingTo - swingFrom) * (u * u * (3 - 2 * u))
      const stanceFootX = steppingLeft ? w.footR : w.footL
      const stanceRest = steppingLeft ? restR : restL
      const swingRest = steppingLeft ? restL : restR
      const stanceAngle = clampA((stanceFootX - hipX) / LEG_LEN) - stanceRest
      const swingAngle = clampA((swingX - hipX) / LEG_LEN) - swingRest
      if (steppingLeft) {
        setZ(rig.leftUpperLeg, swingAngle + SWING_SPLAY * lift * dir)
        setZ(rig.rightUpperLeg, stanceAngle)
        setX(rig.leftUpperLeg, THIGH_LIFT * lift)
        setX(rig.leftLowerLeg, -KNEE_SWING * lift)
        setZ(rig.leftLowerLeg, -SHIN_SPLAY * lift * dir)
        setX(rig.rightLowerLeg, 0)
        setZ(rig.rightLowerLeg, 0)
        if (rig.leftFoot) rig.leftFoot.rotation.x = (rig.baseX.get(rig.leftFoot) ?? 0) - 0.35 * lift * env
        if (rig.rightFoot) rig.rightFoot.rotation.x = rig.baseX.get(rig.rightFoot) ?? 0
      } else {
        setZ(rig.rightUpperLeg, swingAngle + SWING_SPLAY * lift * dir)
        setZ(rig.leftUpperLeg, stanceAngle)
        setX(rig.rightUpperLeg, THIGH_LIFT * lift)
        setX(rig.rightLowerLeg, -KNEE_SWING * lift)
        setZ(rig.rightLowerLeg, -SHIN_SPLAY * lift * dir)
        setX(rig.leftLowerLeg, 0)
        setZ(rig.leftLowerLeg, 0)
        if (rig.rightFoot) rig.rightFoot.rotation.x = (rig.baseX.get(rig.rightFoot) ?? 0) - 0.35 * lift * env
        if (rig.leftFoot) rig.leftFoot.rotation.x = rig.baseX.get(rig.leftFoot) ?? 0
      }
      const armPhase = (wt / (STEP_DURATION * 2)) * Math.PI * 2
      const armS = Math.sin(armPhase)
      setX(rig.leftUpperArm, 0.45 * armS)
      setX(rig.rightUpperArm, -0.45 * armS)
      group.position.y = -HIP_BOB * (1 - lift) * env
      if (rig.hips) setZ(rig.hips, HIP_SWAY * Math.sin((wt / STEP_DURATION) * Math.PI))
      group.rotation.y = WALK_TURN * dir * Math.sin(Math.PI * uw)
    } else if (w.t !== Infinity) {
      w.t = Infinity
      arrived = true // fix-9 completion-branch latch (belt & braces)
      rig.baseX.forEach((base, node) => { node.rotation.x = base })
      rig.baseZ.forEach((base, node) => { node.rotation.z = base })
      group.position.y = 0
      group.position.x = w.toX
      group.rotation.y = 0
    }
    vrm.humanoid?.update() // pass-7 second sync
    refreshSkinning()
    // ---- fix-9 status write (VrmModel verbatim logic) ----
    const walkingNow = w.t < WALK_DURATION
    camera.updateMatrixWorld()
    const b = bendAll()
    kneeBendDeg = b.cam
    if (walkingNow) {
      if (walkStep === 4) sawStep4Walking = true
      if (b.cam > maxCam) { maxCam = b.cam; maxCamFrame = frame }
      max3D = Math.max(max3D, b.d3)
      maxRawNdc = Math.max(maxRawNdc, b.camRawNdc)
      setStatus({ walking: true, step: walkStep, steps: STEP_COUNT, x: group.position.x, tick: TICK, kneeDeg: kneeBendDeg })
    } else if (arrived) {
      if (store.tick === 0) {
        arrived = false
        setStatus({ walking: false, step: 0, steps: STEP_COUNT, x: group.position.x, tick: 0, kneeDeg: kneeBendDeg })
      } else {
        if (firstHeldFrame < 0) { firstHeldFrame = frame; firstHeldWt = wt }
        heldFrames++
        setStatus({ walking: false, step: STEP_COUNT, steps: STEP_COUNT, x: group.position.x, tick: TICK, kneeDeg: kneeBendDeg })
      }
    } else {
      setStatus({ walking: false, step: 0, steps: STEP_COUNT, x: group.position.x, tick: 0, kneeDeg: kneeBendDeg })
    }
    if (peakIdx < peaks.length && wt >= peaks[peakIdx]) {
      const hipL = raw.hipL.getWorldPosition(new THREE.Vector3())
      const kneeL = raw.kneeL.getWorldPosition(new THREE.Vector3())
      const ankL = raw.ankL.getWorldPosition(new THREE.Vector3())
      const hipR = raw.hipR.getWorldPosition(new THREE.Vector3())
      const kneeR = raw.kneeR.getWorldPosition(new THREE.Vector3())
      const ankR = raw.ankR.getWorldPosition(new THREE.Vector3())
      console.log(`PEAK t=${peaks[peakIdx].toFixed(1)}s (frame ${frame}, walking=${walkingNow} step=${walkStep}): ${fmtB(bendAll())}`)
      console.log(`  NORM: kneeL=${deg(rig.leftLowerLeg.rotation.x).toFixed(1)} kneeR=${deg(rig.rightLowerLeg.rotation.x).toFixed(1)} thighLx=${deg(rig.leftUpperLeg.rotation.x).toFixed(1)} thighLz=${deg(rig.leftUpperLeg.rotation.z).toFixed(1)} thighRx=${deg(rig.rightUpperLeg.rotation.x).toFixed(1)} thighRz=${deg(rig.rightUpperLeg.rotation.z).toFixed(1)} shinLz=${deg(rig.leftLowerLeg.rotation.z).toFixed(1)} shinRz=${deg(rig.rightLowerLeg.rotation.z).toFixed(1)} groupX=${group.position.x.toFixed(3)} groupRotY=${deg(group.rotation.y).toFixed(1)}`)
      console.log(`  RAW L: hip=(${hipL.x.toFixed(3)},${hipL.y.toFixed(3)},${hipL.z.toFixed(3)}) knee=(${kneeL.x.toFixed(3)},${kneeL.y.toFixed(3)},${kneeL.z.toFixed(3)}) ank=(${ankL.x.toFixed(3)},${ankL.y.toFixed(3)},${ankL.z.toFixed(3)})`)
      console.log(`  RAW R: hip=(${hipR.x.toFixed(3)},${hipR.y.toFixed(3)},${hipR.z.toFixed(3)}) knee=(${kneeR.x.toFixed(3)},${kneeR.y.toFixed(3)},${kneeR.z.toFixed(3)}) ank=(${ankR.x.toFixed(3)},${ankR.y.toFixed(3)},${ankR.z.toFixed(3)})`)
      peakIdx++
    }
    // Simulated reading end at t=5 s: resetWalkStatus().
    if (frame === 300) {
      console.log(`frame 300 (t=5.0s): reading ends -> resetWalkStatus() (store before: walking=${store.walking} step=${store.step} tick=${store.tick})`)
      resetStatus()
      console.log(`  store after reset: walking=${store.walking} step=${store.step} tick=${store.tick} kneeDeg=${store.kneeDeg.toFixed(1)}`)
    }
  }
  const restAfterB = bendAll()
  console.log(`REST after walk+reset: ${fmtB(restAfterB)}`)
  console.log(`MAX over walking frames: panel(cam)=${maxCam.toFixed(1)} deg (frame ${maxCamFrame}) | rawNDC=${maxRawNdc.toFixed(1)} | true3D=${max3D.toFixed(1)}`)
  console.log(`NOTIFIED status writes (${notified.length}):`)
  for (const s of notified) {
    console.log(`  walking=${s.walking} step=${s.step}/${s.steps} x=${s.x >= 0 ? '+' : ''}${s.x.toFixed(2)} tick=${s.tick} kneeDeg=${s.kneeDeg.toFixed(1)} -> ${s.walking ? 'Marche…' : s.tick > 0 ? 'Arrivée' : 'prête'}`)
  }
  console.log('CHECKS:')
  console.log(`  pas 4/4 written while walking: ${sawStep4Walking ? 'YES' : 'NO — REGRESSION'}`)
  console.log(`  first held Arrivee frame: ${firstHeldFrame} (wt=${firstHeldWt.toFixed(3)}s, x=${group.position.x.toFixed(2)}) — held for ${heldFrames} frames before reset`)
  console.log(`  arrival survived the whole simulated reading (60 frames): ${heldFrames >= 59 ? 'YES' : `NO (${heldFrames} frames)`}`)
  console.log(`  reset returns to ready and the loop never re-latches: ${!arrived && store.tick === 0 && store.walking === false ? 'YES' : 'NO — REGRESSION'}`)
  console.log(`  peak projected bend ~31–44 deg (sampled peaks 31.4–42.5, per-frame max ${maxCam.toFixed(1)}): ${maxCam >= 31 && maxCam <= 45 ? 'YES' : `NO (${maxCam.toFixed(1)})`}`)
  console.log(`  rest projected bend ~0 deg: ${restB.cam < 5 && restAfterB.cam < 5 ? 'YES' : `NO (before ${restB.cam.toFixed(1)}, after ${restAfterB.cam.toFixed(1)})`}`)
  console.log(`  panel number is the projected bend, not true 3D (3D peak ${max3D.toFixed(1)} vs panel peak ${maxCam.toFixed(1)}): ${Math.abs(max3D - maxCam) > 10 ? 'YES' : 'NO'}`)
  console.log(`  aspect-corrected NDC == pixel-space angle (max |cam - px| over peaks): see peak lines above — they must match to ~0.1 deg`)
}
