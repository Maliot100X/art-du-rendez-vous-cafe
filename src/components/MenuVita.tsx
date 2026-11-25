import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import { BookOpen, ChevronDown, ChevronUp, Send, Volume2, VolumeX } from 'lucide-react'
import { MENU } from '../content'
import { botReply } from '../lib/agentBrain'
import { isSpeechMuted, isSpeechSupported, setSpeechMuted, speak, stopSpeaking } from '../lib/speech'

const VrmModel = lazy(() => import('./VrmModel'))

/**
 * Vita inside the Menu tab — the walking guide.
 *
 * - Category change → she walks (one procedural cycle via walkTick) and
 *   reads the category aloud (2–3 items + prices, from MENU data, never
 *   retyped). Item tap → she walks and speaks that item.
 * - Mini chat: the same rule-based brain as the agent (agentBrain). If
 *   the question names a category, she walks to it, OPENS THE BOOK on
 *   that category (onOpenBook → tab switch + flip) and speaks the reply.
 * - Speaking is the browser's speechSynthesis (French voice when the
 *   device has one). Deepgram and freellm are both offline and are
 *   never claimed here.
 *
 * Split shape (one VRM instance only): the tab shell renders either
 * the desktop side column (<MenuVita>, stage + panel stacked) or the
 * phone layout (<MenuVitaStage> sticky under the category bar +
 * <MenuVitaPanel> in flow above the list). Both read the same
 * useVitaGuide state — the stage and the panel are never mounted twice.
 */

const CATEGORY_KEYWORDS: { id: string; words: string[] }[] = [
  { id: 'chaudes', words: ['cafe', 'the', 'expresso', 'cappuccino', 'chocolat', 'latte', 'irish', 'deca', 'soupe', 'supe', 'chaud'] },
  { id: 'bieres', words: ['biere', 'primus', 'pils', 'pression'] },
  { id: 'froides', words: ['froid', 'soda', 'jus', 'limonade', 'coca', 'perrier', 'eau'] },
  { id: 'vins', words: ['vin', 'rouge', 'blanc', 'rose', 'champagne', 'prosecco'] },
  { id: 'aperitifs', words: ['aperitif', 'spritz', 'aperol', 'martini', 'kir', 'pastis', 'ricard'] },
  { id: 'liqueurs', words: ['liqueur', 'baileys', 'amaretto', 'cointreau', 'marnier'] },
  { id: 'alcools', words: ['alcool', 'whisky', 'whiskey', 'gin', 'vodka', 'rhum', 'tequila', 'cognac'] },
]

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

function findCategoryForText(text: string): string | null {
  const n = norm(text)
  // An item name wins over a keyword ("un Aperol Spritz" → apéritifs).
  for (const cat of MENU) {
    if (cat.items.some((item) => n.includes(norm(item.name)))) return cat.id
  }
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.words.some((w) => n.includes(w))) return entry.id
  }
  return null
}

function categoryLine(catId: string): string {
  const cat = MENU.find((c) => c.id === catId)
  if (!cat) return ''
  const picks = cat.items.slice(0, 3)
  return `${cat.label} — ${cat.blurb} Par exemple : ${picks.map((i) => `${i.name} ${i.price}`).join(', ')}.`
}

export interface MenuVitaItemEvent {
  name: string
  price: string
  nonce: number
}

export interface VitaGuide {
  walkTick: number
  line: string
  input: string
  setInput: (v: string) => void
  muted: boolean
  toggleMute: () => void
  collapsed: boolean
  toggleCollapse: () => void
  categoryId: string
  ask: (e: FormEvent) => void
  openBook: () => void
}

