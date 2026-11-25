/**
 * FIX PASS 9 — worker B (item 4: bend direction) probe. NOT shipped.
 *
 * Extends scripts/fix8-walk-probe.mjs: same real runtime (real vita.vrm
 * + real three-vrm, headless Node), but runs a CANDIDATE sweep over the
 * four walk constants and, per candidate, records a compact summary for
 * the STEPPING leg at each mid-step peak (t = 0.5 / 1.5 / 2.5 / 3.5 s):
 *   front-projected knee angle (min over peaks = max bend),
 *   knee toward-camera offset (stepping knee world z - rest knee z;
 *     camera sits at +Z, so +z = toward the viewer),
 *   knee lateral jut (stepping knee x - stepping hip x),
 *   foot lift (stepping ankle y - rest ankle y),
 *   foot lateral excursion (stepping ankle x - stepping hip x, and the
 *     skinned foot-mean dx vs rest, the fix-8-comparable number),
 *   shoe-sole lift (shoe minY - rest shoe minY).
 * Selection rule (task): maximise knee toward-camera offset + foot lift
 * while keeping lateral foot excursion <= ~16 cm and front-projected
 * bend >= ~35 deg (projected angle <= 145 deg).
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


// ---- fix pass 9: rest references + per-peak stepping-leg metrics ----
let restRaw = null // { hipL, kneeL, ankL, hipR, kneeR, ankR } world Vector3 at rest
const SUMMARIES = []
const _mA = new THREE.Vector3()
const _mB = new THREE.Vector3()
const _mC = new THREE.Vector3()
function captureRestRaw() {
  refreshSkinning()
  restRaw = {
    hipL: raw.hipL.getWorldPosition(new THREE.Vector3()),
    kneeL: raw.kneeL.getWorldPosition(new THREE.Vector3()),
    ankL: raw.ankL.getWorldPosition(new THREE.Vector3()),
    hipR: raw.hipR.getWorldPosition(new THREE.Vector3()),
    kneeR: raw.kneeR.getWorldPosition(new THREE.Vector3()),
    ankR: raw.ankR.getWorldPosition(new THREE.Vector3()),
  }
}
/** Metrics for the STEPPING leg at one peak (raw bones, post-sync). */
function stepMetrics(steppingLeft) {
  refreshSkinning()
  const hip = (steppingLeft ? raw.hipL : raw.hipR).getWorldPosition(new THREE.Vector3())
  const knee = (steppingLeft ? raw.kneeL : raw.kneeR).getWorldPosition(new THREE.Vector3())
  const ank = (steppingLeft ? raw.ankL : raw.ankR).getWorldPosition(new THREE.Vector3())
  const rHip = steppingLeft ? restRaw.hipL : restRaw.hipR
  const rKnee = steppingLeft ? restRaw.kneeL : restRaw.kneeR
  const rAnk = steppingLeft ? restRaw.ankL : restRaw.ankR
  _mA.copy(hip).sub(knee); _mA.z = 0; _mA.normalize() // CURRENT hip (fix9: rest hip was wrong — traverse skews the angle)
  _mB.copy(ank).sub(knee); _mB.z = 0; _mB.normalize()
  const projAngle = deg(Math.acos(THREE.MathUtils.clamp(_mA.dot(_mB), -1, 1)))
  const footMean = groupMeanWorld(steppingLeft ? 'leftFoot' : 'rightFoot')
  const restFootMean = restMeans[steppingLeft ? 'leftFoot' : 'rightFoot']
  const shoeNow = groupMinY(steppingLeft ? 'leftFoot' : 'rightFoot')
  const shoeRest = steppingLeft ? restShoeMinY.left : restShoeMinY.right
  return {
    side: steppingLeft ? 'L' : 'R',
    traverse: group.position.x,
    projAngle,
    bendDeg: 180 - projAngle,
    kneeDz: knee.z - rKnee.z, // + = toward camera
    kneeDxHip: knee.x - hip.x, // lateral jut of the knee from the hip line
    footLift: ank.y - rAnk.y,
    footLatHip: ank.x - hip.x, // foot sideways from under the hip
    footMeanDx: footMean && restFootMean ? footMean.x - restFootMean.x : NaN,
    shoeLift: shoeNow != null && shoeRest != null ? shoeNow - shoeRest : NaN,
  }
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
  const peakMetrics = []
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
      // stepping leg at this peak: dir is +1 here (fromX=0 -> toX=+0.14),
      // leadLeft=false, so the left leg steps on odd stepIdx, right on even.
      const stepIdxNow = Math.min(STEP_COUNT - 1, Math.floor(wt / STEP_DURATION))
      const m = stepMetrics(stepIdxNow % 2 === 1)
      m.t = peaks[peakIdx]
      peakMetrics.push(m)
      console.log(`  [fix9] t=${peaks[peakIdx].toFixed(1)}s stepping ${m.side}: proj=${m.projAngle.toFixed(1)}deg (bend ${m.bendDeg.toFixed(1)}deg) kneeDz=${m.kneeDz >= 0 ? '+' : ''}${m.kneeDz.toFixed(3)}m kneeDxHip=${m.kneeDxHip >= 0 ? '+' : ''}${m.kneeDxHip.toFixed(3)}m footLift=${m.footLift.toFixed(3)}m footLatHip=${m.footLatHip >= 0 ? '+' : ''}${m.footLatHip.toFixed(3)}m footMeanDx=${m.footMeanDx >= 0 ? '+' : ''}${m.footMeanDx.toFixed(3)}m shoeLift=${m.shoeLift.toFixed(3)}m`)
      peakIdx++
    }
  }
  console.log(`MAX raw left-ankle lift over walk: ${maxFootLiftL.toFixed(3)} m`)
  console.log(`group.position.x end: ${group.position.x.toFixed(3)} (expect ${WALK_RIGHT})`)
  const s = {
    label,
    kneeSwing, thighLift, thighSplay, shinSplay,
    minProj: Math.min(...peakMetrics.map((m) => m.projAngle)),
    maxBend: Math.max(...peakMetrics.map((m) => m.bendDeg)),
    maxKneeDz: Math.max(...peakMetrics.map((m) => m.kneeDz)),
    maxKneeDxHip: Math.max(...peakMetrics.map((m) => Math.abs(m.kneeDxHip))),
    maxFootLift: Math.max(...peakMetrics.map((m) => m.footLift)),
    maxFootLatHip: Math.max(...peakMetrics.map((m) => Math.abs(m.footLatHip))),
    maxFootMeanDx: Math.max(...peakMetrics.filter((m) => m.t <= 1.5).map((m) => Math.abs(m.footMeanDx))), // fix-8 metric: early peaks only, else the traverse inflates it
    maxShoeLift: Math.max(...peakMetrics.map((m) => m.shoeLift)),
  }
  SUMMARIES.push(s)
  console.log(`SUMMARY ${label}: minProj=${s.minProj.toFixed(1)}deg maxBend=${s.maxBend.toFixed(1)}deg maxKneeDz=+${s.maxKneeDz.toFixed(3)}m maxKneeDxHip=${s.maxKneeDxHip.toFixed(3)}m maxFootLift=${s.maxFootLift.toFixed(3)}m maxFootLatHip=${s.maxFootLatHip.toFixed(3)}m maxFootMeanDx=${s.maxFootMeanDx.toFixed(3)}m maxShoeLift=${s.maxShoeLift.toFixed(3)}m`)
  return s
}

