import { describe, expect, it } from 'vitest';

/**
 * Static guard for persistence code: imported files are data only. No code
 * evaluation, no HTML injection, no network, no environment or key access.
 * Browser storage is touched only in localSave.ts.
 */
const persistence = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const ui = import.meta.glob('../ui/persistence*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const production = Object.entries({ ...persistence, ...ui }).filter(([p]) => !p.endsWith('.test.ts'));

const FORBIDDEN: ReadonlyArray<[string, RegExp]> = [
  ['eval', /\beval\s*\(/],
  ['Function constructor', /\bFunction\s*\(/],
  // Matches real calls (`import('x')`), not the word "import" in comments.
  ['dynamic import', /\bimport\s*\(\s*['"`]/],
  ['innerHTML/outerHTML/insertAdjacentHTML/document.write', /\b(?:inner|outer)HTML\b|insertAdjacentHTML|document\.write/],
  // `EventSource` is also WORLDWEAVER's event-source type, so match constructors and calls only.
  ['network', /\bfetch\s*\(|new\s+(?:XMLHttpRequest|WebSocket|EventSource)\s*\(|sendBeacon/],
  ['environment', /process\.env|import\.meta\.env/],
  ['key header names', /x-goog-api-key|GEMINI_API_KEY/],
];

describe('persistence safety', () => {
  it('scans the persistence modules and UI', () => {
    expect(production.map(([p]) => p).sort()).toEqual(['../ui/persistenceModel.ts', '../ui/persistencePanel.ts', './controller.ts', './localSave.ts', './reboot.ts', './saveFile.ts']);
  });

  it.each(FORBIDDEN)('contains no %s', (_label, pattern) => {
    expect(production.filter(([, code]) => pattern.test(code)).map(([p]) => p)).toEqual([]);
  });

  it('uses browser storage only in localSave.ts', () => {
    expect(production.filter(([p, code]) => p !== './localSave.ts' && /localStorage|sessionStorage|indexedDB/.test(code)).map(([p]) => p)).toEqual([]);
  });
});
