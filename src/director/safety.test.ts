import { describe, expect, it } from 'vitest';

/**
 * Static guard: Director code treats model output as data only. It must never
 * evaluate code, read environment variables or secrets, write HTML or use
 * storage. Network access is allowed ONLY in client.ts, and only to the two
 * same-origin proxy endpoints. (The proxy that holds the key is in server/.)
 */
const sources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const production = Object.entries(sources).filter(([path]) => !path.endsWith('.test.ts'));
const NETWORK_MODULE = './client.ts';

const FORBIDDEN: ReadonlyArray<[string, RegExp]> = [
  ['eval', /\beval\s*\(/],
  ['Function constructor', /\bFunction\s*\(/],
  ['dynamic import', /\bimport\s*\(/],
  ['setTimeout/setInterval with code strings', /\bset(?:Timeout|Interval)\s*\(\s*['"`]/],
  ['innerHTML/outerHTML', /\b(?:inner|outer)HTML\b/],
  ['insertAdjacentHTML / document.write', /insertAdjacentHTML|document\.write/],
  ['environment variables', /process\.env|import\.meta\.env/],
  ['API key names', /GEMINI_API_KEY|x-goog-api-key|AIza/],
  ['storage', /localStorage|sessionStorage|indexedDB/],
  ['other network APIs', /XMLHttpRequest|WebSocket|EventSource|sendBeacon/],
];

describe('director safety', () => {
  it('scans every director production module', () => {
    expect(production.map(([p]) => p).sort()).toEqual([
      './apply.ts',
      './client.ts',
      './context.ts',
      './controller.ts',
      './describe.ts',
      './index.ts',
      './morph.ts',
      './schema.ts',
      './translate.ts',
      './validate.ts',
    ]);
  });

  it.each(FORBIDDEN)('contains no %s', (_label, pattern) => {
    const offenders = production.filter(([, code]) => pattern.test(code)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('uses fetch only in client.ts', () => {
    const offenders = production.filter(([path, code]) => path !== NETWORK_MODULE && /\bfetch\b/.test(code)).map(([p]) => p);
    expect(offenders).toEqual([]);
  });

  it('client.ts talks only to relative same-origin proxy endpoints', () => {
    const client = sources[NETWORK_MODULE] ?? '';
    expect(client).toMatch(/DIRECTOR_ENDPOINT = '\/api\/director'/);
    expect(client).toMatch(/HEALTH_ENDPOINT = '\/api\/director\/health'/);
    expect(client).not.toMatch(/https?:\/\//);
    const calls = [...client.matchAll(/fetchImpl\(\s*([A-Z_]+)/g)].map((m) => m[1]);
    expect(calls.sort()).toEqual(['DIRECTOR_ENDPOINT', 'HEALTH_ENDPOINT']);
    expect(client).toMatch(/credentials: 'same-origin'/);
  });
});
