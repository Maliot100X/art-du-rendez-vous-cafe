# Nekomi Live2D — setup notes (pro-studio)

Date: 2026-11-25 · Model: Nekomi "Furry" (FinfiWorks), Live2D Cubism 3 `.moc3`
Status: installed, downscaled, staged, import-verified. **Not yet runnable in the
browser: the Cubism Core file is still missing (see §1) — nobody has added it or
edited `index.html` yet. Licence UNCONFIRMED (`WorkshopSharingForbidden: true`) —
local build only, do not publish.**

## Installed (2026-11-25, `npm install` in `~/workspace/web-design/pro-studio/`)

| Package | Installed version | Spec in `package.json` |
|---|---|---|
| `pixi-live2d-display` | **0.5.0-beta** | `^0.5.0-beta` |
| `pixi.js` | **7.4.3** | `^7.4.3` |
| `qrcode` | 1.5.4 | `^1.5.4` |
| `@types/qrcode` (dev) | 1.5.6 | `^1.5.6` |

`sharp` 0.35.5 was already a devDependency and was used for the downscale.
`npm install` succeeded first try (17 s) — no retry needed.

### Version surprise — read this before touching versions

- **`pixi-live2d-display@^4` does not exist.** Published versions are `0.1.0` …
  `0.4.0` (latest stable) and `0.5.0-beta`. The "v4" line is **0.4.0**.
- **0.4.0 needs PixiJS 6** (peer deps `@pixi/* ^6`), NOT Pixi 7. Installing
  0.4.0 + Pixi 7 would fail on peer-dependency conflicts.
- **0.5.0-beta is the only release whose peer dep is `pixi.js ^7.0.0`**, so that
  is what is installed, to keep the Pixi 7 requirement. It is a beta — the
  stable 0.4.0 + Pixi 6 pairing remains the fallback if the beta misbehaves.
- The installed README still says "PixiJS v6" / "Requirements: PixiJS 6.x" —
  stale text; the installed `package.json` peerDep (`pixi.js ^7.0.0`) is authoritative.

## 1. Cubism Core — REQUIRED, not yet installed

`pixi-live2d-display` does **not** bundle or auto-load the Core. The bundle
references the bare global `Live2DCubismCore` (no CDN URL anywhere in it) and
has a module-level guard (`dist/cubism4.es.js` ~line 10065):

```js
if (!window.Live2DCubismCore) {
  throw new Error("Could not find Cubism 4 runtime. This plugin requires live2dcubismcore.js to be loaded.");
}
```

So the import itself throws until the Core global exists. The Core must load
**before** the app bundle. Two options (do the self-hosted one for production):

