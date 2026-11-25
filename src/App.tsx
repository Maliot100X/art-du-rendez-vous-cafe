import {useCallback, useEffect, useState} from 'react';
import {startScroll} from './lib/scroll';
import {startGlow} from './lib/glow';
import {useRoute} from './lib/router';
import {useReducedMotion} from './hooks/useReducedMotion';
import {Nav} from './components/Nav';
import {Stage} from './components/Stage';
import {Signatures} from './components/Signatures';
import {CarteReel} from './components/CarteReel';
import {Livre} from './components/Livre';
import {Galerie} from './components/Galerie';
import {ParallaxWall} from './components/ParallaxWall';
import {Commande} from './components/Commande';
import {Venir} from './components/Venir';
import {Footer} from './components/Footer';
import {BagDrawer} from './components/BagDrawer';
import {Preloader} from './components/Preloader';
import {Curtain} from './components/Curtain';
import {Finder} from './components/Finder';

const TITLES: Record<string, string> = {
  '/': 'Art du Rendez-Vous — café, bières belges et apéros à Laeken',
  '/carte': 'La carte · 59 boissons — Art du Rendez-Vous',
  '/livre': 'Le livre de la carte — Art du Rendez-Vous',
  '/galerie': 'Galerie — Art du Rendez-Vous',
  '/commande': 'Commande — Art du Rendez-Vous',
  '/venir': 'Venir · Rue des Artistes 1A, Laeken — Art du Rendez-Vous',
};

export default function App() {
  const reduced = useReducedMotion();
  const route = useRoute();
  const [progress, setProgress] = useState(0);
  const onProgress = useCallback((p: number) => setProgress((cur) => Math.max(cur, p)), []);

  useEffect(() => startScroll(reduced), [reduced]);
  useEffect(() => startGlow(), []);
  useEffect(() => {
    document.title = TITLES[route];
    if (route !== '/') setProgress(1);
  }, [route]);

  return (
    <div id="top" data-route={route}>
      <Preloader progress={progress} />
      <Nav />
      <main key={route}>
        {route === '/' && (
          <>
            <Stage onProgress={onProgress} />
            <Signatures />
            <CarteReel />
          </>
        )}
        {route === '/carte' && <CarteReel />}
        {route === '/livre' && <Livre />}
        {route === '/galerie' && (
          <>
            <Galerie />
            <ParallaxWall />
          </>
        )}
        {route === '/commande' && <Commande />}
        {route === '/venir' && <Venir />}
      </main>
      {route !== '/commande' && <Footer />}
      <BagDrawer />
      <Curtain />
      <Finder />
      <div className="grain" aria-hidden />
    </div>
  );
}