// Rest snapshot first
measureSnapshot('REST (before walk)')
captureRestRaw()
console.log(`rest raw L: hip=(${restRaw.hipL.x.toFixed(3)},${restRaw.hipL.y.toFixed(3)},${restRaw.hipL.z.toFixed(3)}) knee=(${restRaw.kneeL.x.toFixed(3)},${restRaw.kneeL.y.toFixed(3)},${restRaw.kneeL.z.toFixed(3)}) ank=(${restRaw.ankL.x.toFixed(3)},${restRaw.ankL.y.toFixed(3)},${restRaw.ankL.z.toFixed(3)})`)
// Shipped constants (VrmModel verbatim): thigh +0.45 / knee -1.0 in the
// probe's sign convention = kneeSwing -1.0, thighLift -0.45.
const F = (label, knee, thigh, thighSplay, shin) =>
  runWalk({ label, kneeSwing: -knee, thighLift: -thigh, syncHumanoid: true, thighSplay, shinSplay: -shin })
F('BASE shipped (knee 1.00 thigh 0.45 splay 0.20 shin 0.30)', 1.0, 0.45, 0.20, 0.30)
F('S15 shin 0.15', 1.0, 0.45, 0.20, 0.15)
F('S20 shin 0.20', 1.0, 0.45, 0.20, 0.20)
F('T55 thigh 0.55', 1.0, 0.55, 0.20, 0.30)
F('K11 knee 1.10', 1.1, 0.45, 0.20, 0.30)
F('S20+T55 shin 0.20 thigh 0.55', 1.0, 0.55, 0.20, 0.20)
F('S20+K11 shin 0.20 knee 1.10', 1.1, 0.45, 0.20, 0.20)
F('S15+T55+K11 shin 0.15 thigh 0.55 knee 1.10', 1.1, 0.55, 0.20, 0.15)
F('S20+T55+K11 shin 0.20 thigh 0.55 knee 1.10', 1.1, 0.55, 0.20, 0.20)
// Fix-9 follow-up: the first sweep showed the knee's sideways jut
// (kneeDxHip) is set by the THIGH splay (SWING_SPLAY), not the shin
// splay — shin 0.15 leaves the jut at 0.113 m while dropping the bend
// below the 35 deg floor. So vary SWING_SPLAY too (one of the four
// constants), alone and combined with the thigh/knee gains.
F('P15 thigh-splay 0.15', 1.0, 0.45, 0.15, 0.30)
F('P10 thigh-splay 0.10', 1.0, 0.45, 0.10, 0.30)
F('P15+K11 splay 0.15 knee 1.10', 1.1, 0.45, 0.15, 0.30)
F('P10+K11 splay 0.10 knee 1.10', 1.1, 0.45, 0.10, 0.30)
F('P15+T55+K11 splay 0.15 thigh 0.55 knee 1.10', 1.1, 0.55, 0.15, 0.30)
F('P10+T55+K11 splay 0.10 thigh 0.55 knee 1.10', 1.1, 0.55, 0.10, 0.30)

console.log('\n########## FIX 9 COMPARISON (stepping leg, best peak per walk) ##########')
console.log('candidate | minProj | maxBend | kneeDz+ | kneeDxHip | footLift | footLatHip | footMeanDx | shoeLift')
for (const s of SUMMARIES) {
  const pass = s.maxBend >= 35 && s.maxFootLatHip <= 0.16 && s.maxFootMeanDx <= 0.16
  console.log(`${s.label} | ${s.minProj.toFixed(1)} | ${s.maxBend.toFixed(1)} | +${s.maxKneeDz.toFixed(3)} | ${s.maxKneeDxHip.toFixed(3)} | ${s.maxFootLift.toFixed(3)} | ${s.maxFootLatHip.toFixed(3)} | ${s.maxFootMeanDx.toFixed(3)} | ${s.maxShoeLift.toFixed(3)} | ${pass ? 'PASS' : 'fail'}`)
}
