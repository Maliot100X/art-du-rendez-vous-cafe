import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BookOpen, Send, Volume2, VolumeX } from 'lucide-react'
import { CHARACTER, MENU } from '../content'
import { askBrain } from '../lib/brain'
import {
  getGuideLine,
  getPendingOpen,
  getReading,
  registerReadingFinishHandler,
  registerSpeechStopper,
  retimeReading,
  setGuideLine,
  setPendingOpen,
  setReplyArrived,
  startReading,
  stopReading,
  subscribeReadingStore,
  type ReadingState,
} from '../lib/readingStore'
import { isSpeechMuted, isSpeechSupported, setSpeechMuted, shortenForSpeech, speak, stopSpeaking } from '../lib/speech'

/**
 * Nekomi's guide inside the Menu tab — text + voice, NO 3D model.
 *
 * The VRM walking guide was removed (user order — the live model was
 * full of bugs). What remains is the guide itself:
 *
 * - Category change → the guide shows the category line only (2–3
 *   items + prices, from MENU data, never retyped). Fix pass 13: no
 *   reading, no voice, no big-book open on a category tap — a reading
 *   starts only from "Demander à la barmaid" or an explicit ask.
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
 *
 * Fix pass 14: the reading lives in the module-level store
 * (src/lib/readingStore.ts), NOT in this hook's local state. App.tsx
 * mounts only the active tab, so this hook unmounts the moment the
 * visitor leaves LA CARTE — the old local timer, pending big-book
 * open and reply flag died with it, the reading never finished, the
 * book never opened and the Agent tab never logged the category.
 * The store outlives the unmount: a reading started here still
 * finishes on its timer, still opens the book (switching the visitor
 * to the Livre tab — the existing pending-open flow) and still
 * produces the book flip the Agent log entry replays from, even if
 * the visitor is on AGENT when it finishes. Leaving the tab cancels
 * nothing; only "Couper la voix" (stopReading) does.
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
    estimated spoken seconds — see src/lib/readingStore.ts. */
