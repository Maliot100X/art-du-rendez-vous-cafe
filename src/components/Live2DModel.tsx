import { useEffect, useRef, useState } from 'react'
import type { Live2DModel as Live2DModelType } from 'pixi-live2d-display/cubism4'
import { AGENT } from '../content'

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

export default function Live2DModel() {
  const containerRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<Live2DModelType | null>(null)
  const formRef = useRef<Form>('human')
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [form, setForm] = useState<Form>('human')

  useEffect(() => {
    let cancelled = false
    let app: import('pixi.js').Application | null = null
    let ro: ResizeObserver | null = null

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
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
        })

        const fit = (model: Live2DModelType) => {
          const w = container.clientWidth
          const h = container.clientHeight
          if (w === 0 || h === 0) return
          app?.renderer.resize(w, h)
          const scale = (h * 0.98) / model.height
          model.scale.set(scale)
          model.position.set(w / 2, h * 0.55)
        }

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
        fit(model)
        void model.motion('Idle').catch(() => undefined)

        const onPointer = (e: PointerEvent) => {
          const rect = container.getBoundingClientRect()
          model.focus(e.clientX - rect.left, e.clientY - rect.top)
        }
        container.addEventListener('pointermove', onPointer)

        ro = new ResizeObserver(() => fit(model))
        ro.observe(container)

        setStatus('ready')
        return () => container.removeEventListener('pointermove', onPointer)
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
      ro?.disconnect()
      modelRef.current?.destroy()
      modelRef.current = null
      app?.destroy(true, { children: true })
      app = null
    }
  }, [])

  const setHenshin = (next: Form) => {
    formRef.current = next
    setForm(next)
    const model = modelRef.current
    if (!model) return
    // The expression API is the toggle: playing Henshin sets Param3 = 1,
    // resetting the expression manager returns it to the human default
    // (Param3 = 0). A direct parameter write would be overwritten while an
    // expression is active, so it is not used here.
    if (next === 'furry') {
      void model.expression('Henshin').catch(() => undefined)
    } else {
      model.internalModel.motionManager.expressionManager?.resetExpression()
    }
  }

  const nod = () => {
    void modelRef.current?.motion('Nodd').catch(() => undefined)
  }

  return (
    <div className="overflow-hidden rounded-[1.75rem] border border-line bg-ink-2">
      <div
        ref={containerRef}
        className="relative h-[420px] sm:h-[480px]"
        style={{ background: 'radial-gradient(70% 70% at 50% 30%, rgba(232,163,61,0.14), transparent 70%), #171210' }}
      >
        {status !== 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <img
              src="/images/nekomi-icon.png"
              alt="Nekomi — portrait de l’agent"
              className="h-40 w-40 rounded-full border border-amber/40 object-cover shadow-2xl shadow-black/50"
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
            className="absolute bottom-4 right-4 rounded-full border border-white/20 bg-black/40 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-white/90 backdrop-blur transition-colors duration-300 hover:border-amber hover:text-amber"
          >
            ✦ Nodd
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
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
              className={`rounded-full px-4 py-2 text-xs font-bold transition-all duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] ${
                form === opt.id ? 'bg-bone text-ink' : 'text-bone/60 hover:text-bone'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-mist">{AGENT.modelNote}</p>
    </div>
  )
}
