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
 * (["bearer", jwt]). This static site has no backend, so the token
 * provider is honest about that:
 *   (a) it first tries a same-origin POST /api/deepgram/grant endpoint
 *       — a TODO for the deploy phase. No such backend exists yet, so
 *       it 404s today and the voice button stays in its offline state.
 *   (b) it NEVER sends the raw API key to the agent socket and NEVER
 *       embeds it in the shipped bundle as socket auth. The only other
 *       path is local development: when import.meta.env.DEV is true,
 *       VITE_DEEPGRAM_API_KEY may be used to request a grant from the
 *       browser (POST https://api.deepgram.com/v1/auth/grant). That
 *       branch is dev-only and is stripped from production builds.
 *       A production build must NOT set VITE_DEEPGRAM_API_KEY.
 * When no token can be obtained, start() fails with reason 'no-token'
 * and the UI shows the honest offline state; the text chat keeps
 * working. The stored Deepgram key is currently rejected (401), so
 * voice is OFFLINE until Minir re-enters a working key — never claim
 * otherwise.
 *
 * The agent's brain is the Deepgram-managed LLM (gpt-4o-mini) with a
 * French prompt built from the site's own data (menu, hours, address —
 * never invented). Two client-side functions run in this client:
 * add_to_order (deferred until end-of-turn: an order is a side effect)
 * and get_menu. The freellm gateway is NOT wired here: Deepgram's
 * think endpoint can point at an OpenAI-compatible URL later, once the
 * gateway is back up — that is a deploy-phase change, not this file.
 *
 * Voice model note: Flux TTS only ships English voices, so the agent
 * speaks French text with the documented English Flux voice
 * flux-alexis-en. A French Aura-2 voice name was NOT guessed — a wrong
 * model name ends the session with an error. Swap the speak model once
 * a French voice is confirmed against the live model list.
 */

import { CAFE, MENU } from '../content'
import { avatarBridge, rmsOf, shapeMouthOpen, VISEME, type AvatarBridge } from './avatarBridge'

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

/** The agent's spoken/written name: 'vita' is the 3D barmaid, 'nekomi'
    the Live2D form — one and the same person (see content.ts CHARACTER). */
export type VoicePersona = 'vita' | 'nekomi'

function personaName(persona: VoicePersona): string {
  return persona === 'nekomi' ? 'Nekomi' : 'Vita'
}

function agentPrompt(persona: VoicePersona = 'vita'): string {
  return [
    `Tu es ${personaName(persona)}, l\u2019agent de l\u2019Art du Rendez-Vous, un café-bar à Bruxelles.`,
    'Tu parles français, avec chaleur et concision — une ou deux phrases par réponse.',
    `Adresse : ${CAFE.address} (sur Google Maps, le lieu est listé sous « Casa da Santana »).`,
    'Horaires : à confirmer — aucun horaire n’est listé sur Google Maps pour ce lieu.',
    'La carte (noms et prix exacts, ne jamais inventer un prix) :',
    menuSummary(),
    'Tu conseilles selon les goûts, tu composes la commande avec la fonction add_to_order,',
    'et tu proposes de rappeler le client pour confirmer sa commande.',
    `Téléphone du café : ${CAFE.phone}. Aucun site web n’est listé : ne jamais en inventer.`,
  ].join('\n')
}

function settingsMessage(persona: VoicePersona = 'vita'): Record<string, unknown> {
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
      think: {
        provider: { type: 'open_ai', model: 'gpt-4o-mini', temperature: 0.7 },
        prompt: agentPrompt(persona),
        functions: [
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
        ],
      },
      speak: {
        provider: { type: 'deepgram', version: 'v2', model: 'flux-alexis-en' },
      },
      greeting: `Bonjour, je suis ${personaName(persona)}, bienvenue à l\u2019Art du Rendez-Vous. Un café, une bière, un apéritif ? Dites-moi ce qui vous ferait plaisir.`,
    },
  }
}

interface GrantResponse {
  access_token?: string
  token?: string
}

/**
 * Mint a short-lived JWT. Same-origin grant endpoint first (deploy
 * phase — does not exist yet); dev-only API-key grant second; otherwise
 * throw, so the caller can show the honest offline state.
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
    persona: 'vita' | 'nekomi' = 'vita',
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
    //    file). There is no /api/deepgram/grant backend and production
    //    has no key, so this fails with 'no-token' today — and it must
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
