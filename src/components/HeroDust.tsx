import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'
import { pixelRatioCap } from '../lib/perf'

/**
 * Dust motes drifting over the hero — the selene dust veil, as real 3D.
 *
 * Its own lazy chunk (see Hero.tsx): @react-three/fiber, postprocessing
 * and three.js itself load only with the Home tab's hero, never with
 * the first paint — three used to ride in the main bundle.
 */

/** Dust motes drifting over the hero — the selene dust veil, as real 3D. */
function Dust() {
  const ref = useRef<THREE.Points>(null!)
  const count = 260
  const positions = useRef<Float32Array | null>(null)
  if (positions.current === null) {
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 16
      arr[i * 3 + 1] = (Math.random() - 0.5) * 9
      arr[i * 3 + 2] = (Math.random() - 0.5) * 4 - 1
    }
    positions.current = arr
  }
  const texture = useRef<THREE.Texture | null>(null)
  if (texture.current === null) {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(232,163,61,1)')
    g.addColorStop(0.4, 'rgba(232,163,61,0.45)')
    g.addColorStop(1, 'rgba(232,163,61,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
    texture.current = new THREE.CanvasTexture(canvas)
  }

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    ref.current.rotation.y = Math.sin(t * 0.05) * 0.08
    ref.current.position.y = Math.sin(t * 0.12) * 0.25
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions.current, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.14}
        map={texture.current}
        transparent
        opacity={0.75}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  )
}

export default function HeroDust() {
  return (
    <Canvas
      dpr={[1, pixelRatioCap()]}
      camera={{ position: [0, 0, 7], fov: 50 }}
      gl={{ antialias: true, alpha: true }}
      style={{ pointerEvents: 'none' }}
    >
      <Dust />
      <EffectComposer>
        <Bloom intensity={0.55} luminanceThreshold={0.55} luminanceSmoothing={0.2} mipmapBlur />
      </EffectComposer>
    </Canvas>
  )
}
