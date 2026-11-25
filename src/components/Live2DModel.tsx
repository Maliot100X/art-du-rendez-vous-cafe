import { useCallback, useEffect, useRef, useState } from 'react'
import type { Live2DModel as Live2DModelType } from 'pixi-live2d-display/cubism4'
import useDimensions from 'react-cool-dimensions'
import { AGENT } from '../content'
import { avatarBridge, EXPRESSION_PRESETS, type AvatarBridge } from '../lib/avatarBridge'
import { pixelRatioCap } from '../lib/perf'

/**
 * Nekomi — Live2D Cubism 3 model, rendered with pixi-live2d-display
 * (Cubism 4 runtime) on a PixiJS stage.
 *
 * Facts from the agent-kits report: the model is a cat-girl with a Henshin
 * transform on parameter Param3 (1 = furry, 0 = human). Param3 defaults to
 * 0 in the .moc3, so the site starts human and the Henshin expression is
 * never played on load; the toggle plays the expression (furry) or resets
 * the expression manager (human). Motions: Idle (breath only,
 * loops) and Nodd (head-nod sway, the "Dance" trigger). Eye blink is
 * automatic — the model defines the EyeBlink group. The Cubism Core is
 * served locally from /live2d/live2dcubismcore.min.js (Live2D's
 * redistributable), with the Live2D CDN as fallback.
 *
 * If any step fails (no WebGL, core or model unreachable), the stage falls
 * back to a styled placeholder instead of breaking the page.
 */

type Form = 'human' | 'furry'

/**
 * Fix pass 12, bug 3: the Henshin form survives an Agent remount.
 * The tab shell unmounts Live2DModel on every tab leave, and the form
 * used to live only in useState — so returning to AGENT always reset
 * to human (and reloaded the model) even though the model choice
 * persisted. Same module-level pattern as lastAgentStage in Agent.tsx
 * (now src/lib/agentSelection.ts): the init effect below already
 * applies formRef on load, so a persisted 'furry' re-plays Henshin
 * on the fresh model instead of resetting.
 */
let lastHenshinForm: Form = 'human'

/**
 * Fix pass 13, bug 3: the parsed Live2D stage survives an Agent remount.
 * The tab shell unmounts Live2DModel on every tab leave, and the old
 * cleanup destroyed the PIXI Application + parsed model, so every
 * return re-ran Live2DModel.from() (fetch + .moc3 parse + texture
 * upload) behind a ~10–15 s placeholder. The prewarm only warms the
 * HTTP cache, not the parsed model. This module-level cache keeps the
 * app, the parsed model, the canvas and the bridge subscription alive
 * across unmounts: unmount only stops the ticker and detaches the
 * pointer listener; remount re-appends the SAME canvas, resizes,
 * re-fits, restarts the ticker and is 'ready' immediately.
 */
type WarmStage = {
  app: import('pixi.js').Application
  model: Live2DModelType
  canvas: HTMLCanvasElement
  unsubscribe: () => void
}
let warmStage: WarmStage | null = null

/**
 * Destroy the cached stage (if any) and drop the cache — the next
 * mount does a full cold init. Used by the "Réessayer" path and by
 * the webglcontextlost handler; NEVER called on a plain unmount.
 */
function dropWarmStage(): void {
  const stage = warmStage
  warmStage = null
  if (!stage) return
  try {
    stage.unsubscribe()
  } catch {
    // Subscription already gone — nothing to free.
  }
  try {
    stage.model.destroy()
  } catch {
    // Already destroyed — nothing to free.
  }
  try {
    stage.app.destroy(true, { children: true })
  } catch {
    // Already destroyed — nothing to free.
  }
}

