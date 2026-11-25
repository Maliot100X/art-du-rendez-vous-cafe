import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/bodoni-moda'
import '@fontsource-variable/bodoni-moda/wght-italic.css'
import '@fontsource-variable/albert-sans'
import '@fontsource/martian-mono/400.css'
import '@fontsource/martian-mono/500.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
