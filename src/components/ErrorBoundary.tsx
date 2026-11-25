import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  /** Rendered when a child throws during render/commit (e.g. WebGL unavailable). */
  fallback?: ReactNode
  /** Fix pass 6: the boundary used to swallow the error — the caller
      can now record the message and show it on the fallback screen. */
  onError?: (error: Error, info: ErrorInfo) => void
  children: ReactNode
}

type State = { hasError: boolean }

/**
 * Small error boundary for decorative WebGL canvases (hero dust, etc.).
 * Without it, a single `new THREE.WebGLRenderer()` throw during the commit
 * phase unmounts the entire React root — on any browser without WebGL the
 * whole site renders as a black page. With it, the canvas simply disappears
 * and the static hero content stays visible.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the failure visible in the console for debugging; the page itself
    // degrades gracefully to the fallback instead of going blank.
    console.error('[ErrorBoundary] child failed, rendering fallback:', error)
    this.props.onError?.(error, info)
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null
    return this.props.children
  }
}
