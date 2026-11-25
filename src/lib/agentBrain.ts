import { MENU, CAFE } from '../content'
import type { AvatarExpression } from './avatarBridge'

/**
 * Offline concierge for the live-agent chat panel. It answers from the
 * site's own data (menu, hours, address) and builds an order — no network,
 * no keys. When the live voice + brain connect later, this stays as the
 * offline fallback. It never invents prices, hours or contact details.
 */

export interface BotAction {
  label: string
  name: string
  price: string
}

export interface BotReply {
  text: string
  actions?: BotAction[]
  /** Face the Live2D stage should ease toward for this reply. */
  expression?: AvatarExpression
}

/**
 * Reply tone -> expression preset. The Soul-of-Waifu 28-emotion idea,
 * reduced to the small preset set the Nekomi stage can actually show
 * (see src/lib/avatarBridge.ts). Keyword matching on the normalised
 * French text; neutral when nothing matches.
 */
export function expressionForReply(text: string): AvatarExpression {
  const n = norm(text)
  if (/(desole|pardon|malheureusement|ferme|indisponible|pas possible)/.test(n)) return 'sad'
  if (/(surprise|incroyable|wow|oh|vraiment|formidable|magnifique)/.test(n)) return 'surprised'
  if (/(je regarde|je verifie|un instant|laissez-moi|reflechir|je cherche)/.test(n)) return 'thinking'
  if (/(avec plaisir|ravi|parfait|excellent|merci|bienvenue|super|delicieux)/.test(n)) return 'happy'
  if (/(doucement|calme|soir|tendre|doux|profitez|prenez votre temps)/.test(n)) return 'tender'
  return 'neutral'
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s']/g, ' ')

const ALL_ITEMS = MENU.flatMap((cat) => cat.items.map((item) => ({ ...item, category: cat.label })))

/** Menu price string ("9,00 €" / "9.00 €") -> number. */
export function priceValue(price: string): number {
  return parseFloat(price.replace(',', '.')) || 0
}

/** Format a euro amount the way the menu prints it ("5,00 €"). */
export function formatPrice(amount: number): string {
  return `${amount.toFixed(2).replace('.', ',')} €`
}

/**
 * Fix pass 16 (budget chips): parse a budget the visitor stated, in
 * euros — "j'ai seulement 5 euros en poche", "moins de 10 €", "5,50 €".
 * The € sign is matched on the RAW message: norm() below strips it.
 * With several amounts ("entre 3 et 5 euros") the cap is the largest —
 * a budget is an upper bound, not the smallest amount mentioned.
 * Returns null when no amount is stated.
 */
export function parseBudget(message: string): number | null {
  // (?![a-z]) — not \b — after the unit: "5 €" ends on the non-word
  // €, so \b never fires there (and "10 €" at end of string failed
  // to parse at all). The lookahead still blocks "5 europe".
  const amounts = [...message.toLowerCase().matchAll(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?|eur)(?![a-z])/g)]
    .map((m) => parseFloat(m[1].replace(',', '.')))
    .filter((v) => Number.isFinite(v) && v > 0)
  return amounts.length > 0 ? Math.max(...amounts) : null
}

/** Drop every add-to-order action whose price is over the budget. */
function filterByBudget(actions: BotAction[], budget: number | null): BotAction[] {
  if (budget === null) return actions
  return actions.filter((a) => priceValue(a.price) <= budget + 0.001)
}

/**
 * Fix pass 16: the best-value picks at or under a budget — the most
 * expensive items that still fit (closest to the budget), up to `n`,
 * menu order on ties. The old hardcoded favourites (Spritz 9 €,
 * Primus 50 CL 5,30 €, Irish Coffee 10 €) ignored any budget, so a
 * 5 € visitor got chips for drinks they could not afford.
 */
function picksUnderBudget(budget: number, n = 3): { name: string; price: string }[] {
  const under = ALL_ITEMS.filter((i) => priceValue(i.price) <= budget + 0.001)
  // Array.sort is stable: equal prices keep menu order.
  under.sort((a, b) => priceValue(b.price) - priceValue(a.price))
  return under.slice(0, n)
}

