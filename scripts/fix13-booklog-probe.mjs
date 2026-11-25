/**
 * Fix pass 13 probe — static verification for the book-log fixes.
 *
 * Run from the repo root:  node scripts/fix13-booklog-probe.mjs
 * Exit 0 = all checks pass, 1 = at least one fails.
 *
 * Checks:
 *  A1  No per-mount book-reaction dedupe (lastBookCatRef) remains in Agent.tsx.
 *  A2  Module-level dedupe `lastPostedBookCat` exists in Agent.tsx, declared
 *      before the component (next to lastChatMessages).
 *  A3  handleCategory checks the module dedupe at the top AND sets it inside
 *      the 400 ms timeout immediately before posting the message.
 *  B1  App clears bookTarget on landing: stable handleTargetConsumed does
 *      setBookTarget(null), and BookTab receives it as onTargetConsumed.
 *  B2  BookTab's onBookCategory subscription consumes the target only when
 *      the landed catId equals the current target (read via a ref, so the
 *      subscription deps stay [armReadingTimer] and never churn).
 *  C1  MenuGuide's category-change effect only setLine(text): no
 *      startReading / speak / pendingOpenRef / replyArrivedRef in it, and
 *      the first-mount guard is intact.
 *  C2  Explicit readings still exist: startReading is still defined and
 *      askBartender still uses it (readings start only from an explicit ask).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const agent = read('src/components/Agent.tsx')
const app = read('src/App.tsx')
const guide = read('src/components/MenuGuide.tsx')

/** Slice of `src` between two markers (first occurrence each). */
function sliceBetween(src, start, end) {
  const i = src.indexOf(start)
  if (i === -1) return null
  const j = end ? src.indexOf(end, i + start.length) : src.length
  return src.slice(i, j === -1 ? src.length : j)
}

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// --- A1: no per-mount dedupe ---
// Code occurrences only: the fix comment legitimately names the old
// ref in prose, so match a declaration or a `.current` use, not the word.
check(
  'A1  no lastBookCatRef code remains in Agent.tsx',
  !/lastBookCatRef\s*=\s*useRef/.test(agent) && !agent.includes('lastBookCatRef.current'),
)

// --- A2: module-level dedupe, before the component ---
const moduleDedupe = 'let lastPostedBookCat: string | null = null'
const dedupeIdx = agent.indexOf(moduleDedupe)
const componentIdx = agent.indexOf('export default function Agent')
check(
  'A2  module-level lastPostedBookCat declared before Agent',
  dedupeIdx !== -1 && componentIdx !== -1 && dedupeIdx < componentIdx,
  dedupeIdx === -1 ? 'declaration missing' : '',
)

// --- A3: checked at top of handleCategory, set in timeout before posting ---
const bookReaction = sliceBetween(agent, '// ---- Book reaction', 'Deepgram voice call')
const checkIdx = bookReaction?.indexOf('if (catId === lastPostedBookCat) return') ?? -1
const setIdx = bookReaction?.indexOf('lastPostedBookCat = catId') ?? -1
const postIdx = bookReaction?.indexOf("setMessages((prev) => [...prev, { role: 'bot', text, actions }])") ?? -1
check(
  'A3  handleCategory checks module dedupe, sets it in timeout before posting',
  bookReaction !== null && checkIdx !== -1 && setIdx !== -1 && postIdx !== -1 && checkIdx < setIdx && setIdx < postIdx,
  bookReaction === null
    ? 'book-reaction block not found'
    : `check=${checkIdx} set=${setIdx} post=${postIdx}`,
)
// Mount replay still present (surfaces flips made while Agent was unmounted).
check(
  'A3b mount replay (getLastBookCategory -> handleCategory) still present',
  agent.includes('const last = getLastBookCategory()') && agent.includes('if (last) handleCategory(last)'),
)

// --- B1: App clears bookTarget via a stable callback passed to BookTab ---
check(
  'B1a handleTargetConsumed does setBookTarget(null)',
  /const handleTargetConsumed = useCallback\(\(\) => \{\s*setBookTarget\(null\)\s*\}, \[\]\)/.test(app),
)
check(
  'B1b BookTab accepts onTargetConsumed prop',
  app.includes('onTargetConsumed?: () => void'),
)
check(
  'B1c App passes onTargetConsumed={handleTargetConsumed} to BookTab',
  app.includes('<BookTab goToCategory={bookTarget} onTargetConsumed={handleTargetConsumed} />'),
)

// --- B2: landing-only consumption via refs, subscription does not churn ---
const bookTab = sliceBetween(app, 'function BookTab(', 'export default function App()')
const subBlock = sliceBetween(bookTab ?? '', 'onBookCategory((catId)', '}),\n    [armReadingTimer],')
check(
  'B2a landing consumes target only when landed catId equals current target',
  bookTab !== null &&
    bookTab.includes('const goToCategoryRef = useRef(goToCategory)') &&
    bookTab.includes('const onTargetConsumedRef = useRef(onTargetConsumed)') &&
    (subBlock ?? '').includes('if (goToCategoryRef.current && catId === goToCategoryRef.current.catId)') &&
    (subBlock ?? '').includes('onTargetConsumedRef.current?.()'),
  subBlock === null ? 'subscription block not found' : '',
)
check(
  'B2b onBookCategory subscription deps stay [armReadingTimer] (no churn)',
  bookTab !== null && /onBookCategory\(\(catId\) => \{[\s\S]*?\}\),\s*\[armReadingTimer\],\s*\)/.test(bookTab),
)

// --- C1: category-change effect shows the line only ---
// Slice from the effect's `useEffect` (not the comment above it — the
// fix comment legitimately names startReading/pendingOpenRef in prose).
const catCommentIdx = guide.indexOf('// Category change')
const catEffectStart = catCommentIdx === -1 ? -1 : guide.indexOf('useEffect(() => {', catCommentIdx)
const catEffectEnd = catEffectStart === -1 ? -1 : guide.indexOf('// Item tap', catEffectStart)
const catEffect = catEffectStart === -1 || catEffectEnd === -1 ? null : guide.slice(catEffectStart, catEffectEnd)
check('C1a category-change effect block found', catEffect !== null)
if (catEffect !== null) {
  check('C1b effect keeps first-mount guard', catEffect.includes('firstCategoryRef.current'))
  check('C1c effect calls setLine(text)', catEffect.includes('setLine(text)'))
  check('C1d effect has no startReading', !catEffect.includes('startReading'))
  check('C1e effect has no speak(', !catEffect.includes('speak('))
  check('C1f effect has no pendingOpenRef', !catEffect.includes('pendingOpenRef'))
  check('C1g effect has no replyArrivedRef', !catEffect.includes('replyArrivedRef'))
  check('C1h effect deps are [categoryId] only', /}, \[categoryId\]\)/.test(catEffect))
}

// --- C2: explicit readings still work (ask / askBartender untouched) ---
check(
  'C2a startReading still defined',
  guide.includes('const startReading = useCallback('),
)
check(
  'C2b askBartender still starts a reading + arms pending open',
  (() => {
    const ask = sliceBetween(guide, 'const askBartender = () => {', '\n  }\n\n  return {')
    return ask !== null && ask.includes('startReading(categoryId,') && ask.includes('pendingOpenRef.current = categoryId')
  })(),
)
check(
  'C2c ask() still starts a reading for a named category',
  guide.includes('const nonce = startReading(catId, 12)'),
)

console.log(failures === 0 ? '\nAll fix-13 probe checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
