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
 */
const FACE_TOP = 0.02
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
    }
  }
}

const CORE_LOCAL = '/live2d/live2dcubismcore.min.js'
const CORE_CDN = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js'
const MODEL_URL = '/live2d/nekomi/Furry.model3.json'

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
  const formRef = useRef<Form>('human')
  const fitRef = useRef<(() => void) | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [form, setForm] = useState<Form>('human')
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

  // Re-fit whenever the measured stage size changes.
  useEffect(() => {
    if (stageW > 0 && stageH > 0) fitRef.current?.()
  }, [stageW, stageH])

  useEffect(() => {
    let cancelled = false
    let app: import('pixi.js').Application | null = null

    const init = async () => {
      const container = containerRef.current
      if (!container) return
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

        app = new PIXI.Application({
          view: canvas,
          backgroundAlpha: 0,
          antialias: true,
          resolution: Math.min(window.devicePixelRatio || 1, pixelRatioCap()),
          autoDensity: true,
        })

        const fit = () => {
          const w = container.clientWidth
          const h = container.clientHeight
          if (w === 0 || h === 0) return
          app?.renderer.resize(w, h)
          // Frame the FACE band (see FACE_TOP/FACE_BOTTOM above), not the
          // top of the bounds: getBounds() is the whole canvas rect, so
          // the window is placed by measured canvas fractions. A
          // horizontal guard keeps the head inside narrow stages.
          model.scale.set(1)
          model.position.set(0, 0)
          const b = model.getBounds()
          if (!b || b.height === 0) {
            const scale = (h * 0.98) / model.height
            model.scale.set(scale)
            model.position.set(w / 2, h * 0.55)
            return
          }
          const windowH = FACE_BOTTOM - FACE_TOP
          const s = Math.min((h * 0.98) / (b.height * windowH), (w * 0.96) / (b.width * HEAD_WIDTH_FRAC))
          model.scale.set(s)
          model.position.set(w / 2 - (b.x + b.width / 2) * s, h * 0.02 - (b.y + b.height * FACE_TOP) * s)
          // Debug projection (verifiable without a real browser): where
          // the eyes and mouth land in stage pixels, from the measured
          // fractions and the actual scale/position just applied.
          const stageY = (fracFromTop: number) => h * 0.02 + (fracFromTop - FACE_TOP) * b.height * s
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
          }
        }
        fitRef.current = fit

        const model = (await Live2DModel.from(MODEL_URL)) as Live2DModelType
        if (cancelled) {
          model.destroy()
          return
        }
        model.anchor.set(0.5, 0.5)
        app.stage.addChild(model)
        modelRef.current = model

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

        const detachTicker = () => {
          app?.ticker.remove(tick)
          unsubscribe()
        }

        const onPointer = (e: PointerEvent) => {
          const rect = container.getBoundingClientRect()
          model.focus(e.clientX - rect.left, e.clientY - rect.top)
        }
        container.addEventListener('pointermove', onPointer)

        setStatus('ready')
        return () => {
          detachTicker()
          container.removeEventListener('pointermove', onPointer)
        }
      } catch {
        if (!cancelled) setStatus('failed')
      }
    }

    let detach: void | (() => void)
    void init().then((fn) => {
      detach = fn
    })
    return () => {
      cancelled = true
      detach?.()
      fitRef.current = null
      // Destroy calls can throw if the renderer is already gone (context
      // lost mid-unmount) — a throw here during React's unmount would
      // propagate and unmount the whole app into a black page.
      try {
        modelRef.current?.destroy()
      } catch {
        // Already destroyed — nothing to free.
      }
      modelRef.current = null
      try {
        app?.destroy(true, { children: true })
      } catch {
        // Already destroyed — nothing to free.
      }
      app = null
    }
  }, [bridge])

  const setHenshin = (next: Form) => {
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
    // transition. The face band itself is the same in both forms
    // (measured), so this is a safety net, not the fix.
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
                ? 'Le modèle Live2D se prépare — il apparaîtra ici et vous suivra des yeux.'
                : 'Le modèle Live2D n’a pas pu se charger ici — le chat et la commande ci-contre fonctionnent normalement.'}
            </p>
            <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-line bg-ink px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-bone/70">
              <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-amber" />
              {status === 'loading' ? 'Modèle en cours de chargement' : 'Modèle indisponible'}
            </span>
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
