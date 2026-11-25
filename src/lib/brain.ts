import { CAFE, CHARACTER, MENU } from '../content'
import { botReply, expressionForReply, type BotReply } from './agentBrain'

/**
 * LLM-brain adapter for the café live agent (text chat).
 *
 * The key is NOT here yet — Minir will give it later. Until then this
 * module behaves exactly like the offline rule-based brain: every call
 * falls back to agentBrain.botReply, and the UI keeps its honest
 * "hors ligne" state. Nothing in this file ever logs or ships a key.
 *
 * Env vars (see BRAIN-SETUP.md at the project root):
 *   VITE_LLM_API_KEY    — the LLM API key (primary)
 *   VITE_LLM_BASE_URL   — OpenAI-compatible base URL (default https://api.openai.com/v1)
 *   VITE_LLM_MODEL      — chat model (default gpt-4o-mini; "auto" for the freellm gateway)
 * Legacy aliases, honoured when the VITE_LLM_* vars are unset:
 *   VITE_FREELLM_API_KEY / VITE_FREELLM_BASE_URL (the freellm gateway is
 *   OpenAI-compatible, so it plugs in here unchanged; model then defaults
 *   to "auto").
 *
 * When a key IS configured, askBrain() POSTs an OpenAI-compatible
 * chat-completions request whose system prompt is built from the site's
 * own data (menu + prices from content.ts MENU, hours + address from
 * VISIT / CAFE, order flow) — the brain knows the café and never has to
 * invent a price, an hour or an address. On ANY failure (no key, bad
 * URL, network error, non-2xx, timeout, empty reply) it falls back
 * silently to the offline brain, returning the same BotReply shape
 * (text + optional actions + expression) so callers never care which
 * brain answered — the expression + lip-sync path is identical.
 *
 * Honesty rule: only a successful LLM call flips the brain to "live".
 * A configured key alone proves nothing (a dead gateway or a wrong key
 * still answers offline), so the UI must only claim "cerveau connecté"
 * after askBrain() has returned source 'llm' at least once.
 */

export type BrainSource = 'llm' | 'offline'

export interface BrainResult {
  reply: BotReply
  source: BrainSource
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

const LLM_TIMEOUT_MS = 12_000
const MAX_REPLY_CHARS = 1200

function envString(name: string): string | undefined {
  const v = (import.meta.env as Record<string, unknown>)[name]
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

export interface BrainConfig {
  key?: string
  baseUrl: string
  model: string
}

/** Read the config from env only. No key is ever hardcoded here. */
export function brainConfig(): BrainConfig {
  const key = envString('VITE_LLM_API_KEY') ?? envString('VITE_FREELLM_API_KEY')
  const fromFreellm = !envString('VITE_LLM_API_KEY') && Boolean(envString('VITE_FREELLM_API_KEY'))
  const baseUrl =
    envString('VITE_LLM_BASE_URL') ??
    envString('VITE_FREELLM_BASE_URL') ??
    'https://api.openai.com/v1'
  // The freellm gateway serves model "auto" (and "auto:fast"); plain
  // OpenAI-compatible endpoints default to gpt-4o-mini.
  const model = envString('VITE_LLM_MODEL') ?? (fromFreellm ? 'auto' : 'gpt-4o-mini')
  return { key, baseUrl: baseUrl.replace(/\/+$/, ''), model }
}

/** True when a key is configured. Says nothing about reachability. */
export function isBrainConfigured(): boolean {
  return Boolean(brainConfig().key)
}

// Set to true only by a successful LLM call (see askBrain). Module-level
// so both chat surfaces (Agent tab + menu mini-chat) share the truth.
let brainLive = false

/** True only after at least one LLM call has succeeded in this session. */
export function brainWasLive(): boolean {
  return brainLive
}

function menuSummary(): string {
  return MENU.map(
    (cat) => `${cat.label}: ${cat.items.map((i) => `${i.name} ${i.price}`).join(', ')}`,
  ).join('\n')
}

/** System prompt — built from the site's own data, never retyped. The
    persona comes from the character card (src/content.ts CHARACTER):
    Nekomi, the barmaid. The first line always leads with her name. */
export function brainSystemPrompt(_persona: 'vita' | 'nekomi' = 'nekomi'): string {
  const name = CHARACTER.name
  const firstLine = `Tu es ${name}, ${CHARACTER.role}, un café-bar à Bruxelles.`
  return [
    firstLine,
    CHARACTER.personality,
    CHARACTER.scenario,
    `Adresse : ${CAFE.address} (sur Google Maps, le lieu est listé sous « Casa da Santana »).`,
    'Horaires : à confirmer — aucun horaire n’est listé sur Google Maps pour ce lieu.',
    'La carte (noms et prix exacts, ne jamais inventer un prix) :',
    menuSummary(),
    'Tu conseilles selon les goûts du client. Quand tu proposes une boisson, cite son nom exact tel qu\u2019il figure sur la carte, avec son prix.',
    'Si le client veut commander, confirme les boissons et leurs prix, puis propose de préparer la commande : l\u2019interface affiche des boutons « Ajouter » à côté de ta réponse.',
    `Téléphone du café : ${CAFE.phone}. Aucun site web n’est listé : ne jamais en inventer.`,
  ].join('\n')
}

interface ChatCompletionsResponse {
  choices?: { message?: { content?: unknown } }[]
}

/** One OpenAI-compatible chat-completions call. Throws on any failure. */
async function callLlm(
  message: string,
  history: ChatTurn[],
  persona: 'vita' | 'nekomi' = 'nekomi',
): Promise<string> {
  const { key, baseUrl, model } = brainConfig()
  if (!key) throw new Error('no-key')
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('bad-base-url')

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 300,
        messages: [
          { role: 'system', content: brainSystemPrompt(persona) },
          ...history.slice(-6).map((t) => ({ role: t.role, content: t.text })),
          { role: 'user', content: message },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`llm-${res.status}`)
    const body = (await res.json()) as ChatCompletionsResponse
    const content = body.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim().length === 0) throw new Error('empty-reply')
    return content.trim().slice(0, MAX_REPLY_CHARS)
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * Ask the brain. Returns the LLM reply when the key is configured and
 * the call succeeds; otherwise the offline rule-based reply — same
 * shape, so the expression + lip-sync path never changes.
 * The `actions` (tap-to-add buttons) come from the offline brain's read
 * of the same message: the LLM names the drinks, the buttons add them.
 */
export async function askBrain(
  message: string,
  history: ChatTurn[] = [],
  opts?: { persona?: 'vita' | 'nekomi' },
): Promise<BrainResult> {
  const clean = message.trim()
  if (!clean) return { reply: botReply(''), source: 'offline' }
  const offline = botReply(clean)
  try {
    const text = await callLlm(clean, history, opts?.persona ?? 'nekomi')
    brainLive = true
    return {
      reply: {
        text,
        actions: offline.actions,
        expression: expressionForReply(text),
      },
      source: 'llm',
    }
  } catch {
    // No key, dead endpoint, timeout, bad key, empty reply — the chat
    // keeps working offline. The key is never logged.
    return { reply: offline, source: 'offline' }
  }
}
