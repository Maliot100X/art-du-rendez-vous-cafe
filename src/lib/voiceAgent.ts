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
 * FIX PASS 17, GROUP 3 — MIC FIRST (root cause of the 00:03–00:08 CET
 * cloud-check failure): start() used to await the grant fetch FIRST
 * (1–2 s healthy, up to ~33 s with the fix-16 retries) and only then
 * call getUserMedia — so the mic prompt arrived seconds after the tap,
 * detached from the user gesture (Safari suppresses a gesture-less
 * mic request; Chrome is less reliable about it too), and in the
 * headless browser the cloud check used, getUserMedia auto-denied
 * with NotAllowedError and no prompt at all. The grant HAD succeeded
 * (a grant failure reports grant-*, never mic-*), but the UI could
 * only say "Micro non autorisé" — the code never recorded which step
 * was actually attempted, and micErrorReason mapped every
 * unclassified rejection to 'mic-denied'. So now: getUserMedia is
 * fired synchronously in start() — the first statement after the
 * 'connecting' status, still inside the tap's gesture — and the
 * grant fetch runs CONCURRENTLY (its result is only awaited once
 * the mic is in hand; a mic failure reports immediately and the
 * grant result is ignored). The connecting status carries the real
 * stage ('mic' | 'grant' | 'socket') so the UI says what is
 * happening, mic failures are classified against the live
 * permission state ('mic-blocked' when the browser has the mic
 * blocked for this site, 'mic-dismissed' when the prompt was
 * closed/auto-denied without a decision, 'mic-timeout' when the
 * prompt sits unanswered for 30 s), and a socket that opens but
 * never reaches SettingsApplied times out after 20 s
 * ('socket-timeout') instead of sticking on "Connexion…" forever.
 * A stop() mid-connect bumps the generation counter, so a late mic
 * grant or grant token can never start a call after the user ended
 * it (late mic tracks are stopped on arrival); ws.onmessage
 * likewise ignores frames that arrive after stop(), so a late
 * Welcome/SettingsApplied cannot flip an ended call to 'live'.
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
 * When no token can be obtained, start() fails with the real reason:
 * a GrantError (network / timeout / HTTP status / empty body) with
 * the attempt count, reported as reason 'grant-network' /
 * 'grant-timeout' / 'grant-http' / 'grant-empty' with the detail, so
 * the UI says what actually happened instead of the generic
 * "Deepgram n'a pas fourni de jeton d'appel". The plain 'no-token'
 * reason survives only for the dev-only fallback (no VITE key
 * configured). The same-origin fetch retries transient failures
 * (3 attempts, 10 s each, 1 s then 2 s backoff — see
 * GRANT_FETCH_ATTEMPTS below), because one tunnel/proxy flake used
 * to kill the whole call. The text chat keeps working. Voice stays
 * OFFLINE until the grant server runs with a valid key — never claim
 * otherwise.
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

// Fix pass 16, group 4: the same-origin grant fetch is the single point
// of failure for voice — the fix-15 cloud check showed one transient
// tunnel flake killing the whole call, because the fetch ran once with
// no timeout and no retry. So it now runs up to 3 attempts: each
// attempt gets a generous 10 s budget (a healthy tunnel POST takes
// ~1–2 s; the observed flake was a connection failure, not slowness),
// with 1 s then 2 s of backoff between attempts. Worst case the user
// sees "Connexion…" for ~33 s before the honest failure; the common
// case (first attempt works) is unchanged at ~1–2 s. Retried:
// network failures, timeouts, and HTTP 5xx (proxy/tunnel/upstream
// blips). NOT retried: HTTP 4xx (config/auth — the same request would
// fail again) and HTTP 200 with no token (server-side shape problem).
const GRANT_FETCH_ATTEMPTS = 3
const GRANT_FETCH_TIMEOUT_MS = 10_000
const GRANT_FETCH_BACKOFF_MS = [1000, 2000]

/** A grant fetch that gave up, carrying the real reason for the UI. */
class GrantError extends Error {
  readonly kind: GrantFailureKind
  readonly attempts: number
  readonly status?: number

  constructor(kind: GrantFailureKind, attempts: number, status?: number) {
    super(`grant-${kind} after ${attempts} attempt(s)${status ? ` (HTTP ${status})` : ''}`)
    this.name = 'GrantError'
    this.kind = kind
    this.attempts = attempts
    this.status = status
  }

  toDetail(): GrantFailureDetail {
    return { kind: this.kind, attempts: this.attempts, status: this.status }
  }
}

