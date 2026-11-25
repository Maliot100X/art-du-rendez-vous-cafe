import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CAFE, FOOTER } from '../content'
import { scrollToHash } from '../lib/scroll'
import { EASE_SILK } from '../lib/motion'

/** Probe-fit wordmark: render at 100px, measure, scale to the container. */
function useFitText(text: string) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const fit = () => {
      const wrap = wrapRef.current
      const probe = probeRef.current
      if (!wrap || !probe) return
      const w = wrap.clientWidth
      const pw = probe.scrollWidth
      if (pw === 0) return
      probe.style.fontSize = `${(100 * w) / pw}px`
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [text])

  return { wrapRef, probeRef }
}

export default function Footer() {
  const { wrapRef, probeRef } = useFitText('ART DU RENDEZ-VOUS')
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const reducedMotion = useReducedMotion()

  const subscribe = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.includes('@')) return
    setDone(true)
  }

  const swapTransition = { duration: reducedMotion ? 0 : 0.4, ease: EASE_SILK }

  return (
    <footer className="relative z-10 border-t border-line bg-ink-2">
      <div className="mx-auto max-w-[1400px] px-4 pb-10 pt-20 sm:px-6">
        <div className="grid gap-12 md:grid-cols-[1.2fr_1fr_1fr]">
          <div data-reveal>
            <h2 className="font-display text-display text-bone">{FOOTER.subscribeTitle}</h2>
            <p className="mt-3 max-w-sm text-body text-bone/70">{FOOTER.subscribeText}</p>
            <AnimatePresence mode="wait" initial={false}>
              {done ? (
                <motion.p
                  key="subscribed"
                  initial={reducedMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={swapTransition}
                  className="mt-6 inline-flex items-center gap-2 rounded-full border border-amber/50 bg-amber/10 px-5 py-3 text-sm font-bold text-amber"
                >
                  ✓ {FOOTER.subscribeDone}
                </motion.p>
              ) : (
                <motion.form
                  key="subscribe-form"
                  initial={reducedMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={swapTransition}
                  onSubmit={subscribe}
                  className="mt-6 flex max-w-sm items-center gap-2 rounded-full border border-line bg-ink p-1.5"
                >
                  <label htmlFor="newsletter-email" className="sr-only">
                    {FOOTER.subscribePlaceholder}
                  </label>
                  <input
                    id="newsletter-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={FOOTER.subscribePlaceholder}
                    className="min-w-0 flex-1 bg-transparent px-3 text-sm text-bone placeholder:text-mist focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="shrink-0 rounded-full bg-bone px-5 py-2.5 text-sm font-bold text-ink transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:scale-[1.04]"
                  >
                    {FOOTER.subscribeCta}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </div>

          {FOOTER.columns.map((col) => (
            <div key={col.title} data-reveal>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mist">{col.title}</p>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <button
                      type="button"
                      onClick={() => scrollToHash(link.hash)}
                      className="font-display text-xl text-bone/85 transition-colors duration-300 hover:text-amber"
                    >
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Giant edge-to-edge wordmark */}
        <div ref={wrapRef} className="mt-16 select-none overflow-hidden" aria-hidden="true">
          <span
            ref={probeRef}
            className="block whitespace-nowrap font-display font-black leading-none tracking-[-0.02em] text-bone/90"
            style={{ fontSize: '100px' }}
          >
            ART DU RENDEZ-VOUS
          </span>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-line pt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-mist sm:flex-row sm:items-center sm:justify-between">
          <span>{FOOTER.legal}</span>
          <span>{FOOTER.mapsLine}</span>
          <button type="button" onClick={() => scrollToHash('#top')} className="text-left text-bone/70 transition-colors hover:text-amber sm:text-right">
            Retour en haut ↑
          </button>
        </div>
        <p className="sr-only">{CAFE.name} {CAFE.suffix}</p>
      </div>
    </footer>
  )
}
