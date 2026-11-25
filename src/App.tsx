import { Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { BookOpen, Bot, Coffee, Home, Images, MapPin, Sparkles } from 'lucide-react'
import { lazyWithRetry } from './lib/lazyRetry'
import Nav from './components/Nav'
import Hero from './components/Hero'
import MenuSection, { getLastMenuCategory, type OrderLine } from './components/MenuSection'
import Visit from './components/Visit'
import Footer from './components/Footer'
import ErrorBoundary from './components/ErrorBoundary'
import { scrollToTop, startScroll, useReducedMotion } from './lib/scroll'
import { onBookCategory } from './lib/bookEvents'
import { runWhenIdle, shouldDeferHeavyPreload } from './lib/perf'
import { useReveal } from './lib/useReveal'
import { currentTab, onTabChange, setTab, TABS, type TabId } from './lib/tabs'
import { TAB_THEMES } from './lib/tabThemes'
import MenuVita, { MenuVitaPanel, MenuVitaStage, estimateSeconds, useVitaGuide, type MenuVitaItemEvent } from './components/MenuVita'
import { askBrain } from './lib/brain'
import { isSpeechSupported, shortenForSpeech, speak, stopSpeaking } from './lib/speech'
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
const VrmModel = lazyWithRetry(() => import('./components/VrmModel'))

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
function PanelError({ label, detail, onRetry }: { label: string; detail?: string | null; onRetry: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60svh] max-w-[1400px] flex-col items-center justify-center px-4 py-24 text-center">
      <p className="font-display text-3xl italic text-bone">Oups — {label} n'a pas pu se charger.</p>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-mist">
        Le reste du site fonctionne. Réessayez — le plus souvent, c'est juste la connexion.
      </p>
      {detail ? (
        <p className="mt-4 max-w-md break-words font-mono text-[11px] leading-relaxed text-mist/90">
          Erreur : {detail}
        </p>
      ) : null}
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
 * the Live2D and the hero dust never run together) — except the Livre
 * tab, where Vita's stage and the big book each hold one context (two
 * in that tab, each freed on unmount; the VRM itself is shared from
 * the module-level cache, so no re-download). Heavy scenes are
 * React.lazy chunks that load only when their tab opens. The VRM
 * itself is the exception to "load on open": it is cached at module
 * level (src/lib/vrmCache.ts) and prewarmed on idle after first paint,
 * so the parsed 14 MB model survives tab switches — returning to Menu
 * reuses it instead of re-downloading/re-parsing it. Each mount still
 * builds its own renderer and frees its own GL context on unmount.
 * The fluid background lives on the Home tab only; every other tab
 * gets the static CSS gradient (cheap, same palette).
 *
 * The Atmosphere pinned scroll cinema (420svh) keeps working inside
 * the Ambiance tab: the panel is plain flow (no overflow-hidden
 * ancestor), and tab switching scrolls to the top of the panel.
 */

/** Static gradient base layer — under everything, on every tab. */
function FluidFallbackDiv() {
  return <div className="fluid-fallback pointer-events-none fixed inset-0 z-0" aria-hidden="true" />
}

/**
 * Heavy-model prewarm (fix pass 3, defects 4 + 6). Dynamic imports on
 * purpose: statically importing vrmCache / Live2DModel here would drag
 * three-vrm + pixi into the first-paint bundle (the 564 KB initial JS
 * win from the perf pass). Each prewarm is idempotent — the modules
 * share one in-flight promise — so hover + idle + tab open can all
 * call them safely.
 */
function prewarmVrm(): void {
  void import('./lib/vrmCache')
    .then((m) => m.preloadVrm())
    .catch(() => undefined)
}
function prewarmLive2d(): void {
  void import('./components/Live2DModel')
    .then((m) => m.preloadLive2d())
    .catch(() => undefined)
}
function prewarmForTab(id: TabId): void {
  if (id === 'menu' || id === 'book') prewarmVrm()
  else if (id === 'agent') {
    prewarmVrm()
    prewarmLive2d()
  }
}

