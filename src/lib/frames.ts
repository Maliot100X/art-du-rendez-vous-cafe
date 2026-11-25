/**
 * NAÏADE ran its Stage off a 481-frame WebP film (24 fps, 20 s). The café keeps
 * the exact same clock — the remap, beats and playhead chase all speak in
 * "film seconds" — but the picture is now a live three.js scene
 * (src/gl/cafeScene.ts), so there are no frames to stream.
 */
export const FPS = 24;
export const FRAME_COUNT = 481;
export const DURATION = (FRAME_COUNT - 1) / FPS; // 20 s of camera move
