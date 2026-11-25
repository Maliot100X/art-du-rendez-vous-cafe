import { useState } from 'react'
import { Plus } from 'lucide-react'
import { MENU } from '../content'

export interface OrderLine {
  name: string
  price: string
}

export default function MenuSection({ onAdd }: { onAdd: (line: OrderLine) => void }) {
  const [active, setActive] = useState(MENU[0].id)
  const [added, setAdded] = useState<string | null>(null)
  const category = MENU.find((c) => c.id === active) ?? MENU[0]

  const add = (name: string, price: string) => {
    onAdd({ name, price })
    setAdded(name)
    window.setTimeout(() => setAdded((cur) => (cur === name ? null : cur)), 900)
  }

  return (
    <section id="carte" className="relative mx-auto max-w-[1400px] px-4 py-24 sm:px-6 md:py-36">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between" data-reveal>
        <div>
          <p className="font-mono text-label uppercase text-amber">La carte</p>
          <h2 className="mt-3 font-display text-display text-bone">
            Que désirez-<span className="italic text-amber">vous</span> ?
          </h2>
        </div>
        <p className="max-w-md text-body text-bone/70">
          Sept familles, des prix affichés, rien d’autre. La carte est la même au bar et ici — ce que vous lisez est
          ce que vous payez.
        </p>
      </div>

      {/* Tabs — one per category, mono uppercase pills */}
      <div
        className="mt-10 flex flex-wrap gap-2"
        role="tablist"
        aria-label="Catégories de la carte"
        data-reveal
        style={{ ['--d' as string]: '90ms' }}
      >
        {MENU.map((cat) => (
          <button
            key={cat.id}
            type="button"
            role="tab"
            aria-selected={active === cat.id}
            onClick={() => setActive(cat.id)}
            className={`rounded-full border px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-all duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] ${
              active === cat.id
                ? 'border-bone bg-bone text-ink'
                : 'border-line bg-transparent text-bone/70 hover:border-bone/50 hover:text-bone'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div key={category.id} className="mt-10 grid gap-10 lg:grid-cols-[1fr_380px]">
        {/* Items */}
        <div>
          <p className="max-w-lg text-lead italic text-bone/80" data-reveal>
            {category.blurb}
          </p>
          <ul className="mt-8">
            {category.items.map((item, i) => (
              <li
                key={item.name}
                className="group flex items-baseline gap-3 border-b border-line py-4 transition-colors duration-300 hover:border-amber/40"
                data-reveal
                style={{ ['--d' as string]: `${Math.min(i, 6) * 60}ms` }}
              >
                <span className="font-mono text-[11px] text-mist">{String(i + 1).padStart(2, '0')}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-lg font-bold tracking-wide text-bone sm:text-xl">
                    {item.name}
                  </span>
                  {item.note && <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-mist">{item.note}</span>}
                </span>
                <span className="hidden flex-1 border-b border-dotted border-bone/25 sm:block" aria-hidden="true" />
                <span className="font-mono text-sm font-medium tabular-nums text-amber">{item.price}</span>
                <button
                  type="button"
                  onClick={() => add(item.name, item.price)}
                  aria-label={`Ajouter ${item.name} à la commande`}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-all duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] ${
                    added === item.name
                      ? 'border-amber bg-amber text-ink'
                      : 'border-line text-bone/70 hover:scale-110 hover:border-amber hover:text-amber'
                  }`}
                >
                  <Plus size={16} />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-mist">
            Prix en euros, taxes comprises · Le + ajoute à votre commande
          </p>
        </div>

        {/* Category image — crossfades per tab */}
        <figure className="relative hidden overflow-hidden rounded-[1.75rem] lg:block" data-reveal style={{ ['--d' as string]: '120ms' }}>
          <img
            src={category.image}
            alt={category.imageAlt}
            className="h-full w-full object-cover"
            loading="lazy"
          />
          <div
            className="absolute inset-0"
            aria-hidden="true"
            style={{ background: 'linear-gradient(180deg, transparent 55%, rgba(13,10,8,0.85))' }}
          />
          <figcaption className="absolute inset-x-0 bottom-0 p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-amber">{category.label}</p>
            <p className="mt-2 font-display text-2xl italic text-bone">{category.blurb}</p>
          </figcaption>
        </figure>
      </div>
    </section>
  )
}
