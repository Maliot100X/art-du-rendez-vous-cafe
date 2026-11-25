import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {NORI_FACE, type Emotion} from '../lib/emotion';

/**
 * The café host as a Layer2D avatar: "Nori — Cafe-Pop Calico Cat" (MIT,
 * 92 layers, 12 spring chains for hair/ears/ribbons, 37 expressions, AEIOU
 * phoneme lip-sync), played by the MIT Layer2D viewer from /host-l2d/ in a
 * transparent same-origin frame layered over the three.js scene.
 * attachVoice(stream) hands the agent's audio to the player, which delays it
 * ~90 ms and drives the mouth from a look-ahead phoneme classifier.
 *
 * ?host=live2d swaps in a Cubism 4 model instead: pixi-live2d-display (MIT)
 * playing Live2D's "Hiyori" sample from /host-live2d/, same handle API.
 */
export const LIVE2D = typeof location !== 'undefined' && new URLSearchParams(location.search).get('host') === 'live2d';
type L2DWin = Window & {
  __attachTestObsAudioStream?: (s: MediaStream) => void;
  __detachTestObsAudio?: () => void;
  attachVoice?: (s: MediaStream) => boolean;
  detachVoice?: () => void;
  setEmotion?: (e: Emotion) => void;
  focusAt?: (x: number, y: number) => void;
};
export type L2DHandle = {attachVoice(stream: MediaStream): boolean; detachVoice(): void; setFace(name: string | null): void; setEmotion(e: Emotion): void};

export const L2DHost = forwardRef<L2DHandle, {className?: string; view?: 'bust' | 'full'}>(function L2DHost({className = '', view = 'bust'}, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  useImperativeHandle(ref, () => ({
    attachVoice(stream) {
      const w = frame.current?.contentWindow as L2DWin | null;
      if (LIVE2D) return !!w?.attachVoice?.(stream);
      if (!w?.__attachTestObsAudioStream) return false;
      w.__attachTestObsAudioStream(stream);
      return true;
    },
    setFace(name) {
      // the player's own expression buttons (hidden in OBS mode) toggle faces
      const doc = frame.current?.contentDocument;
      if (!doc) return;
      const on = doc.querySelector<HTMLButtonElement>('#faces button[aria-pressed="true"]');
      if (on && on.dataset.face === name) return;
      if (!name) {
        on?.click();
        return;
      }
      doc.querySelector<HTMLButtonElement>(`#faces button[data-face="${name}"]`)?.click();
    },
    setEmotion(e) {
      const w = frame.current?.contentWindow as L2DWin | null;
      if (LIVE2D) w?.setEmotion?.(e);
      else this.setFace(NORI_FACE[e]);
    },
    detachVoice() {
      const w = frame.current?.contentWindow as L2DWin | null;
      if (LIVE2D) w?.detachVoice?.();
      else w?.__detachTestObsAudio?.();
    },
  }));
  useEffect(() => {
    if (!LIVE2D) return;
    // the frame ignores the pointer; forward it so Hiyori's head and eyes follow
    const move = (e: PointerEvent) => {
      const f = frame.current;
      if (!f) return;
      const r = f.getBoundingClientRect();
      const x = ((e.clientX - (r.left + r.width / 2)) / innerWidth) * 2;
      const y = -((e.clientY - (r.top + r.height * 0.25)) / innerHeight) * 2;
      (f.contentWindow as L2DWin | null)?.focusAt?.(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
    };
    addEventListener('pointermove', move);
    return () => removeEventListener('pointermove', move);
  }, []);
  return (
    <iframe
      ref={frame}
      title={LIVE2D ? 'Hiyori, l’hôtesse du café' : 'Nori, l’hôte du café'}
      src={LIVE2D ? '/host-live2d/index.html' : `/host-l2d/index.html?model=/host-l2d/nori.l2d&obs=1&bg=transparent&saved=0&view=${view}&face=Happy`}
      onLoad={() => setReady(true)}
      className={`pointer-events-none border-0 bg-transparent transition-opacity duration-1000 ${ready ? 'opacity-100' : 'opacity-0'} ${className}`}
      // the player sets color-scheme: dark; match it or Chromium paints the frame opaque
      style={{colorScheme: 'dark', background: 'transparent', maskImage: 'linear-gradient(#000 84%, transparent)', WebkitMaskImage: 'linear-gradient(#000 84%, transparent)'}}
      allow="autoplay"
      tabIndex={-1}
      data-host={LIVE2D ? 'live2d' : 'layer2d'}
    />
  );
});
