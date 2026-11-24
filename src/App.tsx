import { useEffect, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import { motion } from 'framer-motion'
import gsap from 'gsap'
import { ArrowRight, Boxes, Palette, Sparkles, Zap } from 'lucide-react'
import * as THREE from 'three'

/*
 * SPEC RECEIPT (ai-3d-animator intake defaults, skill §1/§3)
 * Subject: Puffy blob hero — one subject, one gag (hop + settle), one camera drift
 * Style: Puffy / Bubbly — palette #FFADAD / #FFD6A5 / #FDFFB6 / #B7E4C7 / #A3C9F9,
 *   bg #FFF6EC, accent #E8639B. Zero sharp edges, MeshPhysicalMaterial
 *   roughness 0.44 / clearcoat 0.5 / sheen 0.4. No default gray anywhere.
 * Lighting: hemisphere #FFF3E0/#FFD9E0 0.55 + warm key 1.6 (soft shadows, 2048 map)
 *   + cool fill 0.5 + pink rim 0.7. ACES tone mapping, exposure 1.12.
 * Motion: breathing (period 2s, divides the 4s loop), gentle ±5° sway,
 *   one hop per 4s loop with squash & stretch + settle (easeOutBack-style),
 *   orbiting mini-spheres on a turntable (linear allowed there only).
 * Output: live interactive web hero (Path A — Three.js / React Three Fiber).
 */

const LOOP = 4 // seconds — every continuous motion's period divides this

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x))
}

function easeOutBack(x: number) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

/** Puffy blob: squashed sphere body, sphere eyes 60% up the head, pastel cheeks. */
function PuffyBlob() {
  const group = useRef<THREE.Group>(null!)
  const body = useRef<THREE.Mesh>(null!)

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    const lt = t % LOOP // loop-local time — stateless pose, seam is invisible

    // Breathing: scale Y 1 -> 1.015, period 2s (divides LOOP)
    const breathe = 1 + 0.015 * Math.sin((2 * Math.PI * t) / 2)
    // Gentle sway, ±5 degrees, period 4s
    const sway = (5 * Math.PI) / 180 * Math.sin((2 * Math.PI * t) / LOOP)

    // One hop per loop: anticipation squash 1.0-1.25s, flight 1.25-1.95s,
    // landing squash + settle by 2.4s, rest until the loop wraps.
    const anticipation = clamp01((lt - 1.0) / 0.25) // 0..1
    const flight = clamp01((lt - 1.25) / 0.7)
    const airborne = Math.sin(Math.PI * flight) // 0 -> 1 -> 0 parabola
    const landing = clamp01((lt - 1.95) / 0.45)
    const settle = easeOutBack(landing) // overshoot ~6% then rest

    const squashY =
      breathe * (1 - 0.18 * airborne - 0.16 * anticipation * (1 - flight) + 0.14 * (1 - settle) * (landing > 0 ? 1 : 0))
    const squashXZ = 1 + (1 - squashY) * 0.7

    group.current.position.y = airborne * 0.9
    group.current.rotation.z = sway
    body.current.scale.set(squashXZ, squashY, squashXZ)
  })

  return (
    <group ref={group}>
      {/* Body — blush, high-segment sphere, Puffy material recipe */}
      <mesh ref={body} castShadow position={[0, 1.35, 0]}>
        <sphereGeometry args={[1, 48, 32]} />
        <meshPhysicalMaterial
          color="#FFADAD"
          roughness={0.44}
          clearcoat={0.5}
          clearcoatRoughness={0.5}
          sheen={0.4}
          sheenColor="#ffffff"
        />
      </mesh>
      {/* Belly — peach, slightly flattened */}
      <mesh position={[0, 1.05, 0.62]} scale={[0.62, 0.55, 0.4]}>
        <sphereGeometry args={[1, 32, 24]} />
        <meshPhysicalMaterial color="#FFD6A5" roughness={0.44} clearcoat={0.5} sheen={0.4} sheenColor="#ffffff" />
      </mesh>
      {/* Eyes — white sphere + dark pupil, 60% up the head, never centered */}
      {([-0.38, 0.38] as const).map((x) => (
        <group key={x} position={[x, 1.95, 0.86]}>
          <mesh>
            <sphereGeometry args={[0.17, 24, 18]} />
            <meshPhysicalMaterial color="#ffffff" roughness={0.3} clearcoat={0.6} />
          </mesh>
          <mesh position={[0, 0.02, 0.12]}>
            <sphereGeometry args={[0.085, 24, 18]} />
            <meshPhysicalMaterial color="#3a2e39" roughness={0.25} clearcoat={0.6} />
          </mesh>
        </group>
      ))}
      {/* Cheeks — flattened pastel spheres, opacity ~0.7 */}
      {([-0.66, 0.66] as const).map((x) => (
        <mesh key={x} position={[x, 1.55, 0.8]} scale={[1, 0.6, 0.4]}>
          <sphereGeometry args={[0.16, 24, 18]} />
          <meshPhysicalMaterial color="#ff8fa3" roughness={0.5} transparent opacity={0.7} />
        </mesh>
      ))}
      {/* Arms — peach capsules */}
      {([-1, 1] as const).map((side) => (
        <mesh key={side} position={[side * 1.02, 1.25, 0]} rotation={[0, 0, side * -0.5]} castShadow>
          <capsuleGeometry args={[0.16, 0.5, 8, 24]} />
          <meshPhysicalMaterial color="#FFD6A5" roughness={0.44} clearcoat={0.5} sheen={0.4} sheenColor="#ffffff" />
        </mesh>
      ))}
    </group>
  )
}

