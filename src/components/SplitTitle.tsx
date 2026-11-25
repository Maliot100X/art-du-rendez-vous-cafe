import {createElement, useEffect, useRef} from 'react';
import {gsap} from '../lib/motion';

/**
 * mojito-cocktail's split-letter title, rendered by React (no DOM surgery):
 * every character sits in its own mask and rises with a stagger when the
 * title scrolls in (GSAP + ScrollTrigger). The italic accent keeps its colour.
 */
type Props = {as?: 'h1' | 'h2' | 'p'; id?: string; text: string; em?: string; className?: string; emClassName?: string};

const chars = (s: string, key: string) =>
  s.split(/(\s+)/).map((w, i) =>
    /^\s+$/.test(w) || !w ? (
      ' '
    ) : (
      <span key={`${key}${i}`} className="split-word">
        {[...w].map((c, j) => (
          <span key={j} className="split-mask">
            <span className="split-char">{c}</span>
          </span>
        ))}
      </span>
    ),
  );

export function SplitTitle({as = 'h2', id, text, em, className = '', emClassName = 'text-gold-light'}: Props) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = gsap.from(el.querySelectorAll('.split-char'), {
      yPercent: 115,
      rotate: 8,
      opacity: 0,
      duration: 1,
      ease: 'expo.out',
      stagger: 0.024,
      delay: 0.15,
      scrollTrigger: {trigger: el, start: 'top 95%', once: true},
    });
    return () => {
      t.scrollTrigger?.kill();
      t.kill();
    };
  }, []);
  return createElement(
    as,
    {ref, id, className, 'aria-label': em ? `${text} ${em}` : text},
    <span aria-hidden="true">
      {chars(text, 'a')}
      {em && (
        <>
          {' '}
          <em className={emClassName}>{chars(em, 'b')}</em>
        </>
      )}
    </span>,
  );
}
