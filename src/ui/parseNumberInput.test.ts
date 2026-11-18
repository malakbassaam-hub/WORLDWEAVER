import { describe, expect, it } from 'vitest';
import { parseNumberInput } from './inspector';

describe('parseNumberInput', () => {
  it('parses Latin numbers', () => {
    expect(parseNumberInput('8.77')).toBe(8.77);
    expect(parseNumberInput(' -3 ')).toBe(-3);
    expect(parseNumberInput('.5')).toBe(0.5);
  });

  it('accepts Arabic-Indic and Persian digits and separators', () => {
    expect(parseNumberInput('٨٫٧٧')).toBe(8.77);
    expect(parseNumberInput('٠')).toBe(0);
    expect(parseNumberInput('−۱۲')).toBe(-12);
    expect(parseNumberInput('2,5')).toBe(2.5);
  });

  it('rejects invalid input', () => {
    for (const bad of ['', 'abc', '1.2.3', '--1', '1e999x']) {
      expect(Number.isNaN(parseNumberInput(bad))).toBe(true);
    }
  });
});
