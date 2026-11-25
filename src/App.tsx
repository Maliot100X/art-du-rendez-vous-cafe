import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { lazyWithRetry } from './lib/lazyRetry'
import Nav from './components/Nav'
import Hero from './components/Hero'
import MenuSection, { type OrderLine } from './components/MenuSection'
import Visit from './components/Visit'
import Footer from './components/Footer'
import ErrorBoundary from './components/ErrorBoundary'
import { scrollToTop, startScroll, useReducedMotion } from './lib/scroll'
import { useReveal } from './lib/useReveal'
import { currentTab, onTabChange, setTab, TABS, type TabId } from './lib/tabs'
import MenuVita, { MenuVitaPanel, MenuVitaStage, useVitaGuide, type MenuVitaItemEvent } from './components/MenuVita'
import { MENU } from './content'

// Below-fold / heavy scenes load in their own chunks so the first paint
// stays lean. Each Suspense fallback reserves roughly the section's real
// height so the document doesn't jump as chunks land. The retry wrapper
// gives a dropped chunk one second chance; a persistent failure lands in
// the panel ErrorBoundary below instead of black-screening the page.
const Atmosphere = lazyWithRetry(() => import('./components/Atmosphere'))
const MenuBook = lazyWithRetry(() => import('./components/MenuBook'))
const Gallery = lazyWithRetry(() => import('./components/Gallery'))
const Agent = lazyWithRetry(() => import('./components/Agent'))
const FluidBackground = lazyWithRetry(() => import('./components/FluidBackground'))

/** Visible loading state for a tab panel — never a blank dark area. */
function PanelLoading({ label }: { label: string }) {
  return (
    <div className="mx-auto flex min-h-[60svh] max-w-[1400px] flex-col items-center justify-center px-4 py-24 text-center">
      <span className="live-dot inline-block h-2.5 w-2.5 rounded-full bg-amber" aria-hidden="true" />
      <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.16em] text-bone/80">{label}</p>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-mist">
        Le contenu arrive — le reste du site reste utilisable.
      </p>
    </div>
  )
}

/** A tab panel that failed to load — keeps Nav + TabBar alive, offers a retry. */
function PanelError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60svh] max-w-[1400px] flex-col items-center justify-center px-4 py-24 text-center">
      <p className="font-display text-3xl italic text-bone">Oups — {label} n'a pas pu se charger.</p>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-mist">
        Le reste du site fonctionne. Réessayez — le plus souvent, c'est juste la connexion.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 min-h-11 rounded-full bg-bone px-7 py-3 text-sm font-bold text-ink transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:scale-[1.03]"
      >
        Réessayer
      </button>
    </div>
  )
}

/**
 * Tab shell — Minir's order: no more one long screen. Each tab shows
 * ONLY its own content; the tab bar is always visible (sticky, under
 * the fixed nav pill), works at 390px and on desktop, 44px targets,
 * horizontally scrollable on phones.
 *
 * Deep links: #home #menu #book #gallery #ambiance #visit #agent
 * (legacy anchors #carte #livre #galerie #venir #top still work — see
 * src/lib/tabs.ts). Switching tabs updates the hash; loading with a
 * hash opens that tab; back/forward moves between tabs.
 *
 * Mount-on-activate: only the active tab's panel is mounted, so only
 * one WebGL context is alive at a time (the VRM, the book, the fluid,
 * the Live2D and the hero dust never run together). Heavy scenes are
 * React.lazy chunks that load only when their tab opens. The fluid
 * background lives on the Home tab only; every other tab gets the
 * static CSS gradient (cheap, same palette).
 *
 * The Atmosphere pinned scroll cinema (420svh) keeps working inside
 * the Ambiance tab: the panel is plain flow (no overflow-hidden
 * ancestor), and tab switching scrolls to the top of the panel.
 */

/** Static gradient base layer — under everything, on every tab. */
function FluidFallbackDiv() {
  return <div className="fluid-fallback pointer-events-none fixed inset-0 z-0" aria-hidden="true" />
}

