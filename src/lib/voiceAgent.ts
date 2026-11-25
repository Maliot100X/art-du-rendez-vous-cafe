/**
 * Deepgram Voice Agent client for the café live agent.
 *
 * One WebSocket to wss://agent.deepgram.com/v1/agent/converse, following
 * the voice-agent skill: wait for Welcome, send one Settings message,
 * wait for SettingsApplied, then stream mic audio as binary frames and
 * play the agent's binary audio frames. JSON events arrive as text
 * frames on the same socket, so the frame type is branched on first.
 *
 * Audio in: microphone via an AudioWorkletNode (16 kHz mono PCM16 —
 * see /public/worklets/pcm16-capture.js). Audio out: agent TTS
 * (linear16, 24 kHz, no container) played through an AnalyserNode tap
 * (fftSize 512) placed before the gain node, so lip-sync reads the same
 * samples as the speakers — the YuriOS VisemeDriver pattern, via the
 * shared avatar bridge (src/lib/avatarBridge.ts). Barge-in:
 * UserStartedSpeaking stops playback immediately and drops the queue.
 *
 * TOKEN — read this before touching this file:
 * The browser cannot set an Authorization header on a WebSocket, so
 * the client authenticates with a short-lived JWT minted by
 * POST /v1/auth/grant, passed as the Sec-WebSocket-Protocol value
 * (["bearer", jwt]). The JWT comes from a same-origin
 * POST /api/deepgram/grant endpoint (fix pass 15, group 6):
 * locally that is the tiny grant server (server/grant.mjs,
 * `npm run grant`, 127.0.0.1:8787) reached through the vite preview
 * proxy; on the deploy it is the Vercel function
 * (api/deepgram/grant.ts). The server reads DEEPGRAM_API_KEY from
 * its own environment only — the key is never in the bundle, never
 * in a file, and never sent to the agent socket.
 *   (b) it NEVER sends the raw Deepgram API key to the agent socket
 *       and NEVER embeds it in the shipped bundle as socket auth. The
 *       only other path is local development: when import.meta.env.DEV
 *       is true, VITE_DEEPGRAM_API_KEY may be used to request a grant
 *       from the browser (POST https://api.deepgram.com/v1/auth/grant).
 *       That branch is dev-only and is stripped from production
 *       builds. A production build must NOT set VITE_DEEPGRAM_API_KEY.
 * When no token can be obtained, start() fails with reason 'no-token'
 * and the UI shows the honest offline state; the text chat keeps
 * working. Voice stays OFFLINE until the grant server runs with a
 * valid key — never claim otherwise.
 *
 * THINK — Inception mercury-3 (fix pass 14, group E):
 * The agent's brain is Inception's mercury-3, reached as a Deepgram
 * bring-your-own-LLM: think.provider stays { type: 'open_ai',
 * model: 'mercury-3' } and think.endpoint — a SIBLING of provider,
 * NOT a field inside it — points at
 * https://api.inceptionlabs.ai/v1/chat/completions with an
 * Authorization: Bearer <VITE_LLM_API_KEY> header. That is the exact
 * shape in Deepgram's voice-agent-llm-models docs ("Example using a
 * custom OpenAI endpoint (BYO)") and in the AsyncAPI reference
 * (deepgram-skills skills/api/references/agent.md, AgentV1Settings:
 * think: { provider, endpoint: { url, headers }, ... }). The brief's
 * "think.provider.endpoint" phrasing is wrong — endpoint lives on
 * think, and putting it inside provider would be silently ignored or
 * rejected. For a BYO endpoint Deepgram accepts any model string
 * without restriction (same docs page, "Passing a custom (BYO) LLM
 * through a Cloud Provider"), so 'mercury-3' needs no allow-listing.
 * The key comes from brainConfig() in ./brain — the same env read as
 * the text chat (VITE_LLM_API_KEY, else VITE_FREELLM_API_KEY) — and
 * is never hardcoded. NOTE: that env key is the site's LLM key; if it
 * is a freellm/OpenAI key rather than an Inception key, the mercury-3
 * request fails auth and the fallback below takes over — the key must
 * be an Inception key for mercury-3 to answer. The LLM key IS sent to
 * Deepgram's server inside the Settings message (that is how BYO auth
 * works — Deepgram needs it to call Inception); it is the same
 * VITE_-prefixed key the text chat already ships in the bundle, so
 * this adds no new exposure class. The Deepgram API key itself is
 * never in Settings.
 * Reasoning params: there is NO schema slot for reasoning_effort or
 * max_completion_tokens on a Deepgram-constructed think request
 * (neither the docs page nor the AsyncAPI reference lists one), so
 * the direct-call proof's reasoning_effort "instant" +
 * max_completion_tokens 512 are NOT wired — they cannot be, and
 * faking them would be a lie. think.provider.reasoning_mode exists
 * but is documented only for OpenAI reasoning models (gpt-5…), and
 * whether Deepgram forwards it to a custom endpoint is undocumented,
 * so it is deliberately NOT set for mercury-3. think.context_length
 * (custom-endpoint only) is a context-window cap, not a completion
 * budget, and is left at its default.
 * Fallback: think is an ARRAY — [mercury-3 + endpoint, managed
 * gpt-4o-mini] — the documented ordered fallback chain (same docs
 * page, "Using multiple LLM providers"): a failed/timed-out mercury-3
 * request warns THINK_REQUEST_FAILED and the turn retries on the
 * managed model; every turn starts again from mercury-3. Each entry
 * carries its own prompt + functions, as the schema requires. When no
 * LLM key is configured at all, think is a single managed gpt-4o-mini
 * object (the old behaviour) so the Settings shape is always valid —
 * the endpoint (and its auth header) exists only when a key exists.
 *
 * The agent's brain is mercury-3 (above) with a French prompt built
 * from the site's own data (menu, hours, address — never invented).
 * Two client-side functions run in this client: add_to_order
 * (deferred until end-of-turn: an order is a side effect) and
 * get_menu.
 *
 * Voice model note: Flux TTS only ships English voices, so the agent
 * speaks French text with the documented English Flux voice
 * flux-alexis-en. A French Aura-2 voice name was NOT guessed — a wrong
 * model name ends the session with an error. Swap the speak model once
 * a French voice is confirmed against the live model list.
 */

