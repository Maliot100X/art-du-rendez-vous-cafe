import { lazy, Suspense, useEffect, useState } from 'react'
import Nav from './components/Nav'
import Hero from './components/Hero'
import MenuSection, { type OrderLine } from './components/MenuSection'
import Visit from './components/Visit'
import Footer from './components/Footer'
import FluidBackground, { FluidFallback } from './components/FluidBackground'
import ErrorBoundary from './components/ErrorBoundary'
import { startScroll, useReducedMotion } from './lib/scroll'
import { useReveal } from './lib/useReveal'

// Below-fold sections load in their own chunks so the first paint stays
// lean (Three.js + postprocessing already make the main bundle large).
// Each Suspense fallback reserves roughly the section's real height:
// without it the document grows ~2.7x as the chunks land (measured
// 4832px → 12932px at 390px), so an anchor scroll fired early lands in
// the wrong section — that is how the Visit "ÉTAPE" labels ended up at
// the top of the viewport after tapping the agent CTA. Heights are
// tuned from the measured 390px layout; they only need to be close,
// scrollToHash re-asserts the landing if the target still moves.
const Atmosphere = lazy(() => import('./components/Atmosphere'))
const MenuBook = lazy(() => import('./components/MenuBook'))
const Gallery = lazy(() => import('./components/Gallery'))
const Agent = lazy(() => import('./components/Agent'))

export default function App() {
  const [order, setOrder] = useState<OrderLine[]>([])
  const reducedMotion = useReducedMotion()

  // One global rAF loop: Lenis + every scroll subscriber. Lenis is off
  // entirely when the visitor prefers reduced motion.
  useEffect(() => startScroll(reducedMotion), [reducedMotion])
  useReveal()

  const addToOrder = (line: OrderLine) => setOrder((prev) => [...prev, line])
  const removeFromOrder = (index: number) => setOrder((prev) => prev.filter((_, i) => i !== index))
  const clearOrder = () => setOrder([])

  return (
    <div className="min-h-screen bg-ink font-sans text-bone">
      <div className="grain" aria-hidden="true" />
      {/* Fluid sim behind everything (z-0); main + footer sit above it
          (relative z-10) so the opaque canvas can never cover content.
          The boundary keeps a WebGL failure from blanking the page. */}
      <ErrorBoundary fallback={<FluidFallback />}>
        <FluidBackground />
      </ErrorBoundary>
      <Nav />
      <main className="relative z-10">
        <Hero />
        <MenuSection onAdd={addToOrder} />
        <Suspense fallback={<div className="min-h-[100svh]" aria-hidden="true" />}>
          <MenuBook />
        </Suspense>
        <Suspense fallback={<div className="min-h-[420svh]" aria-hidden="true" />}>
          <Atmosphere />
        </Suspense>
        <Suspense fallback={<div className="min-h-[170svh]" aria-hidden="true" />}>
          <Gallery />
        </Suspense>
        <Visit />
        <Suspense fallback={<div className="min-h-[170svh]" aria-hidden="true" />}>
          <Agent order={order} onAdd={addToOrder} onRemove={removeFromOrder} onClear={clearOrder} />
        </Suspense>
      </main>
      <Footer />
    </div>
  )
}
