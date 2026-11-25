import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { BookOpen, Send, Volume2, VolumeX } from 'lucide-react'
import { CHARACTER, MENU } from '../content'
import { askBrain } from '../lib/brain'
import { isSpeechMuted, isSpeechSupported, setSpeechMuted, shortenForSpeech, speak, stopSpeaking } from '../lib/speech'

/**
 * Nekomi's guide inside the Menu tab — text + voice, NO 3D model.
 *
 * The VRM walking guide was removed (user order — the live model was
 * full of bugs). What remains is the guide itself:
 *
 * - Category change → the guide reads the category aloud (2–3 items +
 *   prices, from MENU data, never retyped) and shows the line; the big
 *   book tab opens on that category once the reading ends.
 * - Item tap → the guide speaks that item ("ajouté à votre commande").
 * - Mini chat: the brain adapter (src/lib/brain.ts) — the LLM brain
 *   when a key is configured and the call succeeds, the offline
 *   rule-based brain otherwise. If the question names a category, the
 *   guide reads it aloud at once and the big book tab opens only once
 *   she has finished reading (so the menu tab is not unmounted
 *   mid-read). The reply arrives asynchronously, so the reading starts
 *   on a default estimate and is re-timed on the real spoken line once
 *   the brain answers.
 * - Speaking is the browser's speechSynthesis (French voice when the
 *   device has one). Deepgram and freellm are both offline and are
 *   never claimed here.
 *
 * First-click fix: "Demander à la barmaid" shows the line, starts the
 * reading indicator and speaks AT ONCE, synchronously in the click
 * handler — nothing visible waits on the async brain reply or on a
 * lazily-mounted model. The old VRM path's first click appeared dead
 * because the visible reading depended on the model mount + walk.
 * A reading ends on a timer (estimateSeconds) — the old onReadingEnd
 * came from the VRM; the timer is its replacement, nonce-guarded so a
 * newer reading or a stop cannot fire an old timer.
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

/** Rough spoken duration of a line, for the reading timer. */
export function estimateSeconds(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.min(30, Math.max(6, Math.round(words / 2.4)))
}

export interface MenuGuideItemEvent {
  name: string
  price: string
  nonce: number
}

/** One reading aloud: the asked category, a trigger nonce, and the
    estimated spoken seconds (the timer ends it — see useMenuGuide). */
export interface ReadingState {
  categoryId: string
  nonce: number
  seconds: number
}

export interface MenuGuide {
  line: string
  input: string
  setInput: (v: string) => void
  muted: boolean
  toggleMute: () => void
  categoryId: string
  ask: (e: FormEvent) => void
  /**
   * "Demander à la barmaid" — the button the visitor presses: the
   * guide reads the current category aloud and, once she has finished,
   * opens the big book on that page. Runs through the same brain path
   * as the chat (askBrain → LLM when live, offline brain otherwise):
   * the brain's reply is the spoken line. Works on the FIRST click —
   * line + reading indicator + voice all start synchronously.
   */
  askBartender: () => void
  openBook: () => void
  /** True only after the LLM brain has actually answered once — the
      footnote below must not claim the brain is live before that. */
  brainLive: boolean
  /** Current reading aloud (null when she is not reading). */
  reading: ReadingState | null
  /** Stop the current reading (timer + voice) at once. */
  stopReading: () => void
}