import { CAFE, MENU } from '../content'
import { avatarBridge, rmsOf, shapeMouthOpen, VISEME, type AvatarBridge } from './avatarBridge'
import { brainConfig } from './brain'

const AGENT_SOCKET_URL = 'wss://agent.deepgram.com/v1/agent/converse'
const GRANT_URL = 'https://api.deepgram.com/v1/auth/grant'
const TTS_SAMPLE_RATE = 24000

export type VoiceStatus = 'idle' | 'connecting' | 'live' | 'ended'

export type VoiceErrorReason =
  | 'no-token'
  | 'mic-denied'
  | 'mic-missing'
  | 'worklet-unsupported'
  | 'socket-error'
  | 'settings-rejected'

export interface VoiceOrderLine {
  name: string
  price: string
}

export interface VoiceAgentCallbacks {
  onStatus: (status: VoiceStatus, error?: VoiceErrorReason) => void
  onTranscript: (role: 'user' | 'assistant', text: string) => void
  onOrderAdded: (line: VoiceOrderLine) => void
}

/** Short menu summary for the agent prompt — built from content.ts. */
function menuSummary(): string {
  return MENU.map(
    (cat) => `${cat.label}: ${cat.items.map((i) => `${i.name} ${i.price}`).join(', ')}`,
  ).join('\n')
}

/** The agent's name: Nekomi, the barmaid (Live2D). */
export type VoicePersona = 'nekomi'

function agentPrompt(_persona: VoicePersona = 'nekomi'): string {
  return [
    `Tu es Nekomi, l\u2019agent de l\u2019Art du Rendez-Vous, un café-bar à Bruxelles.`,
    'Tu parles français, avec chaleur et concision — une ou deux phrases par réponse.',
    `Adresse : ${CAFE.address} (sur Google Maps, le lieu est listé sous « Casa da Santana »).`,
    'Horaires : à confirmer — aucun horaire n’est listé sur Google Maps pour ce lieu.',
    'La carte (noms et prix exacts, ne jamais inventer un prix) :',
    menuSummary(),
    'Tu conseilles selon les goûts, tu composes la commande avec la fonction add_to_order,',
    'et tu notes sa commande, prête à montrer au bar.',
    `Téléphone du café : ${CAFE.phone}. Aucun site web n’est listé : ne jamais en inventer.`,
  ].join('\n')
}

