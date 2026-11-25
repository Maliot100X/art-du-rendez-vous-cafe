import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'
import useDimensions from 'react-cool-dimensions'
import { avatarBridge, type AvatarBridge } from '../lib/avatarBridge'
import { createHandBook, type HandBookRig } from '../lib/handBook'
import { pixelRatioCap } from '../lib/perf'
import { useReducedMotion } from '../lib/scroll'
import { loadVrm } from '../lib/vrmCache'

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
 * Hand book (menu tab, `withBook`): a small 3D book prop parented to
 * her leftHand bone (src/lib/handBook.ts). At rest she carries NOTHING
 * in her hand — the closed carry prop is built but hidden (fix pass 6:
 * at rest it read as a flat green slab at her hip, and three passes
 * failed to make it read as a gripped book; hands empty at idle beats
 * a slab). On a reading trigger (`readingTick` + `readingCategory`) the
 * left arm raises it to chest height AND toward the midline (adduction
 * +0.5) — hand (-0.01, 1.10, 0.32), book centre 1.19 m, book top
 * 1.28 m, 12 cm clear of her chin (1.40 m) — the cover opens and the
 * pages turn (~every 4 s) while she speaks; when she finishes, the arm
 * eases back and the book closes. The pose is composed ABSOLUTELY every frame (upper arm
 * from its stored rest base, elbow as a world-axis bend from its
 * stored rest quaternion): the old code added `rotation.x +=` every
 * frame, which accumulated — the forearm spun from the first frame
 * and, once the 2.2 s walk stopped re-setting the upper arm, the
 * whole arm orbited the shoulder and the book swept across her face.
 * The book's world transform is re-aimed every frame from the hand's
 * world position, so its pages stay camera-readable whatever the arm
 * does — and the hand supports the open book from below (book centre
 * 8.5 cm above the hand, palm on its bottom edge), so it is visibly
 * IN her hand, not floating under it.
 *
 * Walk ends (fix pass 4, measured — scripts/sim-fix4-book.mjs): the
 * old ±0.32 m walk pushed the book out of the 0.72 m-wide frame on
 * the left (open spread x[-232..-56] px, carry x[-94..-60] px at
 * -0.32) and left the carry book's bottom corner flush with the
 * stage's bottom edge. The walk now alternates between -0.08 and
 * +0.14 m (0.22 m of travel — her whole body visibly shifts side to
 * side across category switches) and every state (carry/open, both
 * ends, desktop 356×480 + phone 358×260) projects fully inside the
 * frame with ≥15 px margins.
 *
 * The same stage (withBook + reading) also mounts in the Livre tab,
 * beside the big book — see BookTab in App.tsx. Only one tab mounts
 * at a time, so the two mounts never fight over the cached VRM.
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

const FOV = 30
/** One walk: four sidesteps of 0.55 s, and a real lateral traverse —
    she walks from one side of the stage to the other and STAYS there
    (alternating sides each trigger). The legs are solved from the
    planted feet (fbtpods gait — see the walk block), so the walk is
    visible in the legs while it happens AND in her new position after. */
const WALK_DURATION = 2.2
/**
 * Walk ends (fix pass 4, measured — scripts/sim-fix4-book.mjs): the
 * old symmetric ±0.32 m walk pushed the hand book out of the 0.72 m
 * frame on the left side (the book hangs on her left hand). The ends
 * are asymmetric on purpose — -0.08 / +0.14 m — so both props stay
 * inside the frame at both ends, and the 0.22 m of travel still reads
 * as a real traverse across category switches.
 */
const WALK_LEFT = -0.08
const WALK_RIGHT = 0.14

/**
 * fbtpods gait constants (airpodsvr/body.py proportions, Vita H=1.713 m):
 * hip joint 0.530*H = 0.908 m, thigh 0.245*H = 0.420 m, shin 0.246*H =
 * 0.421 m, hip half-width 0.052*H = 0.089 m, ankle 0.039*H = 0.067 m.
 * The walk is a sidestep — she faces the camera and steps sideways.
 * What is used here: the proportions, the knee-as-hinge model
 * (solver.py _u(k,s,f) / pos(k)), the planted-foot lock
 * (skating_correction: a planted foot never slides, it only moves
 * while lifted), the hip lowering when both feet are loaded
 * (solve_body), and the slow-follow heading (body.py HipEstimator,
 * tau 0.6 s). What is NOT used, and why: solve_leg / solve_leg_fk
 * need a MEASURED shin/thigh orientation from an AirPods IMU — there
 * is no tracker on a website, so the gait is phase-driven and the leg
 * angles are solved from the hip + the planted feet instead (closed
 * form, not the solver's 64-point floor-contact root search);
 * fusion.py (Mahony/BudFusion) fuses gyro+accel+magnetometer from
 * those same IMUs — no IMU data exists here, nothing to fuse;
 * math3d.py's rotation helpers (rot_y, axis_angle, heading_of, wrap)
 * are three.js Quaternion/Euler/MathUtils here — the concepts transfer,
 * the code does not; HipEstimator.update needs a headset pose (R_hmd,
 * p_hmd) that does not exist on a website — only its heading-follower
 * idea is used.
 */
