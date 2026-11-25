import {forwardRef, useImperativeHandle, useRef, useState} from 'react';

/**
 * The café host as a Layer2D avatar: "Nori — Cafe-Pop Calico Cat" (MIT,
 * 92 layers, 12 spring chains for hair/ears/ribbons, 37 expressions, AEIOU
 * phoneme lip-sync), played by the MIT Layer2D viewer from /host-l2d/ in a
 * transparent same-origin frame layered over the three.js scene.
 * attachVoice(stream) hands the agent's audio to the player, which delays it
 * ~90 ms and drives the mouth from a look-ahead phoneme classifier.
 */
export type L2DHandle = {attachVoice(stream: MediaStream): boolean; detachVoice(): void};

export const L2DHost = forwardRef<L2DHandle, {className?: string; view?: 'bust' | 'full'}>(function L2DHost({className = '', view = 'bust'}, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  useImperativeHandle(ref, () => ({
    attachVoice(stream) {
      const w = frame.current?.contentWindow as (Window & {__attachTestObsAudioStream?: (s: MediaStream) => void}) | null;
      if (!w?.__attachTestObsAudioStream) return false;
      w.__attachTestObsAudioStream(stream);
      return true;
    },
    detachVoice() {
      const w = frame.current?.contentWindow as (Window & {__detachTestObsAudio?: () => void}) | null;
      w?.__detachTestObsAudio?.();
    },
  }));
  return (
    <iframe
      ref={frame}
      title="Nori, l’hôte du café"
      src={`/host-l2d/index.html?model=/host-l2d/nori.l2d&obs=1&bg=transparent&saved=0&view=${view}&face=Happy`}
      onLoad={() => setReady(true)}
      className={`pointer-events-none border-0 bg-transparent transition-opacity duration-1000 ${ready ? 'opacity-100' : 'opacity-0'} ${className}`}
      // the player sets color-scheme: dark; match it or Chromium paints the frame opaque
      style={{colorScheme: 'dark', background: 'transparent'}}
      allow="autoplay"
      tabIndex={-1}
      data-host="layer2d"
    />
  );
});
