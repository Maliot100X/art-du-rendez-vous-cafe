// ART DU RENDEZ-VOUS — CAFÉ — single source of all copy on the site.
// Menu transcribed exactly as printed (see ~/workspace/web-design/cafe/MENU.md).
// Prices in EUR. Soups stay printed as SUPE PULE / SUPE DOMA.

export const CAFE = {
  name: 'ART DU RENDEZ-VOUS',
  nameShort: 'Art du Rendez-Vous',
  suffix: 'CAFÉ',
  tagline: 'Café · Bar · Rendez-vous',
  lede: "Un café de quartier au cœur de Bruxelles — café le matin, apéritif le soir, et une carte de boissons à découvrir.",
  address: 'Rue de Malines 21, 1000 Bruxelles, Belgium',
  mapsUrl: 'https://maps.app.goo.gl/RcUuK3RTUZx5ndk66?g_st=ac',
  mapsNameNote: 'Sur Google Maps, le lieu est listé sous « Casa da Santana ».',
  rating: '3,5',
  reviews: '2 avis',
  // Phone is the café's number, given by Minir himself (2026-11-25
  // 18:02 CET) — +1 650 459 7993, the outbound agent number. It replaces
  // the +32 476 75 18 34 from the Casa da Santana Maps listing, which
  // Minir rejected. NOTE: this number is outbound-only, it cannot
  // receive incoming calls — do NOT "fix" it back to the Maps number.
  // No website is listed for the café — never invent one.
  phone: '+1 650 459 7993',
  phoneHref: 'tel:+16504597993',
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
    { label: 'Galerie', hash: '#galerie' },
    { label: 'Venir', hash: '#venir' },
    { label: 'Agent', hash: '#agent' },
  ],
  cta: 'Commander',
  ctaHash: '#agent',
} as const;

