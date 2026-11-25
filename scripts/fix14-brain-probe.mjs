#!/usr/bin/env node
/**
 * FIX PASS 14, GROUP D — brain probe (no network, no key).
 *
 * Bundles the REAL src/lib/brain.ts with Vite (import.meta.env stubbed
 * to {} so no key/env leaks in) and asserts the Inception mercury-3
 * wiring:
 *   - defaults are https://api.inceptionlabs.ai/v1 + mercury-3
 *   - mercury-3 body: max_completion_tokens 512 + reasoning_effort
 *     "instant", NO max_tokens, NO temperature
 *   - non-mercury body: temperature 0.7, max_completion_tokens, NO
 *     reasoning_effort
 *   - isMercuryModel() also fires on an Inception base URL
 *
 * Run: node scripts/fix14-brain-probe.mjs   (exit 0 = all pass)
 */
import { build } from 'vite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(join(tmpdir(), 'fix14-brain-probe-'))

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

await build({
  configFile: false,
  root,
  logLevel: 'silent',
  define: { 'import.meta.env': '{}' },
  build: {
    lib: { entry: join(root, 'src/lib/brain.ts'), formats: ['es'], fileName: 'brain' },
    outDir,
    emptyOutDir: true,
  },
})

const brain = await import(pathToFileURL(join(outDir, 'brain.js')).href)
rmSync(outDir, { recursive: true, force: true })

const msgs = [{ role: 'user', content: 'Bonjour' }]

// 1. Defaults (no env vars at all): Inception + mercury-3, no key.
const cfg = brain.brainConfig()
check('default baseUrl is Inception', cfg.baseUrl === 'https://api.inceptionlabs.ai/v1', cfg.baseUrl)
check('default model is mercury-3', cfg.model === 'mercury-3', cfg.model)
check('no key configured without env', cfg.key === undefined, String(cfg.key))
check('brain not configured without key', brain.isBrainConfigured() === false)

// 2. mercury-3 body (proven call shape).
const mercury = brain.buildChatBody('mercury-3', cfg.baseUrl, msgs)
check('mercury body: max_completion_tokens 512', mercury.max_completion_tokens === 512, String(mercury.max_completion_tokens))
check('mercury body: reasoning_effort instant', mercury.reasoning_effort === 'instant', String(mercury.reasoning_effort))
check('mercury body: NO max_tokens', !('max_tokens' in mercury))
check('mercury body: NO temperature', !('temperature' in mercury))
check('mercury body: model mercury-3', mercury.model === 'mercury-3')
check('mercury body: messages pass through', Array.isArray(mercury.messages) && mercury.messages.length === 1)

// 3. Inception base URL alone also triggers the reasoning shape.
check(
  'inception base URL counts as mercury',
  brain.isMercuryModel('some-other-model', 'https://api.inceptionlabs.ai/v1') === true,
)
const viaBase = brain.buildChatBody('some-other-model', 'https://api.inceptionlabs.ai/v1', msgs)
check('inception-base body: reasoning_effort instant', viaBase.reasoning_effort === 'instant')
check('inception-base body: NO temperature', !('temperature' in viaBase))

// 4. Non-mercury model keeps the old behaviour (minus max_tokens).
const other = brain.buildChatBody('gpt-4o-mini', 'https://api.openai.com/v1', msgs)
check('non-mercury body: temperature 0.7', other.temperature === 0.7, String(other.temperature))
check('non-mercury body: max_completion_tokens 300', other.max_completion_tokens === 300, String(other.max_completion_tokens))
check('non-mercury body: NO reasoning_effort', !('reasoning_effort' in other))
check('non-mercury body: NO max_tokens', !('max_tokens' in other))
check('non-mercury body: model kept', other.model === 'gpt-4o-mini')

// 5. Menu grounding + honesty rule untouched (source-level guard: the
//    prompt still forbids inventing a price; brainLive still starts off).
const prompt = brain.brainSystemPrompt('nekomi')
check('system prompt still forbids inventing a price', prompt.includes('ne jamais inventer un prix'))
check('brainWasLive() starts false', brain.brainWasLive() === false)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
