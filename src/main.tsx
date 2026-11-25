import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/bodoni-moda'
import '@fontsource-variable/bodoni-moda/wght-italic.css'
import '@fontsource-variable/albert-sans'
import '@fontsource/martian-mono/400.css'
import '@fontsource/martian-mono/500.css'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'

/**
 * Root boundary: without it, any render error in a lazy chunk (a chunk
 * failing to load over a slow connection, a WebGL stage throwing during
 * commit) unmounts the entire React tree and the page goes black — no
 * header, no tabs, nothing. With it, the visitor gets a readable error
 * and a reload button instead of a black page.
 */
function RootFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0d0a08] px-6 text-center text-[#ece5da]">
      <p className="font-display text-3xl italic">Oups — le café n'a pas pu s'ouvrir.</p>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-[#9a8f80]">
        Une partie du site n'a pas pu se charger. Rechargez la page — le reste du site fonctionne normalement.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 min-h-11 rounded-full bg-[#ece5da] px-7 py-3 text-sm font-bold text-[#0d0a08]"
      >
        Recharger la page
      </button>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={<RootFallback />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
