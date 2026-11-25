// ART DU RENDEZ-VOUS — CAFÉ — single source of all copy on the site.
// Menu transcribed exactly as printed (see ~/workspace/web-design/cafe/MENU.md).
// Prices in EUR. Soups stay printed as SUPE PULE / SUPE DOMA.

export const CAFE = {
  name: 'ART DU RENDEZ-VOUS',
  nameShort: 'Art du Rendez-Vous',
  suffix: 'CAFÉ',
  tagline: 'Café · Bar · Rendez-vous',
  lede: "Un café de quartier ouvert presque jour et nuit — café le matin, apéritif le soir, et une carte de boissons qui ne s'arrête jamais.",
  address: 'Rue des Artistes 1A, 1020 Bruxelles',
  mapsUrl: 'https://maps.app.goo.gl/ZcxGx3xmSZzen3Zu7',
  mapsNameNote: 'Sur Google Maps, le lieu est listé sous « Cafe Artistes ».',
  rating: '4,8',
  reviews: '45 avis',
  // No phone and no website are listed for the café — never invent them.
  social: {
    // Facebook Page is being created — no URL yet. Do not invent one.
    facebookLabel: 'Facebook — page en cours de création',
    facebookUrl: '',
  },
} as const;

export const NAV = {
  links: [
    { label: 'La Carte', hash: '#carte' },
    { label: 'Ambiance', hash: '#ambiance' },
    { label: 'Venir', hash: '#venir' },
    { label: 'Agent', hash: '#agent' },
  ],
  cta: 'Commander',
  ctaHash: '#agent',
} as const;

export const HERO = {
  eyebrow: 'Bruxelles · Ouvert presque jour et nuit',
  titleA: 'ART DU',
  titleB: 'RENDEZ-VOUS',
  titleC: 'CAFÉ',
  sub: "Le bar en bois, la lumière bleue, les cocktails à la menthe — un rendez-vous à toute heure, du premier café du matin au dernier verre de la nuit.",
  ctaPrimary: 'Voir la carte',
  ctaPrimaryHash: '#carte',
  ctaSecondary: 'Parler à notre agent',
  ctaSecondaryHash: '#agent',
  chips: ['Café dès 08:00', 'Apéritifs dès 18:00', 'Vendredi — dimanche : 24h/24'],
  image: '/images/exterior.jpg',
  imageAlt: 'Le café à la tombée du jour, briques, auvents rouges et néons',
  // The pullable hero photo: the bar, not a face. The shader canvas shows
  // this image; the static <img> fallback shows the same one.
  pullImage: '/images/bar.jpg',
  pullImageAlt: 'Le bar en bois la nuit, verres et chandelles',
  pullHint: 'Tirez la photo',
} as const;

export interface MenuItem {
  name: string;
  price: string;
  note?: string;
}

export interface MenuCategory {
  id: string;
  label: string;
  blurb: string;
  image: string;
  imageAlt: string;
  items: MenuItem[];
}

