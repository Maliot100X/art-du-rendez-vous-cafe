import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { MessageSquareText, Mic, MicOff, PhoneCall, Plus, ScanLine, Sparkles, Trash2, X } from 'lucide-react'
import { AGENT, agentConnected } from '../content'
import { botReply, orderTotal, type BotAction } from '../lib/agentBrain'
import type { OrderLine } from './MenuSection'
import Live2DModel from './Live2DModel'
import { EASE_SILK, ScrollTrigger } from '../lib/motion'

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

export default function Agent({ order, onAdd, onRemove, onClear }: AgentProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([{ role: 'bot', text: AGENT.chatWelcome }])
  const [input, setInput] = useState('')
  const [qr, setQr] = useState<string | null>(null)
  const [qrFailed, setQrFailed] = useState(false)
  const [voice, setVoice] = useState<'idle' | 'listening' | 'denied'>('idle')
  const [confirmed, setConfirmed] = useState(false)
  const reducedMotion = useReducedMotion()
  const listRef = useRef<HTMLDivElement>(null)
  const levelRef = useRef<HTMLDivElement>(null)
  const voiceStopRef = useRef<(() => void) | null>(null)

  // This section lazy-mounts at the bottom of the page: re-measure every
  // ScrollTrigger (Visit's were created before this section existed).
  useEffect(() => {
    ScrollTrigger.refresh()
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

  const send = (text: string) => {
    const clean = text.trim()
    if (!clean) return
    const reply = botReply(clean)
    setMessages((prev) => [...prev, { role: 'user', text: clean }, { role: 'bot', text: reply.text, actions: reply.actions }])
    setInput('')
  }

  const startVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      let raf = 0
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const level = data.reduce((a, b) => a + b, 0) / data.length / 255
        if (levelRef.current) levelRef.current.style.transform = `scaleX(${Math.max(0.04, level)})`
        raf = requestAnimationFrame(tick)
      }
      tick()
      voiceStopRef.current = () => {
        cancelAnimationFrame(raf)
        stream.getTracks().forEach((t) => t.stop())
        void ctx.close()
      }
      setVoice('listening')
    } catch {
      setVoice('denied')
    }
  }

  const stopVoice = () => {
    voiceStopRef.current?.()
    voiceStopRef.current = null
    if (levelRef.current) levelRef.current.style.transform = 'scaleX(0.04)'
    setVoice('idle')
  }

  useEffect(() => () => voiceStopRef.current?.(), [])

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
    <section id="agent" className="relative mx-auto max-w-[1400px] px-4 py-24 sm:px-6 md:py-36">
      <div className="max-w-3xl" data-reveal>
        <p className="font-mono text-label uppercase text-amber">{AGENT.eyebrow}</p>
        <h2 className="mt-3 font-display text-display text-bone">{AGENT.title}</h2>
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

      <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        {/* Live 2D stage */}
        <div data-reveal>
          <Live2DModel />
          <ul className="mt-6 space-y-3">
            {AGENT.guidance.map((g) => (
              <li key={g} className="flex items-start gap-3 text-body text-bone/80">
                <Sparkles size={15} className="mt-1 shrink-0 text-amber" />
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Chat + voice + QR */}
        <div className="flex flex-col gap-6" data-reveal style={{ ['--d' as string]: '120ms' }}>
          <div className="overflow-hidden rounded-[1.75rem] border border-line bg-ink-2">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-bone">
                <MessageSquareText size={15} className="text-amber" /> Chat en direct
              </p>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-mist">Répond hors-ligne pour l’instant</span>
            </div>

            <div ref={listRef} className="h-[320px] space-y-4 overflow-y-auto px-5 py-5">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-3xl px-4 py-3 text-[15px] leading-relaxed ${
                      m.role === 'user' ? 'rounded-br-md bg-bone text-ink' : 'rounded-bl-md bg-ink-3 text-bone'
                    }`}
                  >
                    <p className="whitespace-pre-line">{m.text}</p>
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
                            className="inline-flex items-center gap-1 rounded-full border border-amber/60 bg-amber/10 px-3 py-1.5 text-xs font-bold text-amber transition-colors duration-300 hover:bg-amber hover:text-ink"
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

            <div className="flex flex-wrap gap-2 px-5 pb-3">
              {AGENT.chatSuggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-line px-3 py-1.5 text-xs text-bone/75 transition-colors duration-300 hover:border-amber/60 hover:text-amber"
                >
                  {s}
                </button>
              ))}
            </div>

            <form
              className="flex items-center gap-2 border-t border-line p-3"
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
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={AGENT.chatPlaceholder}
                className="min-w-0 flex-1 bg-transparent px-3 text-[15px] text-bone placeholder:text-mist focus:outline-none"
              />
              <button
                type="submit"
                className="shrink-0 rounded-full bg-bone px-5 py-2.5 text-sm font-bold text-ink transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:scale-[1.04]"
              >
                {AGENT.chatSend}
              </button>
            </form>
          </div>

          {/* Voice */}
          <div className="rounded-[1.75rem] border border-line bg-ink-2 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-bone">
                <PhoneCall size={15} className="text-amber" /> {AGENT.voiceTitle}
              </p>
              {voice === 'idle' ? (
                <button
                  type="button"
                  onClick={startVoice}
                  className="inline-flex items-center gap-2 rounded-full bg-bone px-5 py-2.5 text-sm font-bold text-ink transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:scale-[1.04]"
                >
                  <Mic size={15} /> {AGENT.voiceCta}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopVoice}
                  className="inline-flex items-center gap-2 rounded-full border border-ember/60 bg-ember/10 px-5 py-2.5 text-sm font-bold text-ember transition-colors duration-300 hover:bg-ember hover:text-ink"
                >
                  <MicOff size={15} /> {AGENT.voiceStop}
                </button>
              )}
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-ink-3">
              <div
                ref={levelRef}
                className="h-full origin-left rounded-full bg-amber will-change-transform"
                style={{ transform: 'scaleX(0.04)' }}
              />
            </div>
            <p className="mt-3 text-sm text-mist">
              {voice === 'listening' ? AGENT.voiceListening : voice === 'denied' ? AGENT.voiceDenied : AGENT.voiceOffline}
            </p>
          </div>

          {/* Order + QR */}
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-[1.75rem] border border-line bg-ink-2 p-5">
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
                          <span className="text-bone">
                            {line.name} <span className="font-mono text-amber">{line.price}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => onRemove(i)}
                            aria-label={`Retirer ${line.name}`}
                            className="text-mist transition-colors hover:text-ember"
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
                      className="flex-1 rounded-full bg-bone px-4 py-2.5 text-sm font-bold text-ink transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:scale-[1.03]"
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
                      className="flex items-center justify-center rounded-full border border-line px-3 text-mist transition-colors hover:text-ember"
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

            <div className="flex items-center gap-4 rounded-[1.75rem] border border-line bg-ink-2 p-5">
              <div className="flex h-[120px] w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-bone">
                {qr ? (
                  <img src={qr} alt="QR code vers le chat de l’agent" className="h-full w-full object-contain" />
                ) : (
                  <span className="flex flex-col items-center gap-1 px-2 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-ink/60">
                    <ScanLine size={22} />
                    {qrFailed ? 'Code indisponible' : 'Code en cours…'}
                  </span>
                )}
              </div>
              <div>
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
