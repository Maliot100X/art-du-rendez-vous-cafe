/**
 * Fix pass 14 probe — reading survives leaving LA CARTE.
 *
 * Run from the repo root:  node scripts/fix14-reading-probe.mjs
 * Exit 0 = all checks pass, 1 = at least one fails.
 *
 * The bug: the reading lived in the menu hook's local state (reading
 * useState, readingTimerRef, pendingOpenRef, replyArrivedRef) plus a
 * useEffect cleanup that cleared the timer, stopped the voice and
 * dropped the pending big-book open on unmount. App mounts only the
 * active tab, so leaving LA CARTE mid-reading killed the timer, the
 * pending open and the book flip — no flip, no bookEvents emit, no
 * Bières log entry in the Agent chat, and the line reset to the
 * greeting on the next mount.
 *
 * The fix: src/lib/readingStore.ts holds the reading + timer + pending
 * open + line at module level (same pattern as Agent.tsx's chat
 * persistence); MenuGuide.tsx only mirrors it. The finish handler is
 * App's openBook, registered in the store and deliberately never
 * unregistered, so a reading finishing while the visitor is on AGENT
 * still switches them to the Livre tab (the existing pending-open
 * flow) and flips the book to the reading's category.
 *
 * Dynamic checks (real logic, real timers, no pixels — this VM has
 * no WebGL2): the store + bookEvents are transpiled with the repo's
 * own tsc into a temp dir under ~/.cache and imported into node.
 * "Unmount" is simulated by simply dropping every hook reference:
 * the store is module-level, so there is no hook left to tear the
 * reading down — that IS the fix under test.
 *
 * Static checks: the hook holds no timer/pending state any more,
 * the category effect still reads the line only (fix pass 13), the
 * first-click behaviour is intact, and the Agent log-entry dedupe
 * that the finished reading feeds into is unchanged.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

/** Slice of `src` between two markers (first occurrence each). */
function sliceBetween(src, start, end) {
  const i = src.indexOf(start)
  if (i === -1) return null
  const j = end ? src.indexOf(end, i + start.length) : src.length
  return src.slice(i, j === -1 ? src.length : j)
}

// ---------------------------------------------------------------------
// Transpile the dependency-free store + bookEvents with the repo's tsc.
// ---------------------------------------------------------------------
const tmpDir = mkdtempSync(join(homedir(), '.cache', 'fix14-reading-probe-'))
let store
let events
try {
  const tsc = join(root, 'node_modules', '.bin', 'tsc')
  execFileSync(
    tsc,
    [
      'src/lib/readingStore.ts',
      'src/lib/bookEvents.ts',
      '--outDir',
      tmpDir,
      '--module',
      'esnext',
      '--target',
      'es2022',
      '--moduleResolution',
      'bundler',
      '--skipLibCheck',
      '--ignoreConfig',
    ],
    { cwd: root, stdio: 'pipe' },
  )
  store = await import(pathToFileURL(join(tmpDir, 'readingStore.js')).href)
  events = await import(pathToFileURL(join(tmpDir, 'bookEvents.js')).href)
} catch (err) {
  console.log(`FAIL  setup — could not transpile/import the store: ${err.message}`)
  process.exit(1)
}

const guide = read('src/components/MenuGuide.tsx')
const agent = read('src/components/Agent.tsx')
const app = read('src/App.tsx')
const storeSrc = read('src/lib/readingStore.ts')

// ---------------------------------------------------------------------
// Dynamic checks against the real store.
// ---------------------------------------------------------------------
const opens = []
let stopperCalls = 0
store.registerReadingFinishHandler((catId) => {
  opens.push(catId)
  // Simulate the downstream of App.openBook -> MenuBook flip: the
  // book lands on the category and emits it; the Agent replays the
  // last emit on mount (module-level dedupe) and posts its log entry.
  events.emitBookCategory(catId)
})
store.registerSpeechStopper(() => {
  stopperCalls++
})

function resetBetweenTests() {
  store.stopReading()
  stopperCalls = 0
  opens.length = 0
}

