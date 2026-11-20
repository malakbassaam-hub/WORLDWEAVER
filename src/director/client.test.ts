import { describe, expect, it } from 'vitest';
import { fetchHealth, requestProposal, type DirectorRequestBody } from './client';

const body: DirectorRequestBody = { mode: 'create', prompt: 'x', world: { worldName: 'W', biome: 'b', entityCount: 0, entities: [] } };

function fakeFetch(status: number, payload: unknown, capture?: Array<{ url: string; init?: RequestInit }>) {
  return async (url: string, init?: RequestInit) => {
    capture?.push({ url, ...(init ? { init } : {}) });
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return new Response(text, { status, headers: { 'content-type': 'application/json' } });
  };
}

describe('requestProposal', () => {
  it('POSTs JSON to the same-origin proxy only', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const r = await requestProposal(body, { fetchImpl: fakeFetch(200, { ok: true, mode: 'live', requestId: 'r1', text: '{}', model: 'gemini-3.5-flash-lite' }, calls) });
    expect(r).toEqual({ ok: true, mode: 'live', requestId: 'r1', text: '{}', model: 'gemini-3.5-flash-lite' });
    expect(calls[0]!.url).toBe('/api/director');
    expect(calls[0]!.init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual(body);
  });

  it('maps proxy errors, keeping retry-after and sanitised issues', async () => {
    const r = await requestProposal(body, {
      fetchImpl: fakeFetch(429, { ok: false, mode: 'live', requestId: 'r2', code: 'RATE_LIMITED', message: 'slow down\u202E', retryAfterSec: 7.2, issues: [{ path: 'a', code: 'too_many', message: 'm' }, { bogus: true }, 'x'] }),
    });
    expect(r).toMatchObject({ ok: false, code: 'RATE_LIMITED', retryAfterSec: 8, mode: 'live', requestId: 'r2' });
    if (!r.ok) {
      expect(r.message).toBe('slow down');
      expect(r.issues).toEqual([{ path: 'a', code: 'too_many', message: 'm' }]);
    }
  });

  it('treats unreadable or unexpected responses as MALFORMED_RESPONSE', async () => {
    for (const [status, payload] of [[502, '<html>Bad Gateway</html>'], [200, []], [200, { ok: true, mode: 'live' }], [200, { ok: true, mode: 'cloud', requestId: 'r', text: '{}' }]] as const) {
      const r = await requestProposal(body, { fetchImpl: fakeFetch(status, payload) });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('MALFORMED_RESPONSE');
    }
  });

  it('replaces unexpected error codes and clips long messages', async () => {
    const r = await requestProposal(body, { fetchImpl: fakeFetch(500, { ok: false, code: 'lowercase<script>', message: 'm'.repeat(1000) }) });
    expect(!r.ok && r.code).toBe('UPSTREAM');
    expect(!r.ok && r.message.length).toBeLessThanOrEqual(300);
  });

  it('reports NETWORK on connection failure and CANCELLED on abort', async () => {
    const down = await requestProposal(body, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
    expect(!down.ok && down.code).toBe('NETWORK');
    const ac = new AbortController();
    ac.abort();
    const cancelled = await requestProposal(body, { signal: ac.signal, fetchImpl: async () => { throw new DOMException('Aborted', 'AbortError'); } });
    expect(!cancelled.ok && cancelled.code).toBe('CANCELLED');
  });
});

describe('fetchHealth', () => {
  it('returns safe health info, or null when unavailable', async () => {
    const info = await fetchHealth({ fetchImpl: fakeFetch(200, { ok: true, mode: 'recorded', model: 'gemini-3.5-flash-lite', keyConfigured: false, liveReady: false, modeReason: 'GEMINI_API_KEY is not set', morphEnabled: false }) });
    expect(info).toEqual({ mode: 'recorded', model: 'gemini-3.5-flash-lite', keyConfigured: false, liveReady: false, modeReason: 'GEMINI_API_KEY is not set', morphEnabled: false });
    expect(await fetchHealth({ fetchImpl: fakeFetch(500, {}) })).toBeNull();
    expect(await fetchHealth({ fetchImpl: fakeFetch(200, { ok: true, mode: 'other' }) })).toBeNull();
    expect(await fetchHealth({ fetchImpl: async () => { throw new TypeError('down'); } })).toBeNull();
  });
});