export const MENU: MenuCategory[] = [
  {
    id: 'chaudes',
    label: 'Boissons Chaudes',
    blurb: 'Le café du matin, le chocolat de l’après-midi, l’Irish Coffee du soir.',
    image: '/images/coffee.jpg',
    imageAlt: 'Café en couches dans un grand verre, lumières du café derrière',
    items: [
      { name: 'CAFÉ', price: '3.00 €' },
      { name: 'EXPRESSO', price: '3.00 €' },
      { name: 'THÉ', price: '3.00 €' },
      { name: 'DÉCA', price: '3.00 €' },
      { name: 'CAPPUCCINO CHANTILLY', price: '3.50 €' },
      { name: 'CHOCOLAT CHAUD', price: '3.50 €' },
      { name: 'CAFÉ LATTE', price: '4.50 €' },
      { name: 'DOUBLE EXPRESSO', price: '4.50 €' },
      { name: 'IRISH COFFEE', price: '10.00 €' },
      { name: 'SUPE PULE', price: '4.00 €', note: 'Telle qu’imprimée sur la carte' },
      { name: 'SUPE DOMA', price: '4.00 €', note: 'Telle qu’imprimée sur la carte' },
    ],
  },
  {
    id: 'bieres',
    label: 'Bières',
    blurb: 'De la Primus du coin aux trappistes — pression et bouteilles.',
    image: '/images/bar.jpg',
    imageAlt: 'Le bar en bois la nuit, verres et chandelles',
    items: [
      { name: 'PRIMUS PILS 25 CL', price: '3.50 €' },
      { name: 'PRIMUS PILS 33 CL', price: '4.30 €' },
      { name: 'PRIMUS PILS 50 CL', price: '5.30 €' },
      { name: 'TANGO', price: '5.50 €' },
      { name: 'CARLSBERG', price: '4.50 €' },
      { name: 'CARLSBERG 0%', price: '4.00 €' },
      { name: 'BLANCHE SUPER B', price: '3.90 €' },
      { name: 'TONGERLO (BLONDE/BRUNE)', price: '4.50 €' },
      { name: 'MYSTIC KRIEK', price: '4.50 €' },
      { name: 'CHIMAY (BLONDE/BLANCHE/BRUNE)', price: '4.50 €' },
      { name: 'DUVEL', price: '4.50 €' },
      { name: 'CHIMAY', price: '5.50 €' },
      { name: 'WESTMALLE', price: '5.50 €' },
      { name: 'CORONA', price: '6.50 €' },
      { name: 'ORVAL', price: '6.50 €' },
    ],
  },
  {
    id: 'froides',
    label: 'Boissons Froides',
    blurb: 'Eaux, sodas et le Red Bull des longues soirées.',
    image: '/images/cocktails.jpg',
    imageAlt: 'Deux cocktails à la menthe sur la terrasse au soleil',
    items: [
      { name: 'EAU PLATE', price: '2.50 €' },
      { name: 'EAU PÉTILLANTE', price: '2.50 €' },
      { name: 'LOOZA (PÊCHE, FRAISE...)', price: '3.00 €' },
      { name: 'VAL TONIC', price: '3.00 €' },
      { name: 'VAL AGRUMES', price: '3.00 €' },
      { name: 'VAL ORANGE', price: '3.00 €' },
      { name: 'PEPSI', price: '3.00 €' },
      { name: 'PEPSI MAX 0', price: '3.00 €' },
      { name: 'REDBULL', price: '4.00 €' },
    ],
  },
  {
    id: 'vins',
    label: 'Vins',
    blurb: 'Rouge, blanc, rosé — au verre ou à la bouteille.',
    image: '/images/cocktails.jpg',
    imageAlt: 'Deux cocktails à la menthe sur la terrasse au soleil',
    items: [
      { name: 'VIN ROUGE', price: '4.00 €', note: 'Verre · Bouteille 20.00 €' },
      { name: 'VIN BLANC', price: '4.00 €', note: 'Verre · Bouteille 20.00 €' },
      { name: 'VIN ROSÉ', price: '4.00 €', note: 'Verre · Bouteille 20.00 €' },
    ],
  },
  {
    id: 'aperitifs',
    label: 'Apéritifs',
    blurb: 'L’heure de l’apéritif, de 18:00 jusqu’au bout de la nuit.',
    image: '/images/cocktails.jpg',
    imageAlt: 'Deux cocktails à la menthe sur la terrasse au soleil',
    items: [
      { name: 'PORTO (BLANC/ROUGE)', price: '5.00 €' },
      { name: 'MARTINI (BLANC/ROUGE)', price: '5.50 €' },
      { name: 'GANCIA', price: '5.50 €' },
      { name: 'PINEAU DE CHARENTES', price: '5.50 €' },
      { name: 'KIR', price: '5.50 €' },
      { name: 'KIR ROYAL', price: '7.00 €' },
      { name: 'CAMPARI', price: '7.00 €' },
      { name: 'APEROL SPRITZ', price: '9.00 €' },
    ],
  },
  {
    id: 'liqueurs',
    label: 'Liqueurs',
    blurb: 'Digestifs et classiques, servis comme il faut.',
    image: '/images/bar.jpg',
    imageAlt: 'Le bar en bois la nuit, verres et chandelles',
    items: [
      { name: 'RICARD', price: '6.50 €' },
      { name: 'BATIDA', price: '6.50 €' },
      { name: 'AMARETTO', price: '7.00 €' },
      { name: 'PISANG', price: '6.50 €' },
      { name: 'BAILEYS', price: '6.50 €' },
      { name: 'BACARDI', price: '7.00 €' },
      { name: 'COINTREAU', price: '7.50 €' },
    ],
  },
  {
    id: 'alcools',
    label: 'Alcools',
    blurb: 'Les forts — vodka, gin, rhum, tequila, whisky.',
    image: '/images/bar.jpg',
    imageAlt: 'Le bar en bois la nuit, verres et chandelles',
    items: [
      { name: 'VODKA', price: '7.00 €' },
      { name: 'GIN', price: '7.00 €' },
      { name: 'RHUM', price: '7.00 €' },
      { name: 'TEQUILA', price: '7.00 €' },
      { name: 'WHISKY', price: '8.00 €' },
      { name: "JACK DANIEL'S", price: '8.50 €' },
    ],
  },
];

