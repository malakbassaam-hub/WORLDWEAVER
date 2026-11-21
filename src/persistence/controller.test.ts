import { describe, expect, it } from 'vitest';
import { canonical, worldFingerprint } from '../core/fingerprint';
import { createFuturesManager } from '../core/futures';
import { buildLedger } from '../core/ledger';
import { WorldStore } from '../core/store';
import type { World } from '../core/types';
import { buildWorldContext } from '../director/context';
import { applyProposalToFuture } from '../director/futures';
import { applyMorph, translateMorph } from '../director/morph';
import { validateProposal } from '../director/validate';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { createPersistence, exportFilename, startupWorld, type RestoreInfo } from './controller';
import { LocalSaveSlots, SAVE_KEYS, type StorageLike } from './localSave';
import { parseSaveFile } from './saveFile';

class MemStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

/** A minimal "studio": restore rebuilds the session (new store), as the policy requires. */
function studio(storage = new MemStorage(), start: World = buildCrystalKingdom()) {
  let tick = 0;
  const session = { store: new WorldStore(start), restored: [] as Array<{ world: World; info: RestoreInfo }> };
  const slots = new LocalSaveSlots(storage);
  const persistence = createPersistence({
    store: session.store,
    slots,
    now: () => `2026-11-20T10:00:${String(tick++).padStart(2, '0')}.000Z`,
    replaceWorld: (world, info) => {
      session.restored.push({ world, info });
    },
  });
  const rename = (name: string) => {
    const r = session.store.dispatch({ type: 'entity/renamed', id: start.order[4]!, name, source: 'user' });
    if (!r.ok) throw new Error(r.reason);
  };
  return { ...session, slots, persistence, storage, rename };
}

describe('unsaved-change indicator', () => {
  it('is clean at start, dirty after an edit, clean after undo back, clean after save', () => {
    const s = studio();
    expect(s.persistence.status().dirty).toBe(false);
    s.rename('Edited');
    expect(s.persistence.status()).toMatchObject({ dirty: true, canUndo: true });
    s.store.undo();
    expect(s.persistence.status().dirty).toBe(false);
    s.store.redo();
    expect(s.persistence.save().ok).toBe(true);
    expect(s.persistence.status()).toMatchObject({ dirty: false, lastSavedAt: '2026-11-20T10:00:00.000Z', local: { present: true, valid: true } });
    s.rename('After save');
    expect(s.persistence.status().dirty).toBe(true);
  });

  it('notifies subscribers on store changes and saves', () => {
    const s = studio();
    const seen: boolean[] = [];
    s.persistence.subscribe((st) => seen.push(st.dirty));
    s.rename('A');
    s.persistence.save();
    expect(seen).toEqual([true, false]);
  });
});

describe('restore and import (atomic, via replaceWorld)', () => {
  it('restores the local save through replaceWorld; the old store is not mutated', () => {
    const s = studio();
    s.rename('Saved Name');
    s.persistence.save();
    s.rename('Unsaved Name');
    const live = s.store.getState();
    expect(s.persistence.confirmation()).toMatchObject({ required: true, reason: expect.stringMatching(/unsaved changes/) });
    const r = s.persistence.restoreLocal();
    expect(r).toMatchObject({ ok: true, info: { source: 'local', recoveredFrom: null } });
    expect(s.store.getState()).toBe(live);
    expect(s.restored).toHaveLength(1);
    expect(s.restored[0]!.world.entities[s.restored[0]!.world.order[4]!]!.name).toBe('Saved Name');
  });

  it('restore with nothing saved, or damaged saves, never calls replaceWorld', () => {
    const s = studio();
    expect(s.persistence.restoreLocal()).toMatchObject({ ok: false, code: 'EMPTY' });
    s.storage.map.set(SAVE_KEYS.current, 'garbage');
    expect(s.persistence.restoreLocal()).toMatchObject({ ok: false, code: 'DAMAGED' });
    expect(s.restored).toHaveLength(0);
    expect(s.persistence.status().lastMessage?.tone).toBe('error');
  });

  it('recovers from the backup and says so', () => {
    const s = studio();
    s.rename('One');
    s.persistence.save();
    s.rename('Two');
    s.persistence.save();
    s.storage.map.set(SAVE_KEYS.current, s.storage.map.get(SAVE_KEYS.current)!.slice(0, -5));
    const r = s.persistence.restoreLocal();
    expect(r).toMatchObject({ ok: true, info: { source: 'backup', recoveredFrom: expect.stringMatching(/not valid JSON/) } });
    expect(s.persistence.status().lastMessage).toMatchObject({ tone: 'warn', text: expect.stringMatching(/backup was restored/) });
  });

  it('a failing replaceWorld is reported and leaves the session as it was', () => {
    const storage = new MemStorage();
    const store = new WorldStore(buildCrystalKingdom());
    const slots = new LocalSaveSlots(storage);
    const p = createPersistence({ store, slots, now: () => 't', replaceWorld: () => { throw new Error('boom'); } });
    p.save();
    store.dispatch({ type: 'entity/renamed', id: store.getState().order[2]!, name: 'Dirty', source: 'user' });
    expect(p.restoreLocal()).toMatchObject({ ok: false, code: 'REPLACE_FAILED' });
    expect(p.status().dirty).toBe(true);
  });

  it('import: check gives a summary and applies nothing; apply goes through replaceWorld; bad files never do', () => {
    const s = studio();
    const exported = s.persistence.exportFile();
    if (!exported.ok) throw new Error('export');
    const check = s.persistence.checkImport(exported.file.text);
    expect(check).toMatchObject({ ok: true, summary: { worldName: 'Crystal Kingdom at Dusk', entities: 27, pinned: 1, version: 1 } });
    expect(s.restored).toHaveLength(0);
    expect(s.persistence.applyImport(check)).toMatchObject({ ok: true, info: { source: 'import' } });
    expect(s.restored).toHaveLength(1);
    const bad = s.persistence.checkImport('{"format":"worldweaver.world","version":1,"world":{}}');
    expect(bad.ok).toBe(false);
    expect(s.persistence.applyImport(bad).ok).toBe(false);
    expect(s.restored).toHaveLength(1);
  });

  it('confirmation is not needed for a clean session without undo history', () => {
    expect(studio().persistence.confirmation()).toEqual({ required: false, reason: null });
  });
});

