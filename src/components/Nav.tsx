import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { CAFE, NAV } from '../content'
import { scrollToHash } from '../lib/scroll'
import { EASE_SILK } from '../lib/motion'

export default function Nav() {
  const [open, setOpen] = useState(false)
  const reducedMotion = useReducedMotion()

  const go = (hash: string) => {
    setOpen(false)
    // Let the menu close before gliding.
    window.setTimeout(() => scrollToHash(hash), 60)
  }

  // Staggered menu links — the container only orchestrates, each link
  // carries its own rise. Reduced motion: everything appears at once.
  const listVariants: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: reducedMotion ? 0 : 0.07, delayChildren: reducedMotion ? 0 : 0.08 } },
  }
  const itemVariants: Variants = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 24 },
    visible: { opacity: 1, y: 0, transition: { duration: reducedMotion ? 0 : 0.55, ease: EASE_SILK } },
  }
  const overlayTransition = { duration: reducedMotion ? 0 : 0.35, ease: EASE_SILK }

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-6 sm:pt-4">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between rounded-full border border-line bg-ink/75 py-2 pl-5 pr-2 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => go('#top')}
            className="flex items-baseline gap-2 text-left"
            aria-label="Art du Rendez-Vous — retour en haut"
          >
            <span className="font-display text-[15px] font-bold tracking-[0.08em] text-bone">
              ART DU RENDEZ-VOUS
            </span>
            <span className="font-display text-[13px] italic text-amber">Café</span>
          </button>

          <nav className="hidden items-center gap-7 md:flex" aria-label="Navigation principale">
            {NAV.links.map((link) => (
              <button
                key={link.hash}
                type="button"
                onClick={() => go(link.hash)}
                className="font-mono text-[11px] uppercase tracking-[0.16em] text-bone/70 transition-colors duration-300 hover:text-bone"
              >
                {link.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => go(NAV.ctaHash)}
              className="hidden rounded-full bg-bone px-5 py-2.5 text-sm font-bold text-ink transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:scale-[1.04] sm:block"
            >
              {NAV.cta}
            </button>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-bone md:hidden"
              aria-label="Ouvrir le menu"
              aria-expanded={open}
            >
              <Menu size={18} />
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            key="mobile-menu"
            className="fixed inset-0 z-[60] flex flex-col bg-ink/95 backdrop-blur-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={overlayTransition}
          >
            <motion.div variants={itemVariants} initial="hidden" animate="visible" exit="hidden" className="flex items-center justify-between px-5 pt-5">
              <span className="font-display text-[15px] font-bold tracking-[0.08em] text-bone">
                ART DU RENDEZ-VOUS <span className="italic text-amber">Café</span>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-bone"
                aria-label="Fermer le menu"
              >
                <X size={18} />
              </button>
            </motion.div>
            <motion.nav
              variants={listVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              className="flex flex-1 flex-col items-start justify-center gap-2 px-6"
              aria-label="Menu mobile"
            >
              {NAV.links.map((link, i) => (
                <motion.button
                  key={link.hash}
                  type="button"
                  variants={itemVariants}
                  onClick={() => go(link.hash)}
                  className="flex items-baseline gap-4 py-2 text-left"
                >
                  <span className="font-mono text-[11px] text-amber">0{i + 1}</span>
                  <span className="font-display text-5xl text-bone">{link.label}</span>
                </motion.button>
              ))}
              <motion.button
                type="button"
                variants={itemVariants}
                onClick={() => go(NAV.ctaHash)}
                className="mt-8 rounded-full bg-bone px-7 py-3.5 text-base font-bold text-ink"
              >
                {NAV.cta} →
              </motion.button>
            </motion.nav>
            <motion.p
              variants={itemVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              className="px-6 pb-8 font-mono text-[11px] uppercase tracking-[0.16em] text-mist"
            >
              {CAFE.address}
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
