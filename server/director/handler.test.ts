import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCrystalKingdom } from '../../src/worlds/crystalKingdom';
import { buildWorldContext } from '../../src/director/context';
import { readConfig, type ConfigOverrides } from './config';
import type { FetchLike } from './gemini';
import { createDirectorServer, type RunningServer } from './index';
import type { DirectorLogger } from './handler';
import { REQUEST_LIMITS } from './request';

// An obviously fake key (deliberately NOT in Google's key format, so secret
// scanners stay quiet). The tests assert it never appears in any output.
const FAKE_KEY = 'test-only-fake-gemini-key-do-not-use-000';

const servers: RunningServer[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
});

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function okUpstream(text: string, extra: Record<string, unknown> = {}) {
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }], modelVersion: 'gemini-3.5-flash-lite-001', ...extra };
}

function mockFetch(responder: (call: Captured) => { status?: number; body: unknown; headers?: Record<string, string> } | Promise<never>) {
  const calls: Captured[] = [];
  const impl: FetchLike = async (url, init) => {
    const call = { url, headers: init.headers, body: init.body };
    calls.push(call);
    const r = await responder(call);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null },
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  };
  return { impl, calls };
}

function captureLogger() {
  const lines: string[] = [];
  const logger: DirectorLogger = { info: (r) => lines.push(JSON.stringify(r)) };
  return { logger, lines };
}

async function start(env: Record<string, string | undefined>, opts: { fetchImpl?: FetchLike; overrides?: ConfigOverrides; logger?: DirectorLogger; now?: () => number } = {}) {
  const config = readConfig(env, { minIntervalMs: 0, recordedLatencyMs: 0, ...opts.overrides });
  const s = await createDirectorServer({ config, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}), ...(opts.logger ? { logger: opts.logger } : {}), ...(opts.now ? { now: opts.now } : {}) });
  servers.push(s);
  return s;
}

const worldPayload = () => {
  const ctx = buildWorldContext(buildCrystalKingdom());
  return { worldName: ctx.worldName, biome: ctx.biome, entityCount: ctx.entityCount, entities: ctx.entities };
};
const validBody = (prompt = 'Add a crystal garden', mode: 'create' | 'edit' = 'create') => ({ mode, prompt, world: worldPayload() });