/** Three pastel mini-spheres orbiting on a turntable (linear turntable motion). */
function OrbitingSpheres() {
  const group = useRef<THREE.Group>(null!)
  useFrame(({ clock }) => {
    group.current.rotation.y = clock.getElapsedTime() * 0.5
  })
  const items = [
    { color: '#FDFFB6', angle: 0, y: 2.4 },
    { color: '#B7E4C7', angle: (2 * Math.PI) / 3, y: 1.5 },
    { color: '#A3C9F9', angle: (4 * Math.PI) / 3, y: 2.1 },
  ]
  return (
    <group ref={group}>
      {items.map((s) => (
        <mesh key={s.color} position={[Math.cos(s.angle) * 2.3, s.y, Math.sin(s.angle) * 2.3]} castShadow>
          <sphereGeometry args={[0.18, 32, 24]} />
          <meshPhysicalMaterial color={s.color} roughness={0.44} clearcoat={0.5} sheen={0.4} sheenColor="#ffffff" />
        </mesh>
      ))}
    </group>
  )
}

/** The 3D hero scene — soft-box rig from the Puffy bible, contact shadow grounding. */
function HeroScene() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 1.7, 7.5], fov: 40 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.12
      }}
      data-testid="hero-3d-canvas"
    >
      <color attach="background" args={['#FFF6EC']} />
      <fog attach="fog" args={['#FFF6EC', 14, 30]} />
      <hemisphereLight args={['#FFF3E0', '#FFD9E0', 0.55]} />
      <directionalLight
        position={[6, 9, 6]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-7, 4, -2]} intensity={0.5} color="#CFE3FF" />
      <directionalLight position={[-2, 6, -8]} intensity={0.7} color="#FFD1DC" />
      <PuffyBlob />
      <OrbitingSpheres />
      {/* Ground: pastel disc + contact shadow so the blob is grounded, never floating */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <circleGeometry args={[3.4, 64]} />
        <meshStandardMaterial color="#FFE9D6" roughness={0.9} />
      </mesh>
      <ContactShadows position={[0, 0, 0]} opacity={0.35} scale={12} blur={2.4} far={4} color="#8a5a6b" />
    </Canvas>
  )
}

