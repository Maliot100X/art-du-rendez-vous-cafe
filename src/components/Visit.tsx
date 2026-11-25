import { useEffect, useRef } from 'react'
import { MapPin, Star } from 'lucide-react'
import { CAFE, VISIT } from '../content'
import { onFrame } from '../lib/scroll'
import { pinProgress } from '../lib/math'

/** Visit: address, hours, map link, and a day-timeline drawn by scroll. */
export default function Visit() {
  const sectionRef = useRef<HTMLElement>(null)
  const lineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return onFrame(() => {
      const section = sectionRef.current
      const line = lineRef.current
      if (!section || !line) return
      const { p, rect, vh } = pinProgress(section)
      if (rect.bottom < 0 || rect.top > vh) return
      line.style.transform = `scaleX(${p})`
    })
  }, [])

  return (
    <section id="venir" ref={sectionRef} className="relative mx-auto max-w-[1400px] px-4 py-24 sm:px-6 md:py-36">
      <div data-reveal>
        <p className="font-mono text-label uppercase text-amber">{VISIT.eyebrow}</p>
        <h2 className="mt-3 font-display text-display text-bone">{VISIT.title}</h2>
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-2">
        <div data-reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mist">{VISIT.addressLabel}</p>
          <p className="mt-3 font-display text-3xl leading-tight text-bone">{CAFE.address}</p>
          <p className="mt-3 flex items-center gap-2 text-body text-bone/70">
            <Star size={15} className="fill-amber text-amber" /> {VISIT.ratingLine}
          </p>
          <p className="mt-2 text-sm text-mist">{CAFE.mapsNameNote}</p>
          <a
            href={CAFE.mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-bone px-7 py-3.5 text-sm font-bold text-ink transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:scale-[1.04]"
          >
            <MapPin size={16} /> {VISIT.mapsCta}
          </a>
        </div>

        <div data-reveal style={{ ['--d' as string]: '120ms' }}>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mist">{VISIT.hoursLabel}</p>
          <ul className="mt-3">
            {VISIT.hours.map((row) => (
              <li key={row.days} className="flex items-baseline justify-between gap-3 border-b border-line py-4">
                <span className="font-display text-xl text-bone">{row.days}</span>
                <span className="hidden flex-1 border-b border-dotted border-bone/25 sm:block" aria-hidden="true" />
                <span className="font-mono text-sm tabular-nums text-amber">{row.time}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* The day, drawn as you scroll (selene Trajectory grammar) */}
      <div className="mt-20" data-reveal>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mist">Une journée au café</p>
        <div className="relative mt-8 h-px bg-bone/15">
          <div
            ref={lineRef}
            className="absolute inset-0 origin-left bg-amber will-change-transform"
            style={{ transform: 'scaleX(0)' }}
          />
        </div>
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {VISIT.dayTimeline.map((stop, i) => (
            <div key={stop.time} className="border-l border-line pl-4">
              <p className="font-mono text-sm tabular-nums text-amber">{stop.time}</p>
              <p className="mt-2 text-body text-bone/80">{stop.label}</p>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-mist">
                Étape 0{i + 1} / 04
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
