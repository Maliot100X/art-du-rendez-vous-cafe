import { lazy, Suspense, useEffect, useState } from 'react'
import Nav from './components/Nav'
import Hero from './components/Hero'
import MenuSection, { type OrderLine } from './components/MenuSection'
import Visit from './components/Visit'
import Footer from './components/Footer'
import { startScroll, useReducedMotion } from './lib/scroll'
import { useReveal } from './lib/useReveal'

// Below-fold sections load in their own chunks so the first paint stays
// lean (Three.js + postprocessing already make the main bundle large).
const Atmosphere = lazy(() => import('./components/Atmosphere'))
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
      <Nav />
      <main>
        <Hero />
        <MenuSection onAdd={addToOrder} />
        <Suspense fallback={null}>
          <Atmosphere />
        </Suspense>
        <Visit />
        <Suspense fallback={null}>
          <Agent order={order} onAdd={addToOrder} onRemove={removeFromOrder} onClear={clearOrder} />
        </Suspense>
      </main>
      <Footer />
    </div>
  )
}
