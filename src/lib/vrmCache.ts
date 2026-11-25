import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'

/**
 * Module-level VRM cache (fix pass 3, defect 4).
 *
 * The problem: the tab shell unmounts the Menu tab on every tab switch,
 * and VrmModel used to fetch + parse the 14 MB vita.vrm from scratch on
 * every mount — ~23 s the first time, ~20 s again on every return.
 *
 * The fix: the parsed VRM (and the bytes it came from) live here, once,
 * for the whole page lifetime. The first mount — or the idle prewarm
 * from App — downloads and parses the file; every later mount (Menu
 * return, Agent tab's Vita stage) reuses the SAME VRM object and skips
 * the download, the GLTF parse, the rest pose and the bounds measuring
 * entirely. What a mount still builds fresh, every time, is its own
 * renderer / scene / camera / lights and its own render loop — and on
 * unmount it frees exactly those, never the shared VRM (see the
 * detach in VrmModel's cleanup: the VRM subtree is removed from the
 * scene BEFORE the dispose traverse, so its geometries/materials are
 * never disposed out from under the cache).
 *
 * Why sharing one VRM object is safe here: only one VrmModel is ever
 * mounted at a time (the tab shell mounts one tab; MenuVita mounts one
 * layout), so there is never a fight over the scene graph — a mount
 * re-parents vrm.scene into its own group, the previous mount already
 * detached it. The rest pose, bounds and base rotations are
 * deterministic for this file, so they are computed once in prepare()
 * and reused. Per-mount state (walk rig, hand book, lip-sync, blink)
 * is rebuilt by VrmModel from the shared bones each time.
 *
 * WebGL rule still holds: one renderer / one context at a time, each
 * mount forceContextLoss()es its own context on unmount (fix pass 2).
 * The cache holds no renderer and no GL resources of its own.
 */

const MODEL_URL = '/vrm/vita.vrm'

export interface CachedVrm {
  vrm: VRM
  /** Posed bounds (world space, group at origin with faceFrontQuat). */
  box: THREE.Box3
  size: THREE.Vector3
  centre: THREE.Vector3
  eyePos: THREE.Vector3
  /** Rotation that faces the model toward +Z (the camera). */
  faceFrontQuat: THREE.Quaternion
  chestBaseRotationX: number
  headBaseRotationX: number
}

/**
 * Rotate a bone by a WORLD-space axis/angle. THREE's
 * Object3D.rotateOnWorldAxis assumes no rotated parent — the VRM's bone
 * chain (and the group's faceFront rotation) breaks that assumption and
 * the arms rotated UP instead of down. Doing the parent-space conversion
 * explicitly is correct regardless of the hierarchy:
 * q' = P^-1 * Q * P * q.
 */
function rotateBoneWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  const parentQ = new THREE.Quaternion()
  bone.parent?.getWorldQuaternion(parentQ)
  const qWorld = new THREE.Quaternion().setFromAxisAngle(axis, angle)
  const delta = parentQ
    .clone()
    .invert()
    .multiply(qWorld)
    .multiply(parentQ)
  bone.quaternion.premultiply(delta)
}

let cached: CachedVrm | null = null
let loadingPromise: Promise<CachedVrm> | null = null
let progress = 0
const progressListeners = new Set<(p: number) => void>()

function setProgress(p: number): void {
  // Monotonic: the fetch phase reports 0–90 and the parse phase 100,
  // and a late listener must never see the bar go backwards.
  const next = Math.max(progress, Math.min(100, Math.round(p)))
  if (next === progress) return
  progress = next
  progressListeners.forEach((cb) => {
    try {
      cb(progress)
    } catch {
      // A progress listener must never break the load.
    }
  })
}

export function getVrmLoadProgress(): number {
  return progress
}

/** Subscribe to load progress; called immediately with the current value. */
export function subscribeVrmProgress(cb: (p: number) => void): () => void {
  progressListeners.add(cb)
  try {
    cb(progress)
  } catch {
    // Ignore a throwing listener.
  }
  return () => {
    progressListeners.delete(cb)
  }
}

/** Download the .vrm bytes with byte progress (fetch 0–90%). */
async function fetchModelBytes(): Promise<ArrayBuffer> {
  const res = await fetch(MODEL_URL)
  if (!res.ok) throw new Error(`VRM fetch failed: ${res.status}`)
  if (!res.body) {
    // No stream (odd embed) — fall back to a plain buffered fetch.
    const buf = await res.arrayBuffer()
    setProgress(90)
    return buf
  }
  const total = Number(res.headers.get('content-length') || 0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      loaded += value.length
      // 14 359 044 bytes on disk; without a content-length, scale
      // against that known size so the bar still moves honestly.
      const denom = total > 0 ? total : 14359044
      setProgress((loaded / denom) * 90)
    }
  }
  setProgress(90)
  const out = new Uint8Array(loaded)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out.buffer
}

/**
 * One-time preparation of a freshly parsed VRM — everything VrmModel
 * used to redo on every mount, moved here so it runs exactly once:
 * the YuriOS loader passes, the rest pose (arms down, measured from
 * the bones), the spring-bone reset, and the POSED bounds + eye
 * position the camera framing is measured from. Runs on a throwaway
 * group (no renderer needed); the mount re-parents vrm.scene into its
 * own group with the same faceFrontQuat, so the cached bounds stay
 * valid.
 */