/**
 * FACE BAND — measured from the real .moc3 with the Cubism Core
 * (Node + live2dcubismcore.min.js, /tmp/measure-nekomi-parts.js), NOT
 * guessed. pixi-live2d-display's getBounds() returns the WHOLE canvas
 * rect (3000x3000, origin centre), so fractions below are fractions of
 * that canvas, from the TOP:
 *
 *   cat ears (furry)  0.025   hair top (human) 0.096–0.130
 *   EYES              0.341–0.482 (centre 0.410)
 *   nose              0.448–0.516   mouth 0.489–0.559
 *   head bottom       0.659         bow 0.627–0.778
 *
 * The old fit framed 0.00–0.32 — entirely ABOVE the eyes (0.341) — which
 * is exactly why Minir's phone screenshot showed only the top of the
 * purple hair. The window 0.02–0.68 puts the eyes at ~59% of the
 * stage height and the mouth at ~76%, with the hair top and (in furry
 * form) the ear tips just inside the frame. Eyes and mouth sit at the
 * SAME fractions in both forms (only the ears move), so one window
 * frames both forms.
 *
 * Fix pass 11: that last claim was wrong in the one place that
 * matters — the ears do NOT stay at 0.025. While the Henshin fade
 * runs, and at full furry rest, the ear tips rise above the human
 * hair top toward the canvas top, past the FACE_TOP 0.02 window
 * edge: at the old fit the ear tips sat only ~13 px from the stage
 * top on desktop (480 px stage), so any rise clipped them. The fit
 * below therefore frames from the TALLER form: in furry form the
 * window starts at FURRY_TOP 0.0 (the canvas top itself), so any ear
 * position inside the canvas lands at least 0.02*h inside the stage.
 */
const FACE_TOP = 0.02
const FURRY_TOP = 0.0
const FACE_BOTTOM = 0.68
/** Head width is ~0.56 of the canvas width — the horizontal guard. */
const HEAD_WIDTH_FRAC = 0.62

declare global {
  interface Window {
    __nekomiDebug?: {
      status: string
      form: Form
      stageW: number
      stageH: number
      bounds: { x: number; y: number; width: number; height: number }
      scale: number
      eyeScreenPx: [number, number]
      mouthScreenPx: [number, number]
      /** Read-back of the Henshin parameter (0 = human, 1 = furry). */
      param3: number
      /** Whether model.expression('Henshin') resolved true. */
      expressionOk: boolean | null
      /**
       * The init failure, when status is 'failed' — the exact error
       * message (fix pass 4: the old code swallowed it, so a failed
       * stage gave no clue what broke). The cloud-browser check reads
       * this to name the real cause instead of guessing.
       */
      error: string | null
    }
  }
}

/** Last Live2D init failure (module-level, for the retry + diagnostics). */
let live2dError: string | null = null
export function getLive2dError(): string | null {
  return live2dError
}

const CORE_LOCAL = '/live2d/live2dcubismcore.min.js'
const CORE_CDN = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js'
const MODEL_URL = '/live2d/nekomi/Furry.model3.json'

/**
 * Live2D prewarm (fix pass 3, defect 6) — module-level, so App can
 * start it on first paint and the Agent tab only has to mount.
 *
 * Warms, in order: the pixi.js + pixi-live2d-display JS chunks the
 * stage dynamically imports on mount, the Cubism Core script, and
 * every file the model references (moc3, both textures, physics,
 * motions, expressions) via fetch — the browser HTTP cache then serves
 * them to Live2DModel.from() instead of re-downloading them on mount.
 * The .moc3 is still parsed fresh on mount (pixi-live2d-display takes
 * a URL, not bytes), so this cuts the network wait, not the parse —
 * the honest progress below is byte progress of the warm-up, and the
 * stage shows it while it loads instead of a blank dark area.
 */
let live2dProgress = 0
let live2dLabel = ''
let live2dPreloadPromise: Promise<void> | null = null
const live2dListeners = new Set<(p: number, label: string) => void>()

function setLive2dProgress(p: number, label?: string): void {
  // Monotonic: totals are learned file by file as responses arrive, so
  // the raw ratio can dip when a new file's size is added — the bar
  // never goes backwards.
  const next = Math.max(live2dProgress, Math.min(100, Math.round(p)))
  if (label) live2dLabel = label
  if (next === live2dProgress && !label) return
  live2dProgress = next
  live2dListeners.forEach((cb) => {
    try {
      cb(live2dProgress, live2dLabel)
    } catch {
      // A progress listener must never break the load.
    }
  })
}

export function getLive2dProgress(): number {
  return live2dProgress
}

