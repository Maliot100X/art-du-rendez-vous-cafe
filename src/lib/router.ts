import {useSyncExternalStore} from 'react';
import {scrollToY} from './scroll';

/**
 * Hash router for the tabs (#/carte, #/livre …) with a curtain transition:
 * navigate() closes a circular look-coloured curtain from the click point,
 * swaps the page under it, jumps to the top, then opens it again.
 */
export const ROUTES = [
  {path: '/', label: 'Accueil'},
  {path: '/carte', label: 'La carte'},
  {path: '/livre', label: 'Le livre'},
  {path: '/galerie', label: 'Galerie'},
  {path: '/commande', label: 'Commande'},
  {path: '/venir', label: 'Venir'},
] as const;
export type RoutePath = (typeof ROUTES)[number]['path'];

const parse = (): RoutePath => {
  const h = location.hash.replace(/^#/, '').split('?')[0];
  const p = (h.startsWith('/') ? h : '/') as RoutePath;
  return ROUTES.some((r) => r.path === p) ? p : '/';
};

type Curtain = {phase: 'idle' | 'closing' | 'opening'; x: number; y: number; label: string};
let route: RoutePath = typeof location !== 'undefined' ? parse() : '/';
let curtain: Curtain = {phase: 'idle', x: 50, y: 50, label: ''};
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const next = parse();
    if (next !== route) {
      route = next;
      scrollToY(0, true);
      emit();
    }
  });
}

export const CLOSE_MS = 650;
export function navigate(path: RoutePath, e?: {clientX: number; clientY: number}) {
  if (curtain.phase !== 'idle') return;
  if (path === route) {
    window.scrollTo({top: 0, behavior: 'smooth'});
    return;
  }
  const label = ROUTES.find((r) => r.path === path)?.label ?? '';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const swap = () => {
    route = path;
    history.pushState(null, '', path === '/' ? '#/' : `#${path}`);
    scrollToY(0, true);
  };
  if (reduced) {
    swap();
    emit();
    return;
  }
  curtain = {phase: 'closing', x: e ? (e.clientX / innerWidth) * 100 : 50, y: e ? (e.clientY / innerHeight) * 100 : 50, label};
  emit();
  setTimeout(() => {
    swap();
    curtain = {...curtain, phase: 'opening'};
    emit();
    setTimeout(() => {
      curtain = {...curtain, phase: 'idle'};
      emit();
    }, CLOSE_MS + 250);
  }, CLOSE_MS + 150);
}

export const useRoute = () => useSyncExternalStore(subscribe, () => route);
export const useCurtain = () => useSyncExternalStore(subscribe, () => curtain);

/** onClick for <a href="#/x"> links. */
export const go = (path: RoutePath) => (e: React.MouseEvent) => {
  e.preventDefault();
  navigate(path, e);
};