function grantReasonFor(kind: GrantFailureKind): VoiceErrorReason {
  switch (kind) {
    case 'network':
      return 'grant-network'
    case 'timeout':
      return 'grant-timeout'
    case 'http':
      return 'grant-http'
    case 'empty':
      return 'grant-empty'
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export type VoiceStatus = 'idle' | 'connecting' | 'live' | 'ended'

/**
 * Why the grant fetch gave up, for the honest offline message.
 * 'network' — fetch itself rejected (tunnel/proxy down, DNS, reset);
 * 'timeout' — the endpoint did not answer within one attempt's budget;
 * 'http' — the endpoint answered with an error status (see `status`);
 * 'empty' — HTTP 200 but no usable token in the body.
 * `attempts` is how many POSTs were made before giving up.
 */
export type GrantFailureKind = 'network' | 'timeout' | 'http' | 'empty'

export interface GrantFailureDetail {
  kind: GrantFailureKind
  attempts: number
  status?: number
}

export type VoiceErrorReason =
  | 'no-token'
  | 'grant-network'
  | 'grant-timeout'
  | 'grant-http'
  | 'grant-empty'
  | 'mic-denied'
  | 'mic-blocked'
  | 'mic-dismissed'
  | 'mic-missing'
  | 'mic-timeout'
  | 'worklet-unsupported'
  | 'socket-error'
  | 'socket-timeout'
  | 'settings-rejected'

/**
 * Which step a voice call is on while 'connecting' — the UI shows
 * the real step instead of the bare "Connexion…" (fix pass 17).
 * 'mic' — waiting on the microphone permission / device;
 * 'grant' — mic in hand, waiting on the same-origin grant fetch;
 * 'socket' — token in hand, waiting on the agent WebSocket
 * (Welcome → Settings → SettingsApplied).
 */
export type VoiceStage = 'mic' | 'grant' | 'socket'

export interface VoiceOrderLine {
  name: string
  price: string
}

export interface VoiceAgentCallbacks {
  onStatus: (
    status: VoiceStatus,
    error?: VoiceErrorReason,
    grantDetail?: GrantFailureDetail,
    stage?: VoiceStage,
  ) => void
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
 * (server/grant.mjs locally, api/deepgram/grant.ts on Vercel), retried
 * up to GRANT_FETCH_ATTEMPTS times with backoff (see the constants
 * above — one transient tunnel/proxy flake must not kill the call);
 * dev-only API-key grant second; otherwise throw, so the caller can
 * show the honest offline state. A same-origin failure throws a
 * GrantError carrying the real kind (network/timeout/http/empty), the
 * attempt count, and the HTTP status when there is one — the caller
 * reports that instead of the generic 'no-token'.
 */
async function fetchGrantToken(): Promise<string> {
  let lastError: GrantError | null = null
  for (let attempt = 1; attempt <= GRANT_FETCH_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), GRANT_FETCH_TIMEOUT_MS)
    try {
      const res = await fetch('/api/deepgram/grant', { method: 'POST', signal: controller.signal })
      if (res.ok) {
        let body: GrantResponse
        try {
          body = (await res.json()) as GrantResponse
        } catch {
          // 200 with an unreadable body is a server-side shape problem,
          // not a transient failure — no retry.
          throw new GrantError('empty', attempt)
        }
        const token = body.access_token ?? body.token
        if (typeof token === 'string' && token.length > 0) return token
        throw new GrantError('empty', attempt)
      }
      // 5xx from the proxy/tunnel/upstream is transient — retry.
      // 4xx is a config/auth problem — the same request would fail
      // again, so give up now with the real status.
      if (res.status >= 500) {
        lastError = new GrantError('http', attempt, res.status)
      } else {
        throw new GrantError('http', attempt, res.status)
      }
    } catch (err) {
      if (err instanceof GrantError) throw err
      // fetch rejected: an abort from our own timeout is 'timeout',
      // anything else (tunnel down, DNS, connection reset) is
      // 'network'. Both are transient — retry while attempts remain.
      const kind: GrantFailureKind =
        err instanceof DOMException && err.name === 'AbortError' ? 'timeout' : 'network'
      lastError = new GrantError(kind, attempt)
    } finally {
      clearTimeout(timer)
    }
    if (attempt < GRANT_FETCH_ATTEMPTS) {
      await sleep(GRANT_FETCH_BACKOFF_MS[attempt - 1] ?? 1000)
    }
  }
  // Same-origin retries exhausted. In dev only, fall back to the
  // direct grant with the dev key (as before — the same-origin path
  // may simply not exist yet in a bare dev setup). In production
  // there is no fallback: report the real same-origin failure.
  if (import.meta.env.DEV) {
    // DEV ONLY: the raw key is used here solely to mint a short-lived
    // grant token, never as socket auth. Stripped from production builds.
    const key = import.meta.env.VITE_DEEPGRAM_API_KEY as string | undefined
    if (!key) throw lastError ?? new GrantError('network', GRANT_FETCH_ATTEMPTS)
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

  throw lastError ?? new GrantError('network', GRANT_FETCH_ATTEMPTS)
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
 * Fix pass 17: how long an unanswered mic prompt may keep the call
 * on "Connexion…" (30 s — a real user needs time to find the prompt;
 * headless auto-deny resolves in ms, so this only bites a prompt
 * nobody answers), and how long the agent socket may stay open
 * without reaching SettingsApplied (20 s — a healthy handshake is
 * ~1 s; past that the socket is wedged, not slow).
 */
const MIC_PROMPT_TIMEOUT_MS = 30_000
const SOCKET_HANDSHAKE_TIMEOUT_MS = 20_000

/**
 * Live microphone permission state, for telling the failures apart
 * (fix pass 17). Returns null when the Permissions API is absent or
 * the query throws — the caller then falls back to the raw error
 * name, never to a guess.
 */
async function micPermissionState(): Promise<'granted' | 'prompt' | 'denied' | null> {
  try {
    const perms = navigator.permissions
    if (!perms?.query) return null
    const result = await perms.query({ name: 'microphone' })
    if (result.state === 'granted' || result.state === 'prompt' || result.state === 'denied') {
      return result.state
    }
    return null
  } catch {
    return null
  }
}

/**
 * Map a getUserMedia failure to the honest reason (fix pass 17 —
 * the old version mapped EVERYTHING unclassified to 'mic-denied',
 * so "blocked in site settings", "prompt dismissed" and "headless
 * auto-deny with no prompt shown" all rendered as the same
 * "Micro non autorisé"). A refused permission (NotAllowedError,
 * SecurityError) is classified against the live permission state:
 * 'denied' means the browser has the mic blocked for this site
 * ('mic-blocked' — the user must re-enable it in site settings,
 * retrying alone will never help); 'prompt' means the prompt was
 * closed or auto-denied without a decision ('mic-dismissed' — the
 * user can simply retry and answer it). No microphone on the device
 * — or one that cannot be read or satisfied (NotFoundError,
 * NotReadableError, OverconstrainedError) — is 'mic-missing'.
 * SecurityError (insecure context, or an iframe without
 * allow="microphone") and anything unclassified keep the old
 * 'mic-denied' so no failure is ever silent. getUserMedia rejects
 * with a DOMException (not an Error subclass), so the name is read
 * off any object-like value.
 */
async function classifyMicError(err: unknown): Promise<VoiceErrorReason> {
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name: unknown }).name)
      : ''
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError')
    return 'mic-missing'
  if (name === 'SecurityError') return 'mic-denied'
  if (name === 'NotAllowedError') {
    const state = await micPermissionState()
    if (state === 'denied') return 'mic-blocked'
    if (state === 'prompt') return 'mic-dismissed'
    return 'mic-denied'
  }
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
  // Fix pass 17: every start() takes a generation number; stop() and
  // any terminal failure bump it, so a late mic grant, a late grant
  // token or a late socket event from an abandoned start() can never
  // resurrect a call the user already ended.
  private generation = 0
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null

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
    this.generation += 1
    const gen = this.generation
    const stale = () => gen !== this.generation
    this.callbacks.onStatus('connecting', undefined, undefined, 'mic')

    // 1. Microphone FIRST, synchronously in the tap's gesture (fix
    //    pass 17 — see the file header). The old order awaited the
    //    grant fetch first, so the prompt arrived seconds after the
    //    tap, detached from the gesture, and a headless browser
    //    auto-denied with no prompt at all. Nothing is awaited
    //    before this call. A device with no mic API at all has no
    //    microphone: 'mic-missing' without prompting and without
    //    spending a grant fetch.
    if (!navigator.mediaDevices?.getUserMedia) {
      this.callbacks.onStatus('ended', 'mic-missing')
      return
    }
    const micPromise = navigator.mediaDevices.getUserMedia({ audio: true })

    // 2. Grant fetch, CONCURRENTLY — its result is only awaited once
    //    the mic is in hand (step 3). A mic failure reports
    //    immediately and the grant result is ignored (the minted
    //    token, if any, simply expires unused — no key is ever in
    //    the browser). The same-origin fetch still retries transient
    //    failures (fix pass 16, group 4).
    const grantPromise = fetchGrantToken()

    // The mic prompt may sit unanswered: race it against a timeout
    // so the call never sticks on "Connexion…" forever. A late mic
    // grant (user answers after we gave up, or after stop()) must
    // never start a call — its tracks are stopped on arrival.
    const micResult = await Promise.race([
      micPromise.then(
        (stream) => ({ ok: true as const, stream }),
        async (err) => ({ ok: false as const, reason: await classifyMicError(err) }),
      ),
      sleep(MIC_PROMPT_TIMEOUT_MS).then(
        () => ({ ok: false as const, reason: 'mic-timeout' as const }),
      ),
    ])
    if (!micResult.ok) {
      void micPromise.then(
        (stream) => stream.getTracks().forEach((track) => track.stop()),
        () => undefined,
      )
      void grantPromise.catch(() => undefined)
      // stop() may have run while the prompt was open — it already
      // reported 'idle', so do not overwrite it with 'ended'.
      if (!stale()) this.callbacks.onStatus('ended', micResult.reason)
      return
    }
    if (stale()) {
      // stop() ran while the prompt was open — do not keep the mic.
      micResult.stream.getTracks().forEach((track) => track.stop())
      void grantPromise.catch(() => undefined)
      return
    }
    const stream = micResult.stream
    this.micStream = stream

    // 3. Short-lived JWT (see the token note at the top of this
    //    file). The same-origin grant fetch retries transient failures
    //    (fix pass 16, group 4), so a single tunnel/proxy flake no
    //    longer kills the call. If it still fails, the GrantError
    //    carries the real reason (network/timeout/HTTP status/empty)
    //    and the attempt count, and that — not the generic 'no-token'
    //    — is what the UI shows. A plain Error('no-token') still
    //    means the dev-only fallback had no key configured. The mic
    //    stream is already open at this point, so a grant failure
    //    stops its tracks (cleanupMic) — never leave a live mic
    //    behind on a failed call.
    this.callbacks.onStatus('connecting', undefined, undefined, 'grant')
    let token: string
    try {
      token = await grantPromise
    } catch (err) {
      this.cleanupMic()
      if (stale()) return
      if (err instanceof GrantError) {
        this.callbacks.onStatus('ended', grantReasonFor(err.kind), err.toDetail())
      } else {
        this.callbacks.onStatus('ended', 'no-token')
      }
      return
    }
    if (stale()) {
      this.cleanupMic()
      return
    }

    // 4. Playback chain: sources -> AnalyserNode tap -> gain -> speakers.
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
    if (stale()) {
      this.cleanupAll()
      return
    }

    // 5. Mic capture worklet (16 kHz mono PCM16). No worklet, no call.
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
      if (!stale()) this.callbacks.onStatus('ended', 'worklet-unsupported')
      return
    }
    if (stale()) {
      this.cleanupAll()
      return
    }

    // 6. Agent socket. Browsers cannot set headers on a WebSocket, so
    //    the JWT travels as the Sec-WebSocket-Protocol value.
    this.callbacks.onStatus('connecting', undefined, undefined, 'socket')
    const ws = new WebSocket(AGENT_SOCKET_URL, ['bearer', token])
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.running = true
    this.lastSampleAt = performance.now()
    this.startVisemeLoop()
    // Handshake timeout (fix pass 17): a socket that opens but never
    // reaches SettingsApplied used to stick on "Connexion…" forever.
    // A healthy handshake is ~1 s; past 20 s the socket is wedged.
    this.clearHandshakeTimer()
    this.handshakeTimer = setTimeout(() => {
      this.handshakeTimer = null
      if (!this.stopped && this.running && !this.settingsApplied && gen === this.generation) {
        this.cleanupAll()
        this.callbacks.onStatus('ended', 'socket-timeout')
      }
    }, SOCKET_HANDSHAKE_TIMEOUT_MS)

    ws.onopen = () => {
      // Nothing is sent before Welcome.
    }
    ws.onmessage = (event: MessageEvent) => {
      // Fix pass 17: a frame already in flight when stop() runs can
      // still be delivered after cleanup (the socket close is async)
      // — a late Welcome/SettingsApplied must not resurrect the call
      // to 'live' after the user ended it. ws.onerror/onclose already
      // check this.stopped; onmessage did not, and the probe caught
      // a late SettingsApplied flipping an ended call to 'live'.
      if (this.stopped) return
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
    // Invalidate any start() still awaiting the mic prompt, the grant
    // fetch or the socket handshake (fix pass 17) — its late
    // continuations check the generation and stand down.
    this.generation += 1
    this.cleanupAll()
    this.callbacks.onStatus('idle')
  }

  private clearHandshakeTimer() {
    if (this.handshakeTimer !== null) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
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
        this.clearHandshakeTimer()
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
    this.clearHandshakeTimer()
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
