import { useEffect, useRef } from 'react'
import { ATMOSPHERE } from '../content'
import { onFrame } from '../lib/scroll'
import { clamp, easeOutCubic, pinProgress, range } from '../lib/math'

const N = ATMOSPHERE.chapters.length

/**
 * Scroll cinema (selene Earthrise + naiade Stage grammar):
 * a tall pinned section, a sticky full-viewport child, four photographic
 * layers that crossfade and drift at different speeds as you scroll.
 * All motion is direct DOM writes inside the rAF loop — never React state.
 */
export default function Atmosphere() {
  const sectionRef = useRef<HTMLElement>(null)
  const layerRefs = useRef<(HTMLDivElement | null)[]>([])
  const copyRefs = useRef<(HTMLDivElement | null)[]>([])
  const railFillRef = useRef<HTMLDivElement>(null)
  const railLabelRef = useRef<HTMLParagraphElement>(null)
  const activeRef = useRef(-1)

  useEffect(() => {
    return onFrame(() => {
      const section = sectionRef.current
      if (!section) return
      const { p, rect, vh } = pinProgress(section)
      if (rect.bottom < 0 || rect.top > vh) return

      for (let i = 0; i < N; i++) {
        const layer = layerRefs.current[i]
        const copy = copyRefs.current[i]
        if (!layer || !copy) continue
        const start = i / N
        const end = (i + 1) / N
        const local = range(p, start, end)
        // Fade in over the first 8% of the chapter, out over the last 8%.
        const opacity = clamp(local / 0.08) * (1 - clamp((local - 0.92) / 0.08))
        const img = layer.querySelector('img')
        if (img) {
          const e = easeOutCubic(local)
          img.style.transform = `scale(${1.14 - e * 0.1}) translateY(${(0.5 - e) * 48}px)`
        }
        layer.style.opacity = String(opacity)
        layer.style.visibility = opacity <= 0 ? 'hidden' : 'visible'
        copy.style.opacity = String(clamp((local - 0.12) / 0.15) * (1 - clamp((local - 0.78) / 0.12)))
        copy.style.transform = `translateY(${(1 - easeOutCubic(clamp((local - 0.1) / 0.3))) * 28}px)`
      }

      if (railFillRef.current) {
        railFillRef.current.style.transform = `scaleY(${p})`
      }
      const active = Math.min(N - 1, Math.max(0, Math.floor(p * N)))
      if (active !== activeRef.current) {
        activeRef.current = active
        if (railLabelRef.current) {
          railLabelRef.current.textContent = `${ATMOSPHERE.chapters[active].index} / ${String(N).padStart(2, '0')} — ${ATMOSPHERE.chapters[active].title}`
        }
      }
    })
  }, [])

  return (
    <section id="ambiance" ref={sectionRef} className="relative" style={{ height: '420svh' }}>
      <div className="sticky top-0 h-svh overflow-hidden">
        {/* Layers */}
        {ATMOSPHERE.chapters.map((chapter, i) => (
          <div
            key={chapter.id}
            ref={(el) => {
              layerRefs.current[i] = el
            }}
            className="absolute inset-0"
            style={{ opacity: i === 0 ? 1 : 0, visibility: i === 0 ? 'visible' : 'hidden' }}
            aria-hidden={i !== 0}
          >
            <img
              src={chapter.image}
              alt={chapter.imageAlt}
              loading={i === 0 ? 'eager' : 'lazy'}
              className="h-full w-full object-cover will-change-transform"
            />
            <div
              className="absolute inset-0"
              aria-hidden="true"
              style={{ background: 'linear-gradient(180deg, rgba(13,10,8,0.55), transparent 30%, transparent 55%, rgba(13,10,8,0.88))' }}
            />
          </div>
        ))}

        {/* Header copy */}
        <div className="absolute inset-x-0 top-0 px-4 pt-[104px] sm:px-6">
          <div className="mx-auto max-w-[1400px]">
            <p className="font-mono text-label uppercase text-amber">{ATMOSPHERE.eyebrow}</p>
            <h2 className="mt-3 max-w-xl font-display text-display text-bone">{ATMOSPHERE.title}</h2>
            <p className="mt-3 max-w-md text-body text-bone/75">{ATMOSPHERE.lede}</p>
          </div>
        </div>

        {/* Chapter copy */}
        {ATMOSPHERE.chapters.map((chapter, i) => (
          <div
            key={chapter.id}
            ref={(el) => {
              copyRefs.current[i] = el
            }}
            className="absolute inset-x-0 bottom-0 px-4 pb-14 sm:px-6 sm:pb-20"
            style={{ opacity: i === 0 ? 1 : 0 }}
          >
            <div className="mx-auto max-w-[1400px]">
              <p className="font-display text-6xl italic text-amber sm:text-7xl">{chapter.index}</p>
              <h3 className="mt-2 font-display text-4xl text-bone sm:text-5xl">{chapter.title}</h3>
              <p className="mt-3 max-w-lg text-lead text-bone/80">{chapter.text}</p>
            </div>
          </div>
        ))}

        {/* Chapter rail (naiade) */}
        <div className="absolute right-5 top-1/2 hidden -translate-y-1/2 flex-col items-center gap-3 sm:flex">
          <div className="relative h-40 w-px bg-bone/25">
            <div
              ref={railFillRef}
              className="absolute inset-0 origin-top bg-amber will-change-transform"
              style={{ transform: 'scaleY(0)' }}
            />
          </div>
          <p ref={railLabelRef} className="font-mono text-[10px] uppercase tracking-[0.16em] text-bone/80 [writing-mode:vertical-rl]">
            01 / 04 — La façade
          </p>
        </div>
      </div>
    </section>
  )
}
