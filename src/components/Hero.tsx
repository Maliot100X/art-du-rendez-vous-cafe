import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import ErrorBoundary from './ErrorBoundary'

// The dust veil is its own chunk (three + fiber + postprocessing):
// it loads with the hero, never with the first paint.
const HeroDust = lazy(() => import('./HeroDust'))
import { HERO } from '../content'
import { onFrame, scrollToHash, useReducedMotion } from '../lib/scroll'
import { clamp } from '../lib/math'
import { EASE_SILK_CSS, gsap, GSAP_EASE_SILK } from '../lib/motion'
import PullPhoto from './PullPhoto'

export default function Hero() {
  const sectionRef = useRef<HTMLElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const photoWrapRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const introRef = useRef<HTMLDivElement>(null)
  const badgeRef = useRef<HTMLDivElement>(null)
  // The pull hint fades once the photo has been pulled (PullPhoto
  // reports it via onFirstPull). The hint lives on the FRAME, not in
  // the scaled photo wrapper — the parallax scale (1.12) used to push
  // it off the frame's right edge.
  const [pulled, setPulled] = useState(false)
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
      // The hero is now ~1 viewport tall, so the old span (height − vh)
      // is ≤ 0 and p would saturate instantly: measure progress over
      // 90% of a viewport of scrolling instead.
      const p = clamp(-rect.top / Math.max(1, vh * 0.9))
      photo.style.transform = `scale(${1.12 - p * 0.08}) translateY(${p * 34}px)`
      title.style.transform = `translateY(${p * -56}px)`
      title.style.opacity = String(1 - p * 0.55)
      hint.style.opacity = String(1 - clamp(p * 6))
    })
  }, [])

  return (
    <section
      ref={sectionRef}
      id="top"
      className="relative flex min-h-[calc(100svh-140px)] flex-col overflow-clip pt-4 sm:pt-6 md:min-h-[calc(100svh-134px)]"
    >
      {/* The hero is exactly one viewport tall (minus the fixed nav pill
          AND the in-flow sticky tab bar below md — 72 + 61 + 1 border =
          134px; the old 72px left the title's last line sitting on the
          fold's edge — and minus the fixed mobile tab bar below md):
          intro + frame + full 3-line title + hint all fit in the first
          view, no scroll. The frame is flex-1 — it absorbs whatever
          height is left after the title and intro, instead of the old
          16:9 / min-440px frame that pushed the title below the fold. */}
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

      <div className="relative mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-3 sm:px-6">
        {/* No data-reveal here: GSAP owns this block's entrance + scroll-away.
            The scrim is the contrast fix (defect 2): a solid dark panel
            (bg-ink/85 + blur + ring) behind eyebrow + tagline + buttons,
            so their legibility no longer depends on whatever the fluid
            canvas happens to be painting behind them. The old
            translucent pills + drop-shadow-only text failed because the
            fluid's bright initial splats bled straight through. */}
        <div
          ref={introRef}
          className="relative flex flex-col items-center rounded-[1.75rem] bg-ink/85 px-4 py-5 text-center shadow-[0_8px_40px_rgba(0,0,0,0.5)] ring-1 ring-line backdrop-blur-md will-change-transform sm:px-8 sm:py-6"
        >
          <p className="hero-entrance inline-flex items-center gap-2 rounded-full border border-line bg-ink px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-bone">
            <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-ember" />
            {HERO.eyebrow}
          </p>
          <p className="hero-entrance mt-4 max-w-2xl text-lead text-bone sm:mt-5">{HERO.sub}</p>
          <div className="hero-entrance mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => scrollToHash(HERO.ctaPrimaryHash)}
              className="rounded-full bg-bone px-7 py-3.5 text-sm font-bold text-ink shadow-[0_4px_24px_rgba(0,0,0,0.5)] ring-1 ring-black/20 transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:scale-[1.04]"
            >
              {HERO.ctaPrimary} →
            </button>
            <button
              type="button"
              onClick={() => scrollToHash(HERO.ctaSecondaryHash)}
              className="rounded-full border border-bone/25 bg-ink px-7 py-3.5 text-sm font-bold text-bone shadow-[0_4px_24px_rgba(0,0,0,0.5)] transition-colors duration-300 hover:border-amber/60 hover:text-amber"
            >
              {HERO.ctaSecondary}
            </button>
          </div>
        </div>

        {/* The frame — visor grammar: rounded, giant type overlapping it.
            No fixed aspect any more: flex-1, it fills the height left
            over by intro + title + hint inside the 100svh hero. */}
        <div
          ref={frameRef}
          className="relative mt-4 min-h-[140px] w-full flex-1 overflow-hidden rounded-[2rem] shadow-2xl shadow-black/60 sm:mt-5"
        >
          <div
            ref={photoWrapRef}
            className="absolute inset-0 will-change-transform"
          >
            <PullPhoto src={HERO.pullImage} alt={HERO.pullImageAlt} onFirstPull={() => setPulled(true)} />
          </div>
          {/* Pull hint — on the FRAME, not inside the scaled photo
              wrapper: the parallax scale pushed it off the right edge. */}
          <p
            aria-hidden
            className="pointer-events-none absolute bottom-4 right-4 rounded-full border border-white/25 bg-black/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/90 backdrop-blur transition-opacity duration-1000 sm:bottom-6 sm:right-6"
            style={{ opacity: pulled ? 0 : 1, transitionTimingFunction: EASE_SILK_CSS }}
          >
            {HERO.pullHint} ↔
          </p>
          <div
            className="absolute inset-0"
            aria-hidden="true"
            style={{ background: 'linear-gradient(180deg, rgba(13,10,8,0.28), transparent 30%, transparent 45%, rgba(13,10,8,0.88))' }}
          />
          <div
            ref={badgeRef}
            className="absolute left-4 top-4 rounded-full border border-white/25 bg-black/30 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/90 backdrop-blur will-change-transform sm:left-6 sm:top-6"
          >
            Bruxelles — 1020
          </div>
        </div>

        {/* Giant overlapping type — same text-hero size as before
            (10vw, capped 9.5rem); it fits now because the frame above
            is flex-1 instead of fixed-height. */}
        <div ref={titleRef} className="relative z-10 -mt-[clamp(64px,9vw,150px)] text-center will-change-transform">
          <h1 className="font-display font-black leading-[0.86] tracking-[-0.02em] text-bone">
            <span className="block text-hero drop-shadow-[0_6px_30px_rgba(0,0,0,0.55)]">{HERO.titleA}</span>
            <span className="block text-hero drop-shadow-[0_6px_30px_rgba(0,0,0,0.55)]">{HERO.titleB}</span>
            <span className="block font-display text-hero italic text-amber drop-shadow-[0_6px_30px_rgba(0,0,0,0.55)]">
              {HERO.titleC}
            </span>
          </h1>
        </div>

        <div ref={hintRef} className="mt-6 flex flex-col items-center gap-3 pb-6" data-reveal>
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
