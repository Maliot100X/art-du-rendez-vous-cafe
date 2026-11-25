/**
 * FIX PASS 13 — open-loop viseme probe. NOT shipped.
 *
 * Drives the REAL src/lib/speechViseme.ts + src/lib/avatarBridge.ts +
 * src/lib/speech.ts (transpiled on the fly with the project's tsc —
 * same pattern as scripts/fix10-lipsync-probe.mjs) through a stubbed
 * browser engine, in the scenarios that matter for BUG 4:
 *   A. NEVER-STARTS — `speechSynthesis.speaking` stays false forever
 *      (no voices installed / headless — the pixel check heard
 *      "Nothing played" in 12 s). The mouth MUST still move through
 *      the word-timed viseme schedule (open-loop from ~800 ms) and
 *      return to 0 when the beats are done. This is the bug: before
 *      fix 13 the 2500 ms watchdog killed the tick and the mouth
 *      stayed 0 for the whole reading.
 *   B. LATE-START — the engine flips `speaking` true at ~1500 ms,
 *      mid open-loop run. The clock MUST re-sync (restart from now)
 *      and switch back to engine mode: the mouth must still be
 *      moving after the open-loop-only end time, and must close once
 *      the beats are done AND the engine is quiet.
 *   C. PROMPT-START (regression) — the engine starts at ~80 ms, as
 *      on a real phone. The mouth must start from the real audio
 *      (first opening well before 800 ms) and end at 0 — no visible
 *      lead from the fallback.
 *   D. Pure `SpeechViseme.restart()` unit check: restarting
 *      re-anchors the clock to the first beat.
 *
 * Usage: node scripts/fix13-viseme-probe.mjs (exit 0 = all pass)
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(path.join(tmpdir(), 'fix13-harness-'))
execFileSync(path.join(root, 'node_modules', '.bin', 'tsc'), [
  path.join(root, 'src', 'lib', 'speechViseme.ts'),
  path.join(root, 'src', 'lib', 'avatarBridge.ts'),
  path.join(root, 'src', 'lib', 'speech.ts'),
  '--ignoreConfig',
  '--target', 'es2022',
  '--module', 'esnext',
  '--moduleResolution', 'bundler',
  '--outDir', outDir,
  '--skipLibCheck',
], { stdio: 'inherit' })
// tsc does not rewrite extensionless relative imports; Node ESM needs
// the extension. The emitted files are throwaway (tmp dir).
for (const f of ['speech.js']) {
  const p = path.join(outDir, f)
  writeFileSync(
    p,
    readFileSync(p, 'utf8')
      .replaceAll("from './avatarBridge'", "from './avatarBridge.js'")
      .replaceAll("from './speechViseme'", "from './speechViseme.js'"),
  )
}

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const countUpCrossings = (series, level) => {
  let n = 0
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] < level && series[i] >= level) n++
  }
  return n
}

// ------------------------------------------------- stubbed browser engine
// Fake rAF (16ms setTimeout) + fake speechSynthesis + fake utterance.
// `speaking` is driven per-scenario by the probe, never by the stub.
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) {
    this.text = text
    this.lang = ''
    this.voice = null
    this.rate = 1
    this.pitch = 1
    this.onstart = null
    this.onboundary = null
    this.onend = null
    this.onerror = null
  }
}
const synth = {
  speaking: false,
  pending: false,
  getVoices: () => [],
  addEventListener: () => {},
  cancel: () => { synth.speaking = false; synth.pending = false },
  speak: (u) => { synth._utter = u },
  _utter: null,
}
globalThis.window = { speechSynthesis: synth }

const visemeMod = await import(path.join(outDir, 'speechViseme.js'))
const { SpeechViseme } = visemeMod
const bridgeMod = await import(path.join(outDir, 'avatarBridge.js'))
const { avatarBridge } = bridgeMod
const speechMod = await import(path.join(outDir, 'speech.js'))
const { speak, stopSpeaking, shortenForSpeech } = speechMod

const TEXT = 'Boissons chaudes — café, chocolat, cappuccino.'
const short = shortenForSpeech(TEXT)
const clock = new SpeechViseme(short, 1)
const DUR_MS = clock.totalSeconds * 1000
console.log(`beat clock: ${clock.beats.length} beats, ${clock.totalSeconds.toFixed(2)}s (${Math.round(DUR_MS)} ms)`)

// ------------------------------------------------------- D: restart() unit
{
  const v = new SpeechViseme(short, 1)
  const t0 = 100000
  v.start(t0)
  const mid = v.sample(t0 + 1500)
  check('D1 restart() re-anchors the clock to the first beat',
    mid.beatIndex > 0, `mid-run beat ${mid.beatIndex}`)
  v.restart(t0 + 2000)
  const after = v.sample(t0 + 2100)
  check('D2 after restart the clock is back at beat 0 with the mouth opening',
    after.beatIndex === 0 && after.mouth > 0.1,
    `beat ${after.beatIndex} mouth ${after.mouth.toFixed(2)}`)
  const v2 = new SpeechViseme(short, 1)
  v2.start(5000)
  v2.noteBoundary(short.indexOf('chocolat'), 5600)
  v2.restart(6000)
  const afterRestart = v2.sample(6100)
  check('D3 restart() clears any boundary shift',
    afterRestart.beatIndex === 0, `beat ${afterRestart.beatIndex} (boundary shift cleared)`)
}

/** Drive one scenario; returns timestamped mouth samples. */
async function runScenario(mode, waitMs) {
  stopSpeaking()
  synth.speaking = false
  synth.pending = false
  const series = []
  const t0 = performance.now()
  const poll = setInterval(() => {
    series.push({ t: performance.now() - t0, m: avatarBridge.getMouthOpen(), v: avatarBridge.getMouthVowel(), s: avatarBridge.isSpeaking() })
  }, 50)
  speak(short)
  if (mode === 'late-start') {
    // Engine starts at ~1500 ms, mid open-loop run; goes quiet when
    // the RESTARTED beats finish (~1500 + DUR + margin).
    setTimeout(() => { synth.speaking = true; synth._utter?.onstart?.() }, 1500)
    setTimeout(() => { synth.speaking = false }, 1500 + DUR_MS + 600)
  } else if (mode === 'prompt-start') {
    setTimeout(() => { synth.speaking = true; synth._utter?.onstart?.() }, 80)
    setTimeout(() => { synth.speaking = false }, 80 + DUR_MS + 600)
  }
  // never-starts: nothing ever happens — speaking stays false forever.
  await sleep(waitMs)
  clearInterval(poll)
  const tail = { m: avatarBridge.getMouthOpen(), s: avatarBridge.isSpeaking() }
  stopSpeaking()
  return { series, tail }
}