export function useMenuGuide({
  categoryId,
  itemEvent,
  onOpenBook,
}: {
  categoryId: string
  itemEvent: MenuGuideItemEvent | null
  onOpenBook: (catId: string) => void
}): MenuGuide {
  const [line, setLine] = useState<string>(CHARACTER.greetings.menu)
  const [input, setInput] = useState('')
  const [muted, setMutedState] = useState(isSpeechMuted())
  const [brainLive, setBrainLive] = useState(false)
  const [reading, setReading] = useState<ReadingState | null>(null)
  /**
   * Mirror of `reading` for the async brain replies — a reply must
   * only re-time the reading IT started. A late reply must not
   * resurrect a reading the visitor stopped or a newer tap superseded
   * (the nonce no longer matches), or the voice would start again
   * after "Couper la voix".
   */
  const readingRef = useRef<ReadingState | null>(null)
  readingRef.current = reading
  const firstCategoryRef = useRef(true)
  /** Big-book tab switch waiting on a reading to finish. */
  const pendingOpenRef = useRef<string | null>(null)
  /** The brain's reply has arrived for the pending chat question. */
  const replyArrivedRef = useRef(false)
  /** The timer that ends the current reading (replaces the VRM's
      onReadingEnd). Its nonce guards against a stale timer firing
      after a newer reading started or a stop. */
  const readingTimerRef = useRef<number | null>(null)

  const clearReadingTimer = () => {
    if (readingTimerRef.current !== null) {
      window.clearTimeout(readingTimerRef.current)
      readingTimerRef.current = null
    }
  }

  // The reading is over: fire the pending big-book open, then clear
  // the indicator. The React reading state is left alone by the brain
  // reply path on purpose (see ask()/askBartender): only this end —
  // or an explicit stop — clears it.
  const finishReading = useCallback(
    (nonce: number) => {
      if (readingRef.current?.nonce !== nonce) return
      const pending = pendingOpenRef.current
      readingTimerRef.current = null
      setReading(null)
      if (pending && replyArrivedRef.current) {
        pendingOpenRef.current = null
        onOpenBook(pending)
      }
    },
    [onOpenBook],
  )

  /** Start a reading: state + timer, both keyed by the same nonce. */
  const startReading = useCallback(
    (catId: string, seconds: number) => {
      const nonce = Date.now()
      clearReadingTimer()
      setReading({ categoryId: catId, nonce, seconds })
      readingTimerRef.current = window.setTimeout(() => finishReading(nonce), seconds * 1000)
      return nonce
    },
    [finishReading],
  )

  const stopReading = useCallback(() => {
    clearReadingTimer()
    stopSpeaking()
    pendingOpenRef.current = null
    setReading(null)
  }, [])

  // Stop any speech + the reading timer when the menu tab unmounts.
  useEffect(
    () => () => {
      clearReadingTimer()
      stopSpeaking()
      pendingOpenRef.current = null
    },
    [],
  )

  // Category change → read the category aloud + speak it.
  useEffect(() => {
    if (firstCategoryRef.current) {
      // First mount: greet without reading.
      firstCategoryRef.current = false
      return
    }
    const text = categoryLine(categoryId)
    if (!text) return
    setLine(text)
    startReading(categoryId, estimateSeconds(text))
    // A manual category tap opens the big book on that category once
    // the reading ends, exactly like "Demander à la barmaid". The
    // category line IS the reply (no brain call to wait for), so the
    // pending open is armed at once and the reply flag is set. A later
    // tap re-arms it for the new category; the old timer never fires
    // (superseded timers are cleared, and finishReading is
    // nonce-guarded), so it cannot fire twice. An item tap (+ on a
    // row) still cancels it — the user is ordering, not reading.
    pendingOpenRef.current = categoryId
    replyArrivedRef.current = true
    if (isSpeechSupported()) speak(text)
  }, [categoryId, startReading])

  // Item tap (+ on a row) → speak that item.
  useEffect(() => {
    if (!itemEvent || itemEvent.nonce === 0) return
    const text = `${itemEvent.name}, ${itemEvent.price} — ajouté à votre commande.`
    setLine(text)
    // The tapped row belongs to the active category.
    startReading(categoryId, estimateSeconds(text))
    pendingOpenRef.current = null
    if (isSpeechSupported()) speak(text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemEvent])

  const toggleMute = () => {
    const next = !muted
    setMutedState(next)
    setSpeechMuted(next)
    // Muting stops the voice (setSpeechMuted calls stopSpeaking), so
    // a spoken reading with no voice is over — clear it at once
    // instead of leaving the indicator up until the timer runs out.
    // Unmuting does not restart anything; the visitor asks again.
    if (next && reading !== null) stopReading()
  }

  const openBook = () => onOpenBook(categoryId)

  // Mini chat goes through the same brain adapter as the Agent tab
  // (src/lib/brain.ts): LLM when a key is configured and the call
  // succeeds, the offline rule-based brain otherwise. If the question
  // names a category the guide reads it aloud at once; the big book
  // tab opens only once she has finished reading (finishReading), so
  // the menu tab is not unmounted mid-read. The reply arrives
  // asynchronously: the reading starts on a default estimate and is
  // re-timed on the real spoken line once the brain answers; if the
  // timer runs out before the reply lands, the end is held until the
  // re-timed reading finishes.
  const ask = (e: FormEvent) => {
    e.preventDefault()
    const clean = input.trim()
    if (!clean) return
    setInput('')
    const catId = findCategoryForText(clean)
    replyArrivedRef.current = false
    if (catId) {
      const nonce = startReading(catId, 12)
      pendingOpenRef.current = catId
      void askBrain(clean).then(({ reply, source }) => {
        if (source === 'llm') setBrainLive(true)
        setLine(reply.text)
        // Only re-time (and speak) the reading THIS ask started — a
        // late reply must not resurrect a reading the visitor stopped
        // or a newer tap superseded (the nonce no longer matches).
        if (catId && pendingOpenRef.current === catId && readingRef.current?.nonce === nonce) {
          replyArrivedRef.current = true
          startReading(catId, estimateSeconds(shortenForSpeech(reply.text)))
          if (isSpeechSupported()) speak(reply.text)
        }
      })
      return
    }
    void askBrain(clean).then(({ reply, source }) => {
      if (source === 'llm') setBrainLive(true)
      setLine(reply.text)
      if (isSpeechSupported()) speak(reply.text)
    })
  }

  // "Demander à la barmaid" — the button, not a typed question: the
  // guide reads the current category aloud, then the big book opens on
  // that page once she has finished (finishReading). The line shows at
  // once from the menu data, the reading indicator starts at once and
  // the voice starts at once — the brain's reply (askBrain — LLM when
  // live, offline brain otherwise) only replaces the line, re-times
  // the reading and is the spoken line if it lands in time; speak()
  // cancels, so the immediate line is shown, never spoken twice.
  const askBartender = () => {
    const cat = MENU.find((c) => c.id === categoryId)
    if (!cat) return
    const text = categoryLine(categoryId)
    replyArrivedRef.current = false
    setLine(text)
    const nonce = startReading(categoryId, estimateSeconds(text))
    pendingOpenRef.current = categoryId
    // Speak NOW — the first click must be heard at once, not after
    // the brain answers.
    if (isSpeechSupported()) speak(text)
    const request = `Lis-moi la page ${cat.label} à voix haute`
    void askBrain(request).then(({ reply, source }) => {
      if (source === 'llm') setBrainLive(true)
      if (pendingOpenRef.current !== categoryId) return
      // Only re-time (and speak) the reading THIS press started — see
      // ask(): a late reply must not resurrect a reading the visitor
      // stopped or a newer tap superseded.
      if (readingRef.current?.nonce !== nonce) return
      replyArrivedRef.current = true
      setLine(reply.text)
      startReading(categoryId, estimateSeconds(shortenForSpeech(reply.text)))
      if (isSpeechSupported()) speak(reply.text)
    })
  }

  return {
    line,
    input,
    setInput,
    muted,
    toggleMute,
    categoryId,
    ask,
    askBartender,
    openBook,
    brainLive,
    reading,
    stopReading,
  }
}

/** What she says + controls — in flow on phones, side column on desktop. */
export function MenuGuidePanel({ guide }: { guide: MenuGuide }) {
  const readingCategoryLabel = guide.reading
    ? (MENU.find((c) => c.id === guide.reading?.categoryId)?.label ?? '')
    : ''
  return (
    <div className="mt-3 overflow-hidden rounded-[1.75rem] border border-line bg-ink-2">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-bone">Nekomi vous guide</p>
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
        </div>
      </div>

      <p aria-live="polite" className="px-4 pt-4 text-[15px] leading-relaxed text-bone/85">
        {guide.line}
      </p>

      {guide.reading && (
        <div
          className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-2xl border border-line bg-ink px-4 py-3"
          role="status"
          aria-live="polite"
        >
          <p className="min-w-0 truncate text-sm text-bone">
            <span className="live-dot mr-2 inline-block h-2 w-2 rounded-full bg-amber" aria-hidden />
            Lecture en cours…{readingCategoryLabel ? ` · ${readingCategoryLabel}` : ''}
          </p>
          <button
            type="button"
            onClick={guide.stopReading}
            className="shrink-0 rounded-full border border-line bg-ink-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-bone transition-colors hover:border-bone/50"
          >
            Couper la voix
          </button>
        </div>
      )}

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
        <form className="mt-3 flex items-center gap-2" onSubmit={guide.ask}>
          <label htmlFor="menu-guide-input" className="sr-only">
            Demander à Nekomi
          </label>
          <input
            id="menu-guide-input"
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
            ? 'Cerveau LLM en ligne — Nekomi répond avec le cerveau du café.'
            : 'Voix du navigateur — Deepgram et le cerveau LLM sont hors ligne.'}
        </p>
      </div>
    </div>
  )
}

/** Desktop side column: the guide panel. */
export default function MenuGuide({ guide }: { guide: MenuGuide }) {
  return (
    <div className="min-w-0">
      <MenuGuidePanel guide={guide} />
    </div>
  )
}
