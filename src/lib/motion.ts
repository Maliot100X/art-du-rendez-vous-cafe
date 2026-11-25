import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CustomEase } from 'gsap/CustomEase';

/**
 * The one motion setup for the site. GSAP + ScrollTrigger are registered
 * here, once, and every component imports them from this module — never
 * from 'gsap' directly, so registration can never be missed or doubled.
 *
 * Easing is the Scrolltide signature everywhere: cubic-bezier(0.2, 0.7,
 * 0.1, 1). GSAP gets it as a named CustomEase ('silk'); Framer Motion
 * gets it as a bezier array (EASE_SILK). Same curve, both libraries.
 */

gsap.registerPlugin(ScrollTrigger, CustomEase);
CustomEase.create('silk', 'M0,0 C0.2,0.7 0.1,1 1,1');

export { gsap, ScrollTrigger };

/** GSAP ease name for the silk curve. */
export const GSAP_EASE_SILK = 'silk';

/** Framer Motion bezier for the silk curve. */
export const EASE_SILK: [number, number, number, number] = [0.2, 0.7, 0.1, 1];

/** The silk curve as a CSS string (for inline styles / transitions). */
export const EASE_SILK_CSS = 'cubic-bezier(0.2, 0.7, 0.1, 1)';
