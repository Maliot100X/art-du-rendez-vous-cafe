import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import useDimensions from 'react-cool-dimensions'
import { avatarBridge, type AvatarBridge } from '../lib/avatarBridge'
import { pixelRatioCap } from '../lib/perf'
import { useReducedMotion } from '../lib/scroll'

/**
 * Vita — VRM 0.x full-body model (CC0, VRoid sample), rendered with
 * @pixiv/three-vrm on a plain Three.js stage. No OrbitControls: fixed
 * camera, the model turns to face it.
 *
 * Framing (measured from the file, not guessed — see /tmp/measure-vita.js):
 * Vita is 1.713 m tall, eyes at 1.531 m (89% of height), head bone 1.466 m.
 * The file stores the body in a T-pose (arms out, 1.38 m wide), which
 * would shrink the whole figure to fit the width and leave a ~56 px head
 * on a phone — so a rest pose is applied at load (arms down, slight
 * outward angle, small elbow bend), measured from the bone directions
 * themselves, and the camera is framed from the POSED bounds
 * (SkinnedMesh.computeBoundingBox accounts for the pose; the geometry
 * bounding boxes alone would still be the T-pose).
 * Full-body framing then gives a ~70 px head at 390 px phone width;
 * the "Visage" toggle reframes to head + shoulders for a close-up.
 *
 * Lip-sync: speechSynthesis exposes no audio stream, so there is no real
 * RMS — src/lib/speech.ts drives avatarBridge with a speech-timed
 * syllabic envelope shaped by the YuriOS constants (gain 5.0, amp^0.7,
 * gate 0.04, cap 0.7), and this loop stages it into the VRM `aa`
 * expression. Idle motion: gentle breathing (chest) + sway. Nod: the
 * head dips when speaking starts.
 *
 * If anything fails (no WebGL on this device, model unreachable), the
 * stage falls back to a large clear portrait and reports it via
 * onFailed, so the Agent can switch to the Nekomi Live2D stage — never
 * a blank stage.
 *
 * Sizing: react-cool-dimensions measures the stage's REAL rendered size
 * (ResizeObserver) and the camera reframes from that measurement, never
 * from an assumed width — the fix for the failed "top 32%" Live2D
 * framing, applied here too.
 */

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

const MODEL_URL = '/vrm/vita.vrm'
const FOV = 30
/** One walk: three steps, ~0.7 s per step, and a real lateral traverse —
    she walks from one side of the stage to the other and STAYS there
    (alternating sides each trigger). The previous version swung the legs
    in place for 1.4 s and then restored the exact rest pose, so any
    screenshot taken after the window showed the identical pose and the
    walk was invisible. */
const WALK_DURATION = 2.2
const WALK_SIDE = 0.32

type Framing = 'full' | 'half' | 'face'

/** Bones the procedural walk drives, with their rest-pose rotation.x. */
interface WalkRig {
  leftUpperLeg: THREE.Object3D
  rightUpperLeg: THREE.Object3D
  leftLowerLeg: THREE.Object3D
  rightLowerLeg: THREE.Object3D
  leftUpperArm: THREE.Object3D
  rightUpperArm: THREE.Object3D
  baseX: Map<THREE.Object3D, number>
}

interface VrmDebug {
  status: string
  framing: Framing
  stageW: number
  stageH: number
  boundsSize: [number, number, number]
  boundsCentre: [number, number, number]
  eyeWorld: [number, number, number]
  cameraDist: number
  /** Projected eye position in stage pixels (from the top-left). */
  eyeScreenPx: [number, number]
  /** Projected head height (hair top -> chin) in stage pixels. */
  headHeightPx: number
  /** Projected full-body height in stage pixels. */
  bodyHeightPx: number
}

declare global {
  interface Window {
    __vrmDebug?: VrmDebug
  }
}

interface ThreeStage {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  vrm: VRM
  group: THREE.Group
  box: THREE.Box3
  size: THREE.Vector3
  centre: THREE.Vector3
  eyePos: THREE.Vector3
  chestBaseRotationX: number
  headBaseRotationX: number
  walkRig: WalkRig | null
}