export const ATMOSPHERE = {
  eyebrow: 'Ambiance',
  title: 'Une soirée, quatre scènes.',
  lede: 'Faites défiler — la lumière change, le bar se remplit, la nuit tombe sur la terrasse.',
  chapters: [
    {
      id: 'exterieur',
      index: '01',
      title: 'La façade',
      text: 'Briques, auvents rouges et néons à la tombée du jour. On repère le café de loin — on y entre pour un verre, on y reste pour la soirée.',
      image: '/images/exterior.jpg',
      imageAlt: 'Le café à la tombée du jour, briques, auvents rouges et néons',
    },
    {
      id: 'bar',
      index: '02',
      title: 'Le bar',
      text: 'Le bois courbe sous la lumière bleue, les chandelles Edison au-dessus des portraits. C’est ici que commence chaque rendez-vous.',
      image: '/images/bar.jpg',
      imageAlt: 'Le bar en bois la nuit, verres et chandelles',
    },
    {
      id: 'cafe',
      index: '03',
      title: 'Le café',
      text: 'Un café en couches, servi encore chaud, crème et mousse au-dessus. Le matin appartient à ceux qui arrivent tôt.',
      image: '/images/coffee.jpg',
      imageAlt: 'Café en couches dans un grand verre, lumières du café derrière',
    },
    {
      id: 'cocktails',
      index: '04',
      title: 'La terrasse',
      text: 'Menthe fraîche, orange et soleil couchant. Deux cocktails, une table en bois, et tout le temps du monde.',
      image: '/images/cocktails.jpg',
      imageAlt: 'Deux cocktails à la menthe sur la terrasse au soleil',
    },
  ],
} as const;

export const VISIT = {
  eyebrow: 'Venir',
  title: 'Trouver le café.',
  addressLabel: 'Adresse',
  hoursLabel: 'Horaires',
  hours: [
    { days: 'Lundi — Mercredi', time: '08:00 — 02:00' },
    { days: 'Jeudi', time: '08:00 — 00:00' },
    { days: 'Vendredi — Dimanche', time: '24h/24' },
  ],
  dayTimeline: [
    { time: '08:00', label: 'Ouverture — premier café' },
    { time: '12:00', label: 'Pause déjeuner, terrasse au soleil' },
    { time: '18:00', label: 'Apéritif — Spritz, Kir, Campari' },
    { time: '00:00', label: 'La nuit continue — vendredi à dimanche, 24h/24' },
  ],
  mapsCta: 'Ouvrir dans Google Maps',
  ratingLine: '4,8 sur 5 — 45 avis sur Google Maps',
} as const;

