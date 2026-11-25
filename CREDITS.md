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
| `src/gl/stretch.ts` | Otis zip `src/face/engine.ts` | WebGL2 grid warp (kept in repo, no longer mounted: signatures went full 3D) |
| `src/gl/kit.ts` | Halcyon vessel recipe + own code | Shared studio for every section: renderer, PMREM, key light, animated sky dome, 3 colour looks (`?look=a|b|c`) |
| Looks a/b/c | gentlerain.ai, Yash studio, indigo/cyan/lime reference sites in 3d-web-toolkit | Palettes and mood only; nothing copied |
| `src/gl/signaturesScene.ts`, `Signatures.tsx` | NAÏADE remap + Visor hotspots | Modelled cappuccino, Aperol spritz, Orval bottle + chalice, Kir royal on a 3D bar; camera travels; 3D-anchored price hotspots |
| `src/gl/carteScene.ts`, `CarteReel.tsx` | SELENE zip `MissionLog.tsx` mechanics | Pin/counter/progress/category index now drive a three.js carousel wheel of all 59 drinks with lacquer-floor reflections |
| `src/gl/bookScene.ts`, `Livre.tsx` | own code; Visor mask idea | Page-curl book (arc-bent sheets in the vertex shader), drag/swipe, circular mask reveal |
| `src/gl/host.ts` + `src/vendor/three-vrm.js` | @pixiv/three-vrm 3.6.0 (MIT © pixiv Inc.), idle techniques studied in YuriOS / utsuwa / airi / Soul-of-Waifu | VRM loader + MToon vendored; idle/blink/look-at/lip-sync hooks written from scratch |
| `public/models/host.vrm` | VRoid AvatarSample_B (pixiv; commercial use allowed, credit not required, modification allowed) | Café host avatar |
| `server/deepgram.mjs`, `src/lib/voice.ts` | Deepgram docs (auth/grant, Voice Agent v1) | Server-side token broker; browser never sees the key |
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
