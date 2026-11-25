/**
 * FIX PASS 9 — store + panel harness. NOT shipped.
 *
 * Drives the REAL src/lib/walkStatus.ts (transpiled on the fly with
 * the project's tsc — no hand copy of the store) through the exact
 * write sequence VrmModel's render loop now produces, and renders
 * the panel line with the EXACT MenuVita ternary (copied verbatim
 * from src/components/MenuVita.tsx), asserting:
 *   1. idle -> "Vita est prête — choisissez une catégorie."
 *   2. walking writes -> "Marche… pas N/4 · x … · genou …°"
 *      (incl. pas 4/4 while walking, genou from the projected bend)
 *   3. walk end -> HELD "Arrivée · pas 4/4 · x +0.14" for 240
 *      consecutive loop frames (a 4 s reading) — the latch holds
 *   4. resetWalkStatus() (reading end) -> ready again, and the
 *      loop's next frames never re-latch the arrival
 *   5. reset DURING a walk does not kill the walk line: the next
 *      walking write re-asserts "Marche…"
 *   6. a second walk with a new tick repeats 2–4 cleanly
 *
 * The loop's latch logic (arrivedRef + the getWalkStatus().tick===0
 * consume check) lives in VrmModel.tsx, which cannot run headless —
 * it is MIRRORED here line-for-line in loopWrite() and proven
 * end-to-end (real VRM + real camera) by scripts/fix8-walk-probe.mjs
 * RUN G, which replays the same write sequence per frame.
 *
 * Usage: node scripts/fix9-status-harness.mjs (exit 0 = all pass)
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(path.join(tmpdir(), 'fix9-harness-'))
execFileSync(path.join(root, 'node_modules', '.bin', 'tsc'), [
  path.join(root, 'src', 'lib', 'walkStatus.ts'),
  '--ignoreConfig',
  '--target', 'es2022',
  '--module', 'nodenext',
  '--moduleResolution', 'nodenext',
  '--outDir', outDir,
  '--skipLibCheck',
], { stdio: 'inherit' })
const { setWalkStatus, resetWalkStatus, getWalkStatus, subscribeWalkStatus } =
  await import(path.join(outDir, 'walkStatus.js'))

// MenuVita.tsx walkLine ternary, verbatim.
const walkLine = (walk) => {
  const walkX = `${walk.x >= 0 ? '+' : ''}${walk.x.toFixed(2)}`
  return walk.walking
    ? `Marche… pas ${walk.step}/${walk.steps} · x ${walkX} · genou ${Math.round(walk.kneeDeg)}°`
    : walk.tick > 0
      ? `Arrivée · pas ${walk.step}/${walk.steps} · x ${walkX}`
      : 'Vita est prête — choisissez une catégorie.'
}

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

// The panel subscribes exactly like MenuVitaPanel does.
let panel = getWalkStatus()
let notifications = 0
subscribeWalkStatus((s) => { panel = s; notifications++ })

// VrmModel loop's status block, mirrored line-for-line (arrivedRef +
// the tick===0 consume check). `tick` is the live walkTickRef.
let arrived = false
const loopWrite = ({ walkingNow, walkStep, tick, x, kneeDeg }) => {
  if (walkingNow) {
    setWalkStatus({ walking: true, step: walkStep, steps: 4, x, tick, kneeDeg })
  } else if (arrived) {
    if (getWalkStatus().tick === 0) {
      arrived = false
      setWalkStatus({ walking: false, step: 0, steps: 4, x, tick: 0, kneeDeg })
    } else {
      setWalkStatus({ walking: false, step: 4, steps: 4, x, tick, kneeDeg })
    }
  } else {
    setWalkStatus({ walking: false, step: 0, steps: 4, x, tick: 0, kneeDeg })
  }
}

// 1. Idle at mount.
check('1. idle shows ready line', walkLine(panel) === 'Vita est prête — choisissez une catégorie.', walkLine(panel))

// 2. Walk 1 (tick 7): trigger + steps 1..4 with projected knee values.
loopWrite({ walkingNow: true, walkStep: 1, tick: 7, x: 0, kneeDeg: 0 })
check('2a. trigger shows Marche pas 1/4', walkLine(panel) === 'Marche… pas 1/4 · x +0.00 · genou 0°', walkLine(panel))
loopWrite({ walkingNow: true, walkStep: 2, tick: 7, x: 0.03, kneeDeg: 42.5 })
check('2b. step 2 shows projected genou 43° (not 3D 62°)', walkLine(panel) === 'Marche… pas 2/4 · x +0.03 · genou 43°', walkLine(panel))
loopWrite({ walkingNow: true, walkStep: 4, tick: 7, x: 0.14, kneeDeg: 43.7 })
check('2c. pas 4/4 IS written while walking', walkLine(panel) === 'Marche… pas 4/4 · x +0.14 · genou 44°', walkLine(panel))

// 3. Walk ends: the loop latches the arrival (crossing frame) and
//    holds it for a whole 4 s reading (240 loop frames).
arrived = true
const heldAt = notifications
for (let f = 0; f < 240; f++) {
  loopWrite({ walkingNow: false, walkStep: 0, tick: 7, x: 0.14, kneeDeg: 1.9 })
}
check('3a. held arrival shows "Arrivée · pas 4/4 · x +0.14"', walkLine(panel) === 'Arrivée · pas 4/4 · x +0.14', walkLine(panel))
check('3b. held arrival survives 240 frames (whole reading)', walkLine(panel) === 'Arrivée · pas 4/4 · x +0.14', `frames=240`)
check('3c. hold writes do not re-render the panel (dedupe)', notifications - heldAt === 1, `extra notifications=${notifications - heldAt}`)

// 4. Reading ends -> resetWalkStatus(); the loop's next frames must
//    NOT re-latch the arrival.
resetWalkStatus()
check('4a. reset returns to ready line', walkLine(panel) === 'Vita est prête — choisissez une catégorie.', walkLine(panel))
for (let f = 0; f < 240; f++) {
  loopWrite({ walkingNow: false, walkStep: 0, tick: 7, x: 0.14, kneeDeg: 1.9 })
}
check('4b. loop never re-latches after reset (240 idle frames)', walkLine(panel) === 'Vita est prête — choisissez une catégorie.' && getWalkStatus().tick === 0, walkLine(panel))

// 5. Reset DURING a walk: the next walking write re-asserts Marche…
arrived = false
loopWrite({ walkingNow: true, walkStep: 2, tick: 7, x: 0.05, kneeDeg: 30 })
resetWalkStatus()
check('5a. mid-walk reset clears to ready (one frame)', walkLine(panel) === 'Vita est prête — choisissez une catégorie.', walkLine(panel))
loopWrite({ walkingNow: true, walkStep: 2, tick: 7, x: 0.05, kneeDeg: 30 })
check('5b. next walking write re-asserts Marche…', walkLine(panel) === 'Marche… pas 2/4 · x +0.05 · genou 30°', walkLine(panel))

// 6. Second walk (new tick 8) repeats cleanly, then resets.
loopWrite({ walkingNow: true, walkStep: 4, tick: 8, x: -0.08, kneeDeg: 35 })
check('6a. second walk pas 4/4 at the other end', walkLine(panel) === 'Marche… pas 4/4 · x -0.08 · genou 35°', walkLine(panel))
arrived = true
loopWrite({ walkingNow: false, walkStep: 0, tick: 8, x: -0.08, kneeDeg: 2 })
check('6b. second arrival held', walkLine(panel) === 'Arrivée · pas 4/4 · x -0.08', walkLine(panel))
resetWalkStatus()
check('6c. second reset returns to ready', walkLine(panel) === 'Vita est prête — choisissez une catégorie.', walkLine(panel))
loopWrite({ walkingNow: false, walkStep: 0, tick: 8, x: -0.08, kneeDeg: 2 })
check('6d. no re-latch after second reset', getWalkStatus().tick === 0, walkLine(panel))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