/** Inception mercury-3 as the Deepgram think provider (see the THINK
    note at the top of this file). */
const THINK_MODEL_PRIMARY = 'mercury-3'
const THINK_ENDPOINT_URL = 'https://api.inceptionlabs.ai/v1/chat/completions'
const THINK_MODEL_FALLBACK = 'gpt-4o-mini'
const THINK_TEMPERATURE = 0.7

/** The client-side functions the agent can call. */
function thinkFunctions(): Record<string, unknown>[] {
  return [
    {
      name: 'add_to_order',
      description: 'Ajoute une boisson de la carte à la commande du client.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nom exact de la boisson sur la carte' },
          quantity: { type: 'integer', description: 'Quantité, 1 par défaut' },
        },
        required: ['name'],
      },
      defer_until_eot: true,
    },
    {
      name: 'get_menu',
      description: 'Récupère la carte complète du café avec les prix.',
      parameters: { type: 'object', properties: {} },
    },
  ]
}

/**
 * Build the `think` value for the Settings message. Pure function of
 * the LLM key (read from env by the caller via brainConfig()), so the
 * fix-14 probe can drive it without env or network:
 * - No key: a single managed gpt-4o-mini think object (the old
 *   behaviour) — no endpoint, no auth header, always a valid shape.
 * - Key: the documented ordered fallback array — mercury-3 on the
 *   Inception endpoint first (endpoint is a SIBLING of provider, per
 *   Deepgram's voice-agent-llm-models docs and the AsyncAPI
 *   reference), managed gpt-4o-mini second. Each entry carries its
 *   own prompt + functions, as the schema requires.
 * No reasoning_effort / max_completion_tokens is set: the think
 * schema has no slot for either (see the THINK note above).
 */
export function buildThinkBlock(
  llmKey?: string,
  persona: VoicePersona = 'nekomi',
): Record<string, unknown> | Record<string, unknown>[] {
  const prompt = agentPrompt(persona)
  const functions = thinkFunctions()
  const fallback: Record<string, unknown> = {
    provider: { type: 'open_ai', model: THINK_MODEL_FALLBACK, temperature: THINK_TEMPERATURE },
    prompt,
    functions,
  }
  if (!llmKey) return fallback
  return [
    {
      provider: { type: 'open_ai', model: THINK_MODEL_PRIMARY, temperature: THINK_TEMPERATURE },
      endpoint: {
        url: THINK_ENDPOINT_URL,
        headers: { Authorization: `Bearer ${llmKey}` },
      },
      prompt,
      functions,
    },
    fallback,
  ]
}

export function settingsMessage(persona: VoicePersona = 'nekomi'): Record<string, unknown> {
  return {
    type: 'Settings',
    audio: {
      input: { encoding: 'linear16', sample_rate: 16000 },
      output: { encoding: 'linear16', sample_rate: 24000, container: 'none' },
    },
    agent: {
      listen: {
        provider: {
          type: 'deepgram',
          version: 'v2',
          model: 'flux-general-multi',
          language: 'fr',
          language_hints: ['fr', 'en'],
        },
      },
      think: buildThinkBlock(brainConfig().key, persona),
      speak: {
        provider: { type: 'deepgram', version: 'v2', model: 'flux-alexis-en' },
      },
      greeting: `Bonjour, je suis Nekomi, bienvenue à l\u2019Art du Rendez-Vous. Un café, une bière, un apéritif ? Dites-moi ce qui vous ferait plaisir.`,
    },
  }
}

interface GrantResponse {
  access_token?: string
  token?: string
}

/**
 * Mint a short-lived JWT. Same-origin grant endpoint first
 * (server/grant.mjs locally, api/deepgram/grant.ts on Vercel);
 * dev-only API-key grant second; otherwise throw, so the caller can
 * show the honest offline state.
 */
