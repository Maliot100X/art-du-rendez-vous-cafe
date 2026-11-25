import {type Ref} from 'react';
import {formatPrice, products} from '../content';

/**
 * Visor's hotspot annotation (dot + drawn leader line + glass card), pinned by
 * the Stage to a point on the 3D cup's rim that it projects to the screen.
 */
export function Hotspot({ref}: {ref?: Ref<HTMLDivElement>}) {
  const latte = products[0];
  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute top-0 left-0 z-[15] max-md:hidden" style={{visibility: 'hidden'}}>
      <span className="absolute -top-2 -left-2 grid size-4 place-items-center">
        <span className="absolute size-4 animate-ping rounded-full bg-gold/50" />
        <span className="size-2 rounded-full bg-gold-light shadow-[0_0_14px_3px_rgb(217_166_80/0.8)]" />
      </span>
      <svg className="absolute top-0 left-0 overflow-visible" width="170" height="90" viewBox="0 0 170 90">
        <path d="M0 0 L70 70 L170 70" fill="none" stroke="rgb(226 189 118 / 0.75)" strokeWidth="1" pathLength={1} className="hotspot-line" />
      </svg>
      <div className="absolute top-[40px] left-[170px] w-[220px] rounded-2xl border border-cream/15 bg-ink/45 px-4 py-3 text-cream shadow-[0_20px_50px_-20px_rgb(0_0_0/0.6)] backdrop-blur-md">
        <p className="label text-gold-light">Signature de la maison</p>
        <p className="mt-1 flex items-baseline justify-between gap-3">
          <span className="display text-[22px]">{latte.name.join(' ')}</span>
          <span className="text-[13px] tabular-nums text-cream/80">{formatPrice(latte.price)}</span>
        </p>
      </div>
    </div>
  );
}