**A. Self-hosted (recommended).** Download `live2dcubismcore.min.js` from the
Cubism 4 SDK (https://www.live2d.com/download/cubism-sdk/download-web/) or the
direct link below, save it as `public/live2d/live2dcubismcore.min.js`, and add
to `index.html` `<head>` (before the `/src/main.tsx` script):

```html
<script src="/live2d/live2dcubismcore.min.js"></script>
```

**B. CDN (dev only).** The README warns this link is unreliable — do not use
in production:

```html
<script src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"></script>
```

Verified 2026-11-25: that URL is live and serves the real file (Live2D Cubism
Core, © 2019 Live2D Inc., proprietary licence — "Redistributable Code" per the
Live2D Proprietary Software License Agreement). I did **not** download it or
edit `index.html` — that step is still open.

## 2. Staged model — `public/live2d/nekomi/` (4.8 MB total)

| File | Size | Note |
|---|---|---|
| `Furry.moc3` | 1.1 MB | binary model, copied byte-identical (md5 verified) |
| `Furry.model3.json` | 830 B | **rewritten** — see below |
| `Furry.physics3.json` | 9.7 KB | generic template rig, 7 settings |
| `Furry.cdi3.json` | 3.8 KB | display info |
| `Henshin.exp3.json` | 163 B | expression: `Param3` = 1.0, Blend Add |
| `Idle.motion3.json` | 443 B | 3 s loop, `ParamBreath` only |
| `Nodd.motion3.json` | 8.3 KB | 5 s loop, head-nod sway ("Dance") |
| `texture_00.png` | 1.79 MB | **downscaled 4096×8192 → 2048×4096** |
| `texture_01.png` | 1.86 MB | **downscaled 4096×8192 → 2048×4096** |

Deliberately **not** staged: `Furry.vtube.json` (VTube Studio only, does nothing
on web) and the 4096 originals (`Furry.4096/`, ~14.9 MB).

`Furry.model3.json` was rewritten from the original: texture paths changed to
`texture_00.png` / `texture_01.png` (same folder), and the missing sections
were added (original had no `Motions`/`Expressions`):

```json
{
  "Version": 3,
  "FileReferences": {
    "Moc": "Furry.moc3",
    "Textures": ["texture_00.png", "texture_01.png"],
    "Physics": "Furry.physics3.json",
    "DisplayInfo": "Furry.cdi3.json"
  },
  "Groups": [
    { "Target": "Parameter", "Name": "LipSync",
      "Ids": ["ParamMouthForm", "ParamMouthOpenY"] },
    { "Target": "Parameter", "Name": "EyeBlink",
      "Ids": ["ParamEyeLOpen", "ParamEyeLSmile", "ParamEyeROpen", "ParamEyeRSmile"] }
  ],
  "Motions": {
    "Idle": [{ "File": "Idle.motion3.json" }],
    "Nodd": [{ "File": "Nodd.motion3.json" }]
  },
  "Expressions": [{ "Name": "Henshin", "File": "Henshin.exp3.json" }]
}
```

### Downscale

Script: `scripts/downscale-nekomi.mjs` — sharp, Lanczos3, PNG lossless
(`compressionLevel: 9`). Run: `node scripts/downscale-nekomi.mjs`.
Result: 14.9 MB → 3.65 MB total, both verified 2048×4096. Re-run any time the
source textures change; it overwrites the staged files in place.

### Verify

`node scripts/verify-nekomi.mjs` — parses `model3.json`, checks every
referenced file exists, checks both PNGs are 2048×4096, checks the banned
files are absent. Last run: **ALL CHECKS PASSED**.

## 3. React component — exact code

Import from the **`cubism4` subpath, not the package root.** The root entry
(`pixi-live2d-display`) also bundles the Cubism 2 runtime and throws at import
time if `live2d.min.js` (Cubism 2 core) is not loaded:
`Error: Could not find Cubism 2 runtime.` We only need Cubism 4.

```tsx
import { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel, MotionPriority } from 'pixi-live2d-display/cubism4';

// The Cubism Core script tag (see §1) must already have run, otherwise this
// import throws "Could not find Cubism 4 runtime".
// window.PIXI is needed: the model's automator defaults to PIXI.Ticker.shared
// from the global PIXI namespace.
window.PIXI = PIXI;

export default function NekomiAgent() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let app: PIXI.Application | undefined;
    let model: Live2DModel | undefined;
    let cancelled = false;

    (async () => {
      app = new PIXI.Application({
        view: canvasRef.current ?? undefined,
        backgroundAlpha: 0, // transparent so the site shows through
        antialias: true,
        resolution: Math.min(window.devicePixelRatio, 2),
      });

      model = await Live2DModel.from('/live2d/nekomi/Furry.model3.json');
      if (cancelled) return;

      // --- framing -------------------------------------------------------
      // The model's saved VTube Studio position was y −9.523 (framed low);
      // re-centre for the web. Anchor (0.5, 0.5) = centre of the model.
      model.anchor.set(0.5, 0.5);
      model.scale.set(0.35); // tune to the hero size
      model.position.set(app.screen.width / 2, app.screen.height / 2);
      app.stage.addChild(model);

      // --- default form: HUMAN (Param3 = 0) ------------------------------
      // The model ships with Henshin saved active in VTS; do NOT inherit it.
      // Param3 defaults to 0 in the .moc3, and we never call expression()
      // on load, so the model starts human. See §4 for the toggle.

      // --- idle ------------------------------------------------------------
      // The "Idle" group auto-plays when nothing else is running
      // (MotionManager idle group defaults to "Idle" for Cubism 4), so no
      // call is needed. Explicit equivalent:
      // await model.motion('Idle', 0, MotionPriority.IDLE);
    })();

    return () => {
      cancelled = true;
      model?.destroy();
      app?.destroy(true);
    };
  }, []);

  return <canvas ref={canvasRef} aria-label="Nekomi, l'agente du café" />;
}
```

Notes:
- `Live2DModel.from(source)` accepts a settings URL, a JSON object, or a
  `ModelSettings` instance; it resolves relative files (moc/textures/motions)
  against the model3.json URL, so `/live2d/nekomi/…` works as served from `public/`.
- `model.internalModel` is undefined until the model is loaded — only touch it
  after `await Live2DModel.from(...)` resolves.
- Pixi 7 `Application` options: `{ view, backgroundAlpha, antialias,
  resolution }` as above. Do **not** use the Pixi 8 `app.init()` style.
- The model has **no arms** (head/body/face only) and the physics rig is a
  generic template — hair/accessory sway will look uniform.

## 4. Henshin toggle — Param3 (furry ↔ human)

- `Henshin.exp3.json` sets `Param3` ("Henshin") to **1.0**, Blend Add.
  Param3 = 0 → human form, Param3 = 1 → furry form. **Default on the site is
  HUMAN: Param3 starts at 0** (the moc default); never play the expression on load.
- Turn furry ON:
  ```ts
  await model.expression('Henshin'); // by name, from the Expressions section
  ```
- Turn furry OFF again (back to human):
  ```ts
  model.internalModel.resetExpression(); // resets to the default (no) expression
  ```
- Direct parameter write also exists but is **not** the toggle mechanism:
  `model.internalModel.coreModel.setParameterValueById('Param3', 0)` is
  overwritten each frame while the Henshin expression is active, so it only
  sticks after `resetExpression()`. Prefer `expression()` / `resetExpression()`.
- `model.expression()` with no argument plays a random expression; with a
  number it takes the expression index. It returns `Promise<boolean>`.

## 5. Motions — Idle and Nodd

```ts
// Idle (breath only, 3 s loop) — auto-plays; manual start if ever needed:
await model.motion('Idle', 0, MotionPriority.IDLE);

// Nodd ("Dance" in VTS — head-nod sway only, 5 s loop, no mouth/eyes/arms):
await model.motion('Nodd', 0, MotionPriority.NORMAL);
```

- `model.motion(group, index?, priority?)` → `Promise<boolean>` (false if it
  could not start, e.g. a higher-priority motion is running).
- Priorities: `MotionPriority.NONE = 0`, `IDLE = 1`, `NORMAL = 2`, `FORCE = 3`.
  Use `FORCE` only to interrupt something (e.g. Nodd over Idle).
- Nodd drives `ParamAngleX/Y/Z` ±30° and `ParamBodyAngleY/Z` — while it plays
  it overrides pointer head-tracking on those parameters (motion wins over
  focus for the parameters it writes). That is expected, not a bug.
- `Idle.motion3.json` is breath only — the visible "alive" feel also comes
  from the automatic breath (see §7) and physics, not from this motion alone.

## 6. Pointer-driven head + eyes — ParamAngleX/Y/Z, ParamEyeBallX/Y

**You do not need to set these parameters yourself.** The model's Automator
does it, and it is on by default:

- `autoFocus` (default `true`): listens for `globalpointermove` and calls
  `model.focus(event.global.x, event.global.y)`.
- `model.focus(x, y, instant?)` takes **world-space** coordinates, converts
  them to a direction from the model's centre, and interpolates smoothly
  toward it (FocusController, clamped to [-1, 1], eased — not instant unless
  `instant: true`).
- What focus actually writes every frame (`Cubism4InternalModel.updateFocus()`,
  verified in the installed bundle):
  ```
  ParamEyeBallX += focusX            // range −1..1
  ParamEyeBallY += focusY
  ParamAngleX   += focusX * 30       // degrees, matches the VTS ±30° mapping
  ParamAngleY   += focusY * 30
  ParamAngleZ   += focusX * focusY * -30
  ParamBodyAngleX += focusX * 10     // matches the VTS ±10° body mapping
  ```
  Note: focus is **directional, not distance-based** — `focus()` normalises
  the pointer offset to a unit circle, so the head turns fully toward the
  pointer direction at any distance. To get distance-scaled looking, drive
  `model.internalModel.focusController.focus(nx, ny)` directly with
  normalised `nx, ny` in [-1, 1] instead.
- To disable pointer tracking (e.g. while the agent is speaking, or on touch
  devices): `model.automator.autoFocus = false` (or pass
  `{ autoFocus: false }` in the `Live2DModel.from` options). `autoHitTest`
  (default true) is the tap/hit-area half of the same automator; `autoInteract`
  is deprecated in 0.5.0 and just mirrors `autoHitTest && autoFocus`.
- Manual override (use sparingly — focus adds to these each frame, so a
  `setParameterValueById` on the same parameter fights the focus update):
  ```ts
  const core = model.internalModel.coreModel; // CubismModel
  core.setParameterValueById('ParamAngleX', 15); // degrees
  ```

## 7. What is automatic (do not re-implement)

- **Eye blink: automatic.** `Cubism4InternalModel.init()` creates a
  `CubismEyeBlink` whenever the model settings have EyeBlink parameters —
  ours do (the `EyeBlink` group in `model3.json`). It blinks on its own
  interval; tune with
  `model.internalModel.eyeBlink?.setBlinkingInterval(seconds)` /
  `setBlinkingSetting(closing, closed, opening)` if needed.
- **Breath: automatic.** A `CubismBreath` runs on `ParamAngleX/Y/Z` and
  `ParamBodyAngleX` every frame, independent of the Idle motion.
- **Physics: automatic.** Loaded from `Furry.physics3.json`; runs at the
  renderer's rate. Do **not** copy the VTS `Live2DPhysicsFPS: 3` value — that
  would make it steppy. The SDK runs physics at its normal rate.
- **Idle motion: automatic** (see §5).

## 8. Lip-sync (Deepgram voice) — no built-in audio API

The library has **no** `setLipSyncValue` / audio-driven lip-sync API. The
`LipSync` group in `model3.json` only tells the motion system which
parameters are lip-sync targets (`ParamMouthForm`, `ParamMouthOpenY`).
Drive them directly from the TTS audio level, every animation frame (or on
each audio-level callback):

```ts
const core = model.internalModel.coreModel;
// level: 0..1 audio amplitude (e.g. from an AnalyserNode on the Deepgram audio)
core.setParameterValueById('ParamMouthOpenY', level * 1.0);
core.setParameterValueById('ParamMouthForm', 0.5); // 0 = closed-ish, 1 = smile/open shape
```

- VTS mappings for reference: MouthOpen → `ParamMouthOpenY` (output up to
  2.1), MouthSmile → `ParamMouthForm`; mouth smoothing was 0 (instant) in VTS.
- Safe to write directly: no motion in this model drives the mouth parameters
  (Idle = breath only, Nodd = angles only), so nothing overwrites your values.
- `setParameterValueById(id, value, weight = 1)` — weight 1 overwrites the
  parameter; use `addParameterValueById` if you ever need to add instead.

## 9. Things that failed / surprised (so the next agent doesn't repeat them)

1. `npm install pixi-live2d-display@^4` → `ETARGET: No matching version found
   for pixi-live2d-display@^4` — there is no 4.x; the line is 0.4.0.
   Fixed by installing `pixi-live2d-display@beta` (0.5.0-beta), the only
   release pairing with Pixi 7.
2. Bare `node -e "import('pixi-live2d-display')"` fails with
   `window is not defined` — PixiJS 7 needs browser globals at import time.
   This is a Node limitation, not a broken package. Verified instead with
   minimal `window`/`navigator`/`document` shims (throwaway script, deleted
   after running).
3. With shims, the **root** import throws
   `Could not find Cubism 2 runtime. This plugin requires live2d.min.js to be
   loaded.` — the root bundle includes Cubism 2. **Import from
   `pixi-live2d-display/cubism4`.**
4. With shims, the cubism4 import throws
   `Could not find Cubism 4 runtime. This plugin requires live2dcubismcore.js
   to be loaded.` until `window.Live2DCubismCore` exists — hence §1. With a
   stubbed Core global the import resolves and prints all exports
   (`Live2DModel.from` is a function, `MotionPriority` = NONE 0 / IDLE 1 /
   NORMAL 2 / FORCE 3, pixi.js 7.4.3). Real model loading still needs the real Core.
5. `npx tsc --noEmit` on the whole project was **not** run (another agent is
   editing `src/` in parallel, per the task). Type safety of the snippet in §3
   has not been compiler-checked — run `npx tsc --noEmit -p tsconfig.app.json`
   once edits settle. Types ship with the package (`types/index.d.ts`).
6. No full site build was run (same reason). The staged files are static
   assets under `public/` and do not affect the build until imported.
7. The `qrcode` package was installed per the task but is not used by anything
   in this notes file — it is for the QR-code-to-live-chat feature (other agent).

## 10. Open items for the site build

- [ ] Add the Cubism Core (§1) — self-hosted file + `<script>` in `index.html`.
- [ ] Build the React component (§3) in `src/`; verify in a real browser
      (this VM's headless Chrome has no WebGL2 — visual QA must happen on a
      phone or another machine).
- [ ] Tune `model.scale` / position for the hero; the VTS saved framing was low.
- [ ] Wire Deepgram TTS audio level → `ParamMouthOpenY`/`ParamMouthForm` (§8).
- [ ] Confirm with Minir: Nekomi licence for public/commercial use, and that
      the cat-girl + Henshin transform fits the café brand.
- [ ] Decide the Henshin toggle UI (button? voice command?) — default is human.
