/**
 * Tab shell state — one tiny store, no React involved, so the tab can be
 * switched from anywhere (Nav, Hero CTAs, the menu Vita, scrollToHash)
 * without prop-drilling.
 *
 * Tabs are deep-linkable: #home #menu #book #gallery #ambiance #visit
 * #agent. Legacy section hashes still work — #carte → menu, #livre →
 * book, #galerie → gallery, #venir → visit, #top → home — so every
 * existing CTA and nav link keeps working unchanged.
 *
 * The hash is written with history.replaceState (never location.hash):
 * assigning location.hash would make the browser jump-scroll to an
 * element with that id, and the tab panels mount/unmount, so the jump
 * target may not exist yet.
 */

export type TabId = 'home' | 'menu' | 'book' | 'gallery' | 'ambiance' | 'visit' | 'agent'

export const TABS: { id: TabId; label: string; hash: string }[] = [
  { id: 'home', label: 'Accueil', hash: '#home' },
  { id: 'menu', label: 'La Carte', hash: '#menu' },
  { id: 'book', label: 'Le Livre', hash: '#book' },
  { id: 'gallery', label: 'Galerie', hash: '#gallery' },
  { id: 'ambiance', label: 'Ambiance', hash: '#ambiance' },
  { id: 'visit', label: 'Venir', hash: '#visit' },
  { id: 'agent', label: 'Agent', hash: '#agent' },
]

const HASH_TO_TAB: Record<string, TabId> = {
  '#home': 'home',
  '#menu': 'menu',
  '#book': 'book',
  '#gallery': 'gallery',
  '#ambiance': 'ambiance',
  '#visit': 'visit',
  '#agent': 'agent',
  // Legacy section anchors (pre-tab-shell) — same destinations.
  '#top': 'home',
  '#carte': 'menu',
  '#livre': 'book',
  '#galerie': 'gallery',
  '#venir': 'visit',
}

export function tabFromHash(hash: string): TabId | null {
  return HASH_TO_TAB[hash] ?? null
}

/** True when the hash names a tab (directly or via a legacy anchor). */
export function isTabHash(hash: string): boolean {
  return hash in HASH_TO_TAB
}

type Listener = (tab: TabId) => void

const listeners = new Set<Listener>()

let current: TabId =
  typeof window !== 'undefined' ? (tabFromHash(window.location.hash) ?? 'home') : 'home'

export function currentTab(): TabId {
  return current
}

export function onTabChange(cb: Listener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Switch tabs, update the hash, notify subscribers. No-op for the active tab. */
export function setTab(id: TabId): void {
  if (id === current) return
  current = id
  const hash = TABS.find((t) => t.id === id)?.hash ?? '#home'
  try {
    history.replaceState(null, '', hash)
  } catch {
    // History unavailable (odd embeds) — the tab still switches.
  }
  listeners.forEach((cb) => {
    try {
      cb(id)
    } catch {
      // One bad listener must not break the switch.
    }
  })
}

/** Back/forward buttons move between tabs. */
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const next = tabFromHash(window.location.hash)
    if (next && next !== current) setTab(next)
  })
}