const HIP_HALF = 0.089
const LEG_LEN = 0.841
const STEP_DURATION = 0.55
const STEP_COUNT = 4
const KNEE_SWING = 0.6
const THIGH_LIFT = 0.25
const HIP_BOB = 0.02
const HIP_SWAY = 0.05
const WALK_TURN = 0.3

type Framing = 'full' | 'half' | 'face'

/**
 * Bones the procedural walk drives, with their rest-pose rotation.x/z.
 * The pelvis + feet are optional (hip sway + foot levelling); the six
 * core bones are required.
 */
interface WalkRig {
  leftUpperLeg: THREE.Object3D
  rightUpperLeg: THREE.Object3D
  leftLowerLeg: THREE.Object3D
  rightLowerLeg: THREE.Object3D
  leftUpperArm: THREE.Object3D
  rightUpperArm: THREE.Object3D
  hips: THREE.Object3D | null
  leftFoot: THREE.Object3D | null
  rightFoot: THREE.Object3D | null
  baseX: Map<THREE.Object3D, number>
  baseZ: Map<THREE.Object3D, number>
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
  /** Hand-book prop, when attached: world position + reading state. */
  book: { world: [number, number, number]; reading: boolean; blend: number; prop: 'open' | 'none' } | null
  /** Walk state, for the cloud-browser check (see layout() + the walk effect). */
  walk: { tick: number; t: number; x: number; rig: boolean; reducedMotion: boolean; hidden: boolean }
}

declare global {
  interface Window {
    __vrmDebug?: VrmDebug
  }
}

/**
 * Bones the reading pose drives. Everything is stored ABSOLUTELY —
 * the pose is recomputed from these rest values every frame, never
 * accumulated with `rotation.x +=` (see the reading block: the old
 * `+=` spun the arm once the walk stopped re-setting it).
 * - `upperBaseX`: the upper arm's rest-pose rotation.x.
 * - `lowerRestQuat`: the lower arm's rest-pose local quaternion.
 * - `hingeLocal`: the elbow hinge axis, fixed in the UPPER arm's
 *   local frame (measured at load: cross(upper-arm dir, face dir),
 *   pulled into the upper arm's frame — ≈ (0, 1, 0) on this rig).
 *   The elbow bend is a WORLD-axis rotation about that axis, composed
 *   with parent-space quaternions (the f6f7dae discipline): q' =
 *   P^-1 * Q * P * qRest. A plain `rotation.x +=` on the lower arm is
 *   NOT a bend — the normalized lower arm's local X runs nearly along
 *   the forearm, so it only twists the hand (measured: fingers point
 *   at the floor) while the forearm stays pointing down.
 */
interface ReadRig {
  leftUpperArm: THREE.Object3D
  leftLowerArm: THREE.Object3D
  upperBaseX: number
  /** Rest-pose rotation.z of the upper arm — the adduction below is
      composed absolutely from this, like rotation.x. */
  upperBaseZ: number
  lowerRestQuat: THREE.Quaternion
  hingeLocal: THREE.Vector3
}

/**
 * Reading pose, measured from the real VRM file (Node sim over the
 * normalized rig — scripts/sim-fix4-book.mjs), not guessed:
 * upper arm forward +0.60 + elbow bend 0.30 (world-axis) + adduction
 * +0.50 toward the midline puts the hand at (0.01, 1.10, 0.31) with
 * a level forearm pointing forward, fingers forward, and the book
 * centre at 1.19 m — chest height (chest bone 1.15 m), book top
 * 1.28 m, 12 cm clear of her chin (1.40 m) at every blend and on
 * both walked sides. The adduction is what keeps the 26 cm open
 * spread inside the 0.72 m frame: without it the spread sticks 32 px
 * out of the left edge even with no walk, and fully out after a
 * leftward walk. Fix pass 5: the signs were backwards — the elbow
 * hinge in the real frame is -Y, not +Y, so the old -0.60 / +0.60
 * swung the arm backwards and left the hand 6 cm behind the chest
 * plane with the book occluded by the torso.
 */
const READ_UPPER = 0.6
const READ_ELBOW = 0.3
const READ_ADDUCT = 0.5

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
  /** The small book in her left hand (menu tab only). */
  handBook: HandBookRig | null
  readRig: ReadRig | null
}

