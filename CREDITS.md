# Credits — Art du Rendez-Vous Café, site v4

## Base: NAÏADE zip site (user-supplied template, "naiade.zip")
Copied verbatim as commit 1, then content-swapped. Still running:
- `src/lib/scroll.ts` (Lenis + single rAF), `src/lib/math.ts`, `src/lib/timeRemap.ts` (monotone-cubic speed ramp),
  `src/lib/timeline.ts` (BEATS / CARDS / HERO_OUT / OUTRO_IN), `src/lib/bag.ts`
- `src/components/Stage.tsx` engine loop: pinned 1500svh stage, playhead chase, card windows + inner stagger,
  hero blur-out, outro mask rise, chapter rail, lean-in zoom. The 2D frame draw was replaced by a three.js render call.
- `ProductCard.tsx`, `BagDrawer.tsx`, `Preloader.tsx` (curtain), `Nav.tsx`, `Outro.tsx`, `ChapterRail.tsx`, `HeroCopy.tsx` layout,
  `hooks/useFitText.ts`, `useReveals.ts`, `useReducedMotion.ts`, `index.css` (reveal, grain, glint, bump)

## Layered in
| Module | From | How |
|---|---|---|
| `src/gl/cafeScene.ts` | Halcyon starter `src/gl/vessel.js` (Maliot100X/3d-web-builder-toolkit, MIT) | Lathe body with wall thickness, MeshPhysical glaze + generated speckle map, RoomEnvironment PMREM, shadowing key light, ACES, adaptive DPR — extended into cup/saucer/liquid/steam/beans/table set |
| `src/gl/stretch.ts`, `Signatures.tsx` | Otis zip `src/face/engine.ts` + `FaceCanvas.tsx` | WebGL2 grid warp, gaussian grab slots, tanh rubber band, spring snap-back, poke, iterative pick — face rig removed |
| `CarteReel.tsx` | SELENE zip `src/components/MissionLog.tsx` | Pinned horizontal reel, focus-line dimming, counter-drift, progress bar |
| `Hotspot.tsx` | Visor zip `CinematicHeroVideo.tsx` | Dot + drawn leader line + glass card, here pinned to a projected 3D point |
| Title-behind-cup | Visor zip occlusion idea | Done with real depth: the name is a plane in the 3D scene behind the cup |
| `src/gl/fluid.js` | tkabalin/WebGL-Fluid-Background (MIT © 2017 Pavel Dobryakov, adapted by Thomas Kabalin) | Vendored with licence header; wrapped as `startFluid()`, café palette, auto "cream pour" |
| Title ripple shader | gentlerain.ai (no licence) | Technique re-implemented from scratch, no code copied |
| Preloader counter | norrav landing page (no licence) | Idea re-implemented, no code copied |

## Runtime libraries
three 0.160 (MIT), React 19 (MIT), Lenis (MIT), Tailwind CSS 4 (MIT), Vite 6 (MIT).
Fonts: Fraunces, Manrope, IBM Plex Mono (SIL OFL, Google Fonts).

## Content
Menu and prices: `src/data/menu.json` (owner's printed card, 59 drinks). Drink and scene photos: generated for the café earlier in this project.
