#!/usr/bin/env node
/**
 * FIX PASS 15, GROUP 2 — live-brain probe (node, no network, no key).
 *
 * Root cause under test (measured, fix 15): Agent.tsx built the LLM
 * history by passing the chat's role 'bot' straight through a lying
 * `as` cast, and brain.ts copied history roles verbatim into the
 * request body — so EVERY Agent chat call sent { role: "bot" } (not a
 * valid chat-completions role), the API answered 400, and askBrain()
 * silently fell back to the canned offline reply. The initial bot
 * greeting is always in the transcript, so even the first user
 * message failed — with a key configured and CORS fine.
 *
 * Bundles the REAL src/lib/brain.ts with Vite (import.meta.env fed a
 * fake key via process.env, fetch stubbed — no network, no real key)
 * and asserts:
 *   - exact URL https://api.inceptionlabs.ai/v1/chat/completions
 *     (no doubled /v1) + mercury-3 body (reasoning_effort instant,
 *     max_completion_tokens 512, NO max_tokens, NO temperature)
 *   - the greeting path reaches askBrain and sends NO role 'bot':
 *     the bot turn arrives as role 'assistant', the reply is the LLM
 *     text (not the canned greeting), source 'llm', brainWasLive true
 *   - the response parser handles the real mercury-3 success shape
 *     AND the content-null shape (finish_reason "length",
 *     reasoning_details present): one retry with a doubled budget
 *     recovers to 'llm'; a second null still falls back offline
 *     without crashing
 *   - offline fallback still works when fetch throws or the API
 *     answers non-200 (incl. the old bug's 400): offline reply, no
 *     crash
 *   - source guards: Agent.tsx maps 'bot' -> 'assistant' and no
 *     longer passes m.role through; brain.ts normalises at the
 *     boundary (apiChatRole)
 *
 * Run: node scripts/fix15-brain-probe.mjs   (exit 0 = all pass)
 */
import { build } from 'vite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Home disk, not /tmp (512 MB tmpfs): the bundle is small but the
// worktree rule is explicit — keep probe scratch on the home disk.
const outDir = mkdtempSync(join(root, '.fix15-probe-'))

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// brain.ts uses window.setTimeout/clearTimeout (browser API) — stub
// it before the bundle is imported; fetch is stubbed per test below.
globalThis.window = { setTimeout, clearTimeout }

let fetchQueue = []
let fetchCalls = []
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, body: JSON.parse(init.body) })
  const next = fetchQueue.shift()
  if (!next) throw new Error('unexpected fetch call (no stub queued)')
  return next(url, init)
}
const okJson = (json) => ({ ok: true, status: 200, json: async () => json })
const errStatus = (status) => ({ ok: false, status, json: async () => ({ error: { message: 'bad request' } }) })

const mercurySuccess = (text) => ({
  id: 'chatcmpl-probe',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: text },
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 120,
    completion_tokens: 40,
    total_tokens: 160,
    completion_tokens_details: { reasoning_tokens: 12 },
  },
  reasoning_details: [{ type: 'reasoning.text', text: 'raisonnement…' }],
})

// The proven mercury-3 failure shape: reasoning eats the budget,
// content comes back null with finish_reason "length".
const mercuryContentNull = () => ({
  id: 'chatcmpl-probe',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: null },
      finish_reason: 'length',
    },
  ],
  usage: {
    prompt_tokens: 120,
    completion_tokens: 512,
    total_tokens: 632,
    completion_tokens_details: { reasoning_tokens: 500 },
  },
  reasoning_details: [{ type: 'reasoning.text', text: 'raisonnement…' }],
})

// The key comes from a FAKE env var, not define: Vite only exposes
// VITE_* variables from process.env / .env files to import.meta.env,
// and brain.ts reads the key via a dynamic index
// (import.meta.env[name]), which a define cannot stub. This value is
// a dummy string — no real key, no network (fetch is stubbed below).
process.env.VITE_LLM_API_KEY = 'probe-fake-key'

