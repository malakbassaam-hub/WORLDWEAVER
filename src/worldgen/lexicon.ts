/**
 * Bilingual (English / Arabic) concept lexicon and text normalisation.
 *
 * This is plain deterministic keyword matching. It is NOT language-model
 * inference and must never be described as such.
 */
import type { ConceptId } from './types';

export type LexiconKind = 'feature' | 'biome' | 'time' | 'weather' | 'theme';

export interface LexiconEntry {
  readonly id: ConceptId;
  readonly kind: LexiconKind;
  readonly en: readonly string[];
  readonly ar: readonly string[];
  readonly labelEn: string;
  readonly labelAr: string;
  /** Upper bound for a requested count. */
  readonly maxCount: number;
}

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;
const ARABIC_LETTER = /[\u0600-\u06FF]/;
const LATIN_LETTER = /[A-Za-z]/;

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Lower-cases, folds Arabic-Indic and Persian digits to ASCII, removes Arabic
 * diacritics and tatweel, and unifies letter variants (alef forms, yeh forms,
 * teh marbuta, hamza carriers) so that spelling variants compare equal.
 */
export function normalizeText(text: string): string {
  let out = text.normalize('NFKC').toLowerCase();
  out = out.replace(ARABIC_DIACRITICS, '');
  out = out.replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627'); // alef variants -> alef
  out = out.replace(/\u0649/g, '\u064A'); // alef maksura -> yeh
  out = out.replace(/\u0626/g, '\u064A'); // hamza on yeh -> yeh
  out = out.replace(/\u0624/g, '\u0648'); // hamza on waw -> waw
  out = out.replace(/\u0629/g, '\u0647'); // teh marbuta -> heh
  out = out.replace(/[\u0660-\u0669]/g, (d) => String(ARABIC_INDIC.indexOf(d)));
  out = out.replace(/[\u06F0-\u06F9]/g, (d) => String(PERSIAN_INDIC.indexOf(d)));
  return out;
}

export function tokenize(normalized: string): string[] {
  return normalized.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0);
}

export function hasArabic(text: string): boolean {
  return ARABIC_LETTER.test(text);
}

export function detectLanguage(text: string): 'en' | 'ar' | 'mixed' | 'unknown' {
  const ar = ARABIC_LETTER.test(text);
  const en = LATIN_LETTER.test(text);
  if (ar && en) return 'mixed';
  if (ar) return 'ar';
  if (en) return 'en';
  return 'unknown';
}

const e = (
  id: ConceptId,
  kind: LexiconKind,
  labelEn: string,
  labelAr: string,
  en: string[],
  ar: string[],
  maxCount = 1,
): LexiconEntry => ({ id, kind, labelEn, labelAr, en, ar, maxCount });