/** Raw HTTP so tests can set Host/Origin/Sec-Fetch-Site freely. */
function raw(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string; json: any }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpRequest({ host: u.hostname, port: u.port, path: u.pathname, method: opts.method ?? 'GET', headers: opts.headers ?? {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* not json */
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const post = (s: RunningServer, body: unknown, headers: Record<string, string> = {}) =>
  raw(`${s.url}/api/director`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('configuration and health', () => {
  it('defaults to RECORDED mode without a key and says why', async () => {
    const s = await start({});
    const r = await raw(`${s.url}/api/director/health`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, mode: 'recorded', keyConfigured: false, liveReady: false, modeReason: 'GEMINI_API_KEY is not set' });
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('uses LIVE mode with a key, and never reveals the key', async () => {
    const s = await start({ GEMINI_API_KEY: FAKE_KEY });
    const r = await raw(`${s.url}/api/director/health`);
    expect(r.json).toMatchObject({ mode: 'live', keyConfigured: true, liveReady: true, model: 'gemini-3.5-flash-lite' });
    expect(r.text).not.toContain(FAKE_KEY);
    expect(r.text).not.toContain('AIza');
  });

  it('honours DIRECTOR_MODE and reports a forced live mode without a key as not ready', async () => {
    const recorded = readConfig({ GEMINI_API_KEY: FAKE_KEY, DIRECTOR_MODE: 'recorded' });
    expect(recorded.mode).toBe('recorded');
    const forced = readConfig({ DIRECTOR_MODE: 'live' });
    expect(forced).toMatchObject({ mode: 'live', keyConfigured: false });
    expect(readConfig({ DIRECTOR_MODE: 'turbo' }).mode).toBe('recorded');
  });

  it('never serialises the key and clamps unsafe settings', () => {
    const c = readConfig({ GEMINI_API_KEY: FAKE_KEY, DIRECTOR_MIN_INTERVAL_MS: '10', DIRECTOR_TIMEOUT_MS: '999999', GEMINI_MODEL: '../../evil' });
    expect(JSON.stringify(c)).not.toContain(FAKE_KEY);
    expect(String(c)).not.toContain(FAKE_KEY);
    expect(c.minIntervalMs).toBe(5000); // tech.md: at least 5 s between live calls
    expect(c.timeoutMs).toBe(60000);
    expect(c.model).toBe('gemini-3.5-flash-lite');
    expect(c.getApiKey()).toBe(FAKE_KEY);
  });
});

describe('request gatekeeping', () => {
  it('refuses non-localhost Host headers (DNS rebinding)', async () => {
    const s = await start({});
    const r = await raw(`${s.url}/api/director/health`, { headers: { host: 'evil.example:80' } });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('FORBIDDEN_ORIGIN');
  });

  it('refuses cross-origin and cross-site requests, allows same-origin', async () => {
    const s = await start({});
    const host = new URL(s.url).host;
    expect((await post(s, validBody(), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(s, validBody(), { origin: `http://${host.replace('127.0.0.1', 'localhost')}` })).status).toBe(403);
    expect((await post(s, validBody(), { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post(s, validBody(), { origin: `http://${host}`, 'sec-fetch-site': 'same-origin' })).status).toBe(200);
  });

  it('enforces method and content type', async () => {
    const s = await start({});
    const get = await raw(`${s.url}/api/director`);
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe('POST');
    expect((await raw(`${s.url}/api/director/health`, { method: 'POST' })).status).toBe(405);
    expect((await post(s, validBody(), { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await raw(`${s.url}/api/director/other`)).status).toBe(404);
  });

  it('rejects oversized bodies', async () => {
    const s = await start({});
    const big = JSON.stringify({ ...validBody(), padding: 'x'.repeat(REQUEST_LIMITS.maxBodyBytes) });
    const r = await post(s, big);
    expect(r.status).toBe(413);
    expect(r.json.code).toBe('TOO_LARGE');
  });

  it.each([
    ['invalid JSON', '{"mode":'],
    ['unknown property', { ...validBody(), extra: 1 }],
    ['bad mode', { ...validBody(), mode: 'delete' }],
    ['empty prompt', validBody('   ')],
    ['prompt too long', validBody('x'.repeat(REQUEST_LIMITS.maxPromptChars + 1))],
    ['control characters', validBody('hi\u0000there')],
    ['bidi override', validBody('abc\u202Edef')],
    ['entityCount mismatch', { ...validBody(), world: { ...worldPayload(), entityCount: 3 } }],
    ['bad ref', { ...validBody(), world: { ...worldPayload(), entities: [{ ...worldPayload().entities[0], ref: 'x1' }], entityCount: 1 } }],
    ['too many entities', { ...validBody(), world: { worldName: 'W', biome: 'b', entityCount: 201, entities: Array.from({ length: 201 }, (_, i) => ({ ...worldPayload().entities[0], ref: `e${i + 1}` })) } }],
  ])('rejects %s with 400', async (_label, body) => {
    const s = await start({});
    const r = await post(s, body);
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('BAD_REQUEST');
  });

  it('accepts Arabic and multi-line prompts', async () => {
    const s = await start({});
    const r = await post(s, validBody('أضف فوانيس في السماء\nand a halo'));
    expect(r.status).toBe(200);
    expect(r.json.recordingId).toBe('create-sky-lanterns');
  });
});

describe('LIVE mode', () => {
  it('sends the key only in the x-goog-api-key header, with the proposal schema', async () => {
    const { impl, calls } = mockFetch(() => ({ body: okUpstream(JSON.stringify({ summary: 'One spire.', operations: [{ op: 'add', archetype: 'crystalSpire', name: 'Spire', placement: 'sky' }] })) }));
    const { logger, lines } = captureLogger();
    const s = await start({ GEMINI_API_KEY: FAKE_KEY }, { fetchImpl: impl, logger });
    const r = await post(s, validBody('Add one spire, my secret plan'));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, mode: 'live', model: 'gemini-3.5-flash-lite-001', finishReason: 'STOP' });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(call.url).not.toContain(FAKE_KEY);
    expect(call.url).not.toContain('key=');
    expect(call.headers['x-goog-api-key']).toBe(FAKE_KEY);
    const sent = JSON.parse(call.body);
    expect(sent.generationConfig.responseMimeType).toBe('application/json');
    expect(sent.generationConfig.responseSchema.required).toEqual(['summary', 'operations']);
    expect(sent.systemInstruction.parts[0].text).toContain('pinned');
    expect(JSON.parse(sent.contents[0].parts[0].text)).toMatchObject({ task: 'create', request: 'Add one spire, my secret plan' });
    // Neither the key nor the prompt text appears in responses or logs.
    expect(r.text).not.toContain(FAKE_KEY);
    expect(lines.join('\n')).not.toContain(FAKE_KEY);
    expect(lines.join('\n')).not.toContain('secret plan');
    expect(lines.join('\n')).toContain('"promptChars":29');
  });

  it.each([
    [429, { error: { details: [{ retryDelay: '13s' }] } }, {}, 'RATE_LIMITED', 429, 13],
    [429, {}, { 'retry-after': '7' }, 'RATE_LIMITED', 429, 7],
    [401, {}, {}, 'AUTH', 502, undefined],
    [403, {}, {}, 'AUTH', 502, undefined],
    [404, {}, {}, 'MODEL_NOT_FOUND', 502, undefined],
    [400, {}, {}, 'UPSTREAM_BAD_REQUEST', 502, undefined],
    [500, {}, {}, 'UPSTREAM', 502, undefined],
    [503, {}, {}, 'UPSTREAM', 502, undefined],
  ])('maps upstream HTTP %i to %s without retrying', async (status, body, headers, code, httpStatus, retryAfterSec) => {
    const { impl, calls } = mockFetch(() => ({ status, body: { ...body, leaked: FAKE_KEY }, headers }));
    const s = await start({ GEMINI_API_KEY: FAKE_KEY }, { fetchImpl: impl });
    const r = await post(s, validBody());
    expect(r.status).toBe(httpStatus);
    expect(r.json.code).toBe(code);
    expect(r.json.retryAfterSec).toBe(retryAfterSec);
    expect(calls).toHaveLength(1); // no automatic retries
    expect(r.text).not.toContain(FAKE_KEY); // upstream bodies are never forwarded
  });

  it.each([
    ['prompt block', { promptFeedback: { blockReason: 'SAFETY' } }, 'BLOCKED_SAFETY', 422],
    ['safety finish', { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }, 'BLOCKED_SAFETY', 422],
    ['truncated', { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"summary":' }] } }] }, 'TRUNCATED', 502],
    ['no candidates', { candidates: [] }, 'EMPTY', 502],
    ['empty text', okUpstream('   '), 'EMPTY', 502],
    ['non-JSON body', 'oops <html>', 'UPSTREAM', 502],
  ])('handles %s safely', async (_label, body, code, status) => {
    const { impl } = mockFetch(() => ({ body }));
    const s = await start({ GEMINI_API_KEY: FAKE_KEY }, { fetchImpl: impl });
    const r = await post(s, validBody());
    expect(r.status).toBe(status);
    expect(r.json.code).toBe(code);
  });

  it('validates model output server-side and reports issues', async () => {
    const hostile = '{"summary":"x","operations":[{"op":"exec","target":"e1"}],"__proto__":{"a":1}}';
    const { impl } = mockFetch(() => ({ body: okUpstream(hostile) }));
    const s = await start({ GEMINI_API_KEY: FAKE_KEY }, { fetchImpl: impl });
    const r = await post(s, validBody());
    expect(r.status).toBe(502);
    expect(r.json.code).toBe('INVALID_PROPOSAL');
    expect(r.json.issues.map((i: { code: string }) => i.code)).toEqual(expect.arrayContaining(['forbidden_key', 'invalid_enum']));
    expect(r.json.text).toBeUndefined();
  });

  it('times out slow upstream calls', async () => {
    const impl: FetchLike = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const s = await start({ GEMINI_API_KEY: FAKE_KEY }, { fetchImpl: impl, overrides: { timeoutMs: 50 } });
    const r = await post(s, validBody());
    expect(r.status).toBe(504);
    expect(r.json.code).toBe('TIMEOUT');
  });

  it('reports network failures without details that could leak data', async () => {
    const impl: FetchLike = () => Promise.reject(Object.assign(new TypeError(`connect failed ${FAKE_KEY}`), { name: 'TypeError' }));
    const s = await start({ GEMINI_API_KEY: FAKE_KEY }, { fetchImpl: impl });
    const r = await post(s, validBody());
    expect(r.json.code).toBe('NETWORK');
    expect(r.text).not.toContain(FAKE_KEY);
  });

  it('enforces the minimum interval between live calls, counting failures', async () => {
    let t = 1_000_000;
    const { impl, calls } = mockFetch(() => ({ status: 500, body: {} }));
    const s = await start({ GEMINI_API_KEY: FAKE_KEY }, { fetchImpl: impl, overrides: { minIntervalMs: 5000 }, now: () => t });
    expect((await post(s, validBody())).json.code).toBe('UPSTREAM');
    t += 2000;
    const limited = await post(s, validBody());
    expect(limited.status).toBe(429);
    expect(limited.json).toMatchObject({ code: 'LOCAL_RATE_LIMITED', retryAfterSec: 3 });
    t += 3000;
    expect((await post(s, validBody())).json.code).toBe('UPSTREAM');
    expect(calls).toHaveLength(2);
  });

  it('a new request supersedes the running one, aborting its upstream call', async () => {
    const signals: AbortSignal[] = [];
    const impl: FetchLike = (_url, init) => {
      signals.push(init.signal);
      if (signals.length === 1) {
        return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
      }
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(okUpstream(JSON.stringify({ summary: 's', operations: [{ op: 'hide', target: 'e4' }] }))) });
    };
    const s = await start({ GEMINI_API_KEY: FAKE_KEY }, { fetchImpl: impl });
    const first = post(s, validBody());
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    const second = await post(s, validBody());
    expect(second.status).toBe(200);
    const firstResult = await first;
    expect(firstResult.status).toBe(409);
    expect(firstResult.json.code).toBe('SUPERSEDED');
    expect(signals[0]!.aborted).toBe(true); // the old upstream call was stopped
  });

  it('cancel followed immediately by a new request succeeds (regression)', async () => {
    const s = await start({}, { overrides: { recordedLatencyMs: 1500 } });
    const port = new URL(s.url).port;
    await new Promise<void>((resolve) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/api/director', method: 'POST', headers: { 'content-type': 'application/json' } });
      req.on('error', () => resolve());
      req.end(JSON.stringify(validBody()));
      setTimeout(() => {
        req.destroy(); // the browser's Cancel
        resolve();
      }, 150);
    });
    const next = await post(s, validBody()); // sent at once, possibly before the close is processed
    expect(next.status).toBe(200);
    expect(next.json.ok).toBe(true);
  });

  it('returns NO_KEY when live mode is forced without a key', async () => {
    const { impl, calls } = mockFetch(() => ({ body: {} }));
    const s = await start({ DIRECTOR_MODE: 'live' }, { fetchImpl: impl });
    const r = await post(s, validBody());
    expect(r.status).toBe(503);
    expect(r.json.code).toBe('NO_KEY');
    expect(calls).toHaveLength(0);
  });
});

describe('RECORDED mode', () => {
  it('serves deterministic, clearly labelled recordings without any network call', async () => {
    const { impl, calls } = mockFetch(() => ({ body: {} }));
    const s = await start({ GEMINI_API_KEY: FAKE_KEY, DIRECTOR_MODE: 'recorded' }, { fetchImpl: impl });
    const a = await post(s, validBody('Grow a crystal garden'));
    const b = await post(s, validBody('Grow a crystal garden'));
    expect(a.json).toMatchObject({ ok: true, mode: 'recorded', recordingId: 'create-crystal-garden' });
    expect(a.json.recordingLabel).toBeTruthy();
    expect(a.json.model).toBeUndefined();
    expect(a.json.text).toBe(b.json.text);
    expect(calls).toHaveLength(0);
  });

  it('falls back to the default recording for each mode', async () => {
    const s = await start({});
    expect((await post(s, validBody('something unusual'))).json.recordingId).toBe('create-moonlit-outpost');
    expect((await post(s, validBody('something unusual', 'edit'))).json.recordingId).toBe('edit-gentle-glow');
  });

  it.each([
    ['RATE_LIMITED', 429, 'RATE_LIMITED'],
    ['TIMEOUT', 504, 'TIMEOUT'],
    ['UPSTREAM', 502, 'UPSTREAM'],
    ['BLOCKED_SAFETY', 422, 'BLOCKED_SAFETY'],
    ['AUTH', 502, 'AUTH'],
    ['INVALID', 502, 'INVALID_PROPOSAL'],
    ['MALFORMED', 502, 'INVALID_PROPOSAL'],
    ['HOSTILE', 502, 'INVALID_PROPOSAL'],
  ])('simulates %s via the #error hook', async (hook, status, code) => {
    const s = await start({});
    const r = await post(s, validBody(`#error:${hook}`));
    expect(r.status).toBe(status);
    expect(r.json).toMatchObject({ ok: false, mode: 'recorded', code });
  });

  it('does not apply the #error hooks in live mode', async () => {
    const { impl, calls } = mockFetch(() => ({ body: okUpstream(JSON.stringify({ summary: 's', operations: [{ op: 'hide', target: 'e4' }] })) }));
    const s = await start({ GEMINI_API_KEY: FAKE_KEY }, { fetchImpl: impl });
    expect((await post(s, validBody('#error:RATE_LIMITED'))).json.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('stops work when the client disconnects', async () => {
    const { logger, lines } = captureLogger();
    const s = await start({}, { overrides: { recordedLatencyMs: 2000 }, logger });
    await new Promise<void>((resolve) => {
      const req = httpRequest({ host: '127.0.0.1', port: new URL(s.url).port, path: '/api/director', method: 'POST', headers: { 'content-type': 'application/json' } });
      req.on('error', () => resolve());
      req.end(JSON.stringify(validBody()));
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 100);
    });
    await vi.waitFor(() => expect(lines.join('\n')).toContain('"code":"CANCELLED"'), { timeout: 1500 });
  });
});