await build({
  configFile: false,
  root,
  logLevel: 'silent',
  build: {
    lib: { entry: join(root, 'src/lib/brain.ts'), formats: ['es'], fileName: 'brain' },
    outDir,
    emptyOutDir: true,
  },
})

const brain = await import(pathToFileURL(join(outDir, 'brain.js')).href)
rmSync(outDir, { recursive: true, force: true })

const LLM_TEXT = 'Bien sûr ! Pour un vin rouge, je vous conseille le Bordeaux 75 CL à 9,00 €.'

// 0. Honesty rule: brainLive starts false (checked BEFORE any success).
check('brainWasLive() starts false', brain.brainWasLive() === false)
check('key configured from stubbed env', brain.isBrainConfigured() === true)

// 1. Default body contract unchanged (fix 14 must keep passing).
const msgs = [{ role: 'user', content: 'Bonjour' }]
const mercury = brain.buildChatBody('mercury-3', 'https://api.inceptionlabs.ai/v1', msgs)
check('mercury body: max_completion_tokens 512', mercury.max_completion_tokens === 512)
check('mercury body: reasoning_effort instant', mercury.reasoning_effort === 'instant')
check('mercury body: NO max_tokens', !('max_tokens' in mercury))
check('mercury body: NO temperature', !('temperature' in mercury))

// 2. Role normaliser at the API boundary.
check("apiChatRole('bot') is 'assistant'", brain.apiChatRole('bot') === 'assistant')
check("apiChatRole('user') is 'user'", brain.apiChatRole('user') === 'user')
check("apiChatRole('assistant') is 'assistant'", brain.apiChatRole('assistant') === 'assistant')
check("apiChatRole('system') is 'assistant'", brain.apiChatRole('system') === 'assistant')

// 3. Source guards: the root-cause line is gone, the fix is in place.
const agentSrc = readFileSync(join(root, 'src/components/Agent.tsx'), 'utf8')
check(
  "Agent.tsx maps 'bot' -> 'assistant'",
  agentSrc.includes("m.role === 'bot' ? 'assistant'"),
)
check(
  'Agent.tsx no longer passes m.role through a cast',
  !agentSrc.includes('({ role: m.role, text: m.text }) as'),
)
const brainSrc = readFileSync(join(root, 'src/lib/brain.ts'), 'utf8')
check('brain.ts normalises history roles via apiChatRole', brainSrc.includes('apiChatRole(t.role)'))

// 4. THE root-cause test: a greeting message with the Agent's real
//    history shape (initial bot greeting, role 'bot') must reach the
//    API with NO role 'bot' and come back as the LLM reply.
fetchQueue = [async () => okJson(mercurySuccess(LLM_TEXT))]
fetchCalls = []
const greetingHistory = [{ role: 'bot', text: 'Bonjour ! Bienvenue à l’Art du Rendez-Vous.' }]
const greeting = await brain.askBrain('bonjour, quel vin rouge conseilles-tu ?', greetingHistory)
check('greeting path: exactly one fetch call', fetchCalls.length === 1, String(fetchCalls.length))
const call = fetchCalls[0]
check(
  'greeting path: exact URL, no doubled /v1',
  call.url === 'https://api.inceptionlabs.ai/v1/chat/completions',
  call.url,
)
check('greeting path: URL has no /v1/v1', !call.url.includes('/v1/v1'))
check('greeting path: body model mercury-3', call.body.model === 'mercury-3')
check('greeting path: body reasoning_effort instant', call.body.reasoning_effort === 'instant')
check('greeting path: body max_completion_tokens 512', call.body.max_completion_tokens === 512)
check('greeting path: body NO max_tokens', !('max_tokens' in call.body))
check('greeting path: body NO temperature', !('temperature' in call.body))
const roles = call.body.messages.map((m) => m.role)
check(
  'greeting path: NO role \'bot\' on the wire',
  !roles.includes('bot'),
  JSON.stringify(roles),
)
check(
  'greeting path: roles only system/user/assistant',
  roles.every((r) => ['system', 'user', 'assistant'].includes(r)),
  JSON.stringify(roles),
)
check(
  'greeting path: bot history turn sent as assistant',
  call.body.messages.some((m) => m.role === 'assistant' && m.content.includes('Bienvenue')),
)
check('greeting path: source is llm', greeting.source === 'llm', greeting.source)
check('greeting path: reply is the LLM text, not canned', greeting.reply.text === LLM_TEXT, greeting.reply.text)
check('greeting path: brainWasLive() now true', brain.brainWasLive() === true)