export default function VrmModel({
  bridge = avatarBridge,
  onFailed,
  compact = false,
  walkTick = 0,
}: {
  bridge?: AvatarBridge
  onFailed?: () => void
  /**
   * Compact menu stage: shorter, defaults to the head-to-knees framing
   * so the face stays large on a phone and the walk stays visible.
   */
  compact?: boolean
  /**
   * Walk trigger: every increment starts one procedural walk cycle
   * (legs + arms swing, hips bob). No walk VRMA exists on disk —
   * utsuwa's VRMA_01–07 are emotes (Show Full Body, Greeting, Peace
   * Sign, Shoot, Spin, Model Pose, Squat) and idle_*.vrma are idle
   * loops — so the walk is bone-driven here, not a clip.
   */
  walkTick?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const threeRef = useRef<ThreeStage | null>(null)
  const framingRef = useRef<Framing>(compact ? 'half' : 'full')
  const walkRef = useRef({ t: Infinity, fromX: 0, toX: 0 })
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [progress, setProgress] = useState(0)
  const [framing, setFraming] = useState<Framing>(compact ? 'half' : 'full')
  const { observe, width: stageW, height: stageH } = useDimensions<HTMLDivElement>()
  const failedRef = useRef(false)
  const reducedMotion = useReducedMotion()

  const setStageRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el
      if (el) observe(el)
    },
    [observe],
  )

  framingRef.current = framing

  /* ---- Walk trigger: each increment starts one traverse. ---- */
  useEffect(() => {
    if (walkTick > 0 && !reducedMotion) {
      const w = walkRef.current
      w.fromX = w.toX
      w.toX = w.toX >= 0 ? -WALK_SIDE : WALK_SIDE
      w.t = 0
    }
  }, [walkTick, reducedMotion])

  /* ---- Framing: measured box + stage size -> camera. ---- */
  const layout = useCallback(() => {
    const three = threeRef.current
    const container = containerRef.current
    if (!three || !container) return
    const w = container.clientWidth
    const h = container.clientHeight
    if (!w || !h) return
    three.renderer.setSize(w, h, false)
    const { camera, box, size, centre, eyePos } = three
    const aspect = w / h
    const halfTan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    let targetY: number
    let framedH: number
    let framedW: number
    if (framingRef.current === 'face') {
      // Head + shoulders: hair top (box.max.y) down to the chest.
      // Window 0.62 m tall, centred 0.10 m below the eyes.
      targetY = eyePos.y - 0.1
      framedH = 0.62
      framedW = 0.55
    } else if (framingRef.current === 'half') {
      // Head to knees: the face stays ~2x larger than full-body on a
      // phone, and the legs (and the walk) stay in frame.
      targetY = eyePos.y - 0.28
      framedH = 0.95
      framedW = 0.6
    } else {
      targetY = centre.y
      framedH = size.y * 1.03
      framedW = size.x * 1.06
    }
    const dist = Math.max(framedH / 2 / halfTan, framedW / 2 / (halfTan * aspect))
    camera.aspect = aspect
    camera.position.set(0, targetY, dist)
    camera.lookAt(0, targetY, 0)
    camera.updateProjectionMatrix()
    three.renderer.render(three.scene, camera)

    // Debug projection, for verification without a real browser: project
    // the eyes and the head extents into stage pixels.
    const project = (p: THREE.Vector3): [number, number] => {
      const v = p.clone().project(camera)
      return [((v.x + 1) / 2) * w, ((1 - (v.y + 1) / 2) * h)]
    }
    const eyePx = project(eyePos)
    const topPx = project(new THREE.Vector3(0, box.max.y, 0))[1]
    const chinPx = project(new THREE.Vector3(0, eyePos.y - 0.13, 0))[1]
    const feetPx = project(new THREE.Vector3(0, box.min.y, 0))[1]
    window.__vrmDebug = {
      status: 'ready',
      framing: framingRef.current,
      stageW: w,
      stageH: h,
      boundsSize: [size.x, size.y, size.z],
      boundsCentre: [centre.x, centre.y, centre.z],
      eyeWorld: [eyePos.x, eyePos.y, eyePos.z],
      cameraDist: dist,
      eyeScreenPx: [Math.round(eyePx[0]), Math.round(eyePx[1])],
      headHeightPx: Math.round(chinPx - topPx),
      bodyHeightPx: Math.round(feetPx - topPx),
    }
  }, [])

  /* ---- Reframe when the measured stage size or framing changes. ---- */
  useEffect(() => {
    if (stageW > 0 && stageH > 0) layout()
  }, [stageW, stageH, framing, layout])

  /* ---- Load + render loop, once. ---- */
  useEffect(() => {
    let cancelled = false
    let raf = 0
    let renderer: THREE.WebGLRenderer | null = null
    const clock = new THREE.Clock()

    const fail = () => {
      if (cancelled || failedRef.current) return
      failedRef.current = true
      window.__vrmDebug = {
        ...(window.__vrmDebug as VrmDebug),
        status: 'failed',
        framing: framingRef.current,
        stageW: containerRef.current?.clientWidth ?? 0,
        stageH: containerRef.current?.clientHeight ?? 0,
        boundsSize: [0, 0, 0],
        boundsCentre: [0, 0, 0],
        eyeWorld: [0, 0, 0],
        cameraDist: 0,
        eyeScreenPx: [0, 0],
        headHeightPx: 0,
        bodyHeightPx: 0,
      }
      setStatus('failed')
      onFailed?.()
    }

    const init = async () => {
      const container = containerRef.current
      if (!container) return
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      } catch {
        fail()
        return
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap()))
      renderer.setClearColor(0x000000, 0)
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;'
      renderer.domElement.setAttribute('aria-hidden', 'true')
      container.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
      scene.add(new THREE.AmbientLight(0xfff2e0, 1.15))
      const key = new THREE.DirectionalLight(0xffffff, 1.6)
      key.position.set(2, 3, 4)
      scene.add(key)
      const rim = new THREE.DirectionalLight(0xdfe8ff, 0.6)
      rim.position.set(-2, 2, -3)
      scene.add(rim)

      let gltf
      try {
        const loader = new GLTFLoader()
        loader.register((parser) => new VRMLoaderPlugin(parser))
        gltf = await loader.loadAsync(MODEL_URL, (e) => {
          if (!cancelled && e.total) setProgress(Math.round((e.loaded / e.total) * 100))
        })
      } catch {
        fail()
        return
      }
      if (cancelled) return
      const vrm = gltf.userData.vrm as VRM | undefined
      if (!vrm) {
        fail()
        return
      }

      // YuriOS VrmLoader passes, in order.
      VRMUtils.removeUnnecessaryVertices(vrm.scene)
      VRMUtils.combineSkeletons(vrm.scene)
      vrm.scene.traverse((o) => {
        o.frustumCulled = false
      })

      const group = new THREE.Group()
      group.add(vrm.scene)
      scene.add(group)

      // Face the camera (+Z): rotate faceFront onto +Z.
      try {
        const faceFront = vrm.lookAt?.faceFront
        if (faceFront) {
          const q = new THREE.Quaternion().setFromUnitVectors(
            faceFront.clone().normalize(),
            new THREE.Vector3(0, 0, 1),
          )
          group.quaternion.premultiply(q)
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
      // Without this, the rendered arms stay in T-pose and the bounds
      // below still measure the T-pose.
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
      if (box.isEmpty()) {
        fail()
        return
      }
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

      // Walk rig: the six bones the procedural walk drives, with their
      // rest-pose rotation.x so the cycle can add swing on top and
      // return exactly to rest afterwards.
      let walkRig: WalkRig | null = null
      try {
        const humanoid = vrm.humanoid
        const nodes = {
          leftUpperLeg: humanoid.getNormalizedBoneNode('leftUpperLeg'),
          rightUpperLeg: humanoid.getNormalizedBoneNode('rightUpperLeg'),
          leftLowerLeg: humanoid.getNormalizedBoneNode('leftLowerLeg'),
          rightLowerLeg: humanoid.getNormalizedBoneNode('rightLowerLeg'),
          leftUpperArm: humanoid.getNormalizedBoneNode('leftUpperArm'),
          rightUpperArm: humanoid.getNormalizedBoneNode('rightUpperArm'),
        } as Record<keyof Omit<WalkRig, 'baseX'>, THREE.Object3D | null>
        if (Object.values(nodes).every(Boolean)) {
          const baseX = new Map<THREE.Object3D, number>()
          Object.values(nodes).forEach((n) => baseX.set(n as THREE.Object3D, (n as THREE.Object3D).rotation.x))
          walkRig = { ...(nodes as Omit<WalkRig, 'baseX'>), baseX }
        }
      } catch {
        // No walk rig — the model still renders, it just never walks.
      }

      threeRef.current = {
        renderer,
        scene,
        camera,
        vrm,
        group,
        box,
        size,
        centre,
        eyePos,
        chestBaseRotationX,
        headBaseRotationX,
        walkRig,
      }
      layout()
      setStatus('ready')

      // ---- Per-frame loop: VRM update, breathing, lip-sync, nod, blink.
      let happyWeight = 0
      let wasSpeaking = false
      let nodT = 1
      let nextBlinkAt = 2.5
      let blinkUntil = 0
      const loop = () => {
        if (cancelled) return
        raf = requestAnimationFrame(loop)
        // Hidden tab: skip the work entirely (rAF already throttles in
        // background tabs, but the guard also covers a hidden iframe).
        if (document.hidden) return
        const dt = Math.min(clock.getDelta(), 0.1)
        const t = clock.elapsedTime
        const three = threeRef.current
        if (!three) return
        three.vrm.update(dt)

        // Procedural walk: while the traverse runs, legs and arms swing
        // in opposition and the hips bob, AND the whole model walks
        // laterally from one side of the stage to the other (smoothstep
        // over the full cycle) and stays there. The envelope fades the
        // limb swing in and out so the cycle starts and ends at the
        // rest pose — but the lateral position is kept, so the walk is
        // visible in a screenshot taken after it ends, not just during.
        const rig = three.walkRig
        if (rig) {
          const wt = walkRef.current.t
          if (wt < WALK_DURATION) {
            walkRef.current.t = wt + dt
            const phase = (wt / 0.7) * Math.PI * 2
            const env = Math.min(1, wt / 0.15) * Math.min(1, (WALK_DURATION - wt) / 0.25)
            const s = Math.sin(phase)
            const setX = (node: THREE.Object3D, v: number) => {
              node.rotation.x = (rig.baseX.get(node) ?? 0) + v * env
            }
            // Forward swing is negative rotation.x (legs point down, the
            // model faces +Z): left leg forward while right arm forward.
            setX(rig.leftUpperLeg, -0.62 * s)
            setX(rig.rightUpperLeg, 0.62 * s)
            setX(rig.leftLowerLeg, 0.34 * Math.max(0, Math.sin(phase + Math.PI / 2)))
            setX(rig.rightLowerLeg, 0.34 * Math.max(0, Math.sin(phase - Math.PI / 2)))
            setX(rig.leftUpperArm, 0.45 * s)
            setX(rig.rightUpperArm, -0.45 * s)
            three.group.position.y = 0.03 * Math.abs(s) * env
            const u = Math.min(1, wt / WALK_DURATION)
            const smooth = u * u * (3 - 2 * u)
            three.group.position.x =
              walkRef.current.fromX + (walkRef.current.toX - walkRef.current.fromX) * smooth
          } else if (walkRef.current.t !== Infinity) {
            // Traverse finished: restore the rest pose exactly, once —
            // but KEEP the lateral position, so she is visibly standing
            // on the other side of the stage.
            walkRef.current.t = Infinity
            rig.baseX.forEach((base, node) => {
              node.rotation.x = base
            })
            three.group.position.y = 0
            three.group.position.x = walkRef.current.toX
          }
        }

        const speaking = bridge.isSpeaking()
        if (speaking && !wasSpeaking) nodT = 0
        wasSpeaking = speaking

        // Mouth: the bridge value (speech envelope, YuriOS-shaped).
        try {
          three.vrm.expressionManager?.setValue('aa', bridge.getMouthOpen())
        } catch {
          // Expression absent on this rig — ignore.
        }
        // Expression: ease toward happy while speaking.
        happyWeight += ((speaking ? 1 : 0) - happyWeight) * Math.min(1, dt * 6)
        try {
          three.vrm.expressionManager?.setValue('happy', happyWeight * 0.7)
        } catch {
          // Ignore.
        }
        // Blink: brief lid close every few seconds.
        if (t > nextBlinkAt) {
          blinkUntil = t + 0.12
          nextBlinkAt = t + 2.8 + Math.random() * 2.2
        }
        try {
          three.vrm.expressionManager?.setValue('blink', t < blinkUntil ? 1 : 0)
        } catch {
          // Ignore.
        }

        // Idle breathing + sway (off for reduced motion), nod on speak.
        const swayAmp = reducedMotion ? 0 : 1
        if (chestNode) {
          chestNode.rotation.x = three.chestBaseRotationX + 0.02 * Math.sin(t * 1.2) * swayAmp
        }
        three.group.rotation.y = 0.03 * Math.sin(t * 0.5) * swayAmp
        if (headNode) {
          let nod = 0
          if (nodT < 0.6) {
            nodT += dt
            nod = 0.12 * Math.sin(Math.min(1, nodT / 0.6) * Math.PI)
          }
          headNode.rotation.x = three.headBaseRotationX + nod
        }
        three.renderer.render(three.scene, three.camera)
      }
      raf = requestAnimationFrame(loop)
    }

    void init()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      const three = threeRef.current
      threeRef.current = null
      if (three) {
        three.scene.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (mesh.isMesh) {
            mesh.geometry?.dispose()
            const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
            else mat?.dispose()
          }
        })
        // Actually give the GL context back to the browser: dispose()
        // alone does not free the context, and a page that keeps
        // creating contexts (tab switches) eventually hits the browser's
        // context limit — the next renderer creation then fails and the
        // stage (or the page) goes black.
        try {
          three.renderer.forceContextLoss()
        } catch {
          // Context already lost — nothing to free.
        }
        three.renderer.dispose()
        if (three.renderer.domElement.parentElement === containerRef.current) {
          containerRef.current?.removeChild(three.renderer.domElement)
        }
      } else if (renderer) {
        try {
          renderer.forceContextLoss()
        } catch {
          // Context already lost — nothing to free.
        }
        renderer.dispose()
        if (renderer.domElement.parentElement === containerRef.current) {
          containerRef.current?.removeChild(renderer.domElement)
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, onFailed])

  return (
    <div className="min-w-0 overflow-hidden rounded-[1.75rem] border border-line bg-ink-2">
      <div
        ref={setStageRef}
        className={`relative touch-pan-y ${
          compact ? 'h-[260px] sm:h-[300px] lg:h-[480px]' : 'h-[520px] sm:h-[540px] lg:h-[560px]'
        }`}
        style={{
          background:
            'radial-gradient(70% 70% at 50% 30%, rgba(232,163,61,0.14), transparent 70%), #171210',
        }}
      >
        {status !== 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <img
              src="/images/nekomi-icon.png"
              alt="Nekomi — portrait de l’agent"
              className={`rounded-full border border-amber/40 object-cover shadow-2xl shadow-black/50 ${
                compact ? 'h-24 w-24 sm:h-28 sm:w-28' : 'h-48 w-48 sm:h-56 sm:w-56'
              }`}
            />
            <p className="mt-5 font-display text-2xl italic text-bone">Vita</p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-mist">
              {status === 'loading'
                ? `Le modèle 3D se prépare — ${progress > 0 ? `${progress} % — ` : ''}il apparaîtra ici en pied, visage visible.`
                : 'Le modèle 3D n’a pas pu se charger ici — le chat et la commande ci-contre fonctionnent normalement.'}
            </p>
            <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-line bg-ink px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-bone/70">
              <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-amber" />
              {status === 'loading' ? 'Modèle en cours de chargement' : 'Modèle indisponible'}
            </span>
          </div>
        )}
        <div className="absolute left-4 top-4 rounded-full border border-white/15 bg-black/30 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/85 backdrop-blur">
          {compact ? 'Vita · 3D' : 'VRM · Vita · corps entier'}
        </div>
      </div>
      {/* Framing controls live BELOW the stage, in the caption row —
          they used to float over the bottom of the stage and cover
          Vita's feet/shoes in "Corps entier". */}
      {status === 'ready' && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 sm:px-5">
          <div
            className="flex rounded-full border border-line bg-ink p-1"
            role="group"
            aria-label="Cadrage du modèle"
          >
            {(
              [
                { id: 'full', label: 'Corps entier' },
                { id: 'half', label: 'Mi-corps' },
                { id: 'face', label: 'Visage' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFraming(opt.id)}
                aria-pressed={framing === opt.id}
                className={`min-h-11 rounded-full px-4 py-2 text-xs font-bold transition-all duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] ${
                  framing === opt.id ? 'bg-bone text-ink' : 'text-bone/70 hover:text-bone'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-mist">
            {compact
              ? 'Vita — elle marche vers la catégorie choisie et vous lit les prix à voix haute.'
              : 'Vita — modèle 3D en pied. Elle parle, hoche la tête et respire ; « Visage » zoome sur son visage.'}
          </p>
        </div>
      )}
      {status !== 'ready' && (
        <p className="border-t border-line px-4 py-2.5 text-xs leading-relaxed text-mist sm:px-5 sm:py-3">
          {compact
            ? 'Vita — elle marche vers la catégorie choisie et vous lit les prix à voix haute.'
            : 'Vita — modèle 3D en pied. Elle parle, hoche la tête et respire ; « Visage » zoome sur son visage.'}
        </p>
      )}
    </div>
  )
}
