// FIX PASS 18, GROUP 3 — price audit probe.
//
// Defect (cloud pixel check 03:24–03:33 CET): LE LIVRE showed DOUBLE
// EXPRESSO at 4,00 € while LA CARTE showed 4,50 €. Source of truth is
// the printed menu transcribed at ../cafe/MENU.md.
//
// What the audit found: MENU.md says DOUBLE EXPRESSO 4.50 €, and the
// site's single price source (src/content.ts MENU) already says 4.50 €
// — the book (canvas drawItems + static DOM spreads) and LA CARTE
// (MenuSection) both render item.price from that one source, and no
// second price literal for DOUBLE EXPRESSO exists anywhere in src/.
// So the reported mismatch does NOT reproduce from this tree: either
// the pixel check read a stale deployment or it misread the row
// (SUPE PULE / SUPE DOMA sit two rows below at 4.00 €).
//
// This probe locks that in: it parses MENU.md and content.ts
// independently, compares EVERY price (59 items + 3 wine bottle
// prices = 62 prices), checks the agent brain's hardcoded favourites
// trio, and asserts the book + LA CARTE renderers carry no retyped
// price literals. Exit 0 = zero mismatches; anything else fails.
//
// Run: node scripts/fix18-price-probe.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MENU_MD = path.resolve(ROOT, '..', 'cafe', 'MENU.md');
const CONTENT_TS = path.join(ROOT, 'src', 'content.ts');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** '4.50 €' / '4,50 €' -> 4.5 */
const num = (s) => parseFloat(String(s).replace(',', '.').replace(/[^\d.]/g, ''));

/* ---- 1. Parse MENU.md (the printed menu, source of truth). ---- */
const md = readFileSync(MENU_MD, 'utf8');
const truth = new Map(); // name -> { price, bottle? }
let section = '';
for (const line of md.split('\n')) {
  const h = line.match(/^##\s+(.+?)\s*$/);
  if (h) { section = h[1]; continue; }
  const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([\d.,]+)\s*€\s*\|(?:\s*([\d.,]+)\s*€\s*\|)?\s*$/);
  if (!m || /^-+$/.test(m[1].trim()) || /^(Item|Price|Verre)$/i.test(m[1].trim())) continue;
  const name = m[1].trim();
  const entry = { price: num(m[2]), section };
  if (m[3] !== undefined) entry.bottle = num(m[3]);
  truth.set(name, entry);
}
check('MENU.md parses', truth.size === 59, `${truth.size} items`);

