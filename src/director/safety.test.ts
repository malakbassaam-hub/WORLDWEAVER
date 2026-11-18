import { describe, expect, it } from 'vitest';

/**
 * Static guard: Director code treats model output as data only. It must never
 * evaluate code, touch the network, read environment variables or secrets, or
 * write HTML. (The proxy, which holds the key, will live outside src/.)
 */
const sources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const production = Object.entries(sources).filter(([path]) => !path.endsWith('.test.ts'));

const FORBIDDEN: ReadonlyArray<[string, RegExp]> = [
  ['eval', /\beval\s*\(/],
  ['Function constructor', /\bFunction\s*\(/],
  ['dynamic import', /\bimport\s*\(/],
  ['setTimeout/setInterval with code strings', /\bset(?:Timeout|Interval)\s*\(\s*['"`]/],
  ['innerHTML/outerHTML', /\b(?:inner|outer)HTML\b/],
  ['insertAdjacentHTML / document.write', /insertAdjacentHTML|document\.write/],
  ['network: fetch', /\bfetch\s*\(/],
  ['network: XMLHttpRequest/WebSocket/EventSource/sendBeacon', /XMLHttpRequest|WebSocket|EventSource|sendBeacon/],
  ['environment variables', /process\.env|import\.meta\.env/],
  ['API key names', /GEMINI_API_KEY|x-goog-api-key|AIza/],
  ['storage', /localStorage|sessionStorage|indexedDB/],
];

describe('director safety', () => {
  it('scans the director production modules', () => {
    expect(production.map(([p]) => p).sort()).toEqual(['./context.ts', './index.ts', './schema.ts', './translate.ts', './validate.ts']);
  });

  it.each(FORBIDDEN)('contains no %s', (_label, pattern) => {
    const offenders = production.filter(([, code]) => pattern.test(code)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