// T1 — the reported bug: a Bières reading started on LA CARTE, then
// the visitor leaves for AGENT (the hook unmounts — simulated by
// dropping every hook reference; nothing here can cancel the store),
// still finishes on its timer, opens the book on Bières, keeps the
// spoken line, and produces the book flip the Agent log replays.
resetBetweenTests()
store.setGuideLine('Bières — Par exemple : Primus 3.50€.')
const t1nonce = store.startReading('bieres', 0.05)
store.setPendingOpen('bieres')
store.setReplyArrived(true)
check('T1a reading live with the right category + nonce', store.getReading()?.categoryId === 'bieres' && store.getReading()?.nonce === t1nonce)
// --- the visitor leaves LA CARTE here: no hook call, no cleanup ---
await sleep(200)
check(
  'T1b reading finished on its timer after the tab switch (book opened on Bières)',
  opens.length === 1 && opens[0] === 'bieres' && store.getReading() === null,
  `opens=${JSON.stringify(opens)}`,
)
check(
  'T1c spoken line did NOT reset to the greeting',
  (store.getGuideLine() ?? '').startsWith('Bières'),
  `line=${JSON.stringify(store.getGuideLine())}`,
)
check(
  'T1d book flip emitted Bières (the value the Agent log entry replays)',
  events.getLastBookCategory() === 'bieres',
  `last=${JSON.stringify(events.getLastBookCategory())}`,
)
check('T1e natural finish did NOT cut the voice (stopper not called)', stopperCalls === 0, `stopperCalls=${stopperCalls}`)

// T2 — "Couper la voix" still cancels everything at once.
resetBetweenTests()
store.startReading('vins', 0.2)
store.setPendingOpen('vins')
store.setReplyArrived(true)
store.stopReading()
check(
  'T2a stop clears reading + pending open + calls the voice stopper once',
  store.getReading() === null && store.getPendingOpen() === null && stopperCalls === 1,
  `reading=${JSON.stringify(store.getReading())} pending=${JSON.stringify(store.getPendingOpen())} stopperCalls=${stopperCalls}`,
)
await sleep(300)
check('T2b stopped reading never opens the book', opens.length === 0, `opens=${JSON.stringify(opens)}`)

// T3 — a newer reading supersedes an older one (nonce guard).
resetBetweenTests()
store.startReading('bieres', 0.05)
store.setPendingOpen('bieres')
store.setReplyArrived(true)
store.startReading('vins', 0.05)
store.setPendingOpen('vins')
store.setReplyArrived(true)
await sleep(200)
check(
  'T3 newer reading supersedes older (one open, on the newer category)',
  opens.length === 1 && opens[0] === 'vins',
  `opens=${JSON.stringify(opens)}`,
)

// T4 — finish before the brain reply holds the open: no book open,
// pending kept for the re-timed reading.
resetBetweenTests()
const t4nonce = store.startReading('aperitifs', 0.05)
store.setPendingOpen('aperitifs')
store.setReplyArrived(false)
await sleep(200)
check(
  'T4a timer expiry without a reply does NOT open the book',
  opens.length === 0 && store.getReading() === null,
  `opens=${JSON.stringify(opens)}`,
)
check(
  'T4b pending open is held (not dropped) when the reply is late',
  store.getPendingOpen() === 'aperitifs',
  `pending=${JSON.stringify(store.getPendingOpen())}`,
)
check(
  'T4c late reply cannot resurrect the expired reading (nonce no longer live)',
  store.getReading() === null || store.getReading()?.nonce !== t4nonce,
  `liveNonce=${store.getReading()?.nonce} oldNonce=${t4nonce}`,
)

// T5 — subscription mirror (what the hook uses to re-render).
resetBetweenTests()
let notified = 0
const unsubscribe = store.subscribeReadingStore(() => {
  notified++
})
store.startReading('froides', 5)
check('T5a subscriber notified on start', notified === 1 && store.getReading()?.categoryId === 'froides', `notified=${notified}`)
store.stopReading()
check('T5b subscriber notified on stop', notified === 2 && store.getReading() === null, `notified=${notified}`)
unsubscribe()
store.startReading('chaudes', 5)
check('T5c unsubscribed listener is not called again', notified === 2, `notified=${notified}`)
store.stopReading()

// ---------------------------------------------------------------------
// Static checks on the wired-up code.
// ---------------------------------------------------------------------

// S1 — no hook-local reading state remains in MenuGuide.tsx. (The
// fix comment legitimately names the old refs in prose, so match
// declarations / `.current` uses, not the words.)
check(
  'S1a no readingTimerRef code remains in MenuGuide.tsx',
  !/readingTimerRef\s*=\s*useRef/.test(guide) && !guide.includes('readingTimerRef.current'),
)
check(
  'S1b no pendingOpenRef code remains in MenuGuide.tsx',
  !/pendingOpenRef\s*=\s*useRef/.test(guide) && !guide.includes('pendingOpenRef.current'),
)
check(
  'S1c no replyArrivedRef code remains in MenuGuide.tsx',
  !/replyArrivedRef\s*=\s*useRef/.test(guide) && !guide.includes('replyArrivedRef.current'),
)
check(
  'S1d no readingRef code remains in MenuGuide.tsx',
  !/readingRef\s*=\s*useRef/.test(guide) && !guide.includes('readingRef.current'),
)
check(
  'S1e no local clearReadingTimer / window.setTimeout left in MenuGuide.tsx',
  !guide.includes('clearReadingTimer') && !guide.includes('window.setTimeout'),
)

