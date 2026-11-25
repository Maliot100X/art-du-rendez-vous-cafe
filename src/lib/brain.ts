import { CAFE, CHARACTER, MENU } from '../content'
import { actionsForReplyText, botReply, expressionForReply, parseBudget, type BotReply } from './agentBrain'
import { getAgentStatus, markBrainLive } from './agentStatus'

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
 *   VITE_LLM_BASE_URL   — OpenAI-compatible base URL (default https://api.inceptionlabs.ai/v1)
 *   VITE_LLM_MODEL      — chat model (default mercury-3; "auto" for the freellm gateway)
 * Legacy aliases, honoured when the VITE_LLM_* vars are unset:
 *   VITE_FREELLM_API_KEY / VITE_FREELLM_BASE_URL (the freellm gateway is
 *   OpenAI-compatible, so it plugs in here unchanged; model then defaults
 *   to "auto").
 *
 * Request-body rule (mercury-3 is a reasoning model — proven 2026-11-25):
 * the body uses `max_completion_tokens` (never the deprecated
 * `max_tokens`) + `reasoning_effort: "instant"`. With default reasoning
 * and a small max_tokens budget the model spends everything reasoning
 * and returns content NULL with finish_reason "length". Temperature is
 * omitted for mercury-3 (reasoning models reject non-default
 * temperature); non-mercury models keep temperature 0.7.
 * reasoning_effort is sent ONLY for mercury-3 (or an Inception base
 * URL) — a non-reasoning model would reject it.
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
    'https://api.inceptionlabs.ai/v1'
  // The freellm gateway serves model "auto" (and "auto:fast"); other
  // OpenAI-compatible endpoints default to mercury-3 (Inception).
  const model = envString('VITE_LLM_MODEL') ?? (fromFreellm ? 'auto' : 'mercury-3')
  return { key, baseUrl: baseUrl.replace(/\/+$/, ''), model }
}

/** True when a key is configured. Says nothing about reachability. */
export function isBrainConfigured(): boolean {
  return Boolean(brainConfig().key)
}

// Fix pass 16, group 3: the live flag lives in the single shared
// agent-status store (src/lib/agentStatus.ts), NOT here. The old
// module-level `brainLive` in this file was the truth no component
// ever read — Agent and MenuGuide each kept their own useState copy,
// which is how the pill and the banner disagreed and how the pill
// reverted on tab navigation. askBrain() below calls markBrainLive()
// on a successful LLM call, so EVERY caller (Agent chat, menu
// mini-chat, App's "Demander à la barmaid") flips the one shared
// truth, and every surface reads it through useAgentStatus().

/** True only after at least one LLM call has succeeded in this session. */
export function brainWasLive(): boolean {
  return getAgentStatus().brainLive
}

function menuSummary(): string {
  return MENU.map(
    (cat) => `${cat.label}: ${cat.items.map((i) => `${i.name} ${i.price}`).join(', ')}`,
  ).join('\n')
}

/** System prompt — built from the site's own data, never retyped. The
    persona comes from the character card (src/content.ts CHARACTER):
    Nekomi, the barmaid. The first line always leads with her name. */
