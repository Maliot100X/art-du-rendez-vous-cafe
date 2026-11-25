import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { BookOpen, ChevronDown, ChevronUp, Send, Volume2, VolumeX } from 'lucide-react'
import { MENU } from '../content'
import { askBrain } from '../lib/brain'
import { isSpeechMuted, isSpeechSupported, setSpeechMuted, shortenForSpeech, speak, stopSpeaking } from '../lib/speech'
import { getWalkStatus, subscribeWalkStatus, type WalkStatus } from '../lib/walkStatus'

const VrmModel = lazy(() => import('./VrmModel'))

/**
 * Vita inside the Menu tab — the walking guide.
 *
 * - Category change → she walks (one procedural cycle via walkTick),
 *   TAKES HER HAND BOOK and reads the category aloud (2–3 items +
 *   prices, from MENU data, never retyped), the book opening on that
 *   category and its pages turning as she speaks. Item tap → she walks,
 *   reads the book on that item's category and speaks that item.
 * - Mini chat: the brain adapter (src/lib/brain.ts) — the LLM brain
 *   when a key is configured and the call succeeds, the offline
 *   rule-based brain otherwise. If the question names a category, she
 *   walks to it and reads the hand book on it — and only once she has
 *   finished reading aloud does the big book tab open on that category
 *   (onReadingEnd → onOpenBook). Without the delay the menu tab would
 *   unmount the moment she started reading and the read would never be
 *   seen. The reply arrives asynchronously, so the reading starts on a
 *   default estimate and is re-timed on the real spoken line once the
 *   brain answers.
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

export function categoryLine(catId: string): string {
  const cat = MENU.find((c) => c.id === catId)
  if (!cat) return ''
  const picks = cat.items.slice(0, 3)
  return `${cat.label} — ${cat.blurb} Par exemple : ${picks.map((i) => `${i.name} ${i.price}`).join(', ')}.`
}

/** Rough spoken duration of a line, for the hand-book reading timer. */
export function estimateSeconds(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.min(30, Math.max(6, Math.round(words / 2.4)))
}

export interface MenuVitaItemEvent {
  name: string
  price: string
  nonce: number
}

/** One hand-book reading: the asked category, a trigger nonce, and the
    estimated spoken seconds (the VRM ends the read when the speech
    ends, or at this estimate when muted / speech is unavailable). */
export interface ReadingState {
  categoryId: string
  nonce: number
  seconds: number
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
  /**
   * "Demander à la barmaid" — the button the visitor presses: she walks
   * to the book, reads the current category aloud and, once she has
   * finished, opens the big book on that page. Runs through the same
   * brain path as the chat (askBrain → LLM when live, offline brain
   * otherwise): the brain's reply is the spoken line.
   */
  askBartender: () => void
  openBook: () => void
  /** True only after the LLM brain has actually answered once — the
      footnote below must not claim the brain is live before that. */
  brainLive: boolean
  /** Current hand-book reading (null when she is not reading). */
  reading: ReadingState | null
  /** Called by the VRM when a reading ends — opens the big book tab if
      a chat question is waiting on it. */
  onReadingEnd: () => void
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
  const [brainLive, setBrainLive] = useState(false)
  const [reading, setReading] = useState<ReadingState | null>(null)
  const firstCategoryRef = useRef(true)
  /** Big-book tab switch waiting on a chat reading to finish. */
  const pendingOpenRef = useRef<string | null>(null)
  /** The brain's reply has arrived for the pending chat question. */
  const replyArrivedRef = useRef(false)

  // Stop any speech when the menu tab unmounts.
  useEffect(
    () => () => {
      stopSpeaking()
      pendingOpenRef.current = null
    },
    [],
  )