function TabBar({ active, onSelect }: { active: TabId; onSelect: (id: TabId) => void }) {
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the active tab visible in the scrollable row.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <div className="sticky top-[64px] z-40 border-b border-line bg-ink/90 backdrop-blur-xl sm:top-[72px]">
      <div
        ref={listRef}
        className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-3 py-2 sm:justify-center sm:px-6"
        role="tablist"
        aria-label="Sections du site"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => onSelect(tab.id)}
            className={`min-h-11 shrink-0 whitespace-nowrap rounded-full px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-all duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] ${
              active === tab.id ? 'bg-bone text-ink' : 'text-bone/70 hover:text-bone'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Menu tab: the menu + Vita walking beside it.
 *
 * Desktop (lg+): two columns — the menu on the left, Vita in a sticky
 * side column. Phone: Vita sits between the category bar and the list —
 * the stage sticks under the category bar (top 184px = nav 64 + tab
 * bar 60 + category bar 60) while the list scrolls beneath it, and her
 * panel (what she says, book button, mini chat) scrolls away in flow.
 * Only one layout mounts at a time (matchMedia), so the VRM exists
 * exactly once.
 */
function MenuTab({ onAdd, onOpenBook }: { onAdd: (line: OrderLine) => void; onOpenBook: (catId: string) => void }) {
  const [categoryId, setCategoryId] = useState(MENU[0].id)
  const [itemEvent, setItemEvent] = useState<MenuVitaItemEvent | null>(null)
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const guide = useVitaGuide({ categoryId, itemEvent, onOpenBook })
  const handleActiveChange = useCallback((id: string) => setCategoryId(id), [])
  const handleItemAdd = useCallback((line: OrderLine) => {
    setItemEvent({ ...line, nonce: Date.now() })
  }, [])

  if (isDesktop) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-10 lg:grid-cols-[1fr_380px]">
        <MenuSection onAdd={onAdd} onActiveChange={handleActiveChange} onItemAdd={handleItemAdd} />
        <aside className="min-w-0 pb-16 pr-4 pt-16 sm:pr-6 sm:pt-24 md:pt-36">
          <div className="sticky top-[132px]">
            <MenuVita guide={guide} />
          </div>
        </aside>
      </div>
    )
  }

  return (
    <MenuSection
      onAdd={onAdd}
      onActiveChange={handleActiveChange}
      onItemAdd={handleItemAdd}
      betweenBarAndList={
        <>
          <div className="sticky top-[184px] z-20 mt-4 sm:top-[192px]">
            <MenuVitaStage guide={guide} />
          </div>
          <MenuVitaPanel guide={guide} />
        </>
      }
    />
  )
}

export default function App() {
  const [order, setOrder] = useState<OrderLine[]>([])
  const [activeTab, setActiveTab] = useState<TabId>(currentTab())
  const [bookTarget, setBookTarget] = useState<{ catId: string; nonce: number } | null>(null)
  // Bumping this remounts the panel ErrorBoundaries (their hasError state
  // is per-instance) — the "Réessayer" button's retry mechanism.
  const [panelNonce, setPanelNonce] = useState(0)
  const reducedMotion = useReducedMotion()

  // One global rAF loop: Lenis + every scroll subscriber. Lenis is off
  // entirely when the visitor prefers reduced motion.
  useEffect(() => startScroll(reducedMotion), [reducedMotion])
  useReveal()

  // Tab changes (tap, deep link, back/forward) re-render the panel,
  // then scroll to its top — after mount, so the new panel's height is
  // already in the document and the scroll can't clamp short.
  useEffect(() => onTabChange(setActiveTab), [])
  useEffect(() => {
    scrollToTop()
  }, [activeTab])

  const addToOrder = (line: OrderLine) => setOrder((prev) => [...prev, line])
  const removeFromOrder = (index: number) => setOrder((prev) => prev.filter((_, i) => i !== index))
  const clearOrder = () => setOrder([])

  // The menu Vita's "Feuilleter le livre": switch to the Book tab and
  // flip the book to that category (MenuBook reacts to the nonce).
  const openBook = useCallback((catId: string) => {
    setBookTarget({ catId, nonce: Date.now() })
    setTab('book')
  }, [])

  return (
    <div className="min-h-screen bg-ink font-sans text-bone">
      <div className="grain" aria-hidden="true" />
      <FluidFallbackDiv />
      <Nav />
      {/* pt clears the fixed nav pill; the tab bar sticks under it. */}
      <main className="relative z-10 pt-[64px] sm:pt-[72px]">
        <TabBar active={activeTab} onSelect={setTab} />
        {activeTab === 'home' && (
          <>
            {/* Fluid sim behind the hero (z-0); main sits above it.
                The boundary keeps a WebGL failure from blanking the page. */}
            <Suspense fallback={null}>
              <ErrorBoundary fallback={<FluidFallbackDiv />}>
                <FluidBackground />
              </ErrorBoundary>
            </Suspense>
            <Hero />
          </>
        )}
        {activeTab === 'menu' && <MenuTab onAdd={addToOrder} onOpenBook={openBook} />}
        {activeTab === 'book' && (
          <ErrorBoundary
            key={`book-${panelNonce}`}
            fallback={<PanelError label="Le livre" onRetry={() => setPanelNonce((n) => n + 1)} />}
          >
            <Suspense fallback={<PanelLoading label="Le livre s'ouvre…" />}>
              <MenuBook goToCategory={bookTarget} />
            </Suspense>
          </ErrorBoundary>
        )}
        {activeTab === 'gallery' && (
          <ErrorBoundary
            key={`gallery-${panelNonce}`}
            fallback={<PanelError label="La galerie" onRetry={() => setPanelNonce((n) => n + 1)} />}
          >
            <Suspense fallback={<PanelLoading label="La galerie se charge…" />}>
              <Gallery />
            </Suspense>
          </ErrorBoundary>
        )}
        {activeTab === 'ambiance' && (
          <ErrorBoundary
            key={`ambiance-${panelNonce}`}
            fallback={<PanelError label="L'ambiance" onRetry={() => setPanelNonce((n) => n + 1)} />}
          >
            <Suspense fallback={<PanelLoading label="L'ambiance se prépare…" />}>
              <Atmosphere />
            </Suspense>
          </ErrorBoundary>
        )}
        {activeTab === 'visit' && <Visit />}
        {activeTab === 'agent' && (
          <ErrorBoundary
            key={`agent-${panelNonce}`}
            fallback={<PanelError label="L'agent" onRetry={() => setPanelNonce((n) => n + 1)} />}
          >
            <Suspense fallback={<PanelLoading label="L'agent se prépare…" />}>
              <Agent order={order} onAdd={addToOrder} onRemove={removeFromOrder} onClear={clearOrder} />
            </Suspense>
          </ErrorBoundary>
        )}
      </main>
      <Footer />
    </div>
  )
}