/** Arabic terms are written in natural spelling; `normalizeText` is applied at load. */
const RAW: readonly LexiconEntry[] = [
  // water
  e('river', 'feature', 'River', 'نهر', ['river', 'rivers', 'stream', 'streams', 'creek', 'brook'], ['نهر', 'انهار', 'أنهار', 'نهير', 'جدول'], 2),
  e('waterfall', 'feature', 'Waterfall', 'شلال', ['waterfall', 'waterfalls', 'cascade', 'cascades'], ['شلال', 'شلالات'], 2),
  e('lake', 'feature', 'Lake', 'بحيرة', ['lake', 'lakes', 'pond', 'ponds', 'lagoon', 'lagoons'], ['بحيرة', 'بحيرات', 'بركة', 'بِرك'], 2),
  e('sea', 'feature', 'Sea', 'بحر', ['sea', 'seas', 'ocean', 'oceans'], ['بحر', 'بحار', 'محيط', 'محيطات']),
  // terrain
  e('mountain', 'feature', 'Mountain', 'جبل', ['mountain', 'mountains', 'peak', 'peaks', 'summit'], ['جبل', 'جبال', 'قمة', 'قمم'], 3),
  e('hill', 'feature', 'Hill', 'تل', ['hill', 'hills', 'hillside', 'plateau'], ['تل', 'تلال', 'هضبة', 'هضاب'], 3),
  e('valley', 'feature', 'Valley', 'وادي', ['valley', 'valleys', 'canyon', 'gorge', 'ravine'], ['وادي', 'أودية', 'وادى', 'خانق'], 2),
  e('island', 'feature', 'Island', 'جزيرة', ['island', 'islands', 'isle', 'archipelago'], ['جزيرة', 'جزر', 'أرخبيل'], 1),
  e('cliff', 'feature', 'Cliff', 'جرف', ['cliff', 'cliffs', 'escarpment', 'crag'], ['جرف', 'جروف', 'منحدر', 'منحدرات'], 2),
  // architecture
  e('lighthouse', 'feature', 'Lighthouse', 'منارة', ['lighthouse', 'lighthouses', 'beacon'], ['منارة', 'مناره', 'فنار', 'منارات'], 2),
  e('castle', 'feature', 'Castle', 'قلعة', ['castle', 'castles', 'fortress', 'fort', 'citadel', 'palace'], ['قلعة', 'قلاع', 'حصن', 'حصون', 'قصر', 'قصور'], 2),
  e('tower', 'feature', 'Tower', 'برج', ['tower', 'towers', 'spire', 'watchtower'], ['برج', 'ابراج', 'أبراج'], 6),
  e('temple', 'feature', 'Temple', 'معبد', ['temple', 'temples', 'shrine', 'sanctuary', 'monastery'], ['معبد', 'معابد', 'ضريح', 'دير'], 2),
  e('village', 'feature', 'Settlement', 'قرية', ['village', 'villages', 'town', 'towns', 'city', 'settlement', 'hamlet'], ['قرية', 'قرى', 'بلدة', 'مدينة', 'مدن', 'قري'], 2),
  e('house', 'feature', 'House', 'بيت', ['house', 'houses', 'cottage', 'cottages', 'cabin', 'cabins', 'hut', 'huts'], ['بيت', 'بيوت', 'منزل', 'منازل', 'كوخ', 'اكواخ', 'أكواخ'], 8),
  e('ruins', 'feature', 'Ruins', 'أطلال', ['ruin', 'ruins', 'ruined', 'abandoned'], ['اطلال', 'أطلال', 'خرائب', 'خربة', 'ركام', 'مهجور', 'مهجورة'], 3),
  e('windmill', 'feature', 'Windmill', 'طاحونة', ['windmill', 'windmills', 'mill'], ['طاحونة', 'طواحين', 'طاحونه'], 2),
  e('bridge', 'feature', 'Bridge', 'جسر', ['bridge', 'bridges'], ['جسر', 'جسور'], 3),
  e('road', 'feature', 'Road', 'طريق', ['road', 'roads', 'path', 'paths', 'trail', 'trails', 'pathway'], ['طريق', 'طرق', 'ممر', 'ممرات', 'مسار', 'مسارات', 'درب'], 3),
  // life
  e('forest', 'feature', 'Forest', 'غابة', ['forest', 'forests', 'woods', 'woodland', 'grove', 'jungle'], ['غابة', 'غابات', 'احراج', 'أحراج', 'حرج'], 2),
  e('tree', 'feature', 'Tree', 'شجرة', ['tree', 'trees', 'palm', 'palms', 'oak', 'pine', 'pines'], ['شجرة', 'شجر', 'اشجار', 'أشجار', 'نخلة', 'نخيل'], 3),
  e('flowers', 'feature', 'Flowers', 'زهور', ['flower', 'flowers', 'blossom', 'blossoms', 'meadow', 'meadows'], ['زهرة', 'زهور', 'ازهار', 'أزهار', 'ورد', 'مروج', 'مرج'], 1),
  e(
    'character',
    'feature',
    'Character',
    'شخصية',
    ['character', 'characters', 'villager', 'villagers', 'people', 'person', 'guardian', 'wizard', 'knight', 'hermit', 'keeper', 'fisherman', 'inhabitants'],
    ['شخصية', 'شخصيات', 'قروي', 'قرويون', 'ساحر', 'حارس', 'فارس', 'ناسك', 'صياد', 'سكان'],
    6,
  ),
  // weather
  e('fog', 'weather', 'Fog', 'ضباب', ['fog', 'foggy', 'mist', 'misty', 'haze', 'hazy'], ['ضباب', 'ضبابي', 'ضبابية', 'سديم', 'غائم'], 1),
  e('rain', 'weather', 'Rain', 'مطر', ['rain', 'rainy', 'drizzle', 'raining'], ['مطر', 'ممطر', 'ممطرة', 'امطار', 'أمطار'], 1),
  e('snow', 'weather', 'Snow', 'ثلج', ['snow', 'snowy', 'snowfall', 'blizzard', 'snowing'], ['ثلج', 'ثلوج', 'ثلجي', 'ثلجية', 'مثلج'], 1),
  e('storm', 'weather', 'Storm', 'عاصفة', ['storm', 'stormy', 'thunder', 'thunderstorm', 'tempest'], ['عاصفة', 'عواصف', 'عاصف', 'رعد', 'عاصفه'], 1),
  // time
  e('dawn', 'time', 'Dawn', 'فجر', ['dawn', 'sunrise', 'daybreak', 'morning'], ['فجر', 'شروق', 'صباح', 'الفجر'], 1),
  e('day', 'time', 'Day', 'نهار', ['day', 'daytime', 'noon', 'midday', 'sunny', 'daylight'], ['نهار', 'ظهر', 'مشمس', 'ظهيرة'], 1),
  e('sunset', 'time', 'Sunset', 'غروب', ['sunset', 'dusk', 'twilight', 'evening'], ['غروب', 'غسق', 'مساء', 'عصر'], 1),
  e('night', 'time', 'Night', 'ليل', ['night', 'nighttime', 'midnight', 'moonlit', 'moonlight', 'starlit'], ['ليل', 'ليلي', 'ليلا', 'ليلة', 'قمر', 'مقمر'], 1),
  // biome
  e('desert', 'biome', 'Desert', 'صحراء', ['desert', 'deserts', 'dune', 'dunes', 'arid', 'sandy', 'sand'], ['صحراء', 'صحراوي', 'صحراويه', 'كثبان', 'رمال', 'رمل', 'صحرا'], 1),
  e('arctic', 'biome', 'Arctic', 'قطبي', ['arctic', 'tundra', 'frozen', 'icy', 'glacier', 'glaciers', 'ice'], ['قطبي', 'قطبية', 'جليد', 'جليدي', 'جليدية', 'متجمد', 'متجمدة', 'تندرا'], 1),
  e('tropical', 'biome', 'Tropical', 'استوائي', ['tropical', 'rainforest', 'tropics'], ['استوائي', 'استوائية', 'إستوائي', 'مداري'], 1),
  e('alpine', 'biome', 'Alpine', 'جبلي', ['alpine', 'highland', 'highlands', 'mountainous'], ['جبلي', 'جبلية', 'مرتفعات'], 1),
  e('coastal', 'biome', 'Coastal', 'ساحلي', ['coastal', 'coast', 'beach', 'shore', 'bay', 'harbor', 'harbour', 'seaside'], ['ساحلي', 'ساحلية', 'ساحل', 'شاطئ', 'شاطي', 'خليج', 'ميناء'], 1),
  e('temperate', 'biome', 'Temperate', 'معتدل', ['temperate', 'grassland', 'grasslands', 'pasture', 'countryside', 'plains'], ['معتدل', 'سهل', 'سهول', 'عشب', 'حقول', 'ريف'], 1),
  // theme
  e('mystic', 'theme', 'Mystic', 'سحري', ['mystic', 'mystical', 'magical', 'magic', 'enchanted', 'glowing', 'ethereal', 'fantasy'], ['سحري', 'سحرية', 'سحر', 'مسحور', 'مسحورة', 'متوهج', 'متوهجة', 'خيالي', 'خيالية'], 1),
  e('ominous', 'theme', 'Ominous', 'مشؤوم', ['ominous', 'dark', 'gloomy', 'eerie', 'haunted', 'grim', 'sinister', 'apocalyptic'], ['مظلم', 'مظلمة', 'كئيب', 'كئيبة', 'مخيف', 'مخيفة', 'موحش', 'موحشة', 'مشؤوم'], 1),
  e('ancient', 'theme', 'Ancient', 'قديم', ['ancient', 'old', 'forgotten', 'timeless', 'medieval', 'primeval'], ['قديم', 'قديمة', 'عتيق', 'عتيقة', 'منسي', 'منسية'], 1),
  e('serene', 'theme', 'Serene', 'هادئ', ['serene', 'peaceful', 'calm', 'tranquil', 'quiet', 'gentle'], ['هادئ', 'هادئة', 'ساكن', 'ساكنة', 'وديع', 'مسالم'], 1),
  e('vibrant', 'theme', 'Vibrant', 'نابض', ['vibrant', 'colorful', 'colourful', 'lush', 'vivid', 'blooming'], ['ملون', 'ملونة', 'نابض', 'نابضة', 'حيوي', 'خصب', 'خصبة', 'مزهر'], 1),
];

