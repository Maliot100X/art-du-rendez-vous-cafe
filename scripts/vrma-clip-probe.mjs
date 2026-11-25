/**
 * TEMPORARY PROBE (fix pass 11) — not shipped. Loads the ACTUAL vita.vrm
 * + the ACTUAL 4 open-vrma clips with the ACTUAL @pixiv/three-vrm-animation
 * 3.6.0, headlessly in Node (no WebGL renderer — parse / retarget /
 * mixer math only). Answers: do the clips parse, do
 * createVRMAnimationClip's tracks bind to Vita's real normalized bones,
 * and does the AnimationMixer move those bones (walk bend, idle sway)
 * with crossfades? It does NOT answer what the walk looks like on
 * screen — no WebGL2 on this VM, so the first real look is a phone.
 *
 * Usage: node scripts/vrma-clip-probe.mjs
 */
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Node has no `self` (GLTFLoader's loadImageSource uses self.URL).
globalThis.self = globalThis

// GLTFLoader needs an ImageLoader; Node has no document. Textures are
// irrelevant to bone math — stub the image with a 1x1 placeholder
// (same stub as scripts/runtime-walk-probe.mjs).
THREE.ImageLoader.prototype.load = function (_url, onLoad) {
  if (onLoad) onLoad({ width: 1, height: 1 })
  return new THREE.Texture()
}

const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
const { VRMLoaderPlugin } = await import('@pixiv/three-vrm')
const {
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
  createVRMAnimationClip,
} = await import('@pixiv/three-vrm-animation')

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const toBuf = (p) => {
  const b = readFileSync(p)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

// Capture three.js binding warnings (unresolved track targets warn here).
const warnings = []
const origWarn = console.warn
console.warn = (...args) => {
  warnings.push(args.map(String).join(' '))
  origWarn(...args)
}

const loader = new GLTFLoader()
loader.register((parser) => new VRMLoaderPlugin(parser))
loader.register((parser) => new VRMAnimationLoaderPlugin(parser))

// 1. The real Vita.vrm.
const vrmGltf = await loader.parseAsync(toBuf(path.join(ROOT, 'public', 'vrm', 'vita.vrm')), '')
const vrm = vrmGltf.userData.vrm
if (!vrm) throw new Error('No VRM in file')
console.log('VRM loaded. humanoid:', !!vrm.humanoid, '| lookAt:', !!vrm.lookAt)
const group = new THREE.Group()
group.add(vrm.scene)
vrm.update(0)

// 2. The lookAt proxy (what vrmClips.ts adds before creating clips).
if (vrm.lookAt) {
  const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt)
  proxy.name = 'VRMLookAtQuaternionProxy'
  vrm.scene.add(proxy)
  console.log('Proxy added as direct child of vrm.scene:', vrm.scene.children.includes(proxy))
}

// 3. The four clips: parse + retarget onto Vita.
const CLIPS = ['Idle_Loop', 'Idle_Talking_Loop', 'Walk_Loop', 'Walk_Carry_Loop']
const clips = {}
for (const name of CLIPS) {
  const gltf = await loader.parseAsync(
    toBuf(path.join(ROOT, 'public', 'vrma', `${name}.vrma`)),
    '',
  )
  const anim = gltf.userData.vrmAnimations?.[0]
  if (!anim) throw new Error(`No VRMAnimation in ${name}.vrma`)
  const clip = createVRMAnimationClip(anim, vrm)
  clips[name] = clip
  const bones = new Set(clip.tracks.map((t) => t.name.split('.')[0]))
  console.log(
    `${name}: duration ${clip.duration.toFixed(2)}s, ${clip.tracks.length} tracks, ${bones.size} bones`,
  )
}

// 4. Mixer: does it move Vita's real bones?
const mixer = new THREE.AnimationMixer(vrm.scene)
const actions = {}
for (const name of CLIPS) {
  const a = mixer.clipAction(clips[name])
  a.setLoop(THREE.LoopRepeat, Infinity)
  actions[name] = a
}
const bone = (n) => vrm.humanoid.getNormalizedBoneNode(n)
const rot = (n) => {
  const b = bone(n)
  return b ? [b.rotation.x, b.rotation.y, b.rotation.z].map((v) => Math.round(v * 1000) / 1000) : null
}
const WATCH = ['hips', 'spine', 'chest', 'head', 'leftUpperArm', 'leftLowerArm', 'leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg']

function snapshot(label) {
  const out = {}
  for (const n of WATCH) out[n] = rot(n)
  console.log(label, JSON.stringify(out))
}

actions.Idle_Loop.play()
mixer.update(0.5)
vrm.humanoid.update()
snapshot('idle  t=0.5 :')
mixer.update(0.5)
vrm.humanoid.update()
snapshot('idle  t=1.0 :')

// Crossfade idle -> walk (the loop's fadeOut/fadeIn pattern).
actions.Idle_Loop.fadeOut(0.4)
actions.Walk_Loop.reset().fadeIn(0.4).play()
mixer.update(0.5)
vrm.humanoid.update()
console.log(
  'crossfade weights: walk',
  Math.round(actions.Walk_Loop.getEffectiveWeight() * 100) / 100,
  '| idle',
  Math.round(actions.Idle_Loop.getEffectiveWeight() * 100) / 100,
)
snapshot('walk  t=0.5 :')
mixer.update(0.5)
vrm.humanoid.update()
snapshot('walk  t=1.0 :')

// Walk -> carry (book out).
actions.Walk_Loop.fadeOut(0.4)
actions.Walk_Carry_Loop.reset().fadeIn(0.4).play()
mixer.update(0.5)
vrm.humanoid.update()
snapshot('carry t=0.5 :')

// Carry -> talking.
actions.Walk_Carry_Loop.fadeOut(0.4)
actions.Idle_Talking_Loop.reset().fadeIn(0.4).play()
mixer.update(0.5)
vrm.humanoid.update()
snapshot('talk  t=0.5 :')

// 5. Does the mixer pose reach the RAW skinned bones (what renders)?
const rawKnee = vrm.humanoid.getRawBoneNode('leftLowerLeg')
const normKnee = bone('leftLowerLeg')
console.log(
  'raw knee quat synced from normalized:',
  rawKnee && normKnee
    ? `raw=[${rawKnee.quaternion.toArray().map((v) => Math.round(v * 1000) / 1000)}] norm=[${normKnee.quaternion.toArray().map((v) => Math.round(v * 1000) / 1000)}]`
    : 'MISSING BONE',
)

console.warn = origWarn
console.log('---')
console.log('binding warnings captured:', warnings.length)
for (const w of warnings) console.log('  WARN:', w.slice(0, 200))
if (warnings.length > 0) process.exitCode = 1
console.log('PROBE DONE')