/**
 * Mobile bottom tab bar — the unmistakable mobile navigation. The
 * desktop tab pills row is hidden below md (see TabBar) and this bar
 * replaces it: seven thumb-sized targets, fixed to the bottom with
 * safe-area padding, so a phone never shows the desktop row shrunken
 * into one line. Icons + short labels; the active tab is a bone pill.
 */
const MOBILE_TAB_ICONS: Record<TabId, typeof Home> = {
  home: Home,
  menu: Coffee,
  book: BookOpen,
  gallery: Images,
  ambiance: Sparkles,
  visit: MapPin,
  agent: Bot,
}
const MOBILE_TAB_LABELS: Record<TabId, string> = {
  home: 'Accueil',
  menu: 'Carte',
  book: 'Livre',
  gallery: 'Galerie',
  ambiance: 'Ambiance',
  visit: 'Venir',
  agent: 'Agent',
}

function MobileTabBar({ active, onSelect }: { active: TabId; onSelect: (id: TabId) => void }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      aria-label="Sections du site"
    >
      <div className="grid grid-cols-7" role="tablist">
        {TABS.map((tab) => {
          const Icon = MOBILE_TAB_ICONS[tab.id]
          const isActive = active === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(tab.id)}
              onFocus={() => prewarmForTab(tab.id)}
              className={`flex min-h-[60px] flex-col items-center justify-center gap-1.5 px-1 py-2 ${
                isActive ? 'text-amber' : 'text-bone/70'
              }`}
            >
              <Icon size={18} strokeWidth={isActive ? 2.4 : 1.8} className="shrink-0" />
              <span className="whitespace-nowrap text-[9px] font-bold uppercase leading-none tracking-[0.08em]">{MOBILE_TAB_LABELS[tab.id]}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function TabBar({ active, onSelect }: { active: TabId; onSelect: (id: TabId) => void }) {
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the active tab visible in the scrollable row.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <div className="sticky top-[64px] z-40 hidden border-b border-line bg-ink/90 backdrop-blur-xl sm:top-[72px] md:block">
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
            onMouseEnter={() => prewarmForTab(tab.id)}
            onFocus={() => prewarmForTab(tab.id)}
            className={`min-h-11 shrink-0 whitespace-nowrap rounded-full px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-all duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] ${
              active === tab.id ? 'bg-bone text-ink' : 'text-bone/85 hover:text-bone'
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
 * Per-tab identity wrapper — one room per tab (see src/lib/tabThemes.ts).
 * A hairline + mono ribbon (index, tab name, tagline) tops the panel,
 * the panel gets its own glow position + accent, and inside the wrapper
 * `text-amber` takes the tab's accent (eyebrows, italic accent words,
 * prices, icons). The tab shell, sticky tab bar and mobile bottom bar
 * are untouched; each tab keeps its own content and layout.
 */
function TabSurface({ tab, children }: { tab: TabId; children: ReactNode }) {
  const theme = TAB_THEMES[tab]
  const label = TABS.find((t) => t.id === tab)?.label ?? tab
  return (
    <div
      className={`tab-surface tab-${tab}`}
      style={
        {
          '--tab-accent': theme.accent,
          '--tab-glow': theme.glow,
          '--tab-glow-pos': theme.glowPosition,
        } as CSSProperties
      }
    >
      <div className="tab-ribbon mx-auto max-w-[1400px] px-4 sm:px-6" aria-hidden="true">
        <span className="tab-ribbon-dot" />
        <span>
          {theme.index} / {label}
        </span>
        <span className="tab-ribbon-tag">{theme.tagline}</span>
      </div>
      {children}
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
  /**
   * Fix pass 9: initialise from the module-level preserved category
   * (MenuSection's lastMenuCategory), NOT from MENU[0]. MenuTab
   * unmounts on every tab switch, so MENU[0] re-initialised the
   * lifted category to 'chaudes' on each return; MenuSection then
   * reported its preserved category in its mount effect and the
   * 'chaudes' -> preserved change fired useVitaGuide's category
   * effect past its first-mount guard — a walk + read + pending
   * big-book open on every return. With both initialised from the
   * same module value the mount report is a same-value no-op, so no
   * effect fires. A manual tap still changes the value and walks;
   * the first mount still greets without walking (guard untouched).
   */
  const [categoryId, setCategoryId] = useState(() => getLastMenuCategory())
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
          <div className="sticky top-[76px] z-20 mt-4 md:top-[192px]">
            <MenuVitaStage guide={guide} />
          </div>
          <MenuVitaPanel guide={guide} />
        </>
      }
    />
  )
}

/**
 * Livre tab: Vita WITH the big book — Minir's order, fix pass 3.
 * The avatar used to live only in the Menu tab while the Livre tab
 * showed the book alone; now she stands beside it and reads it.
 *
 * Desktop (lg+): Vita in a sticky side column, the book beside her.
 * Phone: her compact stage above the book. Only the active tab
 * mounts, so this VrmModel never coexists with the Menu tab's — but
 * it DOES coexist with MenuBook's own renderer inside this tab (two
 * WebGL contexts; the VRM itself is the shared module-level cache
 * from vrmCache.ts, so no re-download on tab switches).
 *
 * She reads the category the big book lands on: the initial target
 * (menu Vita's "Feuilleter le livre") starts a reading at once, and
 * every later flip landing fires onBookCategory and restarts it. She
 * reads silently here (no speech — the Menu tab already speaks the
 * category); the hand book opens and its pages turn as she reads.
 * No walk: she stands beside the book.
 */
function BookTab({ goToCategory }: { goToCategory: { catId: string; nonce: number } | null }) {
  const [reading, setReading] = useState<{ categoryId: string; nonce: number; seconds?: number } | null>(() =>
    goToCategory ? { categoryId: goToCategory.catId, nonce: goToCategory.nonce } : null,
  )
  /**
   * Fix pass 8: mirrors of `reading` for the async brain reply, and
   * the nonce of a reading the visitor explicitly stopped. A late
   * reply must only re-time the reading IT started: not one the
   * visitor stopped (stoppedNonce), not one a flip superseded (live
   * nonce differs) — either would raise the arm again after stop.
   * But a natural end that cleared the banner must NOT block the
   * reply (live reading null, nonce not stopped), or a slow brain
   * answer would be silently dropped.
   */
  const readingRef = useRef(reading)
  readingRef.current = reading
  const stoppedNonceRef = useRef<number | null>(null)
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Follow the big book: every flip landing on a category restarts her
  // reading on it (the scroll-open to the first category included).
  useEffect(
    () => onBookCategory((catId) => setReading({ categoryId: catId, nonce: Date.now() })),
    [],
  )

  // "Demander à la barmaid" (Livre tab): she is already beside the
  // book and it is already open on the page, so the button reads this
  // page aloud — the same brain path as the Menu tab's button
  // (askBrain → LLM when live, offline brain otherwise). The reading
  // starts at once on the hand book and is re-timed on the spoken reply.
  const askBartender = useCallback((catId: string) => {
    const cat = MENU.find((c) => c.id === catId)
    if (!cat) return
    const nonce = Date.now()
    setReading({ categoryId: catId, nonce, seconds: 12 })
    const request = `Lis-moi la page ${cat.label} à voix haute`
    void askBrain(request).then(({ reply }) => {
      // Fix pass 8: only re-time (and speak) the reading THIS press
      // started — see the stoppedNonceRef/readingRef note above.
      if (stoppedNonceRef.current === nonce) return
      const cur = readingRef.current
      if (cur !== null && cur.nonce !== nonce) return
      setReading({ categoryId: catId, nonce: Date.now(), seconds: estimateSeconds(shortenForSpeech(reply.text)) })
      if (isSpeechSupported()) speak(reply.text)
    })
  }, [])

  const vita = (
    <Suspense
      fallback={
        <div className="flex h-[260px] items-center justify-center rounded-[1.75rem] border border-line bg-ink-2 sm:h-[300px] lg:h-[480px]">
          <span className="live-dot inline-block h-2.5 w-2.5 rounded-full bg-amber" aria-label="Vita se prépare" />
        </div>
      }
    >
      <VrmModel
        compact
        withBook
        readingTick={reading?.nonce ?? 0}
        readingCategory={reading?.categoryId}
        readingSeconds={reading?.seconds ?? 12}
        // Fix pass 8: the VRM's reading end clears the banner. The
        // old code passed no onReadingEnd here, so the "Lecture en
        // cours…" panel — React state, not VRM state — stayed up
        // forever after the book had already vanished (~13 s into
        // the default 12 s silent reading). A stop press does not
        // come through here (cancel suppresses the end callback).
        onReadingEnd={() => setReading(null)}
      />
    </Suspense>
  )

  // Fix pass 5: the Livre tab had no feedback surface — a tap on
  // "Demander à la barmaid" produced no verifiable UI. While a
  // reading is active, show what she is reading and a stop control.
  const readingCategoryLabel = reading
    ? (MENU.find((c) => c.id === reading.categoryId)?.label ?? '')
    : ''
  const readingPanel = reading ? (
    <div
      className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-line bg-ink-2 px-4 py-3"
      role="status"
      aria-live="polite"
    >
      <p className="min-w-0 truncate text-sm text-bone">
        <span className="live-dot mr-2 inline-block h-2 w-2 rounded-full bg-amber" aria-hidden />
        Lecture en cours…{readingCategoryLabel ? ` · ${readingCategoryLabel}` : ''}
      </p>
      <button
        type="button"
        onClick={() => {
          // Fix pass 8: remember which reading was stopped, so its
          // late brain reply cannot resurrect it (see askBartender).
          // setReading(null) drops readingTick to 0 and the VRM
          // cancels the pose at once — the old code never told the
          // VRM, so the arm stayed raised until the estimate ran out.
          stoppedNonceRef.current = reading?.nonce ?? null
          stopSpeaking()
          setReading(null)
        }}
        className="shrink-0 rounded-full border border-line bg-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-bone transition-colors hover:border-bone/50"
      >
        Couper la voix
      </button>
    </div>
  ) : null

  if (isDesktop) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-10 lg:grid-cols-[380px_1fr]">
        <aside className="min-w-0 pb-16 pl-4 pt-16 sm:pl-6 sm:pt-24 md:pt-36">
          <div className="sticky top-[132px]">
            {vita}
            {readingPanel}
          </div>
        </aside>
        <div className="min-w-0">
          <MenuBook goToCategory={goToCategory} onAskBartender={askBartender} />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="px-4 pt-10 sm:px-6">
        {vita}
        {readingPanel}
      </div>
      <MenuBook goToCategory={goToCategory} onAskBartender={askBartender} />
    </div>
  )
}

export default function App() {
  const [order, setOrder] = useState<OrderLine[]>([])
  const [activeTab, setActiveTab] = useState<TabId>(currentTab())
  const [bookTarget, setBookTarget] = useState<{ catId: string; nonce: number } | null>(null)
  // Bumping this remounts the panel ErrorBoundaries (their hasError state
  // is per-instance) — the "Réessayer" button's retry mechanism.
  const [panelNonce, setPanelNonce] = useState(0)
  // Fix pass 6: the last error the agent boundary caught, shown verbatim
  // on its fallback (the boundary used to swallow it). Cleared on retry.
  const [agentError, setAgentError] = useState<string | null>(null)
  const reducedMotion = useReducedMotion()

  // One global rAF loop: Lenis + every scroll subscriber. Lenis is off
  // entirely when the visitor prefers reduced motion.
  useEffect(() => startScroll(reducedMotion), [reducedMotion])
  useReveal()

  // Heavy-model prewarm (fix pass 3, defects 4 + 6): after first paint,
  // on idle, start the 14 MB VRM + the Nekomi Live2D bytes + their JS
  // chunks, so opening Menu / Agent later is a cache hit instead of a
  // 20–35 s wait. Skipped on save-data / 2G — hovering the tab still
  // warms on demand (see prewarmForTab on the tab buttons).
  useEffect(() => {
    if (shouldDeferHeavyPreload()) return
    runWhenIdle(() => {
      prewarmVrm()
      prewarmLive2d()
      // Warm the component chunks too (VrmModel + Live2DModel are
      // React.lazy — otherwise the first tab open pays the JS fetch).
      void import('./components/VrmModel').catch(() => undefined)
      void import('./components/Live2DModel').catch(() => undefined)
    })
  }, [])

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
    // pb clears the fixed mobile bottom tab bar so the footer (and the
    // last panel content) can scroll fully above it on phones. The bar
    // is 60 px + the safe-area inset (home indicator) — the old flat
    // 76 px left ~18 px of content hiding under it on notched phones.
    <div className="min-h-screen bg-ink pb-[calc(76px+env(safe-area-inset-bottom,0px))] font-sans text-bone md:pb-0">
      <div className="grain" aria-hidden="true" />
      <FluidFallbackDiv />
      <Nav />
      {/* pt clears the fixed nav pill; the tab bar sticks under it.
          The nav grows by the safe-area inset on notched phones, so the
          top padding grows with it. */}
      <main className="relative z-10 pt-[calc(64px+env(safe-area-inset-top,0px))] sm:pt-[calc(72px+env(safe-area-inset-top,0px))]">
        <TabBar active={activeTab} onSelect={setTab} />
        {activeTab === 'home' && (
          <TabSurface tab="home">
            {/* Fluid sim behind the hero (z-0); main sits above it.
                The boundary keeps a WebGL failure from blanking the page. */}
            <Suspense fallback={null}>
              <ErrorBoundary fallback={<FluidFallbackDiv />}>
                <FluidBackground />
              </ErrorBoundary>
            </Suspense>
            <Hero />
          </TabSurface>
        )}
        {activeTab === 'menu' && (
          <TabSurface tab="menu">
            <MenuTab onAdd={addToOrder} onOpenBook={openBook} />
          </TabSurface>
        )}
        {activeTab === 'book' && (
          <TabSurface tab="book">
            <ErrorBoundary
              key={`book-${panelNonce}`}
              fallback={<PanelError label="Le livre" onRetry={() => setPanelNonce((n) => n + 1)} />}
            >
              <Suspense fallback={<PanelLoading label="Le livre s'ouvre…" />}>
                <BookTab goToCategory={bookTarget} />
              </Suspense>
            </ErrorBoundary>
          </TabSurface>
        )}
        {activeTab === 'gallery' && (
          <TabSurface tab="gallery">
            <ErrorBoundary
              key={`gallery-${panelNonce}`}
              fallback={<PanelError label="La galerie" onRetry={() => setPanelNonce((n) => n + 1)} />}
            >
              <Suspense fallback={<PanelLoading label="La galerie se charge…" />}>
                <Gallery />
              </Suspense>
            </ErrorBoundary>
          </TabSurface>
        )}
        {activeTab === 'ambiance' && (
          <TabSurface tab="ambiance">
            <ErrorBoundary
              key={`ambiance-${panelNonce}`}
              fallback={<PanelError label="L'ambiance" onRetry={() => setPanelNonce((n) => n + 1)} />}
            >
              <Suspense fallback={<PanelLoading label="L'ambiance se prépare…" />}>
                <Atmosphere />
              </Suspense>
            </ErrorBoundary>
          </TabSurface>
        )}
        {activeTab === 'visit' && (
          <TabSurface tab="visit">
            <Visit />
          </TabSurface>
        )}
        {activeTab === 'agent' && (
          <TabSurface tab="agent">
            <ErrorBoundary
              key={`agent-${panelNonce}`}
              onError={(err) => setAgentError(err.message)}
              fallback={
                <PanelError
                  label="L'agent"
                  // The caught boundary error first; the Live2D init
                  // failure recorded on window as a fallback (read
                  // without importing Live2DModel, which would drag
                  // pixi into the first-paint bundle).
                  detail={
                    agentError ??
                    (window as unknown as { __nekomiDebug?: { error?: string | null } }).__nekomiDebug?.error ??
                    null
                  }
                  onRetry={() => {
                    setAgentError(null)
                    setPanelNonce((n) => n + 1)
                  }}
                />
              }
            >
              <Suspense fallback={<PanelLoading label="L'agent se prépare…" />}>
                <Agent order={order} onAdd={addToOrder} onRemove={removeFromOrder} onClear={clearOrder} />
              </Suspense>
            </ErrorBoundary>
          </TabSurface>
        )}
      </main>
      <Footer />
      <MobileTabBar active={activeTab} onSelect={setTab} />
    </div>
  )
}