// S2 — the hook uses the store and registers the finish handler +
// speech stopper with no unmount cleanup for the reading.
check(
  'S2a MenuGuide imports the reading store',
  guide.includes("from '../lib/readingStore'"),
)
check(
  'S2b finish handler registered (App openBook survives unmount)',
  guide.includes('registerReadingFinishHandler(onOpenBook)'),
)
check(
  'S2c speech stopper registered',
  guide.includes('registerSpeechStopper(stopSpeaking)'),
)
check(
  'S2d hook subscribes to the store mirror',
  guide.includes('subscribeReadingStore(() => {'),
)
check(
  'S2e no unmount cleanup clears the reading (no () => () => effect)',
  !/useEffect\(\s*\(\) => \(\) => \{[\s\S]*?clearReadingTimer|useEffect\(\s*\(\) => \(\) => \{[\s\S]*?stopSpeaking/.test(guide),
)

// S3 — category-change effect still shows the line only (fix pass 13).
const catCommentIdx = guide.indexOf('// Category change')
const catEffectStart = catCommentIdx === -1 ? -1 : guide.indexOf('useEffect(() => {', catCommentIdx)
const catEffectEnd = catEffectStart === -1 ? -1 : guide.indexOf('// Item tap', catEffectStart)
const catEffect = catEffectStart === -1 || catEffectEnd === -1 ? null : guide.slice(catEffectStart, catEffectEnd)
check('S3a category-change effect block found', catEffect !== null)
if (catEffect !== null) {
  check('S3b effect keeps first-mount guard', catEffect.includes('firstCategoryRef.current'))
  check('S3c effect calls setGuideLine(text)', catEffect.includes('setGuideLine(text)'))
  check('S3d effect has no startReading', !catEffect.includes('startReading'))
  check('S3e effect has no speak(', !catEffect.includes('speak('))
  check('S3f effect deps are [categoryId] only', /}, \[categoryId\]\)/.test(catEffect))
}

// S4 — "Demander à la barmaid" first click still synchronous:
// line + reading + voice start in the click handler, before the
// async brain reply.
const askBtn = sliceBetween(guide, 'const askBartender = () => {', '\n  }\n\n  return {')
check('S4a askBartender block found', askBtn !== null)
if (askBtn !== null) {
  const lineIdx = askBtn.indexOf('setGuideLine(text)')
  const readIdx = askBtn.indexOf('startReading(categoryId,')
  const speakIdx = askBtn.indexOf('speak(text)')
  const pendingIdx = askBtn.indexOf('setPendingOpen(categoryId)')
  const brainIdx = askBtn.indexOf('void askBrain(request)')
  check(
    'S4b line + reading + pending + voice all start before the async brain reply',
    lineIdx !== -1 && readIdx !== -1 && speakIdx !== -1 && pendingIdx !== -1 && brainIdx !== -1 &&
      lineIdx < readIdx && readIdx < brainIdx && speakIdx < brainIdx && pendingIdx < brainIdx,
    `line=${lineIdx} read=${readIdx} speak=${speakIdx} pending=${pendingIdx} brain=${brainIdx}`,
  )
  check(
    'S4c late reply still nonce-guarded (no resurrection after stop)',
    askBtn.includes('if (getReading()?.nonce !== nonce) return'),
  )
}

// S5 — the finished reading still feeds the Agent log entry exactly
// once: App's openBook switches to the book with the true category,
// and Agent's module-level dedupe + mount replay are untouched.
check(
  'S5a App openBook still switches to the book with the true category',
  app.includes("setBookTarget({ catId, nonce: Date.now() })") && app.includes("setTab('book')"),
)
check(
  'S5b Agent module-level book dedupe intact',
  agent.includes('let lastPostedBookCat: string | null = null'),
)
check(
  'S5c Agent mount replay intact (flip while unmounted still logs once)',
  agent.includes('const last = getLastBookCategory()') && agent.includes('if (last) handleCategory(last)'),
)
check(
  'S5d Livre label follows the actual reading category',
  guide.includes("guide.reading?.categoryId)?.label") && guide.includes('Lecture en cours…'),
)

// S6 — the store is dependency-free and node-importable (no window,
// no React), so the dynamic checks above test the real module.
check(
  'S6a readingStore has no window usage',
  !storeSrc.includes('window.'),
)
check(
  'S6b readingStore has no React import',
  !storeSrc.includes("from 'react'"),
)
check(
  'S6c readingStore has no imports at all',
  !/^import /m.test(storeSrc),
)

// Cleanup the transpiled temp dir.
rmSync(tmpDir, { recursive: true, force: true })

console.log(failures === 0 ? '\nAll fix-14 reading probe checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
