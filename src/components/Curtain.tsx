import {useCurtain} from '../lib/router';

/** The tab transition: a warm circular curtain with the café wordmark. */
export function Curtain() {
  const c = useCurtain();
  const open = c.phase === 'closing';
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[60] grid place-items-center"
      style={{
        background: 'radial-gradient(120% 90% at 50% 30%, #ff8a3d 0%, #e2531c 45%, #5a1e10 100%)',
        clipPath: `circle(${open ? 150 : 0}% at ${c.x}% ${c.y}%)`,
        transition: c.phase === 'idle' ? 'none' : 'clip-path 650ms cubic-bezier(.7,0,.2,1)',
        ...(c.phase === 'opening' ? {clipPath: `circle(0% at 50% 50%)`} : {}),
      }}
    >
      <div className={`text-center text-[#fff1dc] transition-all duration-500 ${open ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
        <p className="label text-[#fff1dc]/70">Art du Rendez-Vous</p>
        <p className="display mt-3 text-[clamp(48px,8vw,128px)] italic">{c.label}</p>
      </div>
    </div>
  );
}