export function subscribeLive2dProgress(cb: (p: number, label: string) => void): () => void {
  live2dListeners.add(cb)
  try {
    cb(live2dProgress, live2dLabel)
  } catch {
    // Ignore a throwing listener.
  }
  return () => {
    live2dListeners.delete(cb)
  }
}

async function preloadLive2dOnce(): Promise<void> {
  // Fix pass 5: the Core MUST load BEFORE pixi-live2d-display/cubism4
  // evaluates — that module throws at import time if
  // window.Live2DCubismCore is undefined, and an ES-module evaluation
  // failure is cached for the page lifetime, so every later mount and
  // every "Réessayer" re-imported the dead module and failed instantly
  // (the poisoned-module bug). The old order imported cubism4 first.
  setLive2dProgress(0, 'Cœur Live2D…')
  await ensureCore() // Core global must exist BEFORE cubism4 evaluates
  setLive2dProgress(8, 'Moteur d’affichage…')
  await Promise.all([import('pixi.js'), import('pixi-live2d-display/cubism4')])
  setLive2dProgress(12, 'Modèle Nekomi…')
  const settingsRes = await fetch(MODEL_URL)
  if (!settingsRes.ok) throw new Error(`Live2D settings fetch failed: ${settingsRes.status}`)
  const settings = (await settingsRes.json()) as {
    FileReferences?: {
      Moc?: string
      Textures?: string[]
      Physics?: string
      Motions?: Record<string, { File?: string }[]>
      Expressions?: { File?: string }[]
    }
  }
  const refs = settings.FileReferences ?? {}
  const base = MODEL_URL.slice(0, MODEL_URL.lastIndexOf('/') + 1)
  const urls: string[] = []
  if (typeof refs.Moc === 'string') urls.push(base + refs.Moc)
  for (const t of refs.Textures ?? []) urls.push(base + t)
  if (typeof refs.Physics === 'string') urls.push(base + refs.Physics)
  for (const group of Object.values(refs.Motions ?? {})) {
    for (const m of group) if (m.File) urls.push(base + m.File)
  }
  for (const e of refs.Expressions ?? []) if (e.File) urls.push(base + e.File)

  let loaded = 0
  let knownTotal = 0
  // Fix pass 4: one flaky file (tunnel hiccup) must not kill the whole
  // prewarm — the stage re-fetches on mount anyway. Settle per file
  // and warn once about the failures instead of rejecting.
  const failures: string[] = []
  const track = async (url: string) => {
    const res = await fetch(url)
    if (!res.ok) {
      failures.push(`${res.status} ${url}`)
      return
    }
    if (!res.body) {
      await res.arrayBuffer()
      return
    }
    knownTotal += Number(res.headers.get('content-length') || 0)
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        loaded += value.length
        if (knownTotal > 0) setLive2dProgress(12 + (loaded / knownTotal) * 88, 'Modèle Nekomi…')
      }
    }
  }
  await Promise.allSettled(urls.map(track))
  if (failures.length > 0) console.warn('Live2D prewarm: files failed (stage will retry on mount):', failures)
  setLive2dProgress(100, '')
}

/**
 * Start the Live2D warm-up in the background. Safe to call repeatedly
 * — concurrent callers share the one in-flight promise. A failure
 * clears it so a later call retries; the stage itself still loads
 * normally on mount if the prewarm never ran.
 */
export function preloadLive2d(): void {
  if (!live2dPreloadPromise) {
    live2dPreloadPromise = preloadLive2dOnce().catch((err: unknown) => {
      live2dPreloadPromise = null
      live2dProgress = 0
      throw err
    })
  }
  void live2dPreloadPromise.catch(() => undefined)
}

declare global {
  interface Window {
    Live2DCubismCore?: unknown
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`script failed: ${src}`))
    document.head.appendChild(el)
  })
}

async function ensureCore(): Promise<void> {
  if (window.Live2DCubismCore) return
  try {
    await loadScript(CORE_LOCAL)
  } catch {
    await loadScript(CORE_CDN)
  }
  if (!window.Live2DCubismCore) throw new Error('Cubism Core did not load')
}

