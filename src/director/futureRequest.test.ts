import { describe, expect, it } from 'vitest';
import { RECORDINGS } from '../../server/director/recordings';
import { worldFingerprint } from '../core/fingerprint';
import { createFuturesManager } from '../core/futures';
import { WorldStore } from '../core/store';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import type { ClientResult, DirectorRequestBody } from './client';
import { requestFutureProposal } from './futureRequest';

const text = (id: string) => JSON.stringify(RECORDINGS.find((r) => r.id === id)!.response);

function setup() {
  const initial = buildCrystalKingdom();
  const store = new WorldStore(initial);
  const manager = createFuturesManager(store, initial);
  const f = manager.fork('Test', { source: 'director' });
  if (!f.ok) throw new Error(f.reason);
  return { initial, store, manager, id: f.value.id };
}

const ok = (t: string, extra: Partial<Extract<ClientResult, { ok: true }>> = {}): ClientResult => ({ ok: true, mode: 'recorded', requestId: 'req-1', text: t, ...extra });

describe('Director requests inside a future', () => {
  it('sends the future world (not the original), validates and applies one step', async () => {
    const { store, manager, id } = setup();
    const before = store.getState();
    let sent: DirectorRequestBody | null = null;
    const r = await requestFutureProposal(manager, id, '  violet dusk  ', 'morph', async (body) => ((sent = body), ok(text('morph-violet-dusk'), { recordingId: 'morph-violet-dusk', recordingLabel: 'Violet dusk morph (default)' })), new AbortController().signal);
    expect(r.ok).toBe(true);
    expect(sent).toMatchObject({ mode: 'morph', prompt: 'violet dusk', world: { entityCount: 27 } });
    expect(manager.get(id)!.steps[0]!.details).toMatchObject({ kind: 'morph', mode: 'recorded', requestId: 'req-1', recordingId: 'morph-violet-dusk' });
    expect(store.getState()).toBe(before);
    expect(store.getLog()).toHaveLength(0);
  });

  it('rejects empty or oversized prompts without a request', async () => {
    const { manager, id } = setup();
    let calls = 0;
    const req = async () => (calls++, ok('{}'));
    for (const p of ['', '   ', 'x'.repeat(2001)]) expect(await requestFutureProposal(manager, id, p, 'edit', req, new AbortController().signal)).toMatchObject({ ok: false, code: 'INVALID_PROMPT' });
    expect(calls).toBe(0);
  });

  it('reports invalid model output with validation issues and changes nothing', async () => {
    const { manager, id } = setup();
    const r = await requestFutureProposal(manager, id, 'x', 'edit', async () => ok('{"summary":"x","operations":[{"op":"explode"}]}'), new AbortController().signal);
    expect(r).toMatchObject({ ok: false, code: 'INVALID_PROPOSAL' });
    if (!r.ok) expect(r.issues!.length).toBeGreaterThan(0);
    expect(manager.get(id)!.eventCount).toBe(0);
  });

  it('pin protection: the recorded pinned-citadel edit is refused with a named reason', async () => {
    const { manager, id } = setup();
    const r = await requestFutureProposal(manager, id, 'recolour the citadel', 'edit', async () => ok(text('edit-pinned-citadel')), new AbortController().signal);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/pinned|Citadel/i);
    expect(manager.get(id)!.eventCount).toBe(0);
  });

  it('discards the response if the future changed while waiting, or was closed', async () => {
    const { manager, id } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pending = requestFutureProposal(manager, id, 'x', 'edit', async () => (await gate, ok(text('edit-violet-night'))), new AbortController().signal);
    await requestFutureProposal(manager, id, 'y', 'edit', async () => ok(text('edit-gentle-glow')), new AbortController().signal);
    release();
    expect(await pending).toMatchObject({ ok: false, code: 'STALE_FUTURE' });
    expect(manager.get(id)!.steps).toHaveLength(1);

    let release2!: () => void;
    const gate2 = new Promise<void>((resolve) => (release2 = resolve));
    const pending2 = requestFutureProposal(manager, id, 'x', 'edit', async () => (await gate2, ok(text('edit-violet-night'))), new AbortController().signal);
    manager.discard(id);
    release2();
    expect(await pending2).toMatchObject({ ok: false, code: 'NO_FUTURE' });
  });

  it('cancellation and proxy errors change nothing', async () => {
    const { store, manager, id } = setup();
    const fp = worldFingerprint(store.getState());
    const ctl = new AbortController();
    const pending = requestFutureProposal(manager, id, 'x', 'edit', async () => (ctl.abort(), ok(text('edit-violet-night'))), ctl.signal);
    expect(await pending).toMatchObject({ ok: false, code: 'CANCELLED' });
    const limited = await requestFutureProposal(manager, id, 'x', 'edit', async () => ({ ok: false, code: 'RATE_LIMITED', message: 'Wait a little.', issues: [], retryAfterSec: 5 }), new AbortController().signal);
    expect(limited).toMatchObject({ ok: false, code: 'REQUEST_FAILED', reason: 'Wait a little.', retryAfterSec: 5 });
    const thrown = await requestFutureProposal(manager, id, 'x', 'edit', async () => { throw new Error('boom'); }, new AbortController().signal);
    expect(thrown).toMatchObject({ ok: false, code: 'REQUEST_FAILED' });
    expect(manager.get(id)!.eventCount).toBe(0);
    expect(worldFingerprint(store.getState())).toBe(fp);
  });

  it('a user future refuses Director steps', async () => {
    const { manager } = setup();
    const u = manager.fork('Hand', { source: 'user' });
    if (!u.ok) throw new Error(u.reason);
    const r = await requestFutureProposal(manager, u.value.id, 'x', 'edit', async () => ok(text('edit-violet-night')), new AbortController().signal);
    expect(r).toMatchObject({ ok: false, code: 'FUTURE_REFUSED' });
  });
});