  // Category change → walk + read the hand book + speak the category.
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
    setReading({ categoryId, nonce: Date.now(), seconds: estimateSeconds(text) })
    // Fix pass 7: a manual category tap opens the big book on that
    // category once the reading ends, exactly like "Demander à la
    // barmaid" — the pass-6 check saw manual taps (VINS, ALCOOLS)
    // walk and read but never switch, while the button did. The
    // category line IS the reply (no brain call to wait for), so the
    // pending open is armed at once and the reply flag is set. A
    // later tap re-arms it for the new category; the old reading
    // never reports an end (superseded), so it cannot fire twice.
    // An item tap (+ on a row) still cancels it — the user is
    // ordering, not reading.
    pendingOpenRef.current = categoryId
    replyArrivedRef.current = true
    if (isSpeechSupported()) speak(text)
  }, [categoryId])

  // Item tap (+ on a row) → walk + read the hand book + speak that item.
  useEffect(() => {
    if (!itemEvent || itemEvent.nonce === 0) return
    const text = `${itemEvent.name}, ${itemEvent.price} — ajouté à votre commande.`
    setWalkTick((t) => t + 1)
    setLine(text)
    // The tapped row belongs to the active category.
    setReading({ categoryId, nonce: Date.now(), seconds: estimateSeconds(text) })
    pendingOpenRef.current = null
    if (isSpeechSupported()) speak(text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemEvent])

  const toggleMute = () => {
    const next = !muted
    setMutedState(next)
    setSpeechMuted(next)
  }

  const toggleCollapse = () => setCollapsed((c) => !c)

  const openBook = () => onOpenBook(categoryId)

  // Mini chat goes through the same brain adapter as the Agent tab
  // (src/lib/brain.ts): LLM when a key is configured and the call
  // succeeds, the offline rule-based brain otherwise — same reply, so
  // Vita's walk + spoken line work identically either way. If the
  // question names a category she walks to it and reads the hand book
  // on it at once; the big book tab opens only once she has finished
  // reading aloud (onReadingEnd), so the menu tab — and the VRM with
  // it — is not unmounted mid-read. The reply arrives asynchronously:
  // the reading starts on a default estimate and is re-timed on the
  // real spoken line once the brain answers; if the estimate runs out
  // before the reply lands, the end is held until the re-timed reading
  // finishes.
  const ask = (e: FormEvent) => {
    e.preventDefault()
    const clean = input.trim()
    if (!clean) return
    setInput('')
    const catId = findCategoryForText(clean)
    replyArrivedRef.current = false
    if (catId) {
      setWalkTick((t) => t + 1)
      setReading({ categoryId: catId, nonce: Date.now(), seconds: 12 })
      pendingOpenRef.current = catId
    }
    void askBrain(clean).then(({ reply, source }) => {
      if (source === 'llm') setBrainLive(true)
      setLine(reply.text)
      if (catId && pendingOpenRef.current === catId) {
        replyArrivedRef.current = true
        setReading({
          categoryId: catId,
          nonce: Date.now(),
          seconds: estimateSeconds(shortenForSpeech(reply.text)),
        })
      }
      if (isSpeechSupported()) speak(reply.text)
    })
  }

  // "Demander à la barmaid" — the button, not a typed question: she
  // walks to the book and reads the current category aloud, then the
  // big book opens on that page once she has finished (onReadingEnd).
  // The line shows at once from the menu data; the brain's reply
  // (askBrain — LLM when live, offline brain otherwise) replaces it,
  // re-times the reading and is the one spoken line — speak() cancels,
  // so the immediate line is shown, never spoken twice.
  const askBartender = () => {
    const cat = MENU.find((c) => c.id === categoryId)
    if (!cat) return
    const text = categoryLine(categoryId)
    replyArrivedRef.current = false
    setWalkTick((t) => t + 1)
    setLine(text)
    setReading({ categoryId, nonce: Date.now(), seconds: estimateSeconds(text) })
    pendingOpenRef.current = categoryId
    const request = `Lis-moi la page ${cat.label} à voix haute`
    void askBrain(request).then(({ reply, source }) => {
      if (source === 'llm') setBrainLive(true)
      if (pendingOpenRef.current !== categoryId) return
      replyArrivedRef.current = true
      setLine(reply.text)
      setReading({ categoryId, nonce: Date.now(), seconds: estimateSeconds(shortenForSpeech(reply.text)) })
      if (isSpeechSupported()) speak(reply.text)
    })
  }

  const onReadingEnd = useCallback(() => {
    const pending = pendingOpenRef.current
    if (pending && replyArrivedRef.current) {
      pendingOpenRef.current = null
      onOpenBook(pending)
    }
  }, [onOpenBook])

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
    askBartender,
    openBook,
    brainLive,
    reading,
    onReadingEnd,
  }
}

/** The VRM stage only — the sticky piece on phones. */
export function MenuVitaStage({ guide }: { guide: VitaGuide }) {
  return (
    <div className={guide.collapsed ? 'hidden lg:block' : ''}>
      <Suspense
        fallback={
          <div className="flex h-[260px] items-center justify-center rounded-[1.75rem] border border-line bg-ink-2 sm:h-[300px] lg:h-[480px]">
            <span className="live-dot inline-block h-2.5 w-2.5 rounded-full bg-amber" aria-label="Vita se prépare" />
          </div>
        }
      >
        <VrmModel
          compact
          walkTick={guide.walkTick}
          withBook
          readingTick={guide.reading?.nonce ?? 0}
          readingCategory={guide.reading?.categoryId}
          readingSeconds={guide.reading?.seconds}
          onReadingEnd={guide.onReadingEnd}
        />
      </Suspense>
    </div>
  )
}

/** What she says + controls — in flow on phones, under the stage on desktop. */
export function MenuVitaPanel({ guide }: { guide: VitaGuide }) {
  // Walk readout (fix pass 6): live walk state as plain DOM text —
  // the cloud-browser check cannot open devtools, so the walk is
  // observable here ("Marche… pas 2/4 · x +0.14" while walking,
  // "Arrivée · x +0.14" once she has arrived — the last state stays
  // readable at rest, so the check can read it after the fact too).
  const [walk, setWalk] = useState<WalkStatus>(getWalkStatus())
  useEffect(() => subscribeWalkStatus(setWalk), [])
  const walkX = `${walk.x >= 0 ? '+' : ''}${walk.x.toFixed(2)}`
  const walkLine = walk.walking
    ? `Marche… pas ${walk.step}/${walk.steps} · x ${walkX} · genou ${Math.round(walk.kneeDeg)}°`
    : walk.tick > 0
      ? `Arrivée · x ${walkX}`
      : 'Vita est prête — choisissez une catégorie.'
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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={guide.askBartender}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-amber px-5 py-2.5 text-sm font-bold text-ink transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:scale-[1.03]"
          >
            <Volume2 size={15} /> Demander à la barmaid
          </button>
          <button
            type="button"
            onClick={guide.openBook}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm font-bold text-bone transition-colors duration-300 hover:border-amber hover:text-amber"
          >
            <BookOpen size={15} /> Feuilleter le livre
          </button>
        </div>
        <p aria-live="polite" className="mt-2 font-mono text-[11px] text-mist/80">
          {walkLine}
        </p>
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
        <p className="mt-2.5 text-xs text-mist">
          {guide.brainLive
            ? 'Cerveau LLM en ligne — Vita répond avec le cerveau du café.'
            : 'Voix du navigateur — Deepgram et le cerveau LLM sont hors ligne.'}
        </p>
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
