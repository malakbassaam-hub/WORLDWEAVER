import { describe, expect, it } from 'vitest';
import { LEXICON, TERM_INDEX, candidateForms, detectLanguage, findAmbiguousTerms, normalizeText, parseCountToken, tokenize } from './lexicon';

describe('lexicon', () => {
  it('maps every term to exactly one concept', () => {
    expect(findAmbiguousTerms()).toEqual([]);
  });

  it('has English and Arabic terms and labels for every concept', () => {
    for (const entry of LEXICON) {
      expect(entry.en.length, entry.id).toBeGreaterThan(0);
      expect(entry.ar.length, entry.id).toBeGreaterThan(0);
      expect(entry.labelAr).toMatch(/[\u0600-\u06FF]/);
    }
  });

  it('indexes Arabic terms in normalised form', () => {
    expect(TERM_INDEX.get(normalizeText('منارة'))?.id).toBe('lighthouse');
    expect(TERM_INDEX.get(normalizeText('أشجار'))?.id).toBe('tree');
  });
});

describe('normalizeText', () => {
  it('unifies Arabic letter variants and strips diacritics and tatweel', () => {
    expect(normalizeText('أنهار')).toBe(normalizeText('انهار'));
    expect(normalizeText('إستوائي')).toBe(normalizeText('استوائي'));
    expect(normalizeText('مَنَارَة')).toBe(normalizeText('منارة'));
    expect(normalizeText('منـــارة')).toBe(normalizeText('منارة'));
    expect(normalizeText('منارة')).toBe(normalizeText('مناره'));
  });

  it('folds Arabic-Indic and Persian digits to ASCII', () => {
    expect(normalizeText('٣ ۴')).toBe('3 4');
    expect(parseCountToken(normalizeText('٣'))).toBe(3);
  });

  it('lower-cases Latin text', () => {
    expect(normalizeText('Lighthouse')).toBe('lighthouse');
  });
});

describe('tokenize and candidateForms', () => {
  it('splits on punctuation in both scripts', () => {
    expect(tokenize(normalizeText('Lake, river; نهر،بحيرة'))).toEqual(['lake', 'river', 'نهر', normalizeText('بحيرة')]);
  });

  it('strips Arabic conjunction, preposition and article prefixes', () => {
    const forms = candidateForms(normalizeText('وبالقرية'));
    expect(forms).toContain(normalizeText('قرية'));
    expect(candidateForms(normalizeText('والشلال'))).toContain(normalizeText('شلال'));
  });

  it('derives English singular forms', () => {
    expect(candidateForms('cities')).toContain('city');
    expect(candidateForms('towers')).toContain('tower');
  });
});

describe('parseCountToken', () => {
  it('reads digits and number words in English and Arabic', () => {
    expect(parseCountToken('3')).toBe(3);
    expect(parseCountToken('three')).toBe(3);
    expect(parseCountToken(normalizeText('ثلاثة'))).toBe(3);
    expect(parseCountToken('tall')).toBeNull();
    expect(parseCountToken('12345')).toBeNull();
  });
});

describe('detectLanguage', () => {
  it('classifies scripts', () => {
    expect(detectLanguage('A river')).toBe('en');
    expect(detectLanguage('نهر')).toBe('ar');
    expect(detectLanguage('A نهر')).toBe('mixed');
    expect(detectLanguage('123 !!')).toBe('unknown');
  });
});
