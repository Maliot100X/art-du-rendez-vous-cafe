/** Feeds the cursor position to every [data-glow] card (CSS vars --gx/--gy). */
export function startGlow() {
  const onMove = (e: PointerEvent) => {
    document.querySelectorAll<HTMLElement>('[data-glow]').forEach((el) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--gx', `${e.clientX - r.left}px`);
      el.style.setProperty('--gy', `${e.clientY - r.top}px`);
    });
  };
  window.addEventListener('pointermove', onMove, {passive: true});
  return () => window.removeEventListener('pointermove', onMove);
}