// ------------------------------------------------------- A: never starts
{
  // Open-loop starts ~800 ms + beats DUR, plus margin for the poll.
  const { series, tail } = await runScenario('never-starts', 800 + DUR_MS + 1600)
  const mouths = series.map((p) => p.m)
  const max = Math.max(...mouths)
  const vowels = new Set(series.map((p) => p.v).filter(Boolean))
  const everSpeaking = series.some((p) => p.s)
  const firstOpen = series.find((p) => p.m >= 0.1)
  const firstOpenMs = firstOpen ? Math.round(firstOpen.t) : -1
  const lastOpen = [...series].reverse().find((p) => p.m >= 0.1)
  const lastOpenMs = lastOpen ? Math.round(lastOpen.t) : -1
  check('A1 never-starts: mouth moves through the beats (max>=0.4, >=3 opens, >=2 vowels, speaking seen, ends at 0)',
    max >= 0.4 && countUpCrossings(mouths, 0.3) >= 3 && vowels.size >= 2 && everSpeaking && tail.m === 0 && !tail.s,
    `max ${max.toFixed(2)} opens ${countUpCrossings(mouths, 0.3)} vowels ${[...vowels].join('')} speaking ${everSpeaking} end ${tail.m}`)
  check('A2 never-starts: mouth first opens only after the ~800 ms fallback threshold (no instant flap)',
    firstOpenMs >= 700 && firstOpenMs <= 1400,
    `first open at ${firstOpenMs} ms`)
  check('A3 never-starts: mouth keeps moving until the beats finish (~800 ms + beats, not killed at 2500 ms)',
    lastOpenMs >= 800 + DUR_MS - 600,
    `last open at ${lastOpenMs} ms, beats end ~${Math.round(800 + DUR_MS)} ms`)
}

// ------------------------------------------------------- B: late start
{
  const openLoopEndMs = 800 + DUR_MS // when a no-resync run would end
  const { series, tail } = await runScenario('late-start', 1500 + DUR_MS + 1600)
  const mouths = series.map((p) => p.m)
  const max = Math.max(...mouths)
  const stillOpenAfterOpenLoopEnd = series.some((p) => p.t > openLoopEndMs + 400 && p.m >= 0.1)
  const maxAfterOpenLoopEnd = Math.max(...series.filter((p) => p.t > openLoopEndMs + 400).map((p) => p.m), 0)
  check('B1 late-start: mouth moves (max>=0.4, >=3 opens, ends at 0)',
    max >= 0.4 && countUpCrossings(mouths, 0.3) >= 3 && tail.m === 0 && !tail.s,
    `max ${max.toFixed(2)} opens ${countUpCrossings(mouths, 0.3)} end ${tail.m}`)
  check('B2 late-start: clock re-syncs — mouth still moving after the open-loop-only end time',
    stillOpenAfterOpenLoopEnd,
    `open-loop would end ~${Math.round(openLoopEndMs)} ms, max mouth after that ${maxAfterOpenLoopEnd.toFixed(2)}`)
}

// ------------------------------------------------------- C: prompt start
{
  const { series, tail } = await runScenario('prompt-start', 80 + DUR_MS + 1600)
  const mouths = series.map((p) => p.m)
  const max = Math.max(...mouths)
  const firstOpen = series.find((p) => p.m >= 0.1)
  const firstOpenMs = firstOpen ? Math.round(firstOpen.t) : -1
  check('C1 prompt-start: mouth moves from the real audio (max>=0.4, >=3 opens, ends at 0)',
    max >= 0.4 && countUpCrossings(mouths, 0.3) >= 3 && tail.m === 0 && !tail.s,
    `max ${max.toFixed(2)} opens ${countUpCrossings(mouths, 0.3)} end ${tail.m}`)
  check('C2 prompt-start: first opening is well before the 800 ms fallback (no visible lead)',
    firstOpenMs >= 0 && firstOpenMs < 700,
    `first open at ${firstOpenMs} ms`)
}

console.log(failures === 0 ? '\nALL FIX13 CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
