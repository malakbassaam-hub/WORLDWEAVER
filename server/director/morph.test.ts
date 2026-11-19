import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildWorldContext } from '../../src/director/context';
import { buildCrystalKingdom } from '../../src/worlds/crystalKingdom';
import { readConfig, type ConfigOverrides } from './config';
import type { FetchLike } from './gemini';
import { createDirectorServer, type RunningServer } from './index';
import { buildGeminiBody, MORPH_INSTRUCTION, SYSTEM_INSTRUCTION, systemInstructionFor } from './prompt';
import { selectRecording } from './recordings';
import { validateDirectorRequest } from './request';

const FAKE_KEY = 'test-only-fake-gemini-key-do-not-use-000';
const servers: RunningServer[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
});

const world = () => {
  const ctx = buildWorldContext(buildCrystalKingdom());
  return { worldName: ctx.worldName, biome: ctx.biome, entityCount: ctx.entityCount, entities: ctx.entities };
};
const body = (mode: 'create' | 'edit' | 'morph', prompt = 'Sink the kingdom into violet dusk') => ({ mode, prompt, world: world() });

async function start(env: Record<string, string | undefined>, overrides: ConfigOverrides = {}, fetchImpl?: FetchLike) {
  const s = await createDirectorServer({ config: readConfig(env, { minIntervalMs: 0, recordedLatencyMs: 0, ...overrides }), logger: { info: () => undefined }, ...(fetchImpl ? { fetchImpl } : {}) });
  servers.push(s);
  return s;
}

function post(s: RunningServer, payload: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const u = new URL(`${s.url}/api/director`);
    const req = httpRequest({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(payload));
  });
}

describe('morph request gating', () => {
  it('is OFF by default: config, request validation and health', async () => {
    expect(readConfig({}).morphEnabled).toBe(false);
    expect(readConfig({ DIRECTOR_MORPH: '0' }).morphEnabled).toBe(false);
    expect(readConfig({ DIRECTOR_MORPH: 'yes' }).morphEnabled).toBe(false);
    expect(readConfig({ DIRECTOR_MORPH: '1' }).morphEnabled).toBe(true);
    expect(readConfig({ DIRECTOR_MORPH: 'TRUE' }).morphEnabled).toBe(true);
    const r = validateDirectorRequest(body('morph'));
    expect(r).toEqual({ ok: false, message: 'World Morph is not enabled on this server.' });
    expect(validateDirectorRequest(body('morph'), { allowMorph: true }).ok).toBe(true);
    expect(validateDirectorRequest({ ...body('create'), mode: 'restyle' }, { allowMorph: true }).ok).toBe(false);

    const s = await start({});
    const res = await post(s, body('morph'));
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('BAD_REQUEST');
    const health = (await fetch(`${s.url}/api/director/health`).then((x) => x.json())) as { morphEnabled: boolean };
    expect(health.morphEnabled).toBe(false);
  });

  it('never serialises the key, also with morph enabled', () => {
    const c = readConfig({ GEMINI_API_KEY: FAKE_KEY, DIRECTOR_MORPH: '1' });
    expect(JSON.stringify(c)).not.toContain(FAKE_KEY);
    expect(JSON.parse(JSON.stringify(c)).morphEnabled).toBe(true);
  });
});

describe('morph in RECORDED mode (enabled for the test)', () => {
  it('serves deterministic morph recordings by keyword, in English and Arabic', async () => {
    const s = await start({}, { morphEnabled: true });
    const a = await post(s, body('morph', 'Sink the kingdom into violet dusk'));
    expect(a.json).toMatchObject({ ok: true, mode: 'recorded', recordingId: 'morph-violet-dusk' });
    const b = await post(s, body('morph', 'an apocalyptic ember ruin'));
    expect(b.json.recordingId).toBe('morph-ember-ruin');
    const c = await post(s, body('morph', 'ارفع الجزيرة'));
    expect(c.json.recordingId).toBe('morph-shift-isle');
    const d = await post(s, body('morph', 'something unusual'));
    expect(d.json.recordingId).toBe('morph-violet-dusk'); // default
    expect(selectRecording('morph', 'x').mode).toBe('morph');
  });

  it('keeps create and edit unchanged when morph is enabled', async () => {
    const s = await start({}, { morphEnabled: true });
    expect((await post(s, body('create', 'Grow a crystal garden'))).json.recordingId).toBe('create-crystal-garden');
    expect((await post(s, body('edit', 'make everything violet'))).json.recordingId).toBe('edit-violet-night');
  });
});

describe('morph prompt (LIVE path, mocked upstream)', () => {
  it('appends the morph rules only for task "morph"; create/edit instruction is unchanged', () => {
    expect(systemInstructionFor('create')).toBe(SYSTEM_INSTRUCTION);
    expect(systemInstructionFor('edit')).toBe(SYSTEM_INSTRUCTION);
    expect(systemInstructionFor('morph')).toBe(`${SYSTEM_INSTRUCTION}\n${MORPH_INSTRUCTION}`);
    expect(MORPH_INSTRUCTION).toMatch(/ancestors/);
    expect(MORPH_INSTRUCTION).toMatch(/parentRef/);
  });

  it('sends task "morph" with the same response schema and the key only in the header', async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const proposalText = JSON.stringify({ summary: 'Violet.', operations: [{ op: 'recolor', target: 'e4', palette: 'Night Violet' }] });
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: proposalText }] } }] }) };
    };
    const s = await start({ GEMINI_API_KEY: FAKE_KEY }, { morphEnabled: true }, fetchImpl);
    const res = await post(s, body('morph'));
    expect(res.status).toBe(200);
    expect(res.json.mode).toBe('live');
    const sent = JSON.parse(calls[0]!.body);
    expect(JSON.parse(sent.contents[0].parts[0].text).task).toBe('morph');
    expect(sent.systemInstruction.parts[0].text).toContain(MORPH_INSTRUCTION);
    expect(sent.generationConfig.responseSchema.required).toEqual(['summary', 'operations']);
    expect(calls[0]!.url).not.toContain(FAKE_KEY);
    expect(calls[0]!.headers['x-goog-api-key']).toBe(FAKE_KEY);
    expect(buildGeminiBody({ mode: 'create', prompt: 'x', world: world() }).systemInstruction.parts[0]!.text).toBe(SYSTEM_INSTRUCTION);
  });
});