export default function VrmModel({
  bridge = avatarBridge,
  onFailed,
  compact = false,
  walkTick = 0,
  withBook = false,
  readingTick = 0,
  readingCategory,
  readingSeconds = 10,
  onReadingEnd,
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
  /**
   * Hand book (menu + livre tabs): attach the small book prop to her
   * left hand. The agent tab leaves this off — Vita holds no book there.
   */
  withBook?: boolean
  /**
   * Reading trigger: every increment starts one reading of the hand
   * book on `readingCategory` — she raises the book to chest height,
   * opens it, and turns the pages while she speaks (or for
   * `readingSeconds` when muted / speech is unavailable). The end is
   * reported via `onReadingEnd` so the caller can open the big book
   * tab once she has finished reading aloud.
   */
  readingTick?: number
  readingCategory?: string
  readingSeconds?: number
  onReadingEnd?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const threeRef = useRef<ThreeStage | null>(null)
  const framingRef = useRef<Framing>(compact ? 'half' : 'full')
  const walkRef = useRef({ t: Infinity, fromX: 0, toX: 0, step: -1, footL: -HIP_HALF, footR: HIP_HALF })
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

  /* ---- Walk trigger: each increment starts one traverse. ----
     Fix pass 5: the old `&& !reducedMotion` gate silently killed
     the walk whenever the browser/OS reported
     prefers-reduced-motion, with no log — and the walk IS the
     feature. Reduced motion is already honoured where it matters
     (sway, reading-blend snap); the gate must not swallow the walk. */
  useEffect(() => {
    if (walkTick > 0) {
      const w = walkRef.current
      w.fromX = w.toX
      // Alternate ends: at/near the right end go left, otherwise right.
      w.toX = w.toX >= (WALK_LEFT + WALK_RIGHT) / 2 ? WALK_LEFT : WALK_RIGHT
      w.t = 0
      // Planted feet start under the hips (fbtpods body.py: hip joints
      // 0.052 * height apart) — the gait solves the legs from these.
      w.step = -1
      w.footL = w.fromX - HIP_HALF
      w.footR = w.fromX + HIP_HALF
      // Walk debug hook: record the trigger so the cloud-browser
      // check reads state instead of guessing. layout()'s snapshot
      // is mount-time only (its walkTick is the mount value), so the
      // tick is refreshed here — live walkTick — and t/x per frame
      // in the render loop below.
      const dbg = window.__vrmDebug
      if (dbg) {
        dbg.walk = {
          tick: walkTick,
          t: walkRef.current.t,
          x: threeRef.current?.group.position.x ?? 0,
          rig: !!threeRef.current?.walkRig,
          reducedMotion,
          hidden: document.hidden,
        }
      }
    }
  }, [walkTick, reducedMotion])

  /* ---- Reading state machine (hand book). Time base is
      performance.now so beginReading can run from any effect, even
      before the render loop's clock exists. ---- */
  interface ReadingState {
    active: boolean
    categoryId: string
    startT: number
    seconds: number
    spread: number
    flipT: number
    lastFlipAt: number
    quietSince: number
    swapped: boolean
    ended: boolean
  }
  const readingRef = useRef<ReadingState>({
    active: false,
    categoryId: '',
    startT: 0,
    seconds: 10,
    spread: 0,
    flipT: Infinity,
    lastFlipAt: 0,
    quietSince: -1,
    swapped: false,
    ended: true,
  })
  const readingBlendRef = useRef(0)
  const pendingReadingRef = useRef<{ categoryId: string; seconds: number } | null>(null)
  const onReadingEndRef = useRef(onReadingEnd)
  onReadingEndRef.current = onReadingEnd

  /**
   * Start (or restart) a reading. If the model is still loading, the
   * request waits in pendingReadingRef and init() picks it up once the
   * book exists. Restarting mid-read supersedes the old one — the old
   * reading never reports an end, so a pending big-book open is not
   * fired twice.
   */
  const beginReading = useCallback((categoryId: string, seconds: number) => {
    const r = readingRef.current
    r.active = true
    r.categoryId = categoryId
    r.startT = performance.now() / 1000
    r.seconds = Math.max(4, seconds || 10)
    r.spread = 0
    r.flipT = Infinity
    r.lastFlipAt = 0
    r.quietSince = -1
    r.swapped = false
    r.ended = false
    const three = threeRef.current
    if (three?.handBook) {
      three.handBook.setSpreadsForCategory(categoryId)
    } else {
      pendingReadingRef.current = { categoryId, seconds }
    }
  }, [])

  /* ---- Reading trigger: each increment starts one read. ---- */
  useEffect(() => {
    if (readingTick > 0 && readingCategory) beginReading(readingCategory, readingSeconds)
  }, [readingTick, readingCategory, readingSeconds, beginReading])

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
      // phone, and the legs (and the walk) stay in frame. Window is
      // 0.98 m tall, centred 0.31 m below the eyes (y 0.73–1.71) — it
      // holds the carried book at rest (0.77–0.96 m) and the open
      // book while reading (centre 1.19 m, top 1.28 m, measured —
      // scripts/sim-fix4-book.mjs), so neither clips an edge.
      targetY = eyePos.y - 0.31
      framedH = 0.98
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
      book: null,
      walk: {
        tick: walkTick,
        t: walkRef.current.t,
        x: threeRef.current?.group.position.x ?? 0,
        rig: !!threeRef.current?.walkRig,
        reducedMotion,
        hidden: document.hidden,
      },
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
        book: null,
        walk: {
          tick: walkTick,
          t: walkRef.current.t,
          x: threeRef.current?.group.position.x ?? 0,
          rig: !!threeRef.current?.walkRig,
          reducedMotion,
          hidden: document.hidden,
        },
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

      // The VRM itself is cached at module level (src/lib/vrmCache.ts):
      // the 14 MB download, the GLTF parse, the rest pose and the posed
      // bounds happen once per page lifetime. A mount that arrives after
      // the first load (returning to Menu, or the Agent tab's Vita
      // stage) gets the same parsed VRM back immediately and only
      // builds its own renderer/scene/camera around it.
      let cached
      try {
        cached = await loadVrm((p) => {
          if (!cancelled) setProgress(p)
        })
      } catch {
        fail()
        return
      }
      if (cancelled) return
      const {
        vrm,
        box,
        size,
        centre,
        eyePos,
        faceFrontQuat,
        chestBaseRotationX,
        headBaseRotationX,
      } = cached

      const group = new THREE.Group()
      group.quaternion.copy(faceFrontQuat)
      // Re-parents vrm.scene into this mount's group (it was detached
      // from the previous mount's group on unmount — see cleanup).
      group.add(vrm.scene)
      scene.add(group)
      group.updateMatrixWorld(true)

      // Rest pose, bounds and eye position now come from the cache
      // (src/lib/vrmCache.ts prepare()) — computed once, not per mount.
      const headNode = vrm.humanoid?.getNormalizedBoneNode('head')
      const chestNode = vrm.humanoid?.getNormalizedBoneNode('chest')

      // Walk rig: the six bones the procedural walk drives, with their
      // rest-pose rotation.x/z so the cycle can add swing on top and
      // return exactly to rest afterwards. The pelvis + feet are
      // optional (hip sway + foot levelling) — missing bones just
      // disable those cues, the core gait still runs.
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
        } as Record<keyof Omit<WalkRig, 'baseX' | 'baseZ' | 'hips' | 'leftFoot' | 'rightFoot'>, THREE.Object3D | null>
        if (Object.values(nodes).every(Boolean)) {
          const baseX = new Map<THREE.Object3D, number>()
          const baseZ = new Map<THREE.Object3D, number>()
          Object.values(nodes).forEach((n) => {
            baseX.set(n as THREE.Object3D, (n as THREE.Object3D).rotation.x)
            baseZ.set(n as THREE.Object3D, (n as THREE.Object3D).rotation.z)
          })
          let hips: THREE.Object3D | null = null
          let leftFoot: THREE.Object3D | null = null
          let rightFoot: THREE.Object3D | null = null
          try {
            hips = humanoid.getNormalizedBoneNode('hips')
            leftFoot = humanoid.getNormalizedBoneNode('leftFoot')
            rightFoot = humanoid.getNormalizedBoneNode('rightFoot')
          } catch {
            // Optional bones — ignore.
          }
          ;[hips, leftFoot, rightFoot].forEach((n) => {
            if (n) {
              baseX.set(n, n.rotation.x)
              baseZ.set(n, n.rotation.z)
            }
          })
          walkRig = {
            ...(nodes as Omit<WalkRig, 'baseX' | 'baseZ' | 'hips' | 'leftFoot' | 'rightFoot'>),
            hips,
            leftFoot,
            rightFoot,
            baseX,
            baseZ,
          }
        }
      } catch {
        // No walk rig — the model still renders, it just never walks.
      }

      // Hand book (menu + livre tabs): the small book parented to her
      // LEFT HAND bone, plus the two arm bones the reading pose drives.
      // Both props (open spread + closed carry) parent to the same
      // hand; the render loop re-aims them in world space every frame,
      // so the attach pose below is only the first frame's pose — the
      // loop is what keeps the book camera-readable and in her hand.
      // Local transform measured from the file, not guessed —
      // scripts/measure-hand-book.mjs: hand at (-0.212, 0.929, 0.002)
      // in the posed VRM. The loop re-aims the props in world space
      // every frame, so this is only the first frame's pose (fix pass
      // 4: rest centre 6 cm below the hand, 1 cm behind it).
      let handBook: HandBookRig | null = null
      let readRig: ReadRig | null = null
      if (withBook) {
        try {
          const hand = vrm.humanoid.getNormalizedBoneNode('leftHand')
          if (hand) {
            handBook = createHandBook()
            handBook.group.position.set(-0.0596, 0.0037, 0.0231)
            handBook.group.quaternion.set(-0.6044, -0.7895, 0.0657, 0.0839)
            hand.add(handBook.group)
            // The carry prop rides the same hand, same first-frame pose.
            handBook.carry.position.copy(handBook.group.position)
            handBook.carry.quaternion.copy(handBook.group.quaternion)
            hand.add(handBook.carry)
          }
        } catch {
          handBook = null
        }
        try {
          const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm')
          const leftLowerArm = vrm.humanoid.getNormalizedBoneNode('leftLowerArm')
          if (leftUpperArm && leftLowerArm) {
            // Absolute-pose rest values (see ReadRig): the upper arm's
            // rest rotation.x, the lower arm's rest local quaternion,
            // and the elbow hinge axis in the upper arm's frame.
            group.updateMatrixWorld(true)
            const shoulder = leftUpperArm.getWorldPosition(new THREE.Vector3())
            const elbow = leftLowerArm.getWorldPosition(new THREE.Vector3())
            const armDir = elbow.sub(shoulder).normalize()
            const hingeWorld = new THREE.Vector3()
              .crossVectors(armDir, new THREE.Vector3(0, 0, 1))
            if (hingeWorld.lengthSq() < 1e-6) hingeWorld.set(0, 1, 0)
            hingeWorld.normalize()
            const upperWorldQuat = leftUpperArm.getWorldQuaternion(new THREE.Quaternion())
            const hingeLocal = hingeWorld.clone().applyQuaternion(upperWorldQuat.clone().invert())
            readRig = {
              leftUpperArm,
              leftLowerArm,
              upperBaseX: leftUpperArm.rotation.x,
              upperBaseZ: leftUpperArm.rotation.z,
              lowerRestQuat: leftLowerArm.quaternion.clone(),
              hingeLocal,
            }
          }
        } catch {
          readRig = null
        }
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
        handBook,
        readRig,
      }
      layout()
      setStatus('ready')

      // A reading asked for before the model finished loading.
      const pending = pendingReadingRef.current
      pendingReadingRef.current = null
      if (pending) beginReading(pending.categoryId, pending.seconds)

      // ---- Per-frame loop: VRM update, breathing, lip-sync, nod, blink.
      let happyWeight = 0
      let wasSpeaking = false
      let nodT = 1
      let nextBlinkAt = 2.5
      let blinkUntil = 0
      // Reading scratch (allocated once, reused every frame).
      const bookHandPos = new THREE.Vector3()
      const bookHandQuat = new THREE.Quaternion()
      const bookOff = new THREE.Vector3()
      const bookOffRead = new THREE.Vector3()
      const bookInv = new THREE.Quaternion()
      const bookTilt = new THREE.Quaternion()
      const bookWant = new THREE.Quaternion()
      const bookWorld = new THREE.Vector3()
      const xAxis = new THREE.Vector3(1, 0, 0)
      const yAxis = new THREE.Vector3(0, 1, 0)
      // Reading-pose scratch: elbow world-axis bend + carry orientation.
      const readParentQ = new THREE.Quaternion()
      const readHingeWorld = new THREE.Vector3()
      const readQWorld = new THREE.Quaternion()
      const readTmpQ = new THREE.Quaternion()
      const bookCarryIdle = new THREE.Quaternion()
      const bookCarryWant = new THREE.Quaternion()
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

        // Procedural walk — a sidestep gait solved from the planted
        // feet (fbtpods solver.py + body.py), not a free swing. The old
        // code swung the legs forward/back (rotation.x) while the body
        // travelled sideways, so the legs and the travel disagreed and
        // the walk read as a slide. Now she faces the camera and steps
        // sideways to the other side of the stage (4 steps of 0.55 s):
        // each step one foot lifts (knee bends, thigh lifts forward)
        // and plants one step length ahead, while the stance foot NEVER
        // slides (skating_correction) — its thigh angle is solved from
        // the hip's position over it (asin of the foot-hip offset over
        // the 0.841 m leg, relative to the rest splay). The hip dips at
        // double support and rises mid-swing (solve_body lowering), the
        // pelvis rocks, and the whole body turns part-way toward the
        // travel direction (HipEstimator's slow-follow heading) and
        // back. The lateral position is kept after the walk, so she is
        // visibly standing on the other side.
        const rig = three.walkRig
        let walkTurn = 0
        if (rig) {
          const w = walkRef.current
          const wt = w.t
          if (wt < WALK_DURATION) {
            w.t = wt + dt
            const dir = w.toX >= w.fromX ? 1 : -1
            const stepLen = (w.toX - w.fromX) / 2
            const stepIdx = Math.min(STEP_COUNT - 1, Math.floor(wt / STEP_DURATION))
            const u = Math.min(1, (wt - stepIdx * STEP_DURATION) / STEP_DURATION)
            const leadLeft = dir < 0
            const steppingLeft = (stepIdx % 2 === 0) === leadLeft
            if (stepIdx !== w.step) {
              if (steppingLeft) w.footL += stepLen
              else w.footR += stepLen
              w.step = stepIdx
            }
            // Traverse first (smoothstep), so the hip position below is
            // the one the legs are solved from.
            const uw = Math.min(1, wt / WALK_DURATION)
            const smooth = uw * uw * (3 - 2 * uw)
            three.group.position.x = w.fromX + (w.toX - w.fromX) * smooth
            const hipX = three.group.position.x
            const env = Math.min(1, wt / 0.15) * Math.min(1, (WALK_DURATION - wt) / 0.25)
            const lift = Math.sin(Math.PI * u)
            const setX = (node: THREE.Object3D, v: number) => {
              node.rotation.x = (rig.baseX.get(node) ?? 0) + v * env
            }
            const setZ = (node: THREE.Object3D, v: number) => {
              node.rotation.z = (rig.baseZ.get(node) ?? 0) + v * env
            }
            // Solved thigh angle (rotation.z) from a planted foot:
            // asin of the foot-hip offset over the leg, minus the rest
            // splay, so the angle is 0 at rest and follows the hip.
            const clampA = (a: number) => Math.asin(THREE.MathUtils.clamp(a, -0.4, 0.4))
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
              setZ(rig.leftUpperLeg, swingAngle)
              setZ(rig.rightUpperLeg, stanceAngle)
              setX(rig.leftUpperLeg, -THIGH_LIFT * lift)
              setX(rig.leftLowerLeg, KNEE_SWING * lift)
              setX(rig.rightLowerLeg, 0)
              if (rig.leftFoot) rig.leftFoot.rotation.x = (rig.baseX.get(rig.leftFoot) ?? 0) - 0.35 * lift * env
              if (rig.rightFoot) rig.rightFoot.rotation.x = rig.baseX.get(rig.rightFoot) ?? 0
            } else {
              setZ(rig.rightUpperLeg, swingAngle)
              setZ(rig.leftUpperLeg, stanceAngle)
              setX(rig.rightUpperLeg, -THIGH_LIFT * lift)
              setX(rig.rightLowerLeg, KNEE_SWING * lift)
              setX(rig.leftLowerLeg, 0)
              if (rig.rightFoot) rig.rightFoot.rotation.x = (rig.baseX.get(rig.rightFoot) ?? 0) - 0.35 * lift * env
              if (rig.leftFoot) rig.leftFoot.rotation.x = rig.baseX.get(rig.leftFoot) ?? 0
            }
            // Arms counter-swing (one cycle per two steps); the LEFT
            // (reading) arm fades out as the book rises, as before.
            const armPhase = (wt / (STEP_DURATION * 2)) * Math.PI * 2
            const armS = Math.sin(armPhase)
            setX(rig.leftUpperArm, 0.45 * armS * (1 - readingBlendRef.current))
            setX(rig.rightUpperArm, -0.45 * armS)
            // Hip: dips at double support, rises mid-swing; pelvis rocks.
            three.group.position.y = -HIP_BOB * (1 - lift) * env
            if (rig.hips) setZ(rig.hips, HIP_SWAY * Math.sin((wt / STEP_DURATION) * Math.PI))
            // Heading: turns part-way toward the travel direction
            // mid-walk, back to face-front at the ends.
            walkTurn = WALK_TURN * dir * Math.sin(Math.PI * uw)
          } else if (w.t !== Infinity) {
            // Traverse finished: restore the rest pose exactly, once —
            // but KEEP the lateral position, so she is visibly standing
            // on the other side of the stage.
            w.t = Infinity
            rig.baseX.forEach((base, node) => {
              node.rotation.x = base
            })
            rig.baseZ.forEach((base, node) => {
              node.rotation.z = base
            })
            three.group.position.y = 0
            three.group.position.x = w.toX
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
        three.group.rotation.y = walkTurn + 0.03 * Math.sin(t * 0.5) * swayAmp
        if (headNode) {
          let nod = 0
          if (nodT < 0.6) {
            nodT += dt
            nod = 0.12 * Math.sin(Math.min(1, nodT / 0.6) * Math.PI)
          }
          headNode.rotation.x = three.headBaseRotationX + nod
        }

        // ---- Reading: Vita holds the book, raises it, opens it, and
        // turns the pages while she speaks.
        // End: the estimated seconds have passed AND she has been quiet
        // for a second (speech over), or the hard cap (estimate + 8 s)
        // — so a stuck utterance can never leave her reading forever.
        // Muted / no-speech devices end on the estimate alone.
        const read = readingRef.current
        const hb = three.handBook
        const rr = three.readRig
        if (hb || rr) {
          const now = performance.now() / 1000
          const elapsed = read.active ? now - read.startT : 0
          const speaking = bridge.isSpeaking()
          if (read.active) {
            if (speaking) read.quietSince = -1
            else if (read.quietSince < 0) read.quietSince = elapsed
            const quietFor = read.quietSince < 0 ? 0 : elapsed - read.quietSince
            if ((elapsed > read.seconds && quietFor > 1) || elapsed > read.seconds + 8) {
              read.active = false
              if (!read.ended) {
                read.ended = true
                onReadingEndRef.current?.()
              }
            }
          }
          // Blend toward 1 while reading, 0 after (snapped when the
          // visitor prefers reduced motion — no eased arm travel).
          const target = read.active ? 1 : 0
          readingBlendRef.current = reducedMotion
            ? target
            : readingBlendRef.current + (target - readingBlendRef.current) * Math.min(1, dt * 3)
          const blend = readingBlendRef.current

          // Arm + head — ABSOLUTE, recomputed from the stored rest
          // values every frame, never `rotation.x +=`: the old `+=`
          // accumulated (the walk only re-sets rotation.x during its
          // 2.2 s window), so the forearm spun from the first reading
          // frame and, once the walk ended, the whole arm orbited the
          // shoulder and the book swept across her face (Node sim:
          // hand y 0.94 → 1.76 m, z +0.41 → -0.39 over 5 s).
          // Upper arm: while walking, the walk block just set
          // rotation.x absolutely this frame, so add the reading
          // delta onto it; once the walk is done, set it absolutely
          // from the stored rest base. Elbow: the world-axis bend
          // (see ReadRig) — q' = P^-1 * Q * P * qRest, P = upper arm
          // world quat NOW — applied every frame, so at blend 0 it
          // restores the rest quaternion exactly. The head dip is
          // safe as `+=`: the nod code above sets head rotation.x
          // absolutely every frame before this runs.
          if (rr) {
            if (walkRef.current.t < WALK_DURATION) {
              rr.leftUpperArm.rotation.x += READ_UPPER * blend
            } else {
              rr.leftUpperArm.rotation.x = rr.upperBaseX + READ_UPPER * blend
            }
            // Adduction toward the midline, absolute from the rest
            // base: without it the 26 cm open spread sticks out of
            // the left edge of the 0.72 m frame (measured — the sim
            // puts the reading hand at x -0.01 with it, -0.20 without).
            // The walk never writes rotation.z, so an absolute set is
            // safe in both branches above.
            rr.leftUpperArm.rotation.z = rr.upperBaseZ + READ_ADDUCT * blend
            rr.leftUpperArm.getWorldQuaternion(readParentQ)
            readHingeWorld.copy(rr.hingeLocal).applyQuaternion(readParentQ)
            readQWorld.setFromAxisAngle(readHingeWorld, READ_ELBOW * blend)
            readTmpQ
              .copy(readParentQ)
              .invert()
              .multiply(readQWorld)
              .multiply(readParentQ)
              .multiply(rr.lowerRestQuat)
            rr.leftLowerArm.quaternion.copy(readTmpQ)
          }
          if (headNode && blend > 0.001) {
            headNode.rotation.x += 0.18 * blend
          }

          if (hb) {
            const hand = hb.group.parent
            if (hand) {
              // Book world transform, glued to the hand in WORLD space:
              // ONE shared centre for both props — the offset blends
              // from rest (at her side, 6 cm below the hand, 1 cm
              // behind it — the hand renders in front of the cover's
              // top edge, so the closed book reads as gripped)
              // to reading (8.5 cm ABOVE the hand, 1 cm forward — the
              // palm touches the open book's bottom edge, so the book
              // is visibly IN her hand, not floating under it), and
              // the facing stays camera-readable (a tilt back toward
              // her face) whatever the arm bones do — parenting alone
              // would roll the book with the hand and could hide the
              // pages. Fix pass 5: the book's local +Z is already
              // "toward camera", so bookWant must NOT be multiplied
              // by the group quaternion — the group is rotated
              // Ry(180°) and that multiplication turned the page
              // normal AWAY from the camera (green back cover). The open spread faces the
              // camera; the carry book faces front-left (Ry -0.9) at
              // rest and turns to face the camera as it rises, so at
              // the blend-0.5 swap the two props already agree on
              // facing and the swap is only a shape change in place.
              hand.getWorldPosition(bookHandPos)
              hand.getWorldQuaternion(bookHandQuat)
              // Fix pass 4 (measured — scripts/sim-fix4-book.mjs):
              // rest (0.02, -0.06, -0.01) — the book's centre 6 cm
              // below the hand and 1 cm BEHIND it, so the hand renders
              // in front of the cover's top edge (gripped, not
              // floating) and the bottom corner clears the stage's
              // bottom edge by 15 px; reading (0, 0.085, 0.01) — the
              // palm touches the open book's bottom edge. The old
              // rest offset (+0.03 forward) hid the hand behind the
              // cover, and the old reading offset (+0.05) left a
              // 4.5 cm gap between palm and book.
              bookOff.set(0.02, -0.06, -0.01)
              bookOffRead.set(0, 0.085, 0.01)
              bookOff.lerp(bookOffRead, blend)
              bookInv.copy(bookHandQuat).invert()
              hb.group.position.copy(bookOff).applyQuaternion(bookInv)
              hb.carry.position.copy(hb.group.position)
              bookTilt.setFromAxisAngle(xAxis, -0.35 * blend)
              bookWant.copy(bookTilt)
              hb.group.quaternion.copy(bookInv).multiply(bookWant)
              bookCarryIdle.copy(bookTilt.setFromAxisAngle(yAxis, -0.9))
              bookCarryWant.slerpQuaternions(
                bookCarryIdle,
                bookWant,
                THREE.MathUtils.clamp(blend * 2, 0, 1),
              )
              hb.carry.quaternion.copy(bookInv).multiply(bookCarryWant)
              // One prop at a time: closed while she carries it, open
              // while she reads. The swap happens mid-transit, when
              // both props already share centre and facing.
              // Fix pass 6: the closed carry prop is NEVER shown — at
              // rest it reads as a flat green slab at her hip (passes
              // 3, 4 and 5 all failed to make it read as a gripped
              // book), and the reading pose is the one that matters.
              // Hands empty at idle beats a slab. The carry prop stays
              // in the rig (built + oriented as before) but invisible.
              hb.group.visible = blend >= 0.5
              hb.carry.visible = false
            }
            // Cover opens once the arm is on its way up — swung BEHIND
            // the book (+2.6), so the open spread stays readable.
            const open = THREE.MathUtils.clamp((blend - 0.2) / 0.8, 0, 1)
            hb.coverPivot.rotation.y = 2.6 * open

            // Page turns: one flip every 4 s while she is speaking (or
            // inside the estimated window when muted), until the last
            // spread. The static right page swaps mid-flip, hidden by
            // the turning leaf; the left page updates when it lands.
            if (read.active && hb.spreadCount > 1 && read.spread < hb.spreadCount - 1) {
              if (
                read.flipT === Infinity &&
                elapsed - read.lastFlipAt > 4 &&
                (speaking || elapsed < read.seconds)
              ) {
                read.flipT = 0
              }
            }
            if (read.flipT !== Infinity) {
              read.flipT = Math.min(1, read.flipT + dt / 0.9)
              const p = read.flipT
              const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
              hb.flipPivot.rotation.y = -Math.PI * eased
              if (p >= 0.5 && !read.swapped) {
                read.swapped = true
                hb.setRightPage(read.spread + 1)
              }
              if (p >= 1) {
                hb.setLeftPage(read.spread + 1)
                read.spread += 1
                hb.showSpread(read.spread)
                hb.flipPivot.rotation.y = 0
                read.flipT = Infinity
                read.swapped = false
                read.lastFlipAt = elapsed
              }
            }

            // Debug: book world position + reading state, for the
            // cloud-browser pixel check (window.__vrmDebug).
            const dbg = window.__vrmDebug
            if (dbg) {
              hb.group.getWorldPosition(bookWorld)
              dbg.book = {
                world: [bookWorld.x, bookWorld.y, bookWorld.z],
                reading: read.active,
                blend: Math.round(blend * 100) / 100,
                prop: blend >= 0.5 ? 'open' : 'none',
              }
            }
          }
        }

        // Walk debug: keep window.__vrmDebug.walk live for the
        // cloud-browser check — layout() only runs on mount/resize,
        // so its snapshot would go stale mid-traverse. Tick is
        // written by the walk effect (live walkTick there); here the
        // per-frame values refresh from the refs.
        const wdbg = window.__vrmDebug
        if (wdbg) {
          wdbg.walk = {
            tick: wdbg.walk?.tick ?? 0,
            t: walkRef.current.t,
            x: three.group.position.x,
            rig: !!three.walkRig,
            reducedMotion,
            hidden: document.hidden,
          }
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
        // Hand-book textures (canvas textures are not freed by the
        // generic traverse below — it only disposes geometries and
        // materials). The book is this mount's own prop: unparent it
        // (both props) from the shared VRM's left hand before
        // disposing it.
        three.handBook?.group.parent?.remove(three.handBook.group)
        three.handBook?.carry.parent?.remove(three.handBook.carry)
        three.handBook?.dispose()
        // Detach the SHARED cached VRM from this mount's group BEFORE
        // the dispose traverse below: its geometries/materials belong
        // to the module-level cache (src/lib/vrmCache.ts) and must
        // survive this unmount, or the next mount would render a
        // disposed model and the cache would be worthless. Only this
        // mount's own renderer, lights and (already removed) hand book
        // are freed here.
        three.group.remove(three.vrm.scene)
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
              ? 'Vita — elle prend son livre, marche vers la catégorie choisie et vous lit les prix à voix haute.'
              : 'Vita — modèle 3D en pied. Elle parle, hoche la tête et respire ; « Visage » zoome sur son visage.'}
          </p>
        </div>
      )}
      {status !== 'ready' && (
        <p className="border-t border-line px-4 py-2.5 text-xs leading-relaxed text-mist sm:px-5 sm:py-3">
          {compact
            ? 'Vita — elle prend son livre, marche vers la catégorie choisie et vous lit les prix à voix haute.'
            : 'Vita — modèle 3D en pied. Elle parle, hoche la tête et respire ; « Visage » zoome sur son visage.'}
        </p>
      )}
    </div>
  )
}
