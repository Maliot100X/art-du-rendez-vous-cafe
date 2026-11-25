/**
 * All copy lives here (NAÏADE's content.ts shape). Every price comes from
 * src/data/menu.json through store.js — never typed by hand.
 */
import {cafe, categories, drinks, formatPrice as fmt, getDrink, type Drink} from './data/store.js';

export {cafe, categories, drinks};
export const formatPrice = (n: number) => fmt(n, 'fr');

export const brand = {
  name: 'Art du Rendez-Vous',
  short: 'Rendez-Vous',
  collection: 'Café · Bar',
  tagline: 'Le café de la rue des Artistes',
};

export const address = {
  line: `${cafe.address.street}, ${cafe.address.postcode} ${cafe.address.district}`,
  city: 'Bruxelles',
  phone: cafe.phone as string,
  phoneDisplay: cafe.phoneDisplay as string,
  maps: cafe.mapsUrl as string,
};

export const nav = [
  ['La carte', '#carte'],
  ['Le livre', '#livre'],
  ['Signatures', '#signatures'],
  ['Venir', '#venir'],
] as const;

export const hero = {
  kicker: 'Rue des Artistes 1A · Laeken · Bruxelles',
  line: 'Café, bières belges et apéros depuis le coin de la rue. Ouvert dès 8 h, 24 h sur 24 le week-end.',
};

export type Product = {
  id: string;
  index: string;
  eyebrow: string;
  name: [string, string];
  material: string;
  description: string;
  image: string;
  specs: [label: string, value: string][];
  price: number;
};

const need = (id: string): Drink => {
  const d = getDrink(id);
  if (!d) throw new Error(`menu.json is missing ${id}`);
  return d;
};
const split = (s: string): [string, string] => {
  const i = s.lastIndexOf(' ');
  return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, ''];
};

/** The three drinks the camera lands on in the film (same order as the beats). */
const film: [string, string, string, [string, string][]][] = [
  ['cafe-latte', 'Boisson chaude', 'Double shot, lait vapeur micro-mousse, cœur tiré à la main sur la crème.', [['Tasse', '25 cl'], ['Shot', 'Double'], ['Lait', 'Entier']]],
  ['chocolat-chaud', 'Boisson chaude', 'Cacao fondu au lait chaud, une spirale de crème et une pluie de cacao.', [['Cacao', 'Belge'], ['Tasse', '25 cl'], ['Crème', 'Spirale']]],
  ['irish-coffee', 'Le classique du soir', 'Café chaud, whiskey irlandais, sucre roux et une couronne de crème fouettée.', [['Whiskey', 'Irlandais'], ['Crème', 'Fouettée'], ['Servi', 'Chaud']]],
];

export const products: Product[] = film.map(([id, eyebrow, description, specs], i) => {
  const d = need(id);
  return {
    id,
    index: String(i + 1).padStart(2, '0'),
    eyebrow,
    name: split(d.name.fr),
    material: d.name.en,
    description,
    image: d.img.l,
    specs,
    price: d.price ?? d.fromPrice,
  };
});

export const outro = {
  line1: 'Un café.',
  line2: ['Un ', 'rendez-vous.'],
};

/** The four drinks you can grab and stretch (Otis engine). */
export const signatures = ['cappuccino-chantilly', 'aperol-spritz', 'orval', 'kir-royal'].map(need);

export const footer = {
  hours: [
    ['Lun – Mer', '08:00 – 02:00'],
    ['Jeudi', '08:00 – 00:00'],
    ['Ven – Dim', '24 h / 24'],
  ] as [string, string][],
  transit: cafe.transit as string[],
  note: 'Horaires et téléphone repris de la fiche publique — à confirmer avec le café.',
};
