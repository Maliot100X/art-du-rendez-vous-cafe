import {createRemap, type Beat} from './timeRemap';
import {DURATION} from './frames';
import {clamp, easeOutCubic, range} from './math';

/**
 * The whole page is one camera move (NAÏADE's beat engine, unchanged): hero →
 * crane up over the cup → macro on the latte art (card 01) → low side shot as
 * it turns to hot chocolate (card 02) → three-quarter back as the Irish coffee
 * crowns with cream (card 03) → a fast rewind back to the wide shot for the
 * last line. `u` is scroll progress through the pinned stage.
 *
 * Film seconds: 0–5 hero→crane, 5–10 crane→latte, 10–15 latte→chocolate,
 * 15–20 chocolate→Irish.
 */

const END = DURATION;

export const BEATS: Beat[] = [
  [0, 0],
  [0.055, 0], // hero holds while its type blurs away
  [0.17, 5], // push in + crane up over the cup
  [0.25, 10], // down onto the latte art
  [0.39, 10], // hold — card 01 (café latte)
  [0.49, 15], // swing low round the side
  [0.63, 15], // hold — card 02 (chocolat chaud)
  [0.73, END], // round to the back three-quarter
  [0.87, END], // hold — card 03 (Irish coffee)
  [0.955, 0], // rewind to the wide shot
  [1, 0],
];

export const REMAP = createRemap(BEATS, DURATION);

export type CardWindow = {inA: number; inB: number; outA: number; outB: number; side: 'left' | 'right'};

export const CARDS: CardWindow[] = [
  {inA: 0.262, inB: 0.296, outA: 0.362, outB: 0.388, side: 'left'},
  {inA: 0.502, inB: 0.536, outA: 0.602, outB: 0.628, side: 'right'},
  {inA: 0.742, inB: 0.776, outA: 0.842, outB: 0.868, side: 'left'},
];

/** 0 → 1 as the card slides in (eased out), 1 → 0 as it leaves (eased in). */
export function cardAmount(u: number, w: CardWindow): number {
  if (u <= w.inA || u >= w.outB) return 0;
  if (u < w.inB) return easeOutCubic(range(u, w.inA, w.inB));
  if (u <= w.outA) return 1;
  const t = range(u, w.outA, w.outB);
  return 1 - t * t * t;
}

/** How far through a card's hold we are (for the slow drift-in while it's open). */
export const holdAmount = (u: number, w: CardWindow) => clamp((u - w.inA) / (w.outB - w.inA));

/** Hero copy out, outro copy in. */
export const HERO_OUT: [number, number] = [0.006, 0.07];
export const OUTRO_IN: [number, number] = [0.93, 0.975];