export default function Live2DModel({ bridge = avatarBridge }: { bridge?: AvatarBridge }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<Live2DModelType | null>(null)
  /** Fix pass 13: the PIXI Application, read by the component-level
      fit() so both the cold init and the warm remount use it. */
  const appRef = useRef<import('pixi.js').Application | null>(null)
  /** The container the pointermove listener is currently attached to
      (captured at attach time — containerRef may already be detached
      when the unmount cleanup runs, so it cannot be trusted there). */
  const pointerContainerRef = useRef<HTMLDivElement | null>(null)
  const formRef = useRef<Form>(lastHenshinForm)
  const fitRef = useRef<(() => void) | null>(null)
  // Fix pass 13: initialise from the warm cache — a return to AGENT
  // with a live cached stage never shows the loading placeholder.
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(() =>
    warmStage ? 'ready' : 'loading',
  )
  /** The init failure message, shown verbatim on the failed placeholder
      (fix pass 6) so the next check can read the cause without a console. */
  const [failMessage, setFailMessage] = useState<string | null>(null)
  /** Retry nonce: the init effect re-runs on each increment, so the
      failed stage can be retried in place instead of reloading the page. */
  const [retryTick, setRetryTick] = useState(0)
  const [form, setForm] = useState<Form>(() => lastHenshinForm)
  // Prewarm progress (fix pass 3): the idle preload's byte progress,
  // shown honestly while the stage loads — never a blank dark area.
  const [liveProgress, setLiveProgress] = useState(getLive2dProgress())
  const [liveLabel, setLiveLabel] = useState('')

  // Subscribe to the prewarm progress as soon as the stage mounts.
  useEffect(() => subscribeLive2dProgress((p, label) => {
    setLiveProgress(p)
    setLiveLabel(label)
  }), [])
  // react-cool-dimensions measures the stage's REAL rendered size
  // (ResizeObserver) — fit() runs from that measurement, never from an
  // assumed width. This is the fix for the failed "top 32%" framing:
  // frame from measured bounds AND a measured stage.
  const { observe, width: stageW, height: stageH } = useDimensions<HTMLDivElement>()
  const setStageRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el
      if (el) observe(el)
    },
    [observe],
  )

  // Fix pass 13: fit lives at component level and reads only refs
  // (containerRef / modelRef / appRef), so the cold init path and the
  // warm remount path use the same fit. It used to close over the
  // init-local `app` and `container`, which made a warm remount
  // impossible (fix pass 6's dead-zone guard stays: it no-ops until
  // the model exists).
  const fit = useCallback(() => {
    const m = modelRef.current
    const app = appRef.current
    const container = containerRef.current
    if (!m || !app || !container) return
    const w = container.clientWidth
    const h = container.clientHeight
    if (w === 0 || h === 0) return
    app.renderer.resize(w, h)
    // Frame the FACE band (see FACE_TOP/FACE_BOTTOM above), not the
    // top of the bounds: getBounds() is the whole canvas rect, so
    // the window is placed by measured canvas fractions. A
    // horizontal guard keeps the head inside narrow stages.
    // Fix pass 11: fit from the TALLER form — in furry form the
    // window starts at FURRY_TOP (canvas top) instead of
    // FACE_TOP, because the ears rise above the human hair top
    // and the old 0.02 window clipped their tips (see the FACE
    // BAND note above). The scale drops slightly to hold the
    // taller window; eyes/mouth move by only a few px.
    m.scale.set(1)
    m.position.set(0, 0)
    const b = m.getBounds()
    if (!b || b.height === 0) {
      const scale = (h * 0.98) / m.height
      m.scale.set(scale)
      m.position.set(w / 2, h * 0.55)
      return
    }
    const top = formRef.current === 'furry' ? FURRY_TOP : FACE_TOP
    const windowH = FACE_BOTTOM - top
    const s = Math.min((h * 0.98) / (b.height * windowH), (w * 0.96) / (b.width * HEAD_WIDTH_FRAC))
    m.scale.set(s)
    m.position.set(w / 2 - (b.x + b.width / 2) * s, h * 0.02 - (b.y + b.height * top) * s)
    // Debug projection (verifiable without a real browser): where
    // the eyes and mouth land in stage pixels, from the measured
    // fractions and the actual scale/position just applied.
    const stageY = (fracFromTop: number) => h * 0.02 + (fracFromTop - top) * b.height * s
    window.__nekomiDebug = {
      status: 'ready',
      form: formRef.current,
      stageW: w,
      stageH: h,
      bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      scale: s,
      eyeScreenPx: [Math.round(w / 2), Math.round(stageY(0.41))],
      mouthScreenPx: [Math.round(w / 2), Math.round(stageY(0.528))],
      param3: window.__nekomiDebug?.param3 ?? -1,
      expressionOk: window.__nekomiDebug?.expressionOk ?? null,
      // A successful fit means no error — never carry a stale
      // failure forward into the ready diagnostic (fix pass 5).
      error: null,
    }
  }, [])

  // Fix pass 13: the pointer handler also lives at component level
  // and reads modelRef/containerRef, so the warm remount can re-attach
  // the same handler to the new container div.
  const onPointer = useCallback((e: PointerEvent) => {
    const container = containerRef.current
    const model = modelRef.current
    if (!container || !model) return
    const rect = container.getBoundingClientRect()
    model.focus(e.clientX - rect.left, e.clientY - rect.top)
  }, [])

  // Publish the component-level fit for the resize effect and the
  // Henshin re-fit timeouts.
  useEffect(() => {
    fitRef.current = fit
  }, [fit])

  // Re-fit whenever the measured stage size changes.
  useEffect(() => {
    if (stageW > 0 && stageH > 0) fitRef.current?.()
  }, [stageW, stageH])

  useEffect(() => {
    let cancelled = false
    let app: import('pixi.js').Application | null = null
    // The stage canvas, so a failed init (e.g. PIXI.Application
    // throwing on context creation) never leaves an orphan canvas in
    // the container for the retry to stack a second one onto.
    let canvasEl: HTMLCanvasElement | null = null

    const init = async () => {
      const container = containerRef.current
      if (!container) return

      // WARM PATH (fix pass 13, bug 3): the parsed stage survived the
      // last unmount — re-attach it instead of re-loading the model.
      // No fetch, no .moc3 parse, no placeholder flash: status was
      // already initialised to 'ready' from the cache.
      if (warmStage) {
        const stage = warmStage
        let contextAlive = true
        try {
          const gl = (stage.app.renderer as unknown as { gl?: WebGLRenderingContext | WebGL2RenderingContext }).gl
          if (gl && typeof gl.isContextLost === 'function' && gl.isContextLost()) contextAlive = false
        } catch {
          contextAlive = false
        }
        if (contextAlive) {
          container.appendChild(stage.canvas)
          appRef.current = stage.app
          modelRef.current = stage.model
          pointerContainerRef.current = container
          container.addEventListener('pointermove', onPointer)
          fitRef.current = fit
          fit()
          try {
            stage.app.ticker.start()
          } catch {
            // Ticker already running — nothing to restart.
          }
          setStatus('ready')
          return
        }
        // The context died while the tab was away: drop the dead
        // stage so the cold path below does a full init.
        dropWarmStage()
        setStatus('loading')
      }

      try {
        await ensureCore()
        // The model's automator reads PIXI.Ticker.shared from the global
        // PIXI namespace, so publish the dynamically imported module first.
        const PIXI = await import('pixi.js')
        ;(window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI
        const { Live2DModel } = await import('pixi-live2d-display/cubism4')
        if (cancelled) return

        const canvas = document.createElement('canvas')
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        canvas.style.display = 'block'
        container.appendChild(canvas)
        canvasEl = canvas

        // Context-loss guard (fix pass 13): if the WebGL context dies,
        // the cached stage is unusable — drop it so the next mount does
        // a full cold init instead of re-attaching a dead canvas. The
        // canvas check guards against an old canvas's listener firing
        // after a retry already built a fresh stage on a new canvas.
        canvas.addEventListener('webglcontextlost', () => {
          if (!warmStage || warmStage.canvas !== canvas) return
          dropWarmStage()
          if (!cancelled) {
            live2dError = 'WebGL context lost'
            setFailMessage('WebGL context lost')
            setStatus('failed')
          }
        })

        app = new PIXI.Application({
          view: canvas,
          backgroundAlpha: 0,
          antialias: true,
          resolution: Math.min(window.devicePixelRatio || 1, pixelRatioCap()),
          autoDensity: true,
        })
        appRef.current = app

        // Fix pass 6: fit MUST NOT close over the `model` const below —
        // it is in the temporal dead zone until Live2DModel.from()
        // resolves, and fitRef used to be published before that await.
        // The resize effect calls fitRef on the first ResizeObserver
        // delivery, which lands while the model is still fetching:
        // the old code threw `ReferenceError: Cannot access 'model'
        // before initialization` inside a React effect — outside the
        // init try/catch — straight into the agent ErrorBoundary.
        // Fix pass 5 unmasked it: prewarmed chunk imports made init
        // fast enough to publish fitRef before the model fetch, while
        // fix pass 4's poisoned cubism4 import threw inside the
        // try/catch before fitRef was ever set (placeholder, no crash).
        // Fix pass 13: fit now lives at component level and reads the
        // model from modelRef, so it no-ops until the model exists;
        // fitRef is only published after the model is set.
        const model = (await Live2DModel.from(MODEL_URL)) as Live2DModelType
        if (cancelled) {
          model.destroy()
          try {
            app.destroy(true, { children: true })
          } catch {
            // Already destroyed — nothing to free.
          }
          return
        }
        model.anchor.set(0.5, 0.5)
        app.stage.addChild(model)
        modelRef.current = model
        // Publish fit only now that the model exists (fix pass 6 — see
        // the note on fit above: publishing earlier let the resize
        // effect call it while `model` was still in its dead zone).
        fitRef.current = fit

        // Human is the default form: Param3 defaults to 0 in the .moc3 and
        // the expression is never played on load, so nothing to set here —
        // unless the visitor already picked the furry form while loading.
        if (formRef.current === 'furry') {
          void model.expression('Henshin').catch(() => undefined)
        }
        fit()
        void model.motion('Idle').catch(() => undefined)

        // Voice + expression drive (Phase 4): per-frame ticker, in the
        // YuriOS avatar.js order — ease the expression preset, then
        // override ParamMouthOpenY with the live TTS mouth value from
        // the avatar bridge. This ticker was registered after the
        // model's own ticker work, so the mouth override wins each
        // frame. Every parameter write is defensive: the Nekomi rig
        // may not expose every Hiyori parameter, and an absent param
        // must not break the stage. Pointer focus (ParamAngleX/Y) and
        // auto-blink stay with pixi-live2d-display's own handling.
        const core = (
          model.internalModel as unknown as {
            coreModel?: {
              setParameterValueById: (id: string, value: number) => void
              getParameterValueById?: (id: string) => number
            }
          }
        ).coreModel
        const setParam = (id: string, value: number) => {
          try {
            core?.setParameterValueById(id, value)
          } catch {
            // Param absent on this rig — ignore.
          }
        }
        let current: Record<string, number> = { ...EXPRESSION_PRESETS.neutral }
        let target: Record<string, number> = { ...EXPRESSION_PRESETS.neutral }
        // Henshin form, driven directly (see setHenshin): the expression
        // manager is the proper path, but the toggle was observed doing
        // nothing in the browser — so Param3 is ALSO written here, every
        // frame, after the model's own update and before the render, which
        // puts it in effect at render time by construction. Eased like
        // the presets so the switch still fades instead of snapping.
        let param3Current = formRef.current === 'furry' ? 1 : 0
        const unsubscribe = bridge.subscribe((state) => {
          target = { ...EXPRESSION_PRESETS[state.expression] }
        })
        const tick = () => {
          for (const key of Object.keys(target)) {
            const from = current[key] ?? 0
            current[key] = from + (target[key] - from) * 0.15
            setParam(key, current[key])
          }
          setParam('ParamMouthOpenY', bridge.getMouthOpen())
          const param3Target = formRef.current === 'furry' ? 1 : 0
          param3Current += (param3Target - param3Current) * 0.12
          setParam('Param3', param3Current)
          if (window.__nekomiDebug) {
            let readback = -1
            try {
              readback = core?.getParameterValueById?.('Param3') ?? -1
            } catch {
              // Read-back unsupported — ignore.
            }
            window.__nekomiDebug.param3 = Math.round(readback * 100) / 100
            window.__nekomiDebug.form = formRef.current
          }
        }
        app.ticker.add(tick)

        // Fix pass 13: the tick closure and the bridge subscription
        // live with the cached app across unmounts — unmount only
        // stops/starts the ticker, it never removes the tick or
        // unsubscribes. The subscription is released in
        // dropWarmStage(), when the stage is really discarded.
        pointerContainerRef.current = container
        container.addEventListener('pointermove', onPointer)

        // Publish the warm cache now that the stage is fully built:
        // the next mount re-attaches this app/model/canvas instead
        // of re-loading. The Henshin form needs no re-apply here —
        // it is already applied (the tick keeps writing Param3 every
        // frame from formRef), the warm path just re-fits.
        warmStage = { app, model, canvas, unsubscribe }

        setStatus('ready')
      } catch (err: unknown) {
        if (!cancelled) {
          // Fix pass 4: record the REAL error instead of swallowing it
          // — the previous build failed with a bare "MODÈLE
          // INDISPONIBLE" and no clue what broke. The cloud-browser
          // check reads window.__nekomiDebug.error to name the cause
          // (WebGL context limit, missing file, parse failure…).
          const message = err instanceof Error ? err.message : String(err)
          live2dError = message
          setFailMessage(message)
          window.__nekomiDebug = {
            status: 'failed',
            form: formRef.current,
            stageW: containerRef.current?.clientWidth ?? 0,
            stageH: containerRef.current?.clientHeight ?? 0,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            scale: 0,
            eyeScreenPx: [0, 0],
            mouthScreenPx: [0, 0],
            param3: -1,
            expressionOk: null,
            error: message,
          }
          setStatus('failed')
        }
      }
    }

    void init()
    return () => {
      cancelled = true
      // Fix pass 13: unmount does NOT destroy the app/model/canvas —
      // warmStage keeps the parsed stage alive for the next mount.
      // Only stop the ticker (restarted on remount) and detach the
      // pointer listener from the dying container. The tick closure
      // and bridge subscription survive with the cached app.
      // Instance refs are cleared so fit() no-ops until the next
      // mount re-points them at the cache.
      try {
        appRef.current?.ticker.stop()
      } catch {
        // Renderer already gone — nothing to stop.
      }
      const pointerContainer = pointerContainerRef.current
      if (pointerContainer) {
        pointerContainer.removeEventListener('pointermove', onPointer)
        pointerContainerRef.current = null
      }
      fitRef.current = null
      modelRef.current = null
      appRef.current = null
      app = null
      // Orphan canvas from an init that threw before the stage was
      // cached (context creation): PIXI never got to remove it, and
      // there is no warm stage to keep it for.
      const container = containerRef.current
      if (!warmStage && canvasEl && container && canvasEl.parentElement === container) {
        container.removeChild(canvasEl)
      }
      canvasEl = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, retryTick])

  const setHenshin = (next: Form) => {
    // Fix pass 12, bug 3: persist the choice module-level (see
    // lastHenshinForm above) so it survives the tab-leave unmount.
    lastHenshinForm = next
    formRef.current = next
    setForm(next)
    const model = modelRef.current
    if (!model) return
    // The expression API is the toggle: playing Henshin sets Param3 = 1,
    // resetting the expression manager returns it to the human default
    // (Param3 = 0). A direct parameter write would be overwritten while an
    // expression is active, so it is not used here — EXCEPT that the tick
    // ALSO writes Param3 directly every frame (see above): the toggle was
    // observed doing nothing in the browser, and the direct write is the
    // guarantee the render actually shows the chosen form. The result of
    // the expression call is recorded in the debug object so a future
    // check can tell which path worked.
    if (next === 'furry') {
      void model
        .expression('Henshin')
        .then((ok) => {
          if (window.__nekomiDebug) window.__nekomiDebug.expressionOk = ok
        })
        .catch(() => {
          if (window.__nekomiDebug) window.__nekomiDebug.expressionOk = false
        })
    } else {
      model.internalModel.motionManager.expressionManager?.resetExpression()
    }
    // Re-fit after the form change: the Henshin expression fades over
    // ~500 ms (expressionFadingDuration) and moves geometry (ears rise in
    // furry form), so re-measure at the start, mid-fade and end of the
    // transition. Fix pass 11: these re-fits now matter — fit() frames
    // the furry window from the canvas top (FURRY_TOP), so each
    // re-measure re-frames the taller form instead of re-applying the
    // human window to risen ears.
    window.setTimeout(() => fitRef.current?.(), 250)
    window.setTimeout(() => fitRef.current?.(), 600)
    window.setTimeout(() => fitRef.current?.(), 1000)
  }

  const nod = () => {
    void modelRef.current?.motion('Nodd').catch(() => undefined)
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-[1.75rem] border border-line bg-ink-2">
      <div
        ref={setStageRef}
        className="relative h-[340px] touch-pan-y sm:h-[380px] lg:h-[480px]"
        style={{ background: 'radial-gradient(70% 70% at 50% 30%, rgba(232,163,61,0.14), transparent 70%), #171210' }}
      >
        {status !== 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <img
              src="/images/nekomi-icon.png"
              alt="Nekomi — portrait de l’agent"
              className="h-48 w-48 rounded-full border border-amber/40 object-cover shadow-2xl shadow-black/50 sm:h-56 sm:w-56"
            />
            <p className="mt-5 font-display text-2xl italic text-bone">Nekomi</p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-mist">
              {status === 'loading'
                ? liveProgress > 0 && liveProgress < 100
                  ? `Le modèle Live2D se prépare — ${liveProgress} %${liveLabel ? ` — ${liveLabel}` : ''}`
                  : 'Le modèle Live2D se prépare — il apparaîtra ici et vous suivra des yeux.'
                : 'Le modèle Live2D n’a pas pu se charger ici — le chat et la commande ci-contre fonctionnent normalement.'}
            </p>
            <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-line bg-ink px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-bone/70">
              <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-amber" />
              {status === 'loading' ? 'Modèle en cours de chargement' : 'Modèle indisponible'}
            </span>
            {status === 'failed' && failMessage && (
              <p className="mt-3 max-w-xs break-words font-mono text-[11px] leading-relaxed text-mist/90">
                Erreur : {failMessage}
              </p>
            )}
            {status === 'failed' && (
              <button
                type="button"
                onClick={() => {
                  // Fix pass 13: retry MUST clear the warm cache and
                  // do a full cold init — never re-attach a dead stage.
                  dropWarmStage()
                  live2dError = null
                  setFailMessage(null)
                  if (window.__nekomiDebug) window.__nekomiDebug.error = null
                  setStatus('loading')
                  setRetryTick((t) => t + 1)
                }}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-bone px-6 py-2.5 text-sm font-bold text-ink transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:scale-[1.03]"
              >
                ↻ Réessayer
              </button>
            )}
          </div>
        )}
        <div className="absolute left-4 top-4 rounded-full border border-white/15 bg-black/30 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/85 backdrop-blur">
          Live2D · Cubism
        </div>
        {status === 'ready' && (
          <button
            type="button"
            onClick={nod}
            className="absolute bottom-4 right-4 min-h-11 rounded-full border border-white/20 bg-black/40 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-white/90 backdrop-blur transition-colors duration-300 hover:border-amber hover:text-amber"
          >
            ✦ Nodd
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5 sm:py-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-bone/80">{AGENT.henshinLabel}</p>
        <div className="flex rounded-full border border-line p-1" role="group" aria-label="Forme du modèle">
          {(
            [
              { id: 'human', label: AGENT.henshinHuman },
              { id: 'furry', label: AGENT.henshinFurry },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setHenshin(opt.id)}
              aria-pressed={form === opt.id}
              className={`min-h-11 rounded-full px-4 py-2 text-xs font-bold transition-all duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] ${
                form === opt.id ? 'bg-bone text-ink' : 'text-bone/60 hover:text-bone'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <p className="border-t border-line px-4 py-2.5 text-xs leading-relaxed text-mist sm:px-5 sm:py-3">{AGENT.modelNote}</p>
    </div>
  )
}