async function fetchGrantToken(): Promise<string> {
  try {
    const res = await fetch('/api/deepgram/grant', { method: 'POST' })
    if (res.ok) {
      const body = (await res.json()) as GrantResponse
      const token = body.access_token ?? body.token
      if (typeof token === 'string' && token.length > 0) return token
    }
  } catch {
    // No backend yet — fall through to the dev-only path below.
  }

  if (import.meta.env.DEV) {
    // DEV ONLY: the raw key is used here solely to mint a short-lived
    // grant token, never as socket auth. Stripped from production builds.
    const key = import.meta.env.VITE_DEEPGRAM_API_KEY as string | undefined
    if (!key) throw new Error('no-token')
    const res = await fetch(GRANT_URL, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl_seconds: 120 }),
    })
    if (!res.ok) throw new Error('no-token')
    const body = (await res.json()) as GrantResponse
    const token = body.access_token ?? body.token
    if (typeof token === 'string' && token.length > 0) return token
    throw new Error('no-token')
  }

  throw new Error('no-token')
}

function findMenuItem(name: string): VoiceOrderLine | null {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
  const needle = norm(name)
  for (const cat of MENU) {
    for (const item of cat.items) {
      const iname = norm(item.name)
      if (iname === needle || (iname.length > 2 && needle.includes(iname))) {
        return { name: item.name, price: item.price }
      }
    }
  }
  return null
}

/**
 * Map a getUserMedia failure to the honest reason. A refused permission
 * (NotAllowedError, SecurityError) is 'mic-denied'; no microphone on the
 * device — or one that cannot be read or satisfied (NotFoundError,
 * NotReadableError, OverconstrainedError) — is 'mic-missing'. Anything
 * unclassified keeps the old 'mic-denied' so no failure is ever silent.
 * getUserMedia rejects with a DOMException (not an Error subclass), so
 * the name is read off any object-like value.
 */
function micErrorReason(err: unknown): VoiceErrorReason {
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name: unknown }).name)
      : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'mic-denied'
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError')
    return 'mic-missing'
  return 'mic-denied'
}

export class DeepgramVoiceAgent {
  private callbacks: VoiceAgentCallbacks
  private bridge: AvatarBridge
  private persona: VoicePersona
  private ws: WebSocket | null = null
  private ctx: AudioContext | null = null
  private micStream: MediaStream | null = null
  private worklet: AudioWorkletNode | null = null
  private analyser: AnalyserNode | null = null
  private analyserBuf: Float32Array<ArrayBuffer> | null = null
  private activeSources = new Set<AudioBufferSourceNode>()
  private nextPlayTime = 0
  private mouthValue = 0
  private lastSampleAt = 0
  private rafId = 0
  private settingsApplied = false
  private running = false
  private stopped = false

  constructor(
    callbacks: VoiceAgentCallbacks,
    bridge: AvatarBridge = avatarBridge,
    persona: VoicePersona = 'nekomi',
  ) {
    this.callbacks = callbacks
    this.bridge = bridge
    this.persona = persona
  }

  isRunning(): boolean {
    return this.running
  }