const STACK = [
  { name: 'Vite', version: '8.3.6' },
  { name: 'React', version: '19.3.1' },
  { name: 'Three.js', version: '0.187.0' },
  { name: 'Tailwind CSS', version: '4.3.5' },
  { name: 'GSAP', version: '3.15.1' },
  { name: 'Framer Motion', version: '14.14.0' },
]

export default function App() {
  const statsRef = useRef<HTMLDivElement>(null)

  // GSAP entrance for the stats row (easeOutBack-style overshoot)
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.gsap-stat',
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, stagger: 0.12, duration: 0.7, ease: 'back.out(1.7)', delay: 0.5 },
      )
    }, statsRef)
    return () => ctx.revert()
  }, [])

  return (
    <div className="min-h-screen bg-[#FFF6EC] text-[#3a2e39]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#E8639B] text-white">
            <Sparkles size={18} />
          </span>
          <span className="text-lg font-bold tracking-tight">Pro Studio</span>
        </div>
        <nav className="hidden items-center gap-6 text-sm font-medium text-[#3a2e39]/70 md:flex">
          <span>Work</span>
          <span>Styles</span>
          <span>Process</span>
          <span>Contact</span>
        </nav>
        <a
          href="#hero"
          className="rounded-full bg-[#3a2e39] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#E8639B]"
        >
          Start a project
        </a>
      </header>

      <main id="hero" className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-16 pt-6 lg:grid-cols-2">
        {/* Copy — Framer Motion entrance */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <p className="inline-flex items-center gap-2 rounded-full bg-[#FFD6A5]/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#3a2e39]/80">
            <Palette size={14} /> Puffy / Bubbly — ai-3d-animator style 01
          </p>
          <h1 className="mt-5 text-5xl font-extrabold leading-[1.05] tracking-tight md:text-6xl">
            Websites with real <span className="text-[#E8639B]">3D soul</span>, built properly.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-[#3a2e39]/70">
            A professional web studio stack — Vite, React, Tailwind, Three.js, GSAP and Framer Motion — driving one
            Puffy-style 3D hero, animated with squash &amp; stretch, eased motion and a soft-box light rig. No
            shortcuts, no default gray.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href="#hero"
              className="inline-flex items-center gap-2 rounded-full bg-[#E8639B] px-6 py-3 font-semibold text-white shadow-lg shadow-[#E8639B]/30 transition hover:brightness-110"
            >
              See the 3D hero <ArrowRight size={18} />
            </a>
            <span className="inline-flex items-center gap-2 rounded-full border-2 border-[#3a2e39]/15 bg-white/70 px-6 py-3 font-semibold">
              <Boxes size={18} /> React Three Fiber
            </span>
          </div>

          {/* Stats — GSAP entrance */}
          <div ref={statsRef} className="mt-10 grid max-w-md grid-cols-3 gap-4">
            {[
              { icon: Zap, value: '60 fps', label: 'Real-time 3D' },
              { icon: Palette, value: '14', label: 'Art styles' },
              { icon: Boxes, value: '5', label: 'Rigged models' },
            ].map((s) => (
              <div key={s.label} className="gsap-stat rounded-2xl bg-white/80 p-4 shadow-sm">
                <s.icon size={18} className="text-[#E8639B]" />
                <p className="mt-2 text-xl font-extrabold">{s.value}</p>
                <p className="text-xs font-medium text-[#3a2e39]/60">{s.label}</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* 3D hero — React Three Fiber Canvas */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: [0.34, 1.56, 0.64, 1], delay: 0.15 }}
          className="h-[420px] overflow-hidden rounded-[2rem] border border-[#FFD6A5]/60 bg-[#FFF6EC] shadow-xl shadow-[#FFADAD]/30 md:h-[520px]"
        >
          <HeroScene />
        </motion.div>
      </main>

      <footer className="border-t border-[#FFD6A5]/60 py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-6 text-xs font-semibold text-[#3a2e39]/60">
          <span>Stack verified by build:</span>
          {STACK.map((s) => (
            <span key={s.name}>
              {s.name} {s.version}
            </span>
          ))}
        </div>
      </footer>
    </div>
  )
}