export interface NormalizedEntry extends LexiconEntry {
  readonly enNorm: ReadonlySet<string>;
  readonly arNorm: ReadonlySet<string>;
}

export const LEXICON: readonly NormalizedEntry[] = RAW.map((entry) => ({
  ...entry,
  enNorm: new Set(entry.en.map(normalizeText)),
  arNorm: new Set(entry.ar.map(normalizeText)),
}));

export const LEXICON_BY_ID: ReadonlyMap<ConceptId, NormalizedEntry> = new Map(LEXICON.map((x) => [x.id, x]));

/** Term -> entry, built once. A term appearing in two entries is a lexicon bug (tested). */
export const TERM_INDEX: ReadonlyMap<string, NormalizedEntry> = (() => {
  const map = new Map<string, NormalizedEntry>();
  for (const entry of LEXICON) {
    for (const term of [...entry.enNorm, ...entry.arNorm]) {
      if (!map.has(term)) map.set(term, entry);
    }
  }
  return map;
})();

/** Terms that appear in more than one entry (should be empty). */
export function findAmbiguousTerms(): string[] {
  const seen = new Map<string, ConceptId>();
  const dup: string[] = [];
  for (const entry of LEXICON) {
    for (const term of [...entry.enNorm, ...entry.arNorm]) {
      const prior = seen.get(term);
      if (prior !== undefined && prior !== entry.id) dup.push(term);
      seen.set(term, entry.id);
    }
  }
  return dup;
}

