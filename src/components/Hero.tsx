import { lazy, Suspense, useEffect, useRef } from 'react'
import ErrorBoundary from './ErrorBoundary'

// The dust veil is its own chunk (three + fiber + postprocessing):
// it loads with the hero, never with the first paint.
const HeroDust = lazy(() => import('./HeroDust'))
import { HERO } from '../content'
import { onFrame, scrollToHash, useReducedMotion } from '../lib/scroll'
import { clamp } from '../lib/math'
import { gsap, GSAP_EASE_SILK } from '../lib/motion'
import PullPhoto from './PullPhoto'

export default function Hero() {
  const sectionRef = useRef<HTMLElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const photoWrapRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const introRef = useRef<HTMLDivElement>(null)
  const badgeRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()

  // GSAP: entrance + scroll-away reinforcement for the intro block and the
  // frame badge. The title/frame parallax itself stays on the rAF path
  // below (direct DOM writes, per the Scrolltide grammar) — GSAP never
  // touches those nodes, so the two systems can't fight over a transform.
  // Reduced motion: no GSAP at all, everything stays fully visible.
  useEffect(() => {
    if (reducedMotion) return
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.hero-entrance',
        { y: 28, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 1, ease: GSAP_EASE_SILK, stagger: 0.1, delay: 0.15 },
      )
      gsap.to(introRef.current, {
        y: -48,
        autoAlpha: 0,
        ease: 'none',
        scrollTrigger: { trigger: sectionRef.current, start: 'top top', end: 'bottom top', scrub: 0.6 },
      })
      gsap.to(badgeRef.current, {
        y: -24,
        autoAlpha: 0,
        ease: 'none',
        scrollTrigger: { trigger: sectionRef.current, start: 'top top', end: 'bottom top', scrub: 0.6 },
      })
    }, sectionRef)
    return () => ctx.revert()
  }, [reducedMotion])

  // Scroll-driven frame parallax — direct DOM writes, never React state.
  // The transform now lives on the photo wrapper (shader canvas or static
  // fallback alike); PullPhoto corrects pointer coords for the scale.
  useEffect(() => {
    return onFrame(() => {
      const section = sectionRef.current
      const frame = frameRef.current
      const photo = photoWrapRef.current
      const title = titleRef.current
      const hint = hintRef.current
      if (!section || !frame || !photo || !title || !hint) return
      const rect = section.getBoundingClientRect()
      const vh = window.innerHeight
      if (rect.bottom < 0 || rect.top > vh) return
      const p = clamp(-rect.top / Math.max(1, rect.height - vh))
      photo.style.transform = `scale(${1.12 - p * 0.08}) translateY(${p * 34}px)`
      title.style.transform = `translateY(${p * -56}px)`
      title.style.opacity = String(1 - p * 0.55)
      hint.style.opacity = String(1 - clamp(p * 6))
    })
  }, [])

  return (
    <section ref={sectionRef} id="top" className="relative overflow-clip pt-8 sm:pt-10">
      {/* 3D dust veil behind everything. Decorative only: if WebGL is
          unavailable (headless browsers, old devices) the boundary drops
          the canvas instead of letting R3F's renderer throw unmount the
          whole app. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <HeroDust />
          </Suspense>
        </ErrorBoundary>
      </div>
      {/* Warm glow, low in the frame */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[60vh]"
        aria-hidden="true"
        style={{ background: 'radial-gradient(60% 60% at 50% 100%, rgba(232,163,61,0.16), transparent 70%)' }}
      />

      <div className="relative mx-auto max-w-[1400px] px-3 sm:px-6">
        {/* No data-reveal here: GSAP owns this block's entrance + scroll-away. */}
        <div ref={introRef} className="flex flex-col items-center text-center will-change-transform">
          <p className="hero-entrance inline-flex items-center gap-2 rounded-full border border-line bg-ink-2/70 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-bone/80">
            <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-ember" />
            {HERO.eyebrow}
          </p>
          <p className="hero-entrance mt-4 max-w-2xl text-lead text-bone drop-shadow-[0_2px_12px_rgba(0,0,0,0.65)] sm:mt-6">{HERO.sub}</p>
          <div className="hero-entrance mt-7 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => scrollToHash(HERO.ctaPrimaryHash)}
              className="rounded-full bg-bone px-7 py-3.5 text-sm font-bold text-ink transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:scale-[1.04]"
            >
              {HERO.ctaPrimary} →
            </button>
            <button
              type="button"
              onClick={() => scrollToHash(HERO.ctaSecondaryHash)}
              className="rounded-full border border-line bg-ink-2/60 px-7 py-3.5 text-sm font-bold text-bone backdrop-blur transition-colors duration-300 hover:border-amber/60 hover:text-amber"
            >
              {HERO.ctaSecondary}
            </button>
          </div>
        </div>

        {/* The frame — visor grammar: 16:9, rounded, giant type overlapping it */}
        <div
          ref={frameRef}
          className="relative mt-6 aspect-[16/9] min-h-[260px] w-full overflow-hidden rounded-[2rem] shadow-2xl shadow-black/60 sm:mt-12 sm:min-h-[380px] lg:aspect-[16/7] lg:min-h-[440px]"
        >
          <div
            ref={photoWrapRef}
            className="absolute inset-0 will-change-transform"
          >
            <PullPhoto src={HERO.pullImage} alt={HERO.pullImageAlt} />
          </div>
          <div
            className="absolute inset-0"
            aria-hidden="true"
            style={{ background: 'linear-gradient(180deg, rgba(13,10,8,0.15), transparent 35%, transparent 55%, rgba(13,10,8,0.72))' }}
          />
          <div
            ref={badgeRef}
            className="absolute left-4 top-4 rounded-full border border-white/25 bg-black/30 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/90 backdrop-blur will-change-transform sm:left-6 sm:top-6"
          >
            Bruxelles — 1020
          </div>
        </div>

        {/* Giant overlapping type */}
        <div ref={titleRef} className="relative z-10 -mt-[clamp(64px,9vw,150px)] text-center will-change-transform lg:-mt-[210px]">
          <h1 className="font-display font-black leading-[0.86] tracking-[-0.02em] text-bone">
            <span className="block text-hero drop-shadow-[0_6px_30px_rgba(0,0,0,0.55)]">{HERO.titleA}</span>
            <span className="block text-hero drop-shadow-[0_6px_30px_rgba(0,0,0,0.55)]">{HERO.titleB}</span>
            <span className="block font-display text-hero italic text-amber drop-shadow-[0_6px_30px_rgba(0,0,0,0.55)]">
              {HERO.titleC}
            </span>
          </h1>
        </div>

        <div ref={hintRef} className="mt-10 flex flex-col items-center gap-4 pb-16" data-reveal>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {HERO.chips.map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-line bg-ink-2/70 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-bone/75"
              >
                {chip}
              </span>
            ))}
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-mist">Faites défiler ↓</p>
        </div>
      </div>
    </section>
  )
}
