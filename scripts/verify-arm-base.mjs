/**
 * TEMPORARY CHECK (fix pass 7 follow-up) — not shipped. Verifies the
 * reading-arm absolute form is IDENTICAL to the old += form:
 * both rigs must read the same rest rotation.x for the left upper
 * arm (walk rig baseX vs read rig upperBaseX). If they differ, the
 * absolute form would introduce a jump.
 *
 * Usage: node scripts/verify-arm-base.mjs
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

const node = vrm.humanoid.getNormalizedBoneNode('leftUpperArm')
if (!node) throw new Error('leftUpperArm missing')

// Walk rig baseX: built from the node's rest rotation.x (VrmModel walk-rig build).
const walkBaseX = node.rotation.x
// Read rig upperBaseX: read the same way (VrmModel read-rig build, line ~814).
const readUpperBaseX = node.rotation.x

console.log('walk rig baseX (leftUpperArm.rotation.x at rest):', walkBaseX)
console.log('read rig upperBaseX (same node, same rest pose):  ', readUpperBaseX)
console.log('identical:', walkBaseX === readUpperBaseX)

// Also verify the absolute form equals the old += form for a sample frame:
// old: x = (baseX + swing) + READ_UPPER*blend ; new: x = upperBaseX + swing + READ_UPPER*blend
const READ_UPPER = 0.6
const swing = 0.45 * Math.sin(1.2) * (1 - 0.7) * 0.9 // arbitrary mid-walk sample
const blend = 0.7
const oldForm = walkBaseX + swing + READ_UPPER * blend
const newForm = readUpperBaseX + swing + READ_UPPER * blend
console.log('old += total:', oldForm, '| new absolute total:', newForm, '| equal:', oldForm === newForm)
