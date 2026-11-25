// Fix pass 13, bug 3 — static probe for the Live2D warm-cache wiring.
// The model loads at most once per page lifetime: the parsed PIXI stage
// survives Agent unmounts in a module-level cache and is re-attached on
// remount. This script checks the wiring statically (no WebGL2 on this
// VM, so it cannot check pixels — the next check must see the instant
// return on screen).
// Usage: node scripts/fix13-live2d-probe.mjs  (exit 0 = all checks pass)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'src/components/Live2DModel.tsx'), 'utf8')

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

// Brace-match helper: extract the body of the first `{ ... }` starting at idx.
function braceBody(text, openIdx) {
  let depth = 0
  for (let i = openIdx; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(openIdx, i + 1)
    }
  }
  return ''
}

// --- (a) module-level warm cache holding app + parsed model + canvas ---
const cacheDecl = src.match(/let warmStage: WarmStage \| null = null/)
check('module-level warm cache declared', !!cacheDecl)
const warmType = src.match(/type WarmStage = \{[^}]*\}/s)?.[0] ?? ''
check(
  'WarmStage holds app + model + canvas (+ unsubscribe)',
  /app:.*Application/.test(warmType) &&
    /model: Live2DModelType/.test(warmType) &&
    /canvas: HTMLCanvasElement/.test(warmType) &&
    /unsubscribe/.test(warmType),
  warmType.replace(/\s+/g, ' '),
)
check('cold init publishes the cache after the model is built', /warmStage = \{ app, model, canvas, unsubscribe,?[^}]*\}/.test(src))

// --- (c) status initialises from cache presence ---
check(
  "status initialises from cache presence (warm return never shows placeholder)",
  /useState<[^>]*>\(\(\) =>\s*warmStage \? 'ready' : 'loading',?\s*\)/.test(src),
)

// --- (b) warm remount path: same canvas re-appended, resize+fit, ticker restart ---
check('warm path re-appends the SAME canvas', /container\.appendChild\(stage\.canvas\)/.test(src))
check('warm path restarts the ticker', /stage\.app\.ticker\.start\(\)/.test(src))
check('warm path re-attaches the pointer listener', /container\.addEventListener\('pointermove', onPointer\)/.test(src))
check('warm path re-fits and sets ready immediately', /fit\(\)\n\s+try \{\n\s+stage\.app\.ticker\.start\(\)/.test(src))
check('warm path guards on a live WebGL context', /isContextLost\(\)/.test(src))

// --- (b) unmount cleanup: stops ticker, removes listener, does NOT destroy ---
const cleanupIdx = src.indexOf('void init()')
const cleanupOpen = src.indexOf('return () => {', cleanupIdx)
const cleanupBody = braceBody(src, src.indexOf('{', cleanupOpen))
check('unmount cleanup stops the ticker', /ticker\.stop\(\)/.test(cleanupBody))
check('unmount cleanup removes the pointer listener', /removeEventListener\('pointermove', onPointer\)/.test(cleanupBody))
check(
  'unmount cleanup does NOT destroy app/model (warm path keeps the stage)',
  !/\.destroy\(/.test(cleanupBody),
  cleanupBody.includes('.destroy(') ? 'destroy() found in cleanup' : 'no destroy() in cleanup',
)
check('unmount cleanup clears instance refs so fit() no-ops', /modelRef\.current = null/.test(cleanupBody) && /appRef\.current = null/.test(cleanupBody))

// --- (d) fit + pointer handler live at component level and read refs ---
const fitIdx = src.indexOf('const fit = useCallback')
const fitBody = braceBody(src, src.indexOf('{', src.indexOf('() => {', fitIdx)))
check('fit is a component-level useCallback', fitIdx !== -1 && fitIdx < src.indexOf('const init = async'))
check(
  'fit reads containerRef/modelRef/appRef (no init-local container/app)',
  /modelRef\.current/.test(fitBody) && /appRef\.current/.test(fitBody) && /containerRef\.current/.test(fitBody),
)
check('fit resizes the renderer', /app\.renderer\.resize\(w, h\)/.test(fitBody))
check('no init-local fit definition remains', !/const fit = \(\) => \{/.test(src))
const ptrIdx = src.indexOf('const onPointer = useCallback')
const ptrBody = braceBody(src, src.indexOf('{', src.indexOf('=> {', ptrIdx)))
check(
  'pointer handler is component-level and reads modelRef',
  ptrIdx !== -1 && /modelRef\.current/.test(ptrBody) && /model\.focus\(/.test(ptrBody),
)

// --- (e) webglcontextlost drops the cache ---
const ctxIdx = src.indexOf("addEventListener('webglcontextlost'")
const ctxBody = braceBody(src, src.indexOf('{', src.indexOf('() => {', ctxIdx)))
check('webglcontextlost listener exists on the canvas', ctxIdx !== -1)
check('context-loss handler drops the cache', /dropWarmStage\(\)/.test(ctxBody))
check(
  'context-loss handler ignores stale canvases (post-retry guard)',
  /warmStage\.canvas !== canvas/.test(ctxBody),
)
check('dropWarmStage nulls the cache and destroys app+model', /warmStage = null/.test(src) && /stage\.model\.destroy\(\)/.test(src) && /stage\.app\.destroy\(/.test(src))

// --- (f) kept working: retry clears cache, Henshin persists, Nodd, progress ---
const retryIdx = src.indexOf('Réessayer')
const retryBlock = src.slice(retryIdx, src.indexOf('</button>', retryIdx))
check('retry ("Réessayer") clears the cache for a full cold init', /dropWarmStage\(\)/.test(retryBlock))
check('Henshin persistence kept (lastHenshinForm + formRef re-apply)', /let lastHenshinForm/.test(src) && /formRef\.current === 'furry'/.test(src))
check('Nodd button kept', /const nod = \(\) =>/.test(src) && /motion\('Nodd'\)/.test(src))
check('live2dProgress display kept', /liveProgress/.test(src) && /subscribeLive2dProgress/.test(src))
check('fit re-runs on resize kept', /fitRef\.current\?\.\(\)/.test(src) && /stageW, stageH/.test(src))
check('tick closure survives unmount (no ticker.remove / unsubscribe in cleanup)', !/ticker\.remove/.test(cleanupBody) && !/unsubscribe\(\)/.test(cleanupBody))

console.log(failures === 0 ? '\nfix13-live2d-probe: ALL CHECKS PASSED' : `\nfix13-live2d-probe: ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