  async start(): Promise<void> {
    if (this.running) return
    this.stopped = false
    this.callbacks.onStatus('connecting')

    // 1. Short-lived JWT FIRST (see the token note at the top of this
    //    file). If the grant endpoint is unreachable or the server
    //    has no valid key, this fails with 'no-token' — and it must
    //    fail BEFORE the microphone is touched, so a mic-less or
    //    denying browser never reports a mic error for what is really
    //    a missing token. No mic stream exists yet at this point, so
    //    there is nothing half-open to clean up; the cleanupMic() call
    //    stays as a guard.
    let token: string
    try {
      token = await fetchGrantToken()
    } catch {
      this.cleanupMic()
      this.callbacks.onStatus('ended', 'no-token')
      return
    }

    // 2. Microphone — only once a token exists. A device with no mic
    //    API at all has no microphone: 'mic-missing' without prompting.
    //    Failures are told apart by error name (see micErrorReason).
    if (!navigator.mediaDevices?.getUserMedia) {
      this.callbacks.onStatus('ended', 'mic-missing')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      this.callbacks.onStatus('ended', micErrorReason(err))
      return
    }
    this.micStream = stream

    // 3. Playback chain: sources -> AnalyserNode tap -> gain -> speakers.
    const ctx = new AudioContext()
    this.ctx = ctx
    const analyser = ctx.createAnalyser()
    analyser.fftSize = VISEME.FFT_SIZE
    const gain = ctx.createGain()
    gain.gain.value = 1
    analyser.connect(gain)
    gain.connect(ctx.destination)
    this.analyser = analyser
    this.analyserBuf = new Float32Array(analyser.fftSize)
    await ctx.resume().catch(() => undefined)

    // 4. Mic capture worklet (16 kHz mono PCM16). No worklet, no call.
    try {
      if (!ctx.audioWorklet) throw new Error('no-worklet')
      await ctx.audioWorklet.addModule('/worklets/pcm16-capture.js')
      const node = new AudioWorkletNode(ctx, 'pcm16-capture')
      node.port.onmessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; data?: ArrayBuffer; rms?: number }
        if (data.type === 'audio' && data.data && this.ws?.readyState === WebSocket.OPEN && this.settingsApplied) {
          this.ws.send(data.data)
        } else if (data.type === 'level' && typeof data.rms === 'number') {
          this.bridge.setMicLevel(Math.min(1, data.rms * 4))
        }
      }
      const source = ctx.createMediaStreamSource(stream)
      source.connect(node)
      this.worklet = node
    } catch {
      this.cleanupAll()
      this.callbacks.onStatus('ended', 'worklet-unsupported')
      return
    }

    // 5. Agent socket. Browsers cannot set headers on a WebSocket, so
    //    the JWT travels as the Sec-WebSocket-Protocol value.
    const ws = new WebSocket(AGENT_SOCKET_URL, ['bearer', token])
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.running = true
    this.lastSampleAt = performance.now()
    this.startVisemeLoop()

    ws.onopen = () => {
      // Nothing is sent before Welcome.
    }
    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        this.handleServerMessage(event.data)
      } else if (event.data instanceof ArrayBuffer) {
        this.playAgentAudio(event.data)
      }
    }
    ws.onerror = () => {
      if (!this.stopped) {
        this.cleanupAll()
        this.callbacks.onStatus('ended', 'socket-error')
      }
    }
    ws.onclose = () => {
      if (!this.stopped && this.running) {
        this.cleanupAll()
        this.callbacks.onStatus('ended', 'socket-error')
      }
    }
  }

  stop() {
    this.stopped = true
    this.cleanupAll()
    this.callbacks.onStatus('idle')
  }

  private handleServerMessage(raw: string) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    switch (msg.type) {
      case 'Welcome':
        this.ws?.send(JSON.stringify(settingsMessage(this.persona)))
        break
      case 'SettingsApplied':
        this.settingsApplied = true
        this.callbacks.onStatus('live')
        break
      case 'UserStartedSpeaking':
        // Barge-in: stop playback now and drop the buffered queue.
        this.stopPlayback()
        this.bridge.setMouthOpen(0)
        this.mouthValue = 0
        break
      case 'AgentStartedSpeaking':
        this.bridge.setSpeaking(true)
        break
      case 'AgentAudioDone':
        // The queue may still be playing; speaking ends when the last
        // scheduled source ends (handled in the viseme loop).
        break
      case 'ConversationText': {
        const role = msg.role === 'assistant' ? 'assistant' : 'user'
        const content = msg.content
        if (typeof content === 'string' && content.length > 0) {
          this.callbacks.onTranscript(role, content)
        }
        break
      }
      case 'FunctionCallRequest': {
        const calls = msg.functions
        if (Array.isArray(calls)) {
          for (const call of calls) {
            void this.handleFunctionCall(call as Record<string, unknown>)
          }
        }
        break
      }
      case 'FunctionCallCancelled':
        // The user started speaking again; nothing to roll back — the
        // deferred add_to_order never ran before end-of-turn.
        break
      case 'Error': {
        const code = typeof msg.code === 'string' ? msg.code : ''
        this.cleanupAll()
        this.callbacks.onStatus('ended', code === 'INVALID_SETTINGS' ? 'settings-rejected' : 'socket-error')
        break
      }
      default:
        break
    }
  }

  private async handleFunctionCall(call: Record<string, unknown>) {
    const id = typeof call.id === 'string' ? call.id : ''
    const name = typeof call.name === 'string' ? call.name : ''
    if (!id || !name) return
    let args: Record<string, unknown> = {}
    if (typeof call.arguments === 'string') {
      try {
        args = JSON.parse(call.arguments) as Record<string, unknown>
      } catch {
        args = {}
      }
    }
    let content: string
    if (name === 'add_to_order') {
      const itemName = typeof args.name === 'string' ? args.name : ''
      const quantity = typeof args.quantity === 'number' && args.quantity > 1 ? Math.floor(args.quantity) : 1
      const item = findMenuItem(itemName)
      if (item) {
        for (let i = 0; i < quantity; i++) this.callbacks.onOrderAdded(item)
        content = `${item.name} (${item.price}) ajouté à la commande${quantity > 1 ? `, ${quantity} fois` : ''}.`
      } else {
        content = `Je n'ai pas trouvé « ${itemName} » sur la carte.`
      }
    } else if (name === 'get_menu') {
      content = menuSummary()
    } else {
      content = `Fonction inconnue : ${name}.`
    }
    const response: Record<string, unknown> = {
      type: 'FunctionCallResponse',
      id,
      name,
      content,
    }
    if (typeof call.thought_signature === 'string') {
      response.thought_signature = call.thought_signature
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(response))
    }
  }

  private playAgentAudio(data: ArrayBuffer) {
    const ctx = this.ctx
    const analyser = this.analyser
    if (!ctx || !analyser) return
    const pcm = new Int16Array(data)
    if (pcm.length === 0) return
    const floats = new Float32Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) floats[i] = pcm[i] / 32768
    const buffer = ctx.createBuffer(1, floats.length, TTS_SAMPLE_RATE)
    buffer.copyToChannel(floats, 0)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(analyser)
    const startAt = Math.max(ctx.currentTime + 0.02, this.nextPlayTime)
    source.start(startAt)
    this.nextPlayTime = startAt + buffer.duration
    this.activeSources.add(source)
    this.bridge.setSpeaking(true)
    source.onended = () => {
      this.activeSources.delete(source)
      if (this.activeSources.size === 0 && this.nextPlayTime <= ctx.currentTime + 0.05) {
        this.bridge.setSpeaking(false)
      }
    }
  }

  private stopPlayback() {
    this.activeSources.forEach((source) => {
      try {
        source.stop()
      } catch {
        // Already stopped.
      }
    })
    this.activeSources.clear()
    if (this.ctx) this.nextPlayTime = this.ctx.currentTime
    this.bridge.setSpeaking(false)
  }

  /** Sample the playback analyser once per frame and drive the bridge. */
  private startVisemeLoop() {
    const tick = () => {
      if (!this.running) return
      const analyser = this.analyser
      const buf = this.analyserBuf
      if (analyser && buf) {
        analyser.getFloatTimeDomainData(buf)
        const now = performance.now()
        const dt = (now - this.lastSampleAt) / 1000
        this.lastSampleAt = now
        this.mouthValue = shapeMouthOpen(rmsOf(buf), this.mouthValue, dt)
        this.bridge.setMouthOpen(this.activeSources.size > 0 ? this.mouthValue : 0)
        if (this.activeSources.size === 0 && this.mouthValue === 0) {
          this.bridge.setSpeaking(false)
        }
      }
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private cleanupMic() {
    this.micStream?.getTracks().forEach((track) => track.stop())
    this.micStream = null
  }

  private cleanupAll() {
    this.running = false
    this.settingsApplied = false
    cancelAnimationFrame(this.rafId)
    this.stopPlayback()
    try {
      this.worklet?.port.close()
    } catch {
      // Already closed.
    }
    this.worklet = null
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      try {
        this.ws.close()
      } catch {
        // Already closing.
      }
    }
    this.ws = null
    this.cleanupMic()
    const ctx = this.ctx
    this.ctx = null
    this.analyser = null
    this.analyserBuf = null
    if (ctx) void ctx.close().catch(() => undefined)
    this.bridge.reset()
  }
}