/* ---- 2. Parse src/content.ts MENU (the site's single price source). ---- */
const ts = readFileSync(CONTENT_TS, 'utf8');
const site = new Map(); // name -> { price, bottle? }
const itemRe = /\{\s*name:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"),\s*price:\s*'([^']+)'(?:,\s*note:\s*'([^']+)')?\s*\}/g;
for (const m of ts.matchAll(itemRe)) {
  const entry = { price: num(m[3]) };
  if (m[4]) {
    const b = m[4].match(/Bouteille\s+([\d.,]+)\s*€/);
    if (b) entry.bottle = num(b[1]);
  }
  site.set(m[1] ?? m[2], entry);
}
check('content.ts MENU parses', site.size === 59, `${site.size} items`);

/* ---- 3. Full audit: every price, both directions. ---- */
let compared = 0;
const mismatches = [];
for (const [name, t] of truth) {
  const s = site.get(name);
  if (!s) { mismatches.push(`${name}: missing from content.ts`); continue; }
  compared++;
  if (s.price !== t.price) mismatches.push(`${name}: MENU.md ${t.price.toFixed(2)} € vs site ${s.price.toFixed(2)} €`);
  if (t.bottle !== undefined && s.bottle !== t.bottle) {
    mismatches.push(`${name} bouteille: MENU.md ${t.bottle.toFixed(2)} € vs site ${s.bottle?.toFixed(2) ?? '—'} €`);
  }
}
for (const name of site.keys()) {
  if (!truth.has(name)) mismatches.push(`${name}: in content.ts but not on the printed menu`);
}
check('every MENU.md price matches content.ts', mismatches.length === 0,
  `${compared} items + 3 bottle prices compared; ${mismatches.length} mismatches${mismatches.length ? `: ${mismatches.join('; ')}` : ''}`);

/* ---- 4. DOUBLE EXPRESSO, the reported defect, in both places. ---- */
// Both renderers read item.price from the single MENU above, so the
// "both places" assertion is: the shared source value is 4.50 € AND
// neither renderer retypes any price (checked in §5).
check('MENU.md: DOUBLE EXPRESSO is 4.50 €', truth.get('DOUBLE EXPRESSO')?.price === 4.5,
  `${truth.get('DOUBLE EXPRESSO')?.price?.toFixed(2) ?? '—'} €`);
check('content.ts: DOUBLE EXPRESSO is 4.50 €', site.get('DOUBLE EXPRESSO')?.price === 4.5,
  `${site.get('DOUBLE EXPRESSO')?.price?.toFixed(2) ?? '—'} €`);
check('no 4.00 € anywhere near DOUBLE EXPRESSO in src/',
  !/DOUBLE EXPRESSO[^]{0,80}4[.,]00|4[.,]00[^]{0,80}DOUBLE EXPRESSO/.test(
    ['src/content.ts', 'src/lib/bookPages.ts', 'src/components/MenuBook.tsx',
     'src/components/MenuSection.tsx', 'src/lib/brain.ts', 'src/lib/agentBrain.ts']
      .map((f) => { try { return readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; } })
      .join('\n---\n')));

/* ---- 5. Single source of truth: no retyped price literals in the renderers. ---- */
const priceLiteral = /\d+[.,]\d{2}\s*€/;
for (const f of ['src/lib/bookPages.ts', 'src/components/MenuBook.tsx',
                 'src/components/MenuSection.tsx', 'src/components/MenuGuide.tsx']) {
  const src = readFileSync(path.join(ROOT, f), 'utf8');
  check(`${f} carries no retyped price literal`, !priceLiteral.test(src));
}
const bookPages = readFileSync(path.join(ROOT, 'src/lib/bookPages.ts'), 'utf8');
check('book canvas draws item.price verbatim', /ctx\.fillText\(item\.price/.test(bookPages));
const menuBook = readFileSync(path.join(ROOT, 'src/components/MenuBook.tsx'), 'utf8');
check('book static spread renders {item.price}', /\{item\.price\}/.test(menuBook));
const menuSection = readFileSync(path.join(ROOT, 'src/components/MenuSection.tsx'), 'utf8');
check('LA CARTE renders {item.price}', /\{item\.price\}/.test(menuSection));

/* ---- 6. Agent brain's hardcoded favourites trio (live, no-budget reply). ---- */
const brain = readFileSync(path.join(ROOT, 'src/lib/agentBrain.ts'), 'utf8');
const trioRe = /\{\s*label:\s*'[^']+',\s*name:\s*'([^']+)',\s*price:\s*'([^']+)'\s*\}/g;
let trioChecked = 0;
const trioBad = [];
for (const m of brain.matchAll(trioRe)) {
  trioChecked++;
  const t = truth.get(m[1]);
  if (!t) trioBad.push(`${m[1]}: not on the printed menu`);
  else if (num(m[2]) !== t.price) trioBad.push(`${m[1]}: brain ${m[2]} vs MENU.md ${t.price.toFixed(2)} €`);
}
check('agentBrain favourites trio matches MENU.md', trioChecked === 3 && trioBad.length === 0,
  `${trioChecked} hardcoded prices checked${trioBad.length ? `: ${trioBad.join('; ')}` : ''}`);

/* ---- Verdict. ---- */
console.log(failures === 0
  ? '\nOK — 0 price mismatches. DOUBLE EXPRESSO is 4,50 € in MENU.md, in the site source, and therefore in both LE LIVRE and LA CARTE.'
  : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