/**
 * Fix pass 16: derive tap-to-add chips from the LLM's own reply text —
 * the menu items the reply actually names, in menu order, at or under
 * the budget when one was stated. The LLM text already respects a
 * stated budget; the chips must be a subset of what it lists, not a
 * different (possibly over-budget) set from the offline brain.
 * Returns [] when the reply names no menu item, so the caller can fall
 * back to the offline brain's actions.
 */
export function actionsForReplyText(text: string, budget: number | null, max = 3): BotAction[] {
  const n = norm(text)
  const seen = new Set<string>()
  const matches: { name: string; price: string }[] = []
  for (const item of ALL_ITEMS) {
    if (seen.has(item.name)) continue
    const iname = norm(item.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!new RegExp(`\\b${iname}\\b`).test(n)) continue
    if (budget !== null && priceValue(item.price) > budget + 0.001) continue
    seen.add(item.name)
    matches.push(item)
  }
  // Longest match wins: "DOUBLE EXPRESSO" in the text also matches
  // the bare word "EXPRESSO" (and "CAFÉ LATTE" matches "CAFÉ") — drop
  // a match whose normalised name is a word-substring of another
  // match's name, so the chip is the drink the reply actually named.
  const kept = matches.filter(
    (m) =>
      !matches.some(
        (other) =>
          other !== m &&
          new RegExp(`\\b${norm(m.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(norm(other.name)),
      ),
  )
  return kept.slice(0, max).map((item) => ({ label: `Ajouter ${item.name}`, name: item.name, price: item.price }))
}

function findItems(message: string) {
  const n = norm(message)
  const hits: { name: string; price: string }[] = []
  const STOP = new Set(['les', 'des', 'une', 'aux', 'sur', 'de', 'la', 'le'])
  for (const item of ALL_ITEMS) {
    const iname = norm(item.name)
    // Full printed name, or the first distinctive word of it.
    const first = iname.split(' ')[0]
    if (iname.length > 2 && n.includes(iname)) {
      hits.push(item)
    } else if (first.length >= 3 && !STOP.has(first) && new RegExp(`\\b${first}\\b`).test(n)) {
      hits.push(item)
    }
  }
  // De-duplicate, keep menu order.
  return hits.filter((h, i) => hits.findIndex((x) => x.name === h.name) === i)
}

/**
 * Fix pass 11: category stems for recommendations and category reads
 * (same approach as MenuGuide.tsx CATEGORY_KEYWORDS, defined locally
 * here because agentBrain must not import a component). norm() strips
 * accents, so 'bière' -> 'biere' and the 'biere' stem matches. Order
 * mirrors MenuGuide: a named drink (findItems) always wins over stems.
 */
const CATEGORY_STEMS: { id: string; words: string[] }[] = [
  { id: 'chaudes', words: ['cafe', 'the', 'expresso', 'cappuccino', 'chocolat', 'latte', 'irish', 'deca', 'soupe', 'supe', 'chaud'] },
  { id: 'bieres', words: ['biere', 'primus', 'pils', 'pression'] },
  { id: 'froides', words: ['froid', 'soda', 'jus', 'limonade', 'coca', 'perrier', 'eau'] },
  { id: 'vins', words: ['vin', 'rouge', 'blanc', 'rose', 'champagne', 'prosecco'] },
  { id: 'aperitifs', words: ['aperitif', 'spritz', 'aperol', 'martini', 'kir', 'pastis', 'ricard'] },
  { id: 'liqueurs', words: ['liqueur', 'baileys', 'amaretto', 'cointreau', 'marnier'] },
  { id: 'alcools', words: ['alcool', 'whisky', 'whiskey', 'gin', 'vodka', 'rhum', 'tequila', 'cognac'] },
]

function findCategory(message: string) {
  const n = norm(message)
  for (const entry of CATEGORY_STEMS) {
    if (entry.words.some((w) => n.includes(w))) {
      return MENU.find((c) => c.id === entry.id) ?? null
    }
  }
  return null
}

/**
 * A category read: first three items, exact menu prices, tap-to-add.
 * Fix pass 16: when a budget was stated, only items at or under it —
 * and no chips at all when nothing in the category fits the budget.
 */
function categoryReply(cat: (typeof MENU)[number], budget: number | null): BotReply {
  const inBudget =
    budget === null ? cat.items : cat.items.filter((i) => priceValue(i.price) <= budget + 0.001)
  const picks = inBudget.slice(0, 3)
  if (picks.length === 0) {
    return {
      text: `Côté ${cat.label.toLowerCase()} : tout est au-dessus de ${formatPrice(budget as number)} — dites-moi si vous voulez une autre catégorie.`,
    }
  }
  return {
    text: `Côté ${cat.label.toLowerCase()} : ${picks.map((i) => `${i.name} ${i.price}`).join(', ')}… et bien d’autres sur la carte. Dites-moi ce qui vous tente.`,
    actions: picks.map((i) => ({ label: `Ajouter ${i.name}`, name: i.name, price: i.price })),
  }
}

function botReplyInner(message: string): BotReply {
  const n = norm(message)
  // Fix pass 16: the budget, parsed once, governs every chip this
  // reply produces (see the wrapper filter in botReply below, and the
  // budget-aware branches for conseil / category).
  const budget = parseBudget(message)

  if (/(bonjour|salut|coucou|hello|hey|bonsoir)/.test(n)) {
    return {
      text: "Bonjour ! Bienvenue à l’Art du Rendez-Vous. Un café, une bière, un apéritif ? Dites-moi ce qui vous ferait plaisir, ou demandez-moi l’adresse.",
    }
  }
  if (/(merci)/.test(n)) {
    return { text: 'Avec plaisir ! Autre chose ? Je peux aussi préparer votre commande.' }
  }
  if (/(horaire|ouvert|ferme|heure|quand.*ouvert|jusqu.*quelle)/.test(n)) {
    return {
      text: `Nos horaires ne sont pas listés sur Google Maps pour ce lieu — ils sont encore à confirmer. En attendant, je peux vous donner l’adresse ou vous aider à choisir une boisson.`,
    }
  }
  if (/(adresse|ou etes|ou se trouve|venir|plan|itineraire|rue)/.test(n)) {
    return {
      text: `Nous sommes au ${CAFE.address}. Sur Google Maps, le lieu est listé sous « Casa da Santana ». Le bouton « Ouvrir dans Google Maps » dans la section Venir vous y mène. Vous pouvez aussi nous joindre au ${CAFE.phone}.`,
    }
  }
  if (/(conseil|recommand|que.*boire|quoi.*boire|specialite|meilleur)/.test(n)) {
    // Fix pass 11: category-aware — a specifically named drink wins,
    // then a named category; the fixed favourites are only the fallback
    // when neither is named (before, the favourites fired for every
    // "conseil" message, so "quel vin rouge ?" got Spritz + Primus).
    const named = findItems(message)
    if (named.length > 0) {
      const lines = named.map((h) => `${h.name} — ${h.price}`).join(', ')
      return {
        text: `Je vous conseille : ${lines}. Je peux les ajouter à votre commande.`,
        actions: named.map((h) => ({ label: `Ajouter ${h.name}`, name: h.name, price: h.price })),
      }
    }
    const cat = findCategory(message)
    if (cat) return categoryReply(cat, budget)
    // Fix pass 16: with a stated budget the favourites must fit it —
    // the old fixed trio (Spritz 9 €, Primus 50 CL 5,30 €, Irish
    // Coffee 10 €) was served to a 5 € visitor verbatim. With no
    // budget the trio is unchanged.
    if (budget !== null) {
      const picks = picksUnderBudget(budget)
      if (picks.length === 0) {
        const cheapest = Math.min(...ALL_ITEMS.map((i) => priceValue(i.price)))
        return {
          text: `Avec ${formatPrice(budget)}, rien sur la carte ne rentre dans ce budget — le moins cher est à ${formatPrice(cheapest)}. Dites-moi si vous pouvez monter un peu.`,
        }
      }
      return {
        text: `Avec ${formatPrice(budget)}, je vous conseille : ${picks.map((i) => `${i.name} ${i.price}`).join(', ')}. Je peux les ajouter à votre commande.`,
        actions: picks.map((i) => ({ label: `Ajouter ${i.name}`, name: i.name, price: i.price })),
      }
    }
    return {
      text: 'Mes trois favoris du moment : l’Aperol Spritz à 9,00 € pour l’apéritif, une Primus Pils 50 CL à 5,30 €, et l’Irish Coffee à 10,00 € pour finir en douceur. Je peux les ajouter à votre commande.',
      actions: [
        { label: 'Aperol Spritz — 9,00 €', name: 'APEROL SPRITZ', price: '9.00 €' },
        { label: 'Primus Pils 50 CL — 5,30 €', name: 'PRIMUS PILS 50 CL', price: '5.30 €' },
        { label: 'Irish Coffee — 10,00 €', name: 'IRISH COFFEE', price: '10.00 €' },
      ],
    }
  }
  if (/(commander|commande|je veux|je voudrais|je prends|prendre)/.test(n)) {
    const hits = findItems(message)
    if (hits.length > 0) {
      const lines = hits.map((h) => `${h.name} — ${h.price}`).join(', ')
      return {
        text: `Parfait, je note : ${lines}. Voulez-vous les ajouter à votre commande ?`,
        actions: hits.map((h) => ({ label: `Ajouter ${h.name}`, name: h.name, price: h.price })),
      }
    }
    return {
      text: 'Avec plaisir ! Dites-moi simplement ce que vous voulez — par exemple « un café et un Aperol Spritz » — et je l’ajoute à votre commande.',
    }
  }
  if (/(prix|combien|coute|tarif)/.test(n)) {
    const hits = findItems(message)
    if (hits.length > 0) {
      return {
        text: hits.map((h) => `${h.name} : ${h.price}`).join('\n'),
        actions: hits.map((h) => ({ label: `Ajouter ${h.name}`, name: h.name, price: h.price })),
      }
    }
    // No named drink: fall through to the category read below instead
    // of asking the visitor to repeat themselves.
  }

  const hits = findItems(message)
  if (hits.length > 0) {
    const lines = hits.map((h) => `${h.name} — ${h.price}`).join(', ')
    return {
      text: `${lines}. Je peux l’ajouter à votre commande si vous voulez.`,
      actions: hits.map((h) => ({ label: `Ajouter ${h.name}`, name: h.name, price: h.price })),
    }
  }
  // Fix pass 11: same category stems as the conseil branch above — the
  // old label-word match needed a word of ≥4 chars from the label, so
  // "vin" never matched "Vins" and the branch was dead for red wine.
  const cat = findCategory(message)
  if (cat) return categoryReply(cat, budget)

  return {
    text: 'Je peux vous aider avec la carte et les prix, les horaires, l’adresse, et préparer votre commande. Essayez par exemple « un café », « vos horaires ? » ou « je veux commander ».',
  }
}

/**
 * Every reply carries the expression the stage should ease toward.
 * Fix pass 16: the budget choke point — EVERY action this reply
 * produces is filtered to the stated budget here, whatever branch
 * built it (a named drink the visitor asked for by name keeps its
 * price in the text, but its over-budget chip is not shown).
 */
export function botReply(message: string): BotReply {
  const reply = botReplyInner(message)
  const budget = parseBudget(message)
  const actions = reply.actions ? filterByBudget(reply.actions, budget) : undefined
  return { ...reply, actions, expression: expressionForReply(reply.text) }
}

export function orderTotal(lines: { price: string }[]): string {
  const sum = lines.reduce((acc, l) => acc + (parseFloat(l.price.replace(',', '.')) || 0), 0)
  return `${sum.toFixed(2).replace('.', ',')} €`
}