export function brainSystemPrompt(_persona: 'nekomi' = 'nekomi'): string {
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

/** True for the Inception reasoning model (by name or by base URL). */
export function isMercuryModel(model: string, baseUrl: string): boolean {
  return model === 'mercury-3' || baseUrl.includes('inceptionlabs')
}

const MERCURY_MAX_COMPLETION_TOKENS = 512
const DEFAULT_MAX_COMPLETION_TOKENS = 300

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Build the chat-completions request body for a model + base URL.
 * mercury-3 (reasoning model): max_completion_tokens 512 (the proven
 * value) + reasoning_effort "instant", NO temperature, NO max_tokens.
 * Any other model: temperature 0.7 + max_completion_tokens 300, and
 * never reasoning_effort (a non-reasoning model would reject it).
 * `maxTokensOverride` is only for the fix-15 content-null retry (a
 * doubled budget on the second attempt); callers that omit it get
 * exactly the proven default shape.
 */
export function buildChatBody(
  model: string,
  baseUrl: string,
  messages: ChatMessage[],
  maxTokensOverride?: number,
): Record<string, unknown> {
  if (isMercuryModel(model, baseUrl)) {
    return {
      model,
      reasoning_effort: 'instant',
      max_completion_tokens: maxTokensOverride ?? MERCURY_MAX_COMPLETION_TOKENS,
      messages,
    }
  }
  return {
    model,
    temperature: 0.7,
    max_completion_tokens: maxTokensOverride ?? DEFAULT_MAX_COMPLETION_TOKENS,
    messages,
  }
}

/**
 * Map any caller-side turn role to a valid OpenAI chat-completions
 * role. The chat UI stores bot turns as role 'bot' — that string is
 * NOT a valid chat-completions role, and sending it makes the API
 * answer 400, which askBrain() then swallows as an offline fallback
 * (fix 15: every Agent chat call failed this way — the initial bot
 * greeting is always in the history, so even the first user message
 * 400'd — and the brain never went live even with a key configured
 * and CORS fine). Anything that is not the user is the assistant.
 */
export function apiChatRole(role: string): 'user' | 'assistant' {
  return role === 'user' ? 'user' : 'assistant'
}

interface ChatCompletionsResponse {
  choices?: { message?: { content?: unknown } }[]
}

/** One OpenAI-compatible chat-completions call. Throws on any failure. */
async function callLlm(
  message: string,
  history: ChatTurn[],
  persona: 'nekomi' = 'nekomi',
): Promise<string> {
  const { key, baseUrl, model } = brainConfig()
  if (!key) throw new Error('no-key')
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('bad-base-url')

  // Exact URL the browser sends (no doubled /v1 — the base already
  // ends in /v1): https://api.inceptionlabs.ai/v1/chat/completions
  const url = `${baseUrl}/chat/completions`
  const messages: ChatMessage[] = [
    { role: 'system', content: brainSystemPrompt(persona) },
    // History roles are normalised here (see apiChatRole): a caller
    // passing role 'bot' must never reach the wire again.
    ...history.slice(-6).map((t) => ({ role: apiChatRole(t.role), content: t.text })),
    { role: 'user', content: message },
  ]

  // One attempt: POST the proven mercury-3 shape and parse the reply.
  // Throws 'empty-reply' when choices[0].message.content is null or
  // blank — the proven mercury-3 shape when reasoning eats the token
  // budget (finish_reason "length", reasoning_details present).
  const postOnce = async (maxTokens?: number): Promise<string> => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(buildChatBody(model, baseUrl, messages, maxTokens)),
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

  try {
    return await postOnce()
  } catch (err) {
    // mercury-3 content-null retry (fix 15): the first call can come
    // back with content null when reasoning consumes the 512-token
    // budget — retry ONCE with a doubled budget instead of silently
    // falling back to the canned offline reply. Any other failure
    // (no key, 4xx/5xx, timeout) still falls through to offline.
    if (err instanceof Error && err.message === 'empty-reply' && isMercuryModel(model, baseUrl)) {
      return await postOnce(MERCURY_MAX_COMPLETION_TOKENS * 2)
    }
    throw err
  }
}

/**
 * Ask the brain. Returns the LLM reply when the key is configured and
 * the call succeeds; otherwise the offline rule-based reply — same
 * shape, so the expression + lip-sync path never changes.
 * The `actions` (tap-to-add buttons) come from the LLM reply's own
 * text when it names menu items (fix 16: the LLM text already
 * respects a stated budget, so the chips must be a subset of what it
 * lists — the old code took the offline brain's actions, whose fixed
 * favourites ignored the budget entirely); otherwise they fall back
 * to the offline brain's read of the same message, which is itself
 * budget-filtered (see agentBrain.botReply).
 */
export async function askBrain(
  message: string,
  history: ChatTurn[] = [],
  opts?: { persona?: 'nekomi' },
): Promise<BrainResult> {
  const clean = message.trim()
  if (!clean) return { reply: botReply(''), source: 'offline' }
  const offline = botReply(clean)
  try {
    const text = await callLlm(clean, history, opts?.persona ?? 'nekomi')
    // Fix pass 16, group 3: flip the ONE shared truth — every status
    // surface (Agent pill, LA CARTE banner, chat hint) reads it from
    // the agent-status store, so no caller has to remember to set its
    // own local copy (and none may: there is no local copy any more).
    // (The old module-level `brainLive = true` is gone: the store owns it.)
    markBrainLive()
    const budget = parseBudget(clean)
    const fromText = actionsForReplyText(text, budget)
    return {
      reply: {
        text,
        actions: fromText.length > 0 ? fromText : offline.actions,
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