export type { ReadingState } from '../lib/readingStore'

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
  /**
   * Fix pass 14: the reading + the shown line live in the module-level
   * store (src/lib/readingStore.ts) and are only MIRRORED here. The
   * hook unmounts when the visitor leaves LA CARTE, so any local
   * reading state, timer or pending open would die with it — the
   * store's do not. On a remount mid-reading the mirrors initialise
   * from the store, so the line does not reset to the greeting and
   * the "Lecture en cours…" indicator comes back with the true
   * category (Livre label follows the actual reading category).
   * `line` is mirrored the same way for the same reason; `input`,
   * `muted` and `brainLive` are per-mount UI and stay local.
   */
  const [line, setLineState] = useState<string>(() => getGuideLine() ?? CHARACTER.greetings.menu)
  const [input, setInput] = useState('')
  const [muted, setMutedState] = useState(isSpeechMuted())
  const [brainLive, setBrainLive] = useState(false)
  const [reading, setReadingState] = useState<ReadingState | null>(() => getReading())
  const firstCategoryRef = useRef(true)

  useEffect(
    () =>
      subscribeReadingStore(() => {
        setReadingState(getReading())
        const stored = getGuideLine()
        if (stored !== null) setLineState(stored)
      }),
    [],
  )

  /**
   * Register the finish handler (App's openBook) and the voice
   * stopper in the store. Deliberately NO cleanup: the handler must
   * outlive this hook, or a reading finishing after a tab switch
   * could never open the book. The hook re-registers the same
   * functions on every mount; the store keeps the latest.
   */
  useEffect(() => {
    registerReadingFinishHandler(onOpenBook)
    registerSpeechStopper(stopSpeaking)
  }, [onOpenBook])

  // Fix pass 14: there is deliberately NO unmount cleanup for the
  // reading here. The old effect cleared the timer, stopped the voice
  // and dropped the pending big-book open when the menu tab unmounted
  // — that was the bug: leaving LA CARTE mid-reading cancelled it.
  // The voice keeps playing and the timer keeps running in the store;
  // only stopReading ("Couper la voix") cancels a reading.

  // Category change → show the category line only. Fix pass 13: NO
  // reading, NO voice, NO pending big-book open here — the old effect
  // auto-started a reading (startReading + speak + pendingOpenRef) on
  // every category tab select, which raised the "Lecture en cours…"
  // indicator, spoke, and auto-opened the book without being asked.
  // Readings start ONLY from "Demander à la barmaid" (askBartender)
  // or an explicit chat ask — see ask()/askBartender below.
  useEffect(() => {
    if (firstCategoryRef.current) {
      // First mount: greet without reading.
      firstCategoryRef.current = false
      return
    }
    const text = categoryLine(categoryId)
    if (!text) return
    setGuideLine(text)
  }, [categoryId])

  // Item tap (+ on a row) → speak that item.
  useEffect(() => {
    if (!itemEvent || itemEvent.nonce === 0) return
    const text = `${itemEvent.name}, ${itemEvent.price} — ajouté à votre commande.`
    setGuideLine(text)
    // The tapped row belongs to the active category.
    startReading(categoryId, estimateSeconds(text))
    setPendingOpen(null)
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
  // tab opens only once she has finished reading (the store's
  // finishReading) — fix pass 14: that open survives a tab switch,
  // because the reading lives in the module-level store, not this
  // hook. The reply arrives asynchronously: the reading starts on a
  // default estimate and is re-timed on the real spoken line once
  // the brain answers; if the timer runs out before the reply lands,
  // the end is held until the re-timed reading finishes.
  const ask = (e: FormEvent) => {
    e.preventDefault()
    const clean = input.trim()
    if (!clean) return
    setInput('')
    const catId = findCategoryForText(clean)
    setReplyArrived(false)
    if (catId) {
      const nonce = startReading(catId, 12)
      setPendingOpen(catId)
      void askBrain(clean).then(({ reply, source }) => {
        if (source === 'llm') setBrainLive(true)
        setGuideLine(reply.text)
        // Only re-time (and speak) the reading THIS ask started —
        // the store refuses the re-time outright when the reading
        // has finished, been stopped or been superseded (fix pass
        // 16), so a late reply can never resurrect it.
        if (catId && getPendingOpen() === catId && retimeReading(nonce, catId, estimateSeconds(shortenForSpeech(reply.text)))) {
          setReplyArrived(true)
          if (isSpeechSupported()) speak(reply.text)
        }
      })
      return
    }
    void askBrain(clean).then(({ reply, source }) => {
      if (source === 'llm') setBrainLive(true)
      setGuideLine(reply.text)
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
    setReplyArrived(false)
    setGuideLine(text)
    const nonce = startReading(categoryId, estimateSeconds(text))
    setPendingOpen(categoryId)
    // Speak NOW — the first click must be heard at once, not after
    // the brain answers.
    if (isSpeechSupported()) speak(text)
    const request = `Lis-moi la page ${cat.label} à voix haute`
    void askBrain(request).then(({ reply, source }) => {
      if (source === 'llm') setBrainLive(true)
      if (getPendingOpen() !== categoryId) return
      // Only re-time (and speak) the reading THIS press started —
      // the store refuses the re-time when the reading has
      // finished, been stopped or been superseded (fix pass 16), so
      // a late reply can never resurrect it.
      if (!retimeReading(nonce, categoryId, estimateSeconds(shortenForSpeech(reply.text)))) return
      setReplyArrived(true)
      setGuideLine(reply.text)
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
          {/* Fix pass 15: this button's accessible name is "Couper la
              voix" while unmuted, so it was present on LA CARTE before
              any reading had started. It only renders while a reading
              is active (reading is mirrored from the module-level
              store, src/lib/readingStore.ts) — there is no voice to
              cut before then. */}
          {guide.reading && (
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
          )}
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