function prepare(vrm: VRM): CachedVrm {
  VRMUtils.removeUnnecessaryVertices(vrm.scene)
  VRMUtils.combineSkeletons(vrm.scene)
  vrm.scene.traverse((o) => {
    o.frustumCulled = false
  })

  const group = new THREE.Group()
  group.add(vrm.scene)

  // Face the camera (+Z): rotate faceFront onto +Z.
  const faceFrontQuat = new THREE.Quaternion()
  try {
    const faceFront = vrm.lookAt?.faceFront
    if (faceFront) {
      faceFrontQuat.setFromUnitVectors(faceFront.clone().normalize(), new THREE.Vector3(0, 0, 1))
      group.quaternion.copy(faceFrontQuat)
    }
  } catch {
    // No lookAt on this rig — VRoid VRM 0.x faces +Z by default.
  }
  vrm.springBoneManager?.reset()
  group.updateMatrixWorld(true)

  // Rest pose: arms down. Measured from the bones, not assumed: the
  // shoulder->elbow direction is rotated toward mostly-down with a
  // slight outward angle; the elbow bends a touch forward.
  try {
    const humanoid = vrm.humanoid
    const faceDir = new THREE.Vector3(0, 0, 1)
    for (const side of ['left', 'right'] as const) {
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
        const angle = Math.acos(THREE.MathUtils.clamp(dir.dot(target), -1, 1))
        rotateBoneWorld(upper, axis, angle)
      }
      group.updateMatrixWorld(true)
      const armDir = lower
        .getWorldPosition(new THREE.Vector3())
        .sub(upper.getWorldPosition(new THREE.Vector3()))
        .normalize()
      const bendAxis = new THREE.Vector3().crossVectors(armDir, faceDir)
      if (bendAxis.lengthSq() > 1e-6) {
        bendAxis.normalize()
        rotateBoneWorld(lower, bendAxis, 0.22)
      }
    }
  } catch {
    // Arms stay in the file pose — framing still uses the measured box.
  }
  // Propagate the rig pose to the skinned bones: getNormalizedBoneNode
  // returns three-vrm's NORMALIZED rig nodes, and only vrm.update()
  // copies their rotations onto the original bones the skinning uses.
  vrm.update(0)
  group.updateMatrixWorld(true)

  // POSED bounds: SkinnedMesh.computeBoundingBox applies the current
  // bone transforms (the plain geometry box would still be T-pose).
  const box = new THREE.Box3()
  const childBox = new THREE.Box3()
  vrm.scene.traverse((obj) => {
    if (obj.name.startsWith('VRMC_springBone_collider')) return
    const mesh = obj as THREE.SkinnedMesh
    if (mesh.isSkinnedMesh) {
      // boneMatrices go stale when bones are rotated directly — the
      // renderer refreshes them every frame, but this one-off bounds
      // computation must refresh them explicitly first.
      mesh.skeleton?.update()
      mesh.computeBoundingBox()
      if (mesh.boundingBox) {
        childBox.copy(mesh.boundingBox).applyMatrix4(obj.matrixWorld)
        box.union(childBox)
      }
      return
    }
    const meshObj = obj as THREE.Mesh
    if (meshObj.isMesh && meshObj.geometry) {
      if (!meshObj.geometry.boundingBox) meshObj.geometry.computeBoundingBox()
      if (meshObj.geometry.boundingBox) {
        childBox.copy(meshObj.geometry.boundingBox).applyMatrix4(obj.matrixWorld)
        box.union(childBox)
      }
    }
  })
  if (box.isEmpty()) throw new Error('VRM bounds are empty')
  const size = new THREE.Vector3()
  const centre = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(centre)

  const headNode = vrm.humanoid?.getNormalizedBoneNode('head')
  const eyeNode =
    vrm.humanoid?.getNormalizedBoneNode('leftEye') ?? vrm.humanoid?.getNormalizedBoneNode('rightEye')
  const eyePos = eyeNode
    ? eyeNode.getWorldPosition(new THREE.Vector3())
    : headNode
      ? headNode.getWorldPosition(new THREE.Vector3())
      : centre.clone()

  const chestNode = vrm.humanoid?.getNormalizedBoneNode('chest')
  const chestBaseRotationX = chestNode ? chestNode.rotation.x : 0
  const headBaseRotationX = headNode ? headNode.rotation.x : 0

  return { vrm, box, size, centre, eyePos, faceFrontQuat, chestBaseRotationX, headBaseRotationX }
}

async function loadOnce(): Promise<CachedVrm> {
  const bytes = await fetchModelBytes()
  const loader = new GLTFLoader()
  loader.register((parser) => new VRMLoaderPlugin(parser))
  const gltf = await loader.parseAsync(bytes, '')
  const vrm = gltf.userData.vrm as VRM | undefined
  if (!vrm) throw new Error('No VRM in file')
  const prepared = prepare(vrm)
  setProgress(100)
  return prepared
}

/**
 * The cached VRM, loading it if needed. Concurrent callers share the
 * one in-flight promise (a tab switch mid-load does not restart the
 * download). A failure clears the promise so the next mount retries
 * instead of caching the rejection forever. onProgress is called with
 * the current value immediately, then on every change.
 */
export function loadVrm(onProgress?: (p: number) => void): Promise<CachedVrm> {
  if (cached) {
    onProgress?.(100)
    return Promise.resolve(cached)
  }
  if (!loadingPromise) {
    loadingPromise = loadOnce().then(
      (entry) => {
        cached = entry
        return entry
      },
      (err: unknown) => {
        // Let the next caller retry from scratch.
        loadingPromise = null
        progress = 0
        throw err
      },
    )
  }
  if (onProgress) {
    // subscribeVrmProgress calls back immediately with the current
    // value; unsubscribe once settled so a mount does not leak a
    // listener (the cached value needs no further updates anyway).
    const unsub = subscribeVrmProgress(onProgress)
    void loadingPromise.then(unsub, unsub)
  }
  return loadingPromise
}

/** Start the load in the background; failures are swallowed here — the
    mount that actually needs the model reports them. */
export function preloadVrm(): void {
  void loadVrm().catch(() => undefined)
}
