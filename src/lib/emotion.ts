/**
 * Reply → emotion, for the host's face. Concept from Soul-of-Waifu's emotion
 * stage and utsuwa's expression composer (both GPL/AGPL: idea only, code
 * written here): classify each assistant line into a small emotion set, then
 * map it onto the avatar's own expression names. French + English cues.
 */
export type Emotion = 'joy' | 'excited' | 'love' | 'proud' | 'sad' | 'surprised' | 'curious' | 'hungry' | 'neutral';

const RULES: [Emotion, RegExp][] = [
  ['sad', /\b(désolée?|malheureusement|hélas|indisponible|pas (de|disponible)|sorry|unfortunately)\b/i],
  ['proud', /\b(ajouté|ajoutée|c'est noté|noté|commande (est )?prête|added|done)\b/i],
  ['love', /\b(adore|coup de c(œ|oe)ur|préférée?|love|favou?rite)\b/i],
  ['hungry', /\b(faim|croque|planche|gourmand|délicieu[sx]|hungry|delicious)\b/i],
  ['surprised', /\b(oh|waouh|vraiment|incroyable|wow|really)\b/i],
  ['excited', /(!.*!|\b(super|génial|parfait|excellent|top|great|awesome)\b)/i],
  ['joy', /\b(bonjour|bienvenue|merci|avec plaisir|santé|hello|welcome|thanks)\b/i],
  ['curious', /\?\s*$/],
];

export function classify(text: string): Emotion {
  for (const [e, re] of RULES) if (re.test(text)) return e;
  return 'neutral';
}

/** Emotion → Nori (Layer2D) face names. */
export const NORI_FACE: Record<Emotion, string | null> = {
  joy: 'Happy',
  excited: 'Excited',
  love: 'Love',
  proud: 'Proud',
  sad: 'Sad',
  surprised: 'Surprised',
  curious: 'Cute',
  hungry: 'Hungry',
  neutral: null,
};