describe('export', () => {
  it('exports a deterministic, re-importable file with a safe filename', () => {
    const s = studio();
    const a = s.persistence.exportFile();
    if (!a.ok) throw new Error('export');
    expect(a.file).toMatchObject({ filename: 'worldweaver-crystal-kingdom-at-dusk-20261120100000.worldweaver.world', mime: 'application/json' });
    const parsed = parseSaveFile(a.file.text);
    expect(parsed.ok && canonical(parsed.world) === canonical(s.store.getState())).toBe(true);
    expect(exportFilename('../../etc/passwd <script>', null)).toBe('worldweaver-etc-passwd-script-unsaved.worldweaver.world');
    expect(exportFilename('دار', null)).toBe('worldweaver-world-unsaved.worldweaver.world');
  });
});

describe('preview isolation: futures are never saved', () => {
  it('saves and exports only the canonical world while futures with steps and a preview are open', () => {
    const s = studio();
    const manager = createFuturesManager(s.store, buildCrystalKingdom());
    const f = manager.fork('Unsaved future', { source: 'director' });
    if (!f.ok) throw new Error(f.reason);
    const v = validateProposal({ summary: 'Future only.', operations: [{ op: 'add', archetype: 'obelisk', name: 'Future Obelisk', placement: 'outer-ring' }] });
    if (!v.ok) throw new Error('proposal');
    expect(applyProposalToFuture(manager, f.value.id, v.proposal, { kind: 'edit', mode: 'recorded' }).ok).toBe(true);
    const exported = s.persistence.exportFile();
    if (!exported.ok) throw new Error('export');
    expect(exported.file.text).not.toContain('Future Obelisk');
    expect(exported.file.text).not.toContain('Unsaved future');
    s.persistence.save();
    const saved = parseSaveFile(s.storage.map.get(SAVE_KEYS.current)!);
    expect(saved.ok && worldFingerprint(saved.world) === worldFingerprint(s.store.getState())).toBe(true);
    expect(s.persistence.status().dirty).toBe(false); // futures do not make the world dirty
  });
});

describe('restore policy in a full session', () => {
  it('after reload: the restored world is a new baseline; undo history and ledger start fresh; pins still protect', () => {
    const storage = new MemStorage();
    const a = studio(storage);
    const ref = (r: string) => buildWorldContext(a.store.getState()).refs.get(r)!;
    a.store.dispatch({ type: 'entity/transformed', id: ref('e10'), transform: { position: [-24, 9, 14] }, source: 'user' });
    const v = validateProposal({ summary: 'Violet.', operations: [{ op: 'recolor', target: 'e4', palette: 'Night Violet' }] });
    if (!v.ok) throw new Error('proposal');
    applyMorph(a.store, translateMorph(a.store.getState(), v.proposal), { mode: 'recorded' });
    a.persistence.save();
    const before = a.store.getState();

    // "Reload": nothing survives but storage.
    const boot = startupWorld(new LocalSaveSlots(storage), buildCrystalKingdom, true);
    expect(boot.from).toBe('local');
    expect(canonical(boot.world)).toBe(canonical(before));
    const b = studio(storage, boot.world);
    expect(b.store.canUndo()).toBe(false);
    expect(b.persistence.status().dirty).toBe(false);
    const ledger = buildLedger(boot.world, b.store.getLog());
    expect(ledger.entries).toEqual([]);
    const pinned = boot.world.order.find((id) => boot.world.entities[id]!.pinned)!;
    expect(b.store.dispatch({ type: 'entity/removed', id: pinned, source: 'user' }).ok).toBe(false);
    const morph = validateProposal({ summary: 'Lift.', operations: [{ op: 'move', target: 'e1', direction: 'up' }] });
    if (!morph.ok) throw new Error('proposal');
    expect(translateMorph(b.store.getState(), morph.proposal).applicable).toBe(false);
    // The session continues normally from the restored world.
    b.rename('After restore');
    expect(buildLedger(boot.world, b.store.getLog()).consistent).toBe(true);
  });

  it('startup without auto-restore boots fresh and reports the available or damaged save', () => {
    const storage = new MemStorage();
    expect(startupWorld(new LocalSaveSlots(storage), buildCrystalKingdom)).toMatchObject({ from: 'fresh', notice: null });
    const s = studio(storage);
    s.rename('Saved');
    s.persistence.save();
    const fresh = startupWorld(new LocalSaveSlots(storage), buildCrystalKingdom);
    expect(fresh.from).toBe('fresh');
    expect(fresh.notice).toMatch(/A local save from 2026-11-20T10:00:00.000Z is available/);
    storage.map.set(SAVE_KEYS.current, 'x');
    expect(startupWorld(new LocalSaveSlots(storage), buildCrystalKingdom).notice).toMatch(/damaged/);
    expect(startupWorld(new LocalSaveSlots(storage), buildCrystalKingdom, true).from).toBe('fresh');
  });
});
