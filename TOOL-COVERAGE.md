# Tool coverage: Art du Rendez-Vous, site v4

Every tool or reference on the brief, with where it lives (file and section).
Status: **USED** = running on the site · **OPT-IN** = built and working behind a URL flag · **IDEA ONLY** = licence forbids copying, so the idea was rebuilt from scratch.
Nothing on this list is MISSING. The last column links the proof in `qa/`.

Routes: `#/` Accueil · `#/carte` · `#/livre` · `#/galerie` · `#/commande` · `#/venir`

## Templates (zips)

| Item | Status | Where | Proof |
|---|---|---|---|
| **NAÏADE** (base) | USED | `components/Stage.tsx` (pinned hero, playhead chase, card windows, outro mask), `lib/scroll.ts`, `lib/timeRemap.ts` (speed-ramp remap), `lib/timeline.ts`, `lib/bag.ts` + `BagDrawer.tsx`, `Preloader.tsx` curtain, `Nav.tsx`, `ChapterRail.tsx`, `Outro.tsx`, `HeroCopy.tsx` layout. Accueil route. | `qa/hero.mp4`, `qa/tabs/tab-1-accueil-1.png` |
| **Otis** (taffy engine) | USED | `gl/stretch.ts` runs in `components/StretchPhoto.tsx`, mounted in `CarteReel.tsx` → "focused drink" photo, above the detail card. Grab and pull, snap back with a wobble, tap to poke; up to 4 pointers. | `qa/coverage/carte-otis-stretch.png` |
| **Selene** (pinned reel) | USED | `CarteReel.tsx` + `gl/carteScene.ts`: pin, scroll → position, counter, progress bar and category index drive the 3D wheel of all 59 drinks. | `qa/tabs/tab-2-carte-1.png` |
| **Visor** (hotspots, mask, occlusion) | USED | `components/Hotspot.tsx` (dot, drawn leader, glass card) pinned to the cup rim in `Stage.tsx` and to drinks in `Signatures.tsx`. Its circular mask reveal opens `Livre.tsx`. Its title-behind-subject idea is a real depth plane in `gl/cafeScene.ts`. | `qa/desktop-05-signatures-3d-*.png`, `qa/coverage/livre-spin-badge-nori.png` |

## Starter and effect references