// 5. Content-null shape: first call null/length, retry recovers to llm.
fetchQueue = [async () => okJson(mercuryContentNull()), async () => okJson(mercurySuccess(LLM_TEXT))]
fetchCalls = []
const retry = await brain.askBrain('je veux un vin rouge pas cher', [])
check('content-null retry: source is llm', retry.source === 'llm', retry.source)
check('content-null retry: two fetch calls', fetchCalls.length === 2, String(fetchCalls.length))
check(
  'content-null retry: 2nd call doubles budget to 1024',
  fetchCalls[1]?.body.max_completion_tokens === 1024,
  String(fetchCalls[1]?.body.max_completion_tokens),
)
check(
  'content-null retry: 2nd call still instant, no temperature/max_tokens',
  fetchCalls[1]?.body.reasoning_effort === 'instant' &&
    !('temperature' in fetchCalls[1].body) &&
    !('max_tokens' in fetchCalls[1].body),
)
check('content-null retry: reply is the LLM text', retry.reply.text === LLM_TEXT)

// 6. Content-null twice: falls back offline, no crash, no empty reply.
fetchQueue = [async () => okJson(mercuryContentNull()), async () => okJson(mercuryContentNull())]
fetchCalls = []
let twice = null
let threw = false
try {
  twice = await brain.askBrain('je veux un vin rouge pas cher', [])
} catch {
  threw = true
}
check('content-null twice: no crash', threw === false)
check('content-null twice: source is offline', twice?.source === 'offline', String(twice?.source))
check('content-null twice: offline reply is non-empty', typeof twice?.reply.text === 'string' && twice.reply.text.length > 0)

// 7. Fetch throws (API unreachable): offline reply, no crash.
fetchQueue = [
  async () => {
    throw new Error('network down')
  },
]
fetchCalls = []
let down = null
threw = false
try {
  down = await brain.askBrain('bonjour', [])
} catch {
  threw = true
}
check('fetch throws: no crash', threw === false)
check('fetch throws: source is offline', down?.source === 'offline', String(down?.source))
check('fetch throws: offline reply is non-empty', typeof down?.reply.text === 'string' && down.reply.text.length > 0)

// 8. Non-200 (400 — the old bug's symptom): offline reply, no crash.
fetchQueue = [async () => errStatus(400)]
fetchCalls = []
let bad = null
threw = false
try {
  bad = await brain.askBrain('bonjour', [])
} catch {
  threw = true
}
check('HTTP 400: no crash', threw === false)
check('HTTP 400: source is offline', bad?.source === 'offline', String(bad?.source))
check('HTTP 400: offline reply is non-empty', typeof bad?.reply.text === 'string' && bad.reply.text.length > 0)

// 9. Real mercury-3 success shape (reasoning_details + usage): llm.
fetchQueue = [async () => okJson(mercurySuccess(`  ${LLM_TEXT}  `))]
fetchCalls = []
const ok = await brain.askBrain('quel vin rouge conseilles-tu ?', [])
check('mercury success shape: source is llm', ok.source === 'llm', ok.source)
check('mercury success shape: reply trimmed', ok.reply.text === LLM_TEXT, JSON.stringify(ok.reply.text))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