export const HERO = {
  eyebrow: 'Bruxelles · Café · Bar',
  titleA: 'ART DU',
  titleB: 'RENDEZ-VOUS',
  titleC: 'CAFÉ',
  sub: "Le bar en bois, la lumière bleue, les cocktails à la menthe — un rendez-vous à toute heure, du premier café du matin au dernier verre de la nuit.",
  ctaPrimary: 'Voir la carte',
  ctaPrimaryHash: '#carte',
  ctaSecondary: 'Parler à notre agent',
  ctaSecondaryHash: '#agent',
  chips: ['Café · Bar · Rendez-vous', 'Cocktails à la menthe', 'Terrasse au soleil'],
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
    blurb: 'L’heure de l’apéritif, du Spritz au Campari, jusqu’au bout de la nuit.',
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

export const BOOK = {
  eyebrow: 'Le livre de la carte',
  title: 'Feuilletez la carte.',
  lede: 'Sept familles, soixante-deux prix, un livre. Glissez pour tourner les pages — comme la carte imprimée au bar, mais en trois dimensions.',
  coverHint: 'Glissez pour tourner la page',
  prevLabel: 'Page précédente',
  nextLabel: 'Page suivante',
  pageLabel: 'Feuille',
  ofLabel: 'sur',
  webglFallbackNote: 'Votre navigateur n’affiche pas la 3D — la carte s’ouvre en pages fixes.',
  reducedMotionNote: 'Mouvement réduit : la carte s’ouvre en pages fixes.',
} as const;

export const GALLERY = {
  eyebrow: 'Galerie',
  title: 'Le café, en images.',
  lede: 'La façade au néon, le bar en bois, le café du matin, les cocktails de la terrasse — et la carte, en affiche, dans ses deux formats.',
  poster: {
    src: '/images/menu-poster-wide-1920x1080.jpg',
    alt: 'Affiche de la carte des boissons de l’Art du Rendez-Vous — les sept familles et leurs prix',
    caption: 'La carte, en affiche — les sept familles et leurs prix',
  },
  // Portrait poster (stories / partage) — same code-built menu, vertical format.
  posterTall: {
    src: '/images/menu-poster-1080x1920.jpg',
    alt: 'Affiche verticale de la carte des boissons de l’Art du Rendez-Vous — les sept familles et leurs prix',
    caption: 'La carte, en affiche verticale — à partager',
  },
  items: [
    {
      src: '/images/exterior.jpg',
      alt: 'Le café à la tombée du jour, briques, auvents rouges et néons',
      caption: 'La façade, à la tombée du jour',
    },
    {
      src: '/images/bar.jpg',
      alt: 'Le bar en bois la nuit, verres et chandelles',
      caption: 'Le bar, sous la lumière bleue',
    },
    {
      src: '/images/coffee.jpg',
      alt: 'Café en couches dans un grand verre, lumières du café derrière',
      caption: 'Le café du matin',
    },
    {
      src: '/images/cocktails.jpg',
      alt: 'Deux cocktails à la menthe sur la terrasse au soleil',
      caption: 'Cocktails à la menthe, sur la terrasse',
    },
  ],
  lightboxClose: 'Fermer l’image',
  lightboxPrev: 'Image précédente',
  lightboxNext: 'Image suivante',
  // Maps visitor photos REMOVED 2026-11-25 (fix pass 10): the nine photos
  // were from the old listing — the wrong place. No replacements fetched. The section stays hidden while mapsPhotos is
  // empty (see Gallery.tsx); the keys below stay so the section can come
  // back if real photos of the new place are ever added.
  mapsTitle: 'Photos des visiteurs — Google Maps',
  mapsLede: 'Ce que les clients ont vraiment photographié.',
  mapsCredit: 'Photos des visiteurs — Google Maps.',
  mapsPhotos: [] as {
    src: string
    alt: string
    caption: string
    video: boolean
    credit: string
  }[],
} as const;

export const VISIT = {
  eyebrow: 'Venir',
  title: 'Trouver le café.',
  addressLabel: 'Adresse',
  hoursLabel: 'Horaires',
  // No hours are listed on Google Maps for the new place — never invent
  // them. The single row below is the à-confirmer placeholder the book
  // back cover and the canvas back cover render; Visit.tsx shows the
  // to-confirm note instead of an hours table.
  hours: [{ days: 'Horaires', time: 'À confirmer' }],
  hoursNote: 'Horaires — à confirmer. Google Maps n’en liste aucun pour ce lieu.',
  dayTimeline: [
    { time: 'Matin', label: 'Premier café' },
    { time: 'Midi', label: 'Pause déjeuner, terrasse au soleil' },
    { time: 'Soir', label: 'Apéritif — Spritz, Kir, Campari' },
    { time: 'Nuit', label: 'Dernier verre, en douceur' },
  ],
  mapsCta: 'Ouvrir dans Google Maps',
  ratingLine: '3,5 sur 5 — 2 avis sur Google Maps',
} as const;

/**
 * The live agent as one character (AIRI-style character card): Nekomi,
 * the barmaid, in her Live2D form. The brain (src/lib/brain.ts) speaks
 * from this card (persona + scenario + greetings), so the chat, the
 * menu guide and the "Demander à la barmaid" button all answer in her
 * voice. (The VRM 3D form of the same barmaid was removed — user
 * order — so there is one name and one form now.)
 */
export const CHARACTER = {
  name: 'Nekomi',
  role: 'la barmaid de l’Art du Rendez-Vous',
  description:
    'La barmaid du café : elle connaît toute la carte par cœur et lit les prix à voix haute.',
  personality:
    'Chaleureuse, directe et concise — une à trois phrases par réponse, jamais de prix inventé, toujours le nom exact de la boisson tel qu’il figure sur la carte.',
  scenario:
    'Elle accueille les visiteurs du site de l’Art du Rendez-Vous, un café-bar à Bruxelles, et les aide à choisir une boisson, à composer une commande et à trouver l’adresse du café.',
  greetings: {
    menu: 'Bonjour ! Choisissez une catégorie — je vous lis les prix.',
    agent:
      'Bonjour ! Je suis Nekomi, l’agent de l’Art du Rendez-Vous. Dites-moi ce qui vous ferait plaisir — je connais toute la carte et je peux préparer votre commande.',
  },
} as const;

export const AGENT = {
  eyebrow: 'Agent',
  title: 'Parlez à Nekomi.',
  lede: "Notre agent connaît toute la carte et le café. Demandez un conseil, composez votre commande — elle la note ici, prête à montrer au bar.",
  statusOffline: 'Agent — chat disponible · voix et cerveau bientôt en ligne',
  statusHint:
    'Le service vocal et le cerveau de l’agent se branchent bientôt. En attendant, le chat ci-dessous répond déjà avec la carte et l’adresse.',
  chatPlaceholder: 'Écrivez ici… ex. « un café et un Aperol Spritz »',
  chatSend: 'Envoyer',
  chatSuggestions: ['Un café, s’il vous plaît', 'Qu’est-ce que vous conseillez en apéritif ?', 'Vos horaires ?', 'Je veux commander'],
  voiceTitle: 'Appel vocal',
  voiceCta: 'Parler à voix haute',
  voiceStop: 'Terminer l’appel',
  voiceOffline:
    'La voix arrive avec la connexion Deepgram — pour l’instant indisponible, le chat texte ci-dessus répond déjà.',
  voiceListening: 'Je vous écoute…',
  voiceDenied: 'Micro non autorisé — le chat texte reste disponible.',
  voiceMicMissing: 'Aucun microphone trouvé sur cet appareil — le chat texte reste disponible.',
  voiceConnecting: 'Connexion à l’agent vocal…',
  voiceSpeaking: 'Nekomi parle…',
  // Honest offline states for the Deepgram voice call (Phase 4). The
  // stored Deepgram key is still rejected (401), so the voice call cannot
  // connect until a working key is re-entered — the UI says so plainly.
  voiceNoToken:
    'La voix en direct n’est pas connectée : Deepgram n’a pas fourni de jeton d’appel. Le chat texte ci-dessus fonctionne normalement.',
  // Fix pass 16, group 4: the grant fetch reports the REAL failure
  // instead of the generic line above. These are the sentence heads —
  // Agent.tsx appends the HTTP status when there is one and the
  // attempt count, e.g. "…n’a pas répondu (3 tentatives)".
  voiceGrantNetwork:
    'La voix en direct n’est pas connectée : le serveur de jetons n’a pas répondu',
  voiceGrantTimeout:
    'La voix en direct n’est pas connectée : le serveur de jetons a mis trop de temps à répondre',
  voiceGrantHttp:
    'La voix en direct n’est pas connectée : le serveur de jetons a renvoyé une erreur',
  voiceGrantEmpty:
    'La voix en direct n’est pas connectée : le serveur de jetons a renvoyé une réponse vide',
  voiceWorklet:
    'Votre navigateur ne permet pas la capture audio en direct — le chat texte reste disponible.',
  voiceSocketError:
    'La connexion vocale a été interrompue. Réessayez, ou utilisez le chat texte.',
  voiceSettingsError:
    'La configuration vocale a été refusée par le service. Le chat texte reste disponible.',
  orderTitle: 'Votre commande',
  orderEmpty: 'Rien pour l’instant — ajoutez une boisson depuis la carte ou depuis le chat.',
  orderConfirm: 'Confirmer la commande',
  orderConfirmed:
    'Commande notée ! Présentez-la au bar à votre arrivée.',
  orderTotal: 'Total',
  henshinLabel: 'Henshin',
  henshinHuman: 'Forme humaine',
  henshinFurry: 'Forme féline',
  modelNote: 'Nekomi — modèle Live2D. Bougez le curseur : elle vous suit des yeux.',
  qrTitle: 'Scannez pour discuter',
  qrText: 'Pointez votre téléphone vers ce code pour ouvrir le chat avec notre agent.',
  // TODO (Phase 9): replace with the real deployed site URL, e.g. https://<vercel-domain>/#agent
  qrUrl: 'https://art-du-rendez-vous-cafe.vercel.app/#agent',
  guidance: [
    'Connaît toute la carte et les prix, ainsi que l’adresse du café.',
    'Propose des conseils selon vos goûts — café, bière, vin, apéritif.',
    'Compose votre commande et la note, prête à montrer au bar.',
  ],
} as const;

export const FOOTER = {
  subscribeTitle: 'Restez au courant.',
  subscribeText: 'La lettre du café arrive bientôt — carte, événements et nouveautés.',
  subscribePlaceholder: 'Votre adresse e-mail',
  subscribeCta: 'S’abonner',
  subscribeDone: 'Merci ! Les inscriptions n’ont pas encore ouvert — votre adresse n’a pas été enregistrée.',
  columns: [
    {
      title: 'Le café',
      links: [
        { label: 'La carte', hash: '#carte' },
        { label: 'Ambiance', hash: '#ambiance' },
        { label: 'Galerie', hash: '#galerie' },
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
  mapsLine: 'Rue de Malines 21, 1000 Bruxelles, Belgium',
} as const;
