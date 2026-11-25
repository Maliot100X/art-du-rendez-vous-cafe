/**
 * Data layer — isomorphic (browser + Vite config prerender).
 * Price truth: src/data/menu.json (synced from /workspace/cafe-rdv/content by scripts/sync_content.py).
 * Never hard-code a price anywhere else.
 */
import menu from './menu.json' with { type: 'json' };
import cafe from './cafe.json' with { type: 'json' };
import fr from './i18n-fr.json' with { type: 'json' };
import en from './i18n-en.json' with { type: 'json' };
import sizes from './media-sizes.json' with { type: 'json' };

export { menu, cafe };
export const DICT = { fr, en };
export const t = (key, lang = 'fr') => DICT[lang]?.[key] ?? DICT.fr[key] ?? key;

const fmt = { fr: new Intl.NumberFormat('fr-BE', { style: 'currency', currency: menu.currency }), en: new Intl.NumberFormat('en-BE', { style: 'currency', currency: menu.currency }) };
export const formatPrice = (n, lang = 'fr') => fmt[lang].format(n);

/** Flatten: every drink with its category, image paths and display prices. */
export const drinks = menu.categories.flatMap((c, ci) => c.items.map((d, i) => ({
  ...d,
  category: c.id,
  categoryIndex: ci,
  index: i,
  img: { s: `/media/menu/${d.id}-480.webp`, l: `/media/menu/${d.id}-960.webp`, w: sizes[d.id]?.[0] ?? 960, h: sizes[d.id]?.[1] ?? 1200 },
  /** list of {label, value} — wines carry glass + bottle, everything else one price */
  priceList: d.prices ? Object.entries(d.prices).map(([k, v]) => ({ key: k, value: v })) : [{ key: null, value: d.price }],
  fromPrice: d.prices ? Math.min(...Object.values(d.prices)) : d.price,
})));
if (drinks.length !== 59) throw new Error(`menu.json must hold 59 drinks, found ${drinks.length}`);

export const categories = menu.categories.map((c, ci) => {
  const list = drinks.filter((d) => d.category === c.id);
  return { id: c.id, title: c.title, index: ci, count: list.length, from: Math.min(...list.map((d) => d.fromPrice)), drinks: list, scene: `m${ci + 1}-${c.id}` };
});
export const getDrink = (id) => drinks.find((d) => d.id === id) ?? null;
export const sizeLabel = (key, lang = 'fr') => (key ? menu.sizeLabels[key]?.[lang] ?? key : '');
export const scene = (name) => ({ s: `/media/scenes/${name}-800.webp`, l: `/media/scenes/${name}-1600.webp`, w: sizes[name]?.[0] ?? 1600, h: sizes[name]?.[1] ?? 1000 });

/* ---------- opening hours (Europe/Brussels) ---------- */
const DAY_KEYS = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
/** Brussels wall-clock for a Date, independent of the visitor's zone. */
export function brusselsNow(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((x) => [x.type, x.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { day, min: Number(p.hour) * 60 + Number(p.minute) };
}
export const hoursFor = (dayKey) => cafe.hours.find((h) => h.days.includes(dayKey));
/** Open intervals in "minutes since Monday 00:00" (closing past midnight spills into the next day). */
function intervals() {
  const out = [];
  DAY_KEYS.forEach((k, d) => {
    const h = hoursFor(k); if (!h) return;
    const base = ((d + 6) % 7) * 1440; // Monday = 0
    const o = toMin(h.open); let c = toMin(h.close); if (c <= o) c += 1440;
    out.push([base + o, base + c]);
  });
  return out;
}
export function openStatus(date = new Date()) {
  const { day, min } = brusselsNow(date);
  const week = 7 * 1440; const now = ((day + 6) % 7) * 1440 + min;
  const iv = intervals();
  for (const [a, b] of iv) {
    for (const shift of [0, -week]) {
      if (now >= a + shift && now < b + shift) {
        // merge chained intervals (fri 00-24 → sat 00-24 → sun 00-24 → mon 08…)
        let end = b + shift; let more = true;
        while (more) { more = false; for (const [a2, b2] of iv) for (const s2 of [0, week, -week]) if (a2 + s2 === end % (2 * week) || a2 + s2 === end) { end = b2 + s2; more = true; } if (end - now > week) break; }
        const until = ((end % 1440) + 1440) % 1440;
        return { open: true, until: `${String(Math.floor(until / 60)).padStart(2, '0')}:${String(until % 60).padStart(2, '0')}`, allNight: end - now > 1440 };
      }
    }
  }
  return { open: false };
}
export const DAYS_ORDER = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