| Item | Status | Where | Proof |
|---|---|---|---|
| **Halcyon: vessel** | USED | `gl/cafeScene.ts` (lathe cup with wall thickness, physical glaze, PMREM, shadow key light, adaptive DPR); the recipe is shared through `gl/kit.ts` with every scene. | `qa/looks/look-a-hero-1.png` |
| **Halcyon: hold** | USED | `HeroCopy.tsx` → `SWATCHES` (Latte / Chocolat / Irish): each one glides the hero film to a held frame. | `qa/coverage/hero-hold-swatches.png` |
| **Halcyon: film** | USED | `Stage.tsx`: the scroll-remapped playhead (NAÏADE `timeRemap`) scrubs the live 3D scene the way Halcyon scrubs its film. | `qa/hero.mp4` |
| **Halcyon: View Transitions** | USED | `lib/router.ts` → `navigate()` uses `document.startViewTransition` (circle reveal from the click via `--vt-x/--vt-y`). `index.css` holds `::view-transition-*` and `.vt-underline` (the tab underline morphs between tabs). `Curtain.tsx` is the fallback. | `qa/tabs/transition-curtain.png` |
| **norrav preloader** | USED (idea) | `Preloader.tsx`: big counter on the curtain while the scene builds. | `qa/hero.mp4` (first frames) |
| **gentlerain ripple title** | USED (idea) | `gl/cafeScene.ts`: cursor-ripple shader on the 3D "Art du Rendez-Vous" title plane. The Apéro palette in `kit.ts` LOOKS. | `qa/looks/look-a-hero-1.png` |
| **mojito split letters** | USED (idea) | `components/SplitTitle.tsx` (GSAP stagger, ScrollTrigger once) on every section title: Signatures, CarteReel, Livre, Galerie, Commande, Venir. | `qa/coverage/signatures-tabs-split.png` |
| **mojito tabbed slider** | USED (idea) | `Signatures.tsx`: tablist of 4 drinks with arrows; each tab glides the 3D bar camera to its station. | `qa/coverage/signatures-tabs-split.png` |
| **spylt reel** | USED (idea) | `Livre.tsx`: circular clip reveal on entry, plus a spinning circle-text badge (`.spin-badge`). `lib/motion.ts` → `clipTitles()` clip-path scrub on the footer wordmark (`Footer.tsx`). | `qa/coverage/livre-spin-badge-nori.png` |
| **custom-globe glow-edge** | USED | `gl/mapScene.ts`: globe group (fresnel glow edge, additive atmosphere, Brussels beacon) lifts away into the OSM map slab. Texture `public/media/globe/globe.jpg`. Venir route. | `qa/coverage/venir-globe-intro.png`, `qa/coverage/venir-map-pin.png` |
| **Balaji lens reveal** | USED | `gl/galleryScene.ts` → lens `ShaderMaterial` on every frame: engraved duotone, with the real photo inside a gold-ringed cursor lens. Galerie route. | `qa/coverage/galerie-balaji-lens.png` |
| **Mage-UI trailing images** | USED | `components/TrailImages.tsx`, in the `Footer.tsx` (#venir footer, every route except Commande). | `qa/coverage/footer-trailing-images.png` |
| **Mage-UI parallax grid** | USED | `components/ParallaxWall.tsx`: a tilted 3D plane of 5 columns of all 59 photos at different speeds. Galerie route, after the gallery walk. | `qa/coverage/galerie-parallax-wall.png` |
| **Mage-UI glowing grid** | USED | `lib/glow.ts` + `[data-glow]` CSS in `index.css`, on the Commande cards (chat, order, QR) and the Venir cards. | `qa/coverage/commande-qr-glow.png` |
| **WebGL-Fluid** | USED | `gl/fluid.js` (vendored MIT), started by `Footer.tsx` as the "cream pour" behind the footer. | `qa/coverage/footer-trailing-images.png` |
| **GSAP + ScrollTrigger** | USED | `lib/motion.ts` (registration, `clipTitles`), `SplitTitle.tsx`, `TrailImages.tsx`. `lib/scroll.ts` feeds Lenis scroll to `ScrollTrigger.update`. | all section titles |
| **Lenis** | USED | `lib/scroll.ts`: one Lenis instance and one rAF (`onFrame`) driving every scene. | everywhere |

## Avatar host

| Item | Status | Where | Proof |
|---|---|---|---|
| **Layer2D physics** (Nori) | USED, default host | `public/host-l2d/` (MIT viewer + `nori.l2d`: 92 layers, 12 spring chains, 37 faces, AEIOU phoneme lip-sync), wrapped by `components/L2DHost.tsx`. Shown in Livre (beside the book) and Commande (behind the bar). | `qa/avatar/host-idle.mp4`, `qa/coverage/livre-spin-badge-nori.png` |
| **pixi-live2d** | OPT-IN `?host=live2d` | `public/host-live2d/index.html`: pixi.js 7 + pixi-live2d-display (cubism4) + Cubism Core. Plays the owner-supplied **Nekomi** model (`inputs/live2d-model`), or Hiyori with `&model=hiyori`. Same `L2DHost` handle (attachVoice / setEmotion), head and eyes follow the cursor. Example URL: `/?host=live2d#/livre`. | `qa/coverage/livre-live2d-nekomi.png` |
| **three-vrm** | OPT-IN `?host=vrm` | `gl/host.ts` + `src/vendor/three-vrm.js` (VRM loader, MToon, idle, blink, look-at, visemes) in `bookScene.ts` / `hostStage.ts`. Not the default: the VRoid sample rigs read badly at bust framing. | `qa/avatar/` |
| **YuriOS** (Apache-2.0) | USED (idea) | `gl/host.ts` idle layering (breathing, saccades, blink timing) follows YuriOS's companion idle. | — |
| **utsuwa lipsync** (AGPL-3) | IDEA ONLY | Look-ahead mouth: the Layer2D player delays agent audio ~90 ms and analyses it ahead (`L2DHost.attachVoice`); `host.ts` maps level → viseme. utsuwa's expression composer inspired `lib/emotion.ts`. No code copied. | `qa/voice-test.json` |
| **Soul-of-Waifu emotions** (GPL-3) | IDEA ONLY | `lib/emotion.ts` → `classify()` sorts each agent line into joy / excited / love / proud / sad / surprised / curious / hungry / neutral. `NORI_FACE` maps those to Nori's faces; `L2DHost.setEmotion` applies them. Called from `Commande.tsx` and `Livre.tsx` (agent replies and page lines). | `qa/coverage/livre-nori-emotion-love.png`, `qa/voice-test.json` → `voiceLog[].emotion` |
| **airi** (MIT) | USED (idea) | RMS → mouth with fast attack and slow release in `public/host-live2d/index.html` (`beforeModelUpdate`); emotion → smile/blush/brow parameters. | — |

## Voice, order, utilities

| Item | Status | Where | Proof |
|---|---|---|---|
| **Deepgram agent + grant token** | USED | `server/deepgram.mjs` (vite dev and preview middleware `POST /api/deepgram-token` → `api.deepgram.com/v1/auth/grant`, key from `process.env.DEEPGRAM_API_KEY`, never sent to the browser). `lib/voice.ts`: Voice Agent v1 websocket (nova-3 → gpt-4o-mini with the full carte → aura-2-agathe-fr), `add_to_order` function, KeepAlive, barge-in. Audio goes to Nori for lip-sync. Commande route, plus "Parler à l'hôte" in Livre. | `qa/voice-test.mp4`, `qa/voice-test.json` |
| **QR** | USED | `Commande.tsx`: a `qrcode` canvas pointing to `…#/commande?agent=1`, which opens the agent on a phone (with a hint). | `qa/coverage/commande-qr-glow.png` |
| **⌘K finder** | USED | `components/Finder.tsx` (⌘K / Ctrl+K, or the Nav button): tabs and all 59 drinks, accent-insensitive; Enter navigates or adds to the bag. | `qa/coverage/finder-cmdk.png` |