export function useVitaGuide({
  categoryId,
  itemEvent,
  onOpenBook,
}: {
  categoryId: string
  itemEvent: MenuVitaItemEvent | null
  onOpenBook: (catId: string) => void
}): VitaGuide {
  const [walkTick, setWalkTick] = useState(0)
  const [line, setLine] = useState('Bonjour ! Choisissez une catégorie — je marche vers elle et je vous lis les prix.')
  const [input, setInput] = useState('')
  const [muted, setMutedState] = useState(isSpeechMuted())
  const [collapsed, setCollapsed] = useState(false)
  const firstCategoryRef = useRef(true)

  // Stop any speech when the menu tab unmounts.
  useEffect(() => () => stopSpeaking(), [])

  // Category change → walk + speak the category (items + prices).
  useEffect(() => {
    if (firstCategoryRef.current) {
      // First mount: greet without walking — she is already there.
      firstCategoryRef.current = false
      return
    }
    const text = categoryLine(categoryId)
    if (!text) return
    setWalkTick((t) => t + 1)
    setLine(text)
    if (isSpeechSupported()) speak(text)
  }, [categoryId])

  // Item tap (+ on a row) → walk + speak that item.
  useEffect(() => {
    if (!itemEvent || itemEvent.nonce === 0) return
    const text = `${itemEvent.name}, ${itemEvent.price} — ajouté à votre commande.`
    setWalkTick((t) => t + 1)
    setLine(text)
    if (isSpeechSupported()) speak(text)
  }, [itemEvent])

  const toggleMute = () => {
    const next = !muted
    setMutedState(next)
    setSpeechMuted(next)
  }

  const toggleCollapse = () => setCollapsed((c) => !c)

  const openBook = () => onOpenBook(categoryId)

  const ask = (e: FormEvent) => {
    e.preventDefault()
    const clean = input.trim()
    if (!clean) return
    setInput('')
    const reply = botReply(clean)
    const catId = findCategoryForText(clean)
    setLine(reply.text)
    if (catId) {
      // She walks to the category and opens the book on it.
      setWalkTick((t) => t + 1)
      if (isSpeechSupported()) speak(reply.text)
      onOpenBook(catId)
    } else if (isSpeechSupported()) {
      speak(reply.text)
    }
  }

  return {
    walkTick,
    line,
    input,
    setInput,
    muted,
    toggleMute,
    collapsed,
    toggleCollapse,
    categoryId,
    ask,
    openBook,
  }
}

/** The VRM stage only — the sticky piece on phones. */
export function MenuVitaStage({ guide }: { guide: VitaGuide }) {
  return (
    <div className={guide.collapsed ? 'hidden lg:block' : ''}>
      <Suspense
        fallback={
          <div className="flex h-[260px] items-center justify-center rounded-[1.75rem] border border-line bg-ink-2 sm:h-[300px] lg:h-[480px]">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mist">Vita se prépare…</p>
          </div>
        }
      >
        <VrmModel compact walkTick={guide.walkTick} />
      </Suspense>
    </div>
  )
}

/** What she says + controls — in flow on phones, under the stage on desktop. */
export function MenuVitaPanel({ guide }: { guide: VitaGuide }) {
  return (
    <div className="mt-3 overflow-hidden rounded-[1.75rem] border border-line bg-ink-2">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-bone">Vita vous guide</p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={guide.toggleMute}
            aria-pressed={guide.muted}
            aria-label={guide.muted ? 'Activer la voix' : 'Couper la voix'}
            className={`flex min-h-11 min-w-11 items-center justify-center rounded-full border transition-colors duration-300 ${
              guide.muted
                ? 'border-line text-mist hover:text-bone'
                : 'border-amber/60 bg-amber/10 text-amber hover:bg-amber hover:text-ink'
            }`}
          >
            {guide.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button
            type="button"
            onClick={guide.toggleCollapse}
            aria-expanded={!guide.collapsed}
            aria-label={guide.collapsed ? 'Afficher Vita' : 'Réduire Vita'}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line text-bone/70 transition-colors duration-300 hover:text-bone lg:hidden"
          >
            {guide.collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      <p aria-live="polite" className="px-4 pt-4 text-[15px] leading-relaxed text-bone/85">
        {guide.line}
      </p>

      <div className="px-4 pb-4 pt-3">
        <button
          type="button"
          onClick={guide.openBook}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-bone px-5 py-2.5 text-sm font-bold text-ink transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:scale-[1.03]"
        >
          <BookOpen size={15} /> Feuilleter le livre
        </button>
        <form className="mt-3 flex items-center gap-2" onSubmit={guide.ask}>
          <label htmlFor="menu-vita-input" className="sr-only">
            Demander à Vita
          </label>
          <input
            id="menu-vita-input"
            value={guide.input}
            onChange={(e) => guide.setInput(e.target.value)}
            placeholder="Demandez un prix, une catégorie…"
            className="min-w-0 flex-1 rounded-full border border-line bg-ink px-4 py-2.5 text-base text-bone placeholder:text-mist focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Envoyer"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-bone text-ink transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:scale-[1.05]"
          >
            <Send size={16} />
          </button>
        </form>
        <p className="mt-2.5 text-xs text-mist">Voix du navigateur — Deepgram et le cerveau LLM sont hors ligne.</p>
      </div>
    </div>
  )
}

/** Desktop side column: stage + panel stacked. */
export default function MenuVita({ guide }: { guide: VitaGuide }) {
  return (
    <div className="min-w-0">
      <MenuVitaStage guide={guide} />
      <MenuVitaPanel guide={guide} />
    </div>
  )
}
