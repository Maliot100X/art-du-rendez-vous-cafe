import { AGENT, MENU, VISIT, CAFE } from '../content'

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
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s']/g, ' ')

const ALL_ITEMS = MENU.flatMap((cat) => cat.items.map((item) => ({ ...item, category: cat.label })))

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

export function botReply(message: string): BotReply {
  const n = norm(message)

  if (/(bonjour|salut|coucou|hello|hey|bonsoir)/.test(n)) {
    return {
      text: "Bonjour ! Bienvenue à l’Art du Rendez-Vous. Un café, une bière, un apéritif ? Dites-moi ce qui vous ferait plaisir, ou demandez-moi les horaires et l’adresse.",
    }
  }
  if (/(merci)/.test(n)) {
    return { text: 'Avec plaisir ! Autre chose ? Je peux aussi préparer votre commande.' }
  }
  if (/(horaire|ouvert|ferme|heure|quand.*ouvert|jusqu.*quelle)/.test(n)) {
    return {
      text: `Nos horaires : lundi — mercredi 08:00–02:00, jeudi 08:00–00:00, et vendredi — dimanche 24h/24. Vous êtes les bienvenus presque jour et nuit.`,
    }
  }
  if (/(adresse|ou etes|ou se trouve|venir|plan|itineraire|rue)/.test(n)) {
    return {
      text: `Nous sommes au ${CAFE.address}. Sur Google Maps, le lieu est listé sous « Cafe Artistes ». Le bouton « Ouvrir dans Google Maps » dans la section Venir vous y mène.`,
    }
  }
  if (/(conseil|recommand|que.*boire|quoi.*boire|specialite|meilleur)/.test(n)) {
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
    return { text: 'Dites-moi de quelle boisson vous parlez et je vous donne son prix — toute la carte est affichée plus haut sur la page.' }
  }

  const hits = findItems(message)
  if (hits.length > 0) {
    const lines = hits.map((h) => `${h.name} — ${h.price}`).join(', ')
    return {
      text: `${lines}. Je peux l’ajouter à votre commande si vous voulez.`,
      actions: hits.map((h) => ({ label: `Ajouter ${h.name}`, name: h.name, price: h.price })),
    }
  }
  if (/(vin|biere|aperitif|liqueur|alcool|froid|chaud)/.test(n)) {
    const cat = MENU.find((c) => n.includes(norm(c.label).split(' ')[0].slice(0, 5)))
    if (cat) {
      const sample = cat.items.slice(0, 3).map((i) => `${i.name} ${i.price}`).join(', ')
      return { text: `Côté ${cat.label.toLowerCase()} : ${sample}… et bien d’autres sur la carte. Dites-moi ce qui vous tente.` }
    }
  }

  return {
    text: 'Je peux vous aider avec la carte et les prix, les horaires, l’adresse, et préparer votre commande. Essayez par exemple « un café », « vos horaires ? » ou « je veux commander ».',
  }
}

export function orderTotal(lines: { price: string }[]): string {
  const sum = lines.reduce((acc, l) => acc + (parseFloat(l.price.replace(',', '.')) || 0), 0)
  return `${sum.toFixed(2).replace('.', ',')} €`
}

export const HOURS_TEXT = VISIT.hours.map((h) => `${h.days} ${h.time}`).join(' · ')
export const AGENT_WELCOME = AGENT.chatWelcome
