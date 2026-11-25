import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
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

// Below-fold / heavy scenes load in their own chunks so the first paint
// stays lean. Each Suspense fallback reserves roughly the section's real
// height so the document doesn't jump as chunks land.
const Atmosphere = lazy(() => import('./components/Atmosphere'))
const MenuBook = lazy(() => import('./components/MenuBook'))
const Gallery = lazy(() => import('./components/Gallery'))
const Agent = lazy(() => import('./components/Agent'))
const FluidBackground = lazy(() => import('./components/FluidBackground'))

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
          <Suspense fallback={<div className="min-h-[113svh]" aria-hidden="true" />}>
            <MenuBook goToCategory={bookTarget} />
          </Suspense>
        )}
        {activeTab === 'gallery' && (
          <Suspense fallback={<div className="min-h-[175svh]" aria-hidden="true" />}>
            <Gallery />
          </Suspense>
        )}
        {activeTab === 'ambiance' && (
          <Suspense fallback={<div className="min-h-[420svh]" aria-hidden="true" />}>
            <Atmosphere />
          </Suspense>
        )}
        {activeTab === 'visit' && <Visit />}
        {activeTab === 'agent' && (
          <Suspense fallback={<div className="min-h-[245svh]" aria-hidden="true" />}>
            <Agent order={order} onAdd={addToOrder} onRemove={removeFromOrder} onClear={clearOrder} />
          </Suspense>
        )}
      </main>
      <Footer />
    </div>
  )
}