const NEGATORS = new Set(['no', 'without', 'not', 'never', 'zero', 'بدون', 'بلا', 'دون', 'لا', 'ليس', 'ليست', 'خال', 'خالي', 'خاليه'].map(normalizeText));

export function isNegator(token: string): boolean {
  return NEGATORS.has(token);
}

const NUMBER_WORDS: Readonly<Record<string, number>> = Object.fromEntries(
  [
    ['one', 1], ['a', 1], ['an', 1], ['single', 1], ['two', 2], ['pair', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6],
    ['seven', 7], ['eight', 8],
    ['واحد', 1], ['واحدة', 1], ['اثنان', 2], ['اثنين', 2], ['اثنتان', 2], ['ثلاث', 3], ['ثلاثة', 3], ['اربع', 4], ['أربع', 4], ['أربعة', 4], ['اربعة', 4],
    ['خمس', 5], ['خمسة', 5], ['ست', 6], ['ستة', 6], ['سبع', 7], ['سبعة', 7], ['ثمان', 8], ['ثمانية', 8],
  ].map(([w, n]) => [normalizeText(w as string), n as number]),
);

/** Returns a count for a number token (digits or number word), otherwise null. */
export function parseCountToken(token: string): number | null {
  if (/^[0-9]{1,3}$/.test(token)) return Number(token);
  const word = NUMBER_WORDS[token];
  return word ?? null;
}

const AR_CONJ = ['\u0648', '\u0641']; // waw, feh
const AR_PREP = ['\u0628', '\u0644', '\u0643']; // beh, lam, kaf
const AR_ARTICLE = '\u0627\u0644';

/** Candidate base forms of a token: itself, English plural stems, Arabic clitic strips. */
export function candidateForms(token: string): string[] {
  const out = new Set<string>([token]);
  if (hasArabic(token)) {
    let stage1 = new Set<string>([token]);
    for (const c of AR_CONJ) if (token.startsWith(c) && token.length > 3) stage1.add(token.slice(1));
    const stage2 = new Set<string>(stage1);
    for (const s of stage1) {
      for (const p of AR_PREP) if (s.startsWith(p) && s.length > 3) stage2.add(s.slice(1));
      if (s.startsWith('\u0644\u0644') && s.length > 4) stage2.add(s.slice(2));
    }
    const stage3 = new Set<string>(stage2);
    for (const s of stage2) if (s.startsWith(AR_ARTICLE) && s.length > 4) stage3.add(s.slice(2));
    stage1 = stage3;
    for (const s of stage1) out.add(s);
  } else {
    if (token.endsWith('ies') && token.length > 4) out.add(`${token.slice(0, -3)}y`);
    if (token.endsWith('es') && token.length > 3) out.add(token.slice(0, -2));
    if (token.endsWith('s') && token.length > 3) out.add(token.slice(0, -1));
  }
  return [...out];
}

export function labelFor(concept: ConceptId, language: 'en' | 'ar'): string {
  const entry = LEXICON_BY_ID.get(concept);
  if (!entry) return concept;
  return language === 'ar' ? entry.labelAr : entry.labelEn;
}
