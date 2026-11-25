// Fix pass 14, Group E — Deepgram think-provider probe.
//
// Drives the REAL settings-building code in src/lib/voiceAgent.ts
// (buildThinkBlock + settingsMessage) headless, with no network and
// no keys: the small TS closure (content, agentBrain, avatarBridge,
// brain, voiceAgent) is transpiled with the repo's tsc CLI into a
// temp dir, relative imports extension-fixed for Node ESM, and
// import.meta.env stubbed to a probe-controlled global (the emitted
// code reads env only through that stub — the source is untouched).
//
// Checks:
//   A  No LLM key: think is a single managed gpt-4o-mini object,
//      no endpoint, no auth header (the old behaviour, always valid).
//   B  Key present: think is the documented ordered fallback array —
//      [0] mercury-3 on the Inception endpoint (endpoint a SIBLING
//      of provider, url + Bearer header from the key), [1] managed
//      gpt-4o-mini with no endpoint; both carry the same prompt +
//      functions; no reasoning_effort / max_completion_tokens /
//      reasoning_mode / context_length anywhere (the schema has no
//      slot for the first two; reasoning_mode is deliberately unset).
//   C  The full settingsMessage() wires the env key through
//      brainConfig(): VITE_LLM_API_KEY wins, VITE_FREELLM_API_KEY is
//      the fallback alias, and no key means the no-key shape.
//      listen (flux-general-multi v2, fr) and speak (flux-alexis-en
//      v2) are unchanged.
//   D  Source scan: no hardcoded key anywhere — the only 'Bearer' in
//      voiceAgent.ts is the `Bearer ${llmKey}` template; endpoint is
//      never nested inside provider; no reasoning params in source.
//
// Usage: node scripts/fix14-think-probe.mjs  (from the repo root)
// Exit 0 = all checks pass, 1 = at least one fails.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

// --- Transpile the real closure into a temp dir. ---------------------------
// TypeScript 7's JS API no longer exposes transpileModule, so the probe
// shells out to the repo's tsc CLI (type errors do not stop emit; the
// `npm run build` typecheck is the authority on types). The emitted
// .js files get their relative imports extension-fixed for Node ESM
// and import.meta.env stubbed to a probe-controlled global (the
// emitted code reads env only through that stub — the source is
// untouched). The temp dir gets {"type":"module"} so .js imports as ESM.
import { execFileSync } from 'node:child_process'
const files = ['content', 'agentBrain', 'avatarBridge', 'brain', 'voiceAgent']
const outDir = mkdtempSync(join(tmpdir(), 'fix14-think-probe-'))
writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'module' }))
const tscBin = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const entryFiles = files.map((name) =>
  name === 'content' ? join(root, 'src', 'content.ts') : join(root, 'src', 'lib', `${name}.ts`),
)
try {
  execFileSync(process.execPath, [
    tscBin,
    '--ignoreConfig',
    ...entryFiles,
    '--target', 'es2022',
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    '--lib', 'es2022,dom,dom.iterable',
    '--skipLibCheck',
    '--outDir', outDir,
  ], { stdio: 'pipe' })
} catch (err) {
  // tsc exits non-zero on type errors but still emits; only the
  // missing outputs below are fatal. Keep stderr for the report.
  if (err.stdout?.length) process.stderr.write(err.stdout)
  if (err.stderr?.length) process.stderr.write(err.stderr)
}
for (const name of files) {
  // tsc preserves the src/ layout: content.js at the top, lib/*.js below.
  const outPath =
    name === 'content' ? join(outDir, 'content.js') : join(outDir, 'lib', `${name}.js`)
  let js
  try {
    js = readFileSync(outPath, 'utf8')
  } catch {
    console.error(`FAIL  tsc did not emit ${name}.js — aborting probe`)
    process.exit(1)
  }
  js = js
    .replaceAll('import.meta.env', '(globalThis.__PROBE_ENV ?? {})')
    .replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g, (_, q, p) => `from ${q}${p}.js${q}`)
  writeFileSync(outPath, js)
}
const voiceAgent = await import(pathToFileURL(join(outDir, 'lib', 'voiceAgent.js')).href)
const { buildThinkBlock, settingsMessage } = voiceAgent

const fnNames = (think) =>
  Array.isArray(think.functions) ? think.functions.map((f) => f.name) : []

// --- A. No key: single managed provider. -----------------------------------
{
  const think = buildThinkBlock(undefined)
  check('A1  no key: think is a single object, not an array', !Array.isArray(think))
  check('A2  no key: provider is open_ai / gpt-4o-mini / 0.7',
    think.provider?.type === 'open_ai' &&
      think.provider?.model === 'gpt-4o-mini' &&
      think.provider?.temperature === 0.7)
  check('A3  no key: no endpoint key present', !('endpoint' in think))
  check('A4  no key: prompt + both functions present',
    typeof think.prompt === 'string' && think.prompt.includes('Nekomi') &&
      fnNames(think).join(',') === 'add_to_order,get_menu')
}

