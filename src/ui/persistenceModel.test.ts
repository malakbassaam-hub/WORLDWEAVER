import { describe, expect, it } from 'vitest';
import type { PersistenceStatus } from '../persistence/controller';
import { createPersistence } from '../persistence/controller';
import { LocalSaveSlots, type StorageLike } from '../persistence/localSave';
import { WorldStore } from '../core/store';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { importPrompt, persistenceView, precheckFile } from './persistenceModel';

const slot = (p: Partial<PersistenceStatus['local']> = {}): PersistenceStatus['local'] => ({ present: false, valid: false, savedAt: null, checksum: null, entities: null, problem: null, ...p });
const status = (p: Partial<PersistenceStatus> = {}): PersistenceStatus => ({ storageAvailable: true, dirty: false, canUndo: false, lastSavedAt: null, local: slot(), backup: slot(), lastMessage: null, ...p });

describe('persistence view', () => {
  it('shows the unsaved indicator and enables Restore only with a valid save', () => {
    expect(persistenceView(status()).indicator).toEqual({ dirty: false, text: 'All changes saved' });
    expect(persistenceView(status({ dirty: true })).indicator.text).toBe('Unsaved changes');
    expect(persistenceView(status()).restore.enabled).toBe(false);
    const saved = persistenceView(status({ local: slot({ present: true, valid: true, savedAt: '2026-11-20T10:05:00.000Z', entities: 27 }) }));
    expect(saved.restore.enabled).toBe(true);
    expect(saved.slotLine).toBe('Local save: 2026-11-20 10:05 UTC · 27 entities');
  });

  it('explains damaged saves and backup recovery; storage unavailable disables Save and Restore only', () => {
    const damaged = persistenceView(status({ local: slot({ present: true, valid: false }), backup: slot({ present: true, valid: true }) }));
    expect(damaged.restore.enabled).toBe(true);
    expect(damaged.slotLine).toBe('Local save is damaged; the backup can be restored.');
    const none = persistenceView(status({ storageAvailable: false }));
    expect(none).toMatchObject({ save: { enabled: false }, restore: { enabled: false }, exportEnabled: true, importEnabled: true });
    expect(none.slotLine).toMatch(/Use Export and Import/);
  });

  it('refuses oversized, empty or non-JSON files before reading them', () => {
    expect(precheckFile({ size: 3 * 1024 * 1024, name: 'w.json' })).toMatch(/larger than 2 MB/);
    expect(precheckFile({ size: 0, name: 'w.json' })).toBe('The file is empty.');
    expect(precheckFile({ size: 10, name: 'w.exe' })).toMatch(/\.json world file/);
    expect(precheckFile({ size: 10, name: 'world', type: 'application/json' })).toBeNull();
    expect(precheckFile({ size: 10, name: 'W.JSON' })).toBeNull();
  });

  it('builds the import confirmation from the real check', () => {
    const mem = new Map<string, string>();
    const storage: StorageLike = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
    const store = new WorldStore(buildCrystalKingdom());
    const p = createPersistence({ store, slots: new LocalSaveSlots(storage), now: () => '2026-11-20T09:30:00.000Z', replaceWorld: () => undefined });
    const file = p.exportFile();
    if (!file.ok) throw new Error('export');
    const check = p.checkImport(file.file.text);
    if (!check.ok) throw new Error('check');
    expect(importPrompt(check, null)).toBe('Import “Crystal Kingdom at Dusk” (floating crystal isles): 27 entities, 1 pinned, saved 2026-11-20 09:30 UTC.');
  });
});
