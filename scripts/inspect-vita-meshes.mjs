/**
 * TEMPORARY PROBE (fix pass 7) — not shipped. Lists Vita's meshes:
 * what covers the legs, which bones each mesh is skinned to, and
 * whether a skirt/dress mesh (skinned to hips/spine, not the legs)
 * hides the knee bend.
 *
 * Usage: node scripts/inspect-vita-meshes.mjs
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
const { VRMLoaderPlugin } = await import('@pixiv/three-vrm')

const VRM_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vrm', 'vita.vrm')
const bytes = readFileSync(VRM_PATH)
const loader = new GLTFLoader()
loader.register((parser) => new VRMLoaderPlugin(parser))
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
const vrm = gltf.userData.vrm
if (!vrm) throw new Error('No VRM in file')

const group = new THREE.Group()
group.add(vrm.scene)
group.updateMatrixWorld(true)

const box = new THREE.Box3()
const v = new THREE.Vector3()
console.log('=== SKINNED MESHES (name | material | world Y range | #bones | leg-bone influence?) ===')
vrm.scene.traverse((o) => {
  if (o.isSkinnedMesh) {
    o.computeBoundingBox()
    const bb = o.boundingBox
    const min = bb.min.clone().applyMatrix4(o.matrixWorld)
    const max = bb.max.clone().applyMatrix4(o.matrixWorld)
    const bones = o.skeleton ? o.skeleton.bones.map((b) => b.name) : []
    const legBones = bones.filter((n) => /UpperLeg|LowerLeg|Foot|Toes/i.test(n))
    const mat = Array.isArray(o.material) ? o.material.map((m) => m.name).join(',') : o.material.name
    console.log(`${o.name} | mat=${mat} | y [${min.y.toFixed(2)}, ${max.y.toFixed(2)}] | bones=${bones.length} legBones=[${legBones.join(',')}]`)
  }
})
console.log('\n=== NON-SKINNED MESHES (rigid, parented — do they cover the legs?) ===')
vrm.scene.traverse((o) => {
  if (o.isMesh && !o.isSkinnedMesh) {
    o.geometry.computeBoundingBox()
    const bb = o.geometry.boundingBox
    const min = bb.min.clone().applyMatrix4(o.matrixWorld)
    const max = bb.max.clone().applyMatrix4(o.matrixWorld)
    if (max.y > 0.3 && min.y < 1.0) {
      console.log(`${o.name} | parent=${o.parent?.name} | y [${min.y.toFixed(2)}, ${max.y.toFixed(2)}] x [${min.x.toFixed(2)}, ${max.x.toFixed(2)}]`)
    }
  }
})
console.log('\n=== SPRING BONE JOINTS (what moves with spring physics, not the walk) ===')
try {
  const joints = vrm.springBoneManager?.joints ?? vrm.springBoneManager?._joints ?? []
  console.log('spring joints:', joints.length)
} catch (e) {
  console.log('springBoneManager unreadable:', String(e).slice(0, 120))
}