// --- B. Key present: fallback array, endpoint sibling of provider. --------
{
  const think = buildThinkBlock('probe-inception-key-abc')
  check('B1  key: think is an array of 2', Array.isArray(think) && think.length === 2)
  const [first, second] = think
  check('B2  key: [0] provider is open_ai / mercury-3 / 0.7',
    first.provider?.type === 'open_ai' &&
      first.provider?.model === 'mercury-3' &&
      first.provider?.temperature === 0.7)
  check('B3  key: [0] endpoint is a SIBLING of provider (not inside it)',
    first.endpoint !== undefined && first.provider?.endpoint === undefined)
  check('B4  key: [0] endpoint url is the Inception chat-completions URL',
    first.endpoint?.url === 'https://api.inceptionlabs.ai/v1/chat/completions')
  check('B5  key: [0] auth header is Bearer + the key passed in',
    first.endpoint?.headers?.Authorization === 'Bearer probe-inception-key-abc')
  check('B6  key: [1] is managed gpt-4o-mini with NO endpoint',
    second.provider?.type === 'open_ai' &&
      second.provider?.model === 'gpt-4o-mini' &&
      !('endpoint' in second))
  check('B7  key: both entries carry the same prompt + functions',
    first.prompt === second.prompt &&
      JSON.stringify(first.functions) === JSON.stringify(second.functions) &&
      fnNames(first).join(',') === 'add_to_order,get_menu')
  const flat = JSON.stringify(think)
  check('B8  key: no reasoning_effort / max_completion_tokens / reasoning_mode / context_length anywhere',
    !/reasoning_effort|max_completion_tokens|reasoning_mode|context_length/.test(flat))
}

// --- C. Full settingsMessage() through the real env wiring. ---------------
{
  globalThis.__PROBE_ENV = {}
  const plain = settingsMessage()
  check('C1  Settings, no env key: think is the single managed object',
    !Array.isArray(plain.agent?.think) &&
      plain.agent?.think?.provider?.model === 'gpt-4o-mini' &&
      !('endpoint' in plain.agent.think))
  check('C2  Settings: listen + speak unchanged',
    plain.agent?.listen?.provider?.model === 'flux-general-multi' &&
      plain.agent?.listen?.provider?.version === 'v2' &&
      plain.agent?.listen?.provider?.language === 'fr' &&
      plain.agent?.speak?.provider?.model === 'flux-alexis-en' &&
      plain.agent?.speak?.provider?.version === 'v2')
  check('C3  Settings: type + audio shape unchanged',
    plain.type === 'Settings' &&
      plain.audio?.input?.encoding === 'linear16' &&
      plain.audio?.output?.container === 'none')

  globalThis.__PROBE_ENV = { VITE_LLM_API_KEY: 'probe-inception-key-abc' }
  const keyed = settingsMessage()
  check('C4  Settings, VITE_LLM_API_KEY set: think is the mercury-3 array',
    Array.isArray(keyed.agent?.think) &&
      keyed.agent.think[0]?.provider?.model === 'mercury-3' &&
      keyed.agent.think[0]?.endpoint?.headers?.Authorization === 'Bearer probe-inception-key-abc' &&
      keyed.agent.think[1]?.provider?.model === 'gpt-4o-mini')

  globalThis.__PROBE_ENV = { VITE_FREELLM_API_KEY: 'probe-freellm-key' }
  const alias = settingsMessage()
  check('C5  Settings, legacy VITE_FREELLM_API_KEY alias is honoured',
    Array.isArray(alias.agent?.think) &&
      alias.agent.think[0]?.endpoint?.headers?.Authorization === 'Bearer probe-freellm-key')

  globalThis.__PROBE_ENV = {
    VITE_LLM_API_KEY: 'probe-inception-key-abc',
    VITE_FREELLM_API_KEY: 'probe-freellm-key',
  }
  const both = settingsMessage()
  check('C6  Settings: VITE_LLM_API_KEY wins over the legacy alias',
    both.agent.think[0]?.endpoint?.headers?.Authorization === 'Bearer probe-inception-key-abc')
  delete globalThis.__PROBE_ENV
}

// --- D. Source scan: no hardcoded key, endpoint never inside provider. ---
{
  const src = readFileSync(join(root, 'src', 'lib', 'voiceAgent.ts'), 'utf8')
  // D1/D2 scan CODE, not comments: the header comment legitimately
  // documents "Bearer <VITE_LLM_API_KEY>" and names reasoning_effort /
  // max_completion_tokens to say they are NOT wired.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])(\/\/.*)$/gm, '$1')
  const bearerUses = [...code.matchAll(/Bearer [^\n]*/g)].map((m) => m[0].trim())
  check('D1  source: the only Bearer use is the `Bearer ${llmKey}` template',
    bearerUses.length === 1 && bearerUses[0].includes('${llmKey}'))
  check('D2  source: no sk- / inception key literal, no reasoning params',
    !/sk-[A-Za-z0-9]/.test(code) && !/reasoning_effort|max_completion_tokens/.test(code))
  check('D3  source: endpoint url + mercury-3 present as constants only',
    src.includes("const THINK_ENDPOINT_URL = 'https://api.inceptionlabs.ai/v1/chat/completions'") &&
      src.includes("const THINK_MODEL_PRIMARY = 'mercury-3'"))
  check('D4  source: provider objects never contain an endpoint field',
    !/provider:\s*\{[^}]*endpoint/s.test(src))
}

console.log(failures === 0 ? '\nfix14-think-probe: ALL CHECKS PASSED' : `\nfix14-think-probe: ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
