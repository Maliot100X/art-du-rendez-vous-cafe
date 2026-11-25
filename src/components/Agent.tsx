import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  MessageSquareText,
  Mic,
  MicOff,
  PhoneCall,
  Plus,
  ScanLine,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { AGENT, agentConnected, MENU } from '../content'
import { botReply, expressionForReply, orderTotal, type BotAction } from '../lib/agentBrain'
import { avatarBridge } from '../lib/avatarBridge'
import { getLastBookCategory, onBookCategory } from '../lib/bookEvents'
import { isSpeechMuted, isSpeechSupported, setSpeechMuted, speak, stopSpeaking } from '../lib/speech'
import { DeepgramVoiceAgent, type VoiceErrorReason, type VoiceStatus } from '../lib/voiceAgent'
import type { OrderLine } from './MenuSection'
import { EASE_SILK, ScrollTrigger } from '../lib/motion'

// The stages are their own chunks (three-vrm, pixi + cubism): they load
// only when the Agent tab opens, never with the first paint.
const VrmModel = lazy(() => import('./VrmModel'))
const Live2DModel = lazy(() => import('./Live2DModel'))

interface ChatMsg {
  role: 'user' | 'bot'
  text: string
  actions?: BotAction[]
}

interface AgentProps {
  order: OrderLine[]
  onAdd: (line: OrderLine) => void
  onRemove: (index: number) => void
  onClear: () => void
}

/**
 * Mini chat + live agent stage, compacted for phones.
 *
 * Stage: Vita VRM full-body is primary; Nekomi Live2D is the secondary /
 * fallback view behind a toggle — and the agent switches to it
 * automatically if the VRM fails to load, so the stage is never blank.
 *
 * Speaking: Deepgram TTS is OFFLINE (key returns 401) and freellm is
 * DOWN — neither is used. Live speaking is the browser's built-in
 * speechSynthesis (French voice when available, src/lib/speech.ts),
 * with a mute toggle. Spoken lines stay short.
 *
 * Book reaction: when the menu book lands on a category (bookEvents),
 * the agent posts a short message from MENU data (items + prices, never
 * retyped) and speaks it — debounced 400 ms, only when the agent
 * section is on screen and the visitor is not mid-chat.
 *
 * Responsive (responsive-css / mobile-principles): grid children get
 * min-w-0 so nothing can push the page sideways; every tap target is
 * at least 44 px tall; the chat input is 16 px so iOS doesn't zoom on
 * focus; the chat list contains its own scroll (overscroll-contain);
 * stages use touch-action: pan-y so a vertical swipe still scrolls.
 */