export const AGENT = {
  eyebrow: 'Agent en direct',
  title: 'Parlez à Nekomi.',
  lede: "Notre agent en direct connaît toute la carte, les horaires et le café. Demandez un conseil, composez votre commande — elle vous proposera même de vous appeler pour la confirmer.",
  statusOffline: 'Agent en direct — connexion en cours de mise en place',
  statusHint:
    'Le service vocal et le cerveau de l’agent se branchent bientôt. En attendant, le chat ci-dessous répond déjà avec la carte et les horaires.',
  chatPlaceholder: 'Écrivez ici… ex. « un café et un Aperol Spritz »',
  chatSend: 'Envoyer',
  chatWelcome:
    "Bonjour ! Je suis Nekomi, l’agent de l’Art du Rendez-Vous. Dites-moi ce qui vous ferait plaisir — je connais toute la carte et je peux préparer votre commande.",
  chatSuggestions: ['Un café, s’il vous plaît', 'Qu’est-ce que vous conseillez en apéritif ?', 'Vos horaires ?', 'Je veux commander'],
  voiceTitle: 'Appel vocal en direct',
  voiceCta: 'Parler à voix haute',
  voiceStop: 'Terminer l’appel',
  voiceOffline:
    'La voix en direct arrive avec la connexion Deepgram. Pour l’instant, le micro sert uniquement à voir votre niveau de voix — aucune donnée ne quitte votre appareil.',
  voiceListening: 'Je vous écoute…',
  voiceDenied: 'Micro non autorisé — le chat texte reste disponible.',
  orderTitle: 'Votre commande',
  orderEmpty: 'Rien pour l’instant — ajoutez une boisson depuis la carte ou depuis le chat.',
  orderConfirm: 'Confirmer la commande',
  orderConfirmed:
    'Commande notée ! Notre agent vous appellera pour confirmer et préparer votre venue au café.',
  orderTotal: 'Total',
  henshinLabel: 'Henshin',
  henshinHuman: 'Forme humaine',
  henshinFurry: 'Forme féline',
  modelNote: 'Nekomi — modèle Live2D. Bougez le curseur : elle vous suit des yeux.',
  qrTitle: 'Scannez pour discuter',
  qrText: 'Pointez votre téléphone vers ce code pour ouvrir le chat avec notre agent.',
  // TODO (Phase 9): replace with the real deployed site URL, e.g. https://<vercel-domain>/#agent
  qrUrl: 'https://art-du-rendez-vous.cafe/#agent',
  guidance: [
    'Connaît toute la carte et les prix, les horaires et l’adresse du café.',
    'Propose des conseils selon vos goûts — café, bière, vin, apéritif.',
    'Compose votre commande et propose de vous appeler pour la confirmer.',
  ],
} as const;

export const FOOTER = {
  subscribeTitle: 'Restez au courant.',
  subscribeText: 'Une adresse e-mail, et on vous écrit quand la carte change ou quand un événement se prépare.',
  subscribePlaceholder: 'Votre adresse e-mail',
  subscribeCta: 'S’abonner',
  subscribeDone: 'Merci — vous êtes inscrit·e.',
  columns: [
    {
      title: 'Le café',
      links: [
        { label: 'La carte', hash: '#carte' },
        { label: 'Ambiance', hash: '#ambiance' },
        { label: 'Venir', hash: '#venir' },
      ],
    },
    {
      title: 'L’agent',
      links: [
        { label: 'Discuter', hash: '#agent' },
        { label: 'Commander', hash: '#agent' },
      ],
    },
  ],
  legal: '© 2026 Art du Rendez-Vous — Café · Bruxelles',
  mapsLine: 'Rue des Artistes 1A, 1020 Bruxelles',
} as const;

// Live-agent connection config. Keys are read from environment variables only.
// Nothing here is a secret: unset values mean "not connected yet" and the UI
// shows the graceful offline state.
export const AGENT_ENV = {
  deepgramKey: import.meta.env.VITE_DEEPGRAM_API_KEY as string | undefined,
  freellmKey: import.meta.env.VITE_FREELLM_API_KEY as string | undefined,
  freellmBaseUrl: (import.meta.env.VITE_FREELLM_BASE_URL as string | undefined) ?? '',
} as const;

export const agentConnected = Boolean(AGENT_ENV.deepgramKey && AGENT_ENV.freellmKey);
