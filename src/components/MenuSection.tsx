import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { MENU } from '../content'
import { EASE_SILK, gsap, GSAP_EASE_SILK } from '../lib/motion'

export interface OrderLine {
  name: string
  price: string
}

export default function MenuSection({
  onAdd,
  onActiveChange,
  onItemAdd,
  barTopClass = 'top-[124px] sm:top-[132px]',
  betweenBarAndList,
}: {
  onAdd: (line: OrderLine) => void
  /**
   * The menu Vita (MenuVita) listens: a category change makes her walk
   * over and read the category aloud; an item tap makes her walk and
   * speak that item. The tab shell also passes barTopClass so the
   * sticky category bar sits under the tab bar (and, on a phone, under
   * the sticky Vita stage above it).
   */
  onActiveChange?: (catId: string) => void
  onItemAdd?: (line: OrderLine) => void
  barTopClass?: string
  /**
   * Node rendered between the sticky category bar and the list — the
   * tab shell puts the phone Vita stage + panel here, so the stage can
   * stick under the category bar while the list scrolls beneath it.
   */
  betweenBarAndList?: ReactNode
}) {
  const [active, setActive] = useState(MENU[0].id)
  const [added, setAdded] = useState<string | null>(null)
  const category = MENU.find((c) => c.id === active) ?? MENU[0]
  const reducedMotion = useReducedMotion()

  const sectionRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const rowsCtx = useRef<ReturnType<typeof gsap.context> | null>(null)
  const safetyRef = useRef<number | null>(null)

  // Report the active category outward (initial + every change) so the
  // Vita can react without owning the menu state.
  useEffect(() => {
    onActiveChange?.(active)
  }, [active, onActiveChange])

  const add = (name: string, price: string) => {
    onAdd({ name, price })
    onItemAdd?.({ name, price })
    setAdded(name)
    window.setTimeout(() => setAdded((cur) => (cur === name ? null : cur)), 900)
  }

  /**
   * GSAP: menu rows stagger in the first time the list scrolls into view
   * (ScrollTrigger, once). Runs every time a tab's content mounts — the
   * mount signal is the content's ref callback below, which fires after
   * AnimatePresence has swapped the tab in, so the rows are hidden before
   * their first paint and never flash visible. Reduced motion: skipped,
   * rows stay fully visible.
   */
  const staggerRows = useCallback(() => {
    if (reducedMotion) return
    rowsCtx.current?.revert()
    if (safetyRef.current) window.clearTimeout(safetyRef.current)
    rowsCtx.current = gsap.context(() => {
      gsap.fromTo(
        '.menu-row',
        { y: 24, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.7,
          ease: GSAP_EASE_SILK,
          stagger: 0.045,
          overwrite: 'auto',
          scrollTrigger: { trigger: listRef.current, start: 'top 88%', once: true },
        },
      )
    }, sectionRef)
    // Safety net: if the scroll trigger never fires (a row stuck at
    // opacity 0 after the stagger should have finished), force the
    // rows visible. A menu that can go invisible is worse than a menu
    // that skips its entrance animation.
    safetyRef.current = window.setTimeout(() => {
      const rows = listRef.current?.querySelectorAll('.menu-row')
      const first = rows?.[0]
      if (first && getComputedStyle(first).opacity === '0' && rows) {
        gsap.set(rows, { clearProps: 'all', autoAlpha: 1 })
      }
    }, 1600)
  }, [reducedMotion])

  // Mount signal for the tab content (stable identity so it only fires on
  // real mount/unmount, not on re-renders like the + button's state change).
  const onContentMount = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) staggerRows()
    },
    [staggerRows],
  )

  useEffect(
    () => () => {
      rowsCtx.current?.revert()
      if (safetyRef.current) window.clearTimeout(safetyRef.current)
    },
    [],
  )

  const tabTransition = { duration: reducedMotion ? 0 : 0.3, ease: EASE_SILK }

  return (
    <section id="carte" ref={sectionRef} className="relative mx-auto max-w-[1400px] scroll-mt-24 px-4 py-16 sm:px-6 sm:py-24 md:py-36">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between" data-reveal>
        <div>
          <p className="font-mono text-label uppercase text-amber">La carte</p>
          <h2 className="mt-3 font-display text-display text-bone">
            Que désirez-<span className="italic text-amber">vous</span>&nbsp;?
          </h2>
        </div>
        <p className="max-w-md text-body text-bone/70">
          Sept familles, des prix affichés, rien d’autre. La carte est la même au bar et ici — ce que vous lisez est
          ce que vous payez.
        </p>
      </div>

      {/* Tabs — sticky, always visible, horizontally scrollable. No
          data-reveal here: a reveal that fails to fire must never hide
          the tabs, and the bar must stay reachable while the list is
          long. The inner row scrolls sideways; the outer wrapper sticks. */}
      <div className={`sticky z-30 -mx-4 mt-8 bg-ink/90 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 ${barTopClass}`}>
        <div
          className="flex flex-nowrap gap-2 overflow-x-auto"
          role="tablist"
          aria-label="Catégories de la carte"
        >
          {MENU.map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={active === cat.id}
              onClick={() => setActive(cat.id)}
              className={`shrink-0 whitespace-nowrap rounded-full border px-4 py-3.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-all duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] ${
                active === cat.id
                  ? 'border-bone bg-bone text-ink'
                  : 'border-line bg-transparent text-bone/70 hover:border-bone/50 hover:text-bone'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {betweenBarAndList}

      {/* Tab content — Framer Motion owns the swap (mode="wait": the old
          category fades/slides out before the new one enters); GSAP owns
          the rows' stagger inside, fired by the content's mount ref. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={category.id}
          ref={onContentMount}
          className="mt-8 grid gap-6 lg:mt-10 lg:grid-cols-[1fr_380px] lg:gap-10"
          initial={reducedMotion ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -14 }}
          transition={tabTransition}
        >
          {/* Items */}
          <div>
            <p className="max-w-lg text-lead italic text-bone/80">{category.blurb}</p>
            <ul ref={listRef} className="mt-8">
              {category.items.map((item, i) => (
                <li
                  key={item.name}
                  className="menu-row group flex items-baseline gap-3 border-b border-line py-4 transition-colors duration-300 hover:border-amber/40"
                >
                  <span className="font-mono text-[11px] text-mist">{String(i + 1).padStart(2, '0')}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-lg font-bold tracking-wide text-bone sm:text-xl">
                      {item.name}
                    </span>
                    {item.note && <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-mist">{item.note}</span>}
                  </span>
                  <span className="hidden flex-1 border-b border-dotted border-bone/25 sm:block" aria-hidden="true" />
                  <span className="font-mono text-sm font-medium tabular-nums text-amber">{item.price}</span>
                  <button
                    type="button"
                    onClick={() => add(item.name, item.price)}
                    aria-label={`Ajouter ${item.name} à la commande`}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-all duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] ${
                      added === item.name
                        ? 'border-amber bg-amber text-ink'
                        : 'border-line text-bone/70 hover:scale-110 hover:border-amber hover:text-amber'
                    }`}
                  >
                    <Plus size={16} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-mist">
              Prix en euros, taxes comprises · Le + ajoute à votre commande
            </p>
          </div>

          {/* Category image — a real photo on every screen: a banner
              above the items on a phone, the side column on desktop.
              Crossfades per tab with the content swap. */}
          <figure className="relative order-first overflow-hidden rounded-[1.75rem] lg:order-none lg:h-full">
            <img
              src={category.image}
              alt={category.imageAlt}
              className="h-48 w-full object-cover sm:h-56 lg:h-full"
              loading="lazy"
              decoding="async"
            />
            <div
              className="absolute inset-0"
              aria-hidden="true"
              style={{ background: 'linear-gradient(180deg, transparent 55%, rgba(13,10,8,0.85))' }}
            />
            <figcaption className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-amber">{category.label}</p>
              <p className="mt-2 font-display text-xl italic text-bone sm:text-2xl">{category.blurb}</p>
            </figcaption>
          </figure>
        </motion.div>
      </AnimatePresence>
    </section>
  )
}