export default function Agent({ order, onAdd, onRemove, onClear }: AgentProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([{ role: 'bot', text: AGENT.chatWelcome }])
  const [input, setInput] = useState('')
  const [qr, setQr] = useState<string | null>(null)
  const [qrFailed, setQrFailed] = useState(false)
  const [voiceState, setVoiceState] = useState<{ status: VoiceStatus; error?: VoiceErrorReason }>({
    status: 'idle',
  })
  const [agentSpeaking, setAgentSpeaking] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [stage, setStage] = useState<'vrm' | 'live2d'>('vrm')
  const [muted, setMutedState] = useState(isSpeechMuted())
  const reducedMotion = useReducedMotion()
  const sectionRef = useRef<HTMLElement>(null)
  const sectionVisibleRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const levelRef = useRef<HTMLDivElement>(null)
  const voiceAgentRef = useRef<DeepgramVoiceAgent | null>(null)
  const bookTimerRef = useRef<number | null>(null)
  const lastBookCatRef = useRef<string | null>(null)

  // This section lazy-mounts at the bottom of the page: re-measure every
  // ScrollTrigger (Visit's were created before this section existed).
  useEffect(() => {
    ScrollTrigger.refresh()
  }, [])

  // Track whether the agent section is on screen — book reactions only
  // speak when the visitor can see (and hear) the agent.
  useEffect(() => {
    const el = sectionRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      sectionVisibleRef.current = true
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        sectionVisibleRef.current = entries.some((e) => e.isIntersecting)
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // QR code for the agent chat — generated in the browser from content.
  useEffect(() => {
    let cancelled = false
    import('qrcode')
      .then((mod) => mod.toDataURL(AGENT.qrUrl, { width: 220, margin: 1, color: { dark: '#0d0a08', light: '#ece5da' } }))
      .then((url) => {
        if (!cancelled) setQr(url)
      })
      .catch(() => {
        if (!cancelled) setQrFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Keep the transcript pinned to the latest message.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Stop any speech when leaving the agent.
  useEffect(() => () => stopSpeaking(), [])

  const toggleMute = () => {
    const next = !muted
    setMutedState(next)
    setSpeechMuted(next)
  }

  const send = (text: string) => {
    const clean = text.trim()
    if (!clean) return
    const reply = botReply(clean)
    avatarBridge.setExpression(reply.expression ?? 'neutral')
    setMessages((prev) => [...prev, { role: 'user', text: clean }, { role: 'bot', text: reply.text, actions: reply.actions }])
    setInput('')
    // Live speaking: the reply is spoken (short, French voice) unless muted.
    if (isSpeechSupported()) speak(reply.text)
  }

  // ---- Book reaction (bookEvents): the model describes the category
  // the book just landed on, from MENU data — items + 2–3 prices, with
  // tap-to-add actions. Debounced 400 ms; a repeat of the same category
  // is ignored. It speaks only when the agent section is visible and
  // the visitor is not typing or on a voice call — never over the user.
  useEffect(() => {
    const handleCategory = (catId: string) => {
      if (catId === lastBookCatRef.current) return
      if (bookTimerRef.current !== null) window.clearTimeout(bookTimerRef.current)
      bookTimerRef.current = window.setTimeout(() => {
        bookTimerRef.current = null
        const cat = MENU.find((c) => c.id === catId)
        if (!cat) return
        lastBookCatRef.current = catId
        const picks = cat.items.slice(0, 3)
        const text = `${cat.label} — ${cat.blurb} Par exemple : ${picks.map((i) => `${i.name} ${i.price}`).join(', ')}.`
        const actions: BotAction[] = picks.map((i) => ({ label: `+ ${i.name}`, name: i.name, price: i.price }))
        avatarBridge.setExpression('happy')
        setMessages((prev) => [...prev, { role: 'bot', text, actions }])
        const userBusy =
          (inputRef.current && document.activeElement === inputRef.current) || input.trim().length > 0
        const voiceLive = voiceState.status === 'live' || voiceState.status === 'connecting'
        if (sectionVisibleRef.current && !userBusy && !voiceLive && isSpeechSupported()) {
          speak(text)
        }
      }, 400)
    }
    const unsubscribe = onBookCategory(handleCategory)
    // The tab shell unmounts the Agent while the book flips, so a flip
    // that happened on the Book tab would otherwise be lost: on mount,
    // react to the latest flip the same way (the dedupe above keeps it
    // to one message).
    const last = getLastBookCategory()
    if (last) handleCategory(last)
    return () => {
      unsubscribe()
      if (bookTimerRef.current !== null) window.clearTimeout(bookTimerRef.current)
    }
    // input/voiceState read inside the timeout on purpose — the handler
    // must see the moment of the flip, not the moment of subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleVrmFailed = useCallback(() => setStage('live2d'), [])

  // Deepgram voice call (Phase 4). The voice client owns the socket,
  // mic worklet and TTS playback; this component only renders its
  // status, feeds its transcript into the chat, and lets its
  // add_to_order function calls land in the order panel. When no
  // token can be obtained the client reports 'no-token' and the UI
  // shows the honest offline state below — voice is offline until a
  // working Deepgram key is re-entered.
  const startVoice = () => {
    const agent = new DeepgramVoiceAgent({
      onStatus: (status, error) => {
        setVoiceState({ status, error })
        if (status === 'idle' || status === 'ended') {
          voiceAgentRef.current = null
          if (levelRef.current) levelRef.current.style.transform = 'scaleX(0.04)'
        }
      },
      onTranscript: (role, text) => {
        if (role === 'assistant') {
          avatarBridge.setExpression(expressionForReply(text))
          setMessages((prev) => [...prev, { role: 'bot', text }])
        } else {
          setMessages((prev) => [...prev, { role: 'user', text }])
        }
      },
      onOrderAdded: (line) => {
        onAdd(line)
        setConfirmed(false)
      },
    })
    voiceAgentRef.current = agent
    void agent.start()
  }

  const stopVoice = () => {
    voiceAgentRef.current?.stop()
    voiceAgentRef.current = null
  }

  useEffect(() => () => voiceAgentRef.current?.stop(), [])

  // The agent's speaking state drives the voice status line.
  useEffect(() => avatarBridge.subscribe((state) => setAgentSpeaking(state.speaking)), [])

  // Real mic-level meter, read from the avatar bridge (fed by the
  // capture worklet's RMS) while a call is live.
  useEffect(() => {
    if (voiceState.status !== 'live') return
    let raf = 0
    const tick = () => {
      const level = avatarBridge.getMicLevel()
      if (levelRef.current) levelRef.current.style.transform = `scaleX(${Math.max(0.04, level)})`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [voiceState.status])

  const voiceStatusText = () => {
    switch (voiceState.status) {
      case 'connecting':
        return AGENT.voiceConnecting
      case 'live':
        return agentSpeaking ? AGENT.voiceSpeaking : AGENT.voiceListening
      case 'ended':
        switch (voiceState.error) {
          case 'no-token':
            return AGENT.voiceNoToken
          case 'mic-denied':
            return AGENT.voiceDenied
          case 'worklet-unsupported':
            return AGENT.voiceWorklet
          case 'settings-rejected':
            return AGENT.voiceSettingsError
          default:
            return AGENT.voiceSocketError
        }
      default:
        return AGENT.voiceOffline
    }
  }

  const confirmOrder = () => {
    if (order.length === 0) return
    setConfirmed(true)
    setMessages((prev) => [
      ...prev,
      {
        role: 'bot',
        text: `Commande confirmée : ${order.map((l) => `${l.name} (${l.price})`).join(', ')} — total ${orderTotal(order)}. ${AGENT.orderConfirmed}`,
      },
    ])
  }

  return (
    <section
      id="agent"
      ref={sectionRef}
      className="relative mx-auto max-w-[1400px] scroll-mt-24 px-4 py-12 sm:px-6 sm:py-16 md:py-24"
    >
      <div className="max-w-3xl" data-reveal>
        <p className="font-mono text-label uppercase text-amber">{AGENT.eyebrow}</p>
        <h2 className="agent-title mt-3 font-display text-bone">{AGENT.title}</h2>
        <p className="mt-4 text-lead text-bone/75">{AGENT.lede}</p>
        <p
          className={`mt-5 inline-flex items-center gap-2 rounded-full border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] ${
            agentConnected ? 'border-amber/50 bg-amber/10 text-amber' : 'border-line bg-ink-2 text-bone/70'
          }`}
        >
          <span className={`live-dot inline-block h-1.5 w-1.5 rounded-full ${agentConnected ? 'bg-amber' : 'bg-ember'}`} />
          {agentConnected ? 'Agent en direct — connecté' : AGENT.statusOffline}
        </p>
        {!agentConnected && <p className="mt-3 max-w-xl text-sm text-mist">{AGENT.statusHint}</p>}
      </div>

      <div className="mt-8 grid gap-4 sm:mt-10 sm:gap-6 lg:grid-cols-[1fr_1.1fr]">
        {/* Live stage: VRM primary, Live2D secondary / fallback */}
        <div className="min-w-0" data-reveal>
          <div
            className="mb-3 flex rounded-full border border-line p-1"
            role="group"
            aria-label="Modèle de l’agent"
          >
            {(
              [
                { id: 'vrm', label: 'Vita · 3D' },
                { id: 'live2d', label: 'Nekomi · Live2D' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setStage(opt.id)}
                aria-pressed={stage === opt.id}
                className={`min-h-11 flex-1 rounded-full px-4 py-2 text-xs font-bold transition-all duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] ${
                  stage === opt.id ? 'bg-bone text-ink' : 'text-bone/60 hover:text-bone'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Suspense
            fallback={
              <div className="flex h-[520px] items-center justify-center rounded-[1.75rem] border border-line bg-ink-2 sm:h-[540px] lg:h-[560px]">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mist">Le modèle se prépare…</p>
              </div>
            }
          >
            {stage === 'vrm' ? (
              <VrmModel bridge={avatarBridge} onFailed={handleVrmFailed} />
            ) : (
              <Live2DModel bridge={avatarBridge} />
            )}
          </Suspense>
          {/* Guidance — full list on desktop, collapsed on a phone so
              the agent section stays compact. */}
          <ul className="mt-6 hidden space-y-3 sm:block">
            {AGENT.guidance.map((g) => (
              <li key={g} className="flex items-start gap-3 text-body text-bone/80">
                <Sparkles size={15} className="mt-1 shrink-0 text-amber" />
                <span>{g}</span>
              </li>
            ))}
          </ul>
          <details className="mt-4 sm:hidden">
            <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.16em] text-amber">
              Ce que Nekomi peut faire
            </summary>
            <ul className="mt-3 space-y-2">
              {AGENT.guidance.map((g) => (
                <li key={g} className="flex items-start gap-3 text-sm text-bone/80">
                  <Sparkles size={14} className="mt-0.5 shrink-0 text-amber" />
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>

        {/* Mini chat + voice + QR */}
        <div className="flex min-w-0 flex-col gap-4 sm:gap-5" data-reveal style={{ ['--d' as string]: '120ms' }}>
          <div className="overflow-hidden rounded-[1.75rem] border border-line bg-ink-2">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <p className="flex min-w-0 items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-bone">
                <MessageSquareText size={15} className="shrink-0 text-amber" /> Chat en direct
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-mist sm:inline">
                  Voix du navigateur
                </span>
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-pressed={muted}
                  aria-label={muted ? 'Activer la voix' : 'Couper la voix'}
                  className={`flex min-h-11 min-w-11 items-center justify-center rounded-full border transition-colors duration-300 ${
                    muted
                      ? 'border-line text-mist hover:text-bone'
                      : 'border-amber/60 bg-amber/10 text-amber hover:bg-amber hover:text-ink'
                  }`}
                >
                  {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
              </div>
            </div>

            <div ref={listRef} className="h-[200px] space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:h-[260px]">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-3xl px-4 py-3 text-[15px] leading-relaxed ${
                      m.role === 'user' ? 'rounded-br-md bg-bone text-ink' : 'rounded-bl-md bg-ink-3 text-bone'
                    }`}
                  >
                    <p className="whitespace-pre-line break-words">{m.text}</p>
                    {m.actions && m.actions.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {m.actions.map((a) => (
                          <button
                            key={a.name}
                            type="button"
                            onClick={() => {
                              onAdd({ name: a.name, price: a.price })
                              setConfirmed(false)
                            }}
                            className="inline-flex min-h-11 items-center gap-1 rounded-full border border-amber/60 bg-amber/10 px-3 py-1.5 text-xs font-bold text-amber transition-colors duration-300 hover:bg-amber hover:text-ink"
                          >
                            <Plus size={13} /> {a.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 px-4 pb-3">
              {AGENT.chatSuggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="min-h-11 rounded-full border border-line px-3 py-2 text-xs text-bone/75 transition-colors duration-300 hover:border-amber/60 hover:text-amber"
                >
                  {s}
                </button>
              ))}
            </div>

            <form
              className="flex items-center gap-2 border-t border-line p-2.5"
              onSubmit={(e) => {
                e.preventDefault()
                send(input)
              }}
            >
              <label htmlFor="agent-input" className="sr-only">
                {AGENT.chatPlaceholder}
              </label>
              <input
                id="agent-input"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={AGENT.chatPlaceholder}
                className="min-w-0 flex-1 bg-transparent px-3 text-base text-bone placeholder:text-mist focus:outline-none"
              />
              <button
                type="submit"
                className="min-h-11 shrink-0 rounded-full bg-bone px-5 py-2.5 text-sm font-bold text-ink transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:scale-[1.04]"
              >
                {AGENT.chatSend}
              </button>
            </form>
          </div>

          {/* Voice */}
          <div className="rounded-[1.75rem] border border-line bg-ink-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-bone">
                <PhoneCall size={15} className="text-amber" /> {AGENT.voiceTitle}
              </p>
              {voiceState.status === 'connecting' || voiceState.status === 'live' ? (
                <button
                  type="button"
                  onClick={stopVoice}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-ember/60 bg-ember/10 px-5 py-2.5 text-sm font-bold text-ember transition-colors duration-300 hover:bg-ember hover:text-ink"
                >
                  <MicOff size={15} /> {AGENT.voiceStop}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startVoice}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-bone px-5 py-2.5 text-sm font-bold text-ink transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:scale-[1.04]"
                >
                  <Mic size={15} /> {AGENT.voiceCta}
                </button>
              )}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-3">
              <div
                ref={levelRef}
                className="h-full origin-left rounded-full bg-amber will-change-transform"
                style={{ transform: 'scaleX(0.04)' }}
              />
            </div>
            <p className="mt-2.5 text-sm text-mist">{voiceStatusText()}</p>
          </div>

          {/* Order + QR */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0 rounded-[1.75rem] border border-line bg-ink-2 p-4 sm:p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-bone">{AGENT.orderTitle}</p>
              {order.length === 0 ? (
                <p className="mt-3 text-sm text-mist">{AGENT.orderEmpty}</p>
              ) : (
                <>
                  {/* Layout animations: a line slides into place when added
                      and slides out when removed; the total glides up. */}
                  <motion.ul layout className="mt-3 space-y-2">
                    <AnimatePresence initial={false} mode="popLayout">
                      {order.map((line, i) => (
                        <motion.li
                          key={`${line.name}-${i}`}
                          layout
                          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 32 }}
                          transition={{ duration: reducedMotion ? 0 : 0.4, ease: EASE_SILK }}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="min-w-0 break-words text-bone">
                            {line.name} <span className="font-mono text-amber">{line.price}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => onRemove(i)}
                            aria-label={`Retirer ${line.name}`}
                            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-mist transition-colors hover:text-ember"
                          >
                            <X size={15} />
                          </button>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </motion.ul>
                  <motion.p
                    layout
                    transition={{ duration: reducedMotion ? 0 : 0.45, ease: EASE_SILK }}
                    className="mt-4 flex justify-between border-t border-line pt-3 font-mono text-sm text-bone"
                  >
                    <span>{AGENT.orderTotal}</span>
                    <span className="text-amber">{orderTotal(order)}</span>
                  </motion.p>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={confirmOrder}
                      className="min-h-11 flex-1 rounded-full bg-bone px-4 py-2.5 text-sm font-bold text-ink transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:scale-[1.03]"
                    >
                      {AGENT.orderConfirm}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onClear()
                        setConfirmed(false)
                      }}
                      aria-label="Vider la commande"
                      className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line text-mist transition-colors hover:text-ember"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <AnimatePresence initial={false}>
                    {confirmed && (
                      <motion.p
                        key="order-confirmed"
                        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reducedMotion ? 0 : 0.4, ease: EASE_SILK }}
                        className="mt-3 text-sm font-bold text-amber"
                      >
                        ✓ {AGENT.orderConfirmed}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </>
              )}
            </div>

            <div className="flex min-w-0 items-center gap-4 rounded-[1.75rem] border border-line bg-ink-2 p-4 sm:p-5">
              <div className="flex h-[96px] w-[96px] shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-bone sm:h-[120px] sm:w-[120px]">
                {qr ? (
                  <img src={qr} alt="QR code vers le chat de l’agent" className="h-full w-full object-contain" />
                ) : (
                  <span className="flex flex-col items-center gap-1 px-2 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-ink/60">
                    <ScanLine size={22} />
                    {qrFailed ? 'Code indisponible' : 'Code en cours…'}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="font-display text-lg text-bone">{AGENT.qrTitle}</p>
                <p className="mt-1 text-sm text-mist">{AGENT.qrText}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
