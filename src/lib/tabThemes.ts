import type { TabId } from './tabs'

/**
 * One visual identity per tab — the tab shell (src/App.tsx) wraps each
 * panel in a `.tab-surface` that reads these values as CSS variables
 * (--tab-accent, --tab-glow, --tab-glow-pos). Inside the wrapper,
 * `text-amber` (eyebrows, italic accent words, prices, icons) takes
 * the tab's accent, so each tab reads as its own room while staying in
 * the Scrolltide grammar: near-black, bone text, Bodoni display + mono
 * eyebrows. The layouts were already distinct per tab (hero, side-guide
 * menu, 3D book, poster banner, pinned cinema, day timeline, stage +
 * chat) — this file adds the background treatment, accent and header
 * ribbon that make the identity unmistakable at a glance.
 *
 * Accents are muted and warm-dark compatible: amber for the home glow,
 * menthe-teal for the menu, terracotta for the paper book, frame gold
 * for the gallery, moonlight blue for the night cinema, terrace green
 * for the visit, and Nekomi's lavender for the agent.
 */
export interface TabTheme {
  /** "01".."07" — shown in the tab ribbon. */
  index: string
  /** Short mono tagline shown in the tab ribbon. */
  tagline: string
  /** The tab's accent (hex). */
  accent: string
  /** Radial glow colour over the panel top. */
  glow: string
  /** Where the glow sits, as a CSS background position. */
  glowPosition: string
}

export const TAB_THEMES: Record<TabId, TabTheme> = {
  home: {
    index: '01',
    tagline: 'Bruxelles · Café · Bar',
    accent: '#e8a33d',
    glow: 'rgba(232, 163, 61, 0.20)',
    glowPosition: '50% 0%',
  },
  menu: {
    index: '02',
    tagline: '07 familles · 62 prix · Mêmes prix qu’au bar',
    accent: '#4da08e',
    glow: 'rgba(77, 160, 142, 0.18)',
    glowPosition: '85% 0%',
  },
  book: {
    index: '03',
    tagline: '08 feuilles · Feuilletez la carte en 3D',
    accent: '#d95d39',
    glow: 'rgba(217, 93, 57, 0.16)',
    glowPosition: '15% 0%',
  },
  gallery: {
    index: '04',
    tagline: '06 images · La carte en affiche',
    accent: '#d9b45b',
    glow: 'rgba(217, 180, 91, 0.18)',
    glowPosition: '50% 8%',
  },
  ambiance: {
    index: '05',
    tagline: '04 scènes · Une soirée, quatre tableaux',
    accent: '#6f8fb0',
    glow: 'rgba(111, 143, 176, 0.20)',
    glowPosition: '50% 20%',
  },
  visit: {
    index: '06',
    tagline: 'Rue de Malines 21 · 1000 Bruxelles',
    accent: '#6f9e5a',
    glow: 'rgba(111, 158, 90, 0.18)',
    glowPosition: '15% 8%',
  },
  agent: {
    index: '07',
    tagline: 'Nekomi · Chat',
    accent: '#9d8bd4',
    glow: 'rgba(157, 139, 212, 0.18)',
    glowPosition: '85% 8%',
  },
}
