/** Feature concepts a provider may name in requirements (the lexicon's feature entries). */
import { LEXICON } from './lexicon';

export const CONCEPT_IDS: readonly string[] = LEXICON.filter((e) => e.kind === 'feature').map((e) => e.id);
