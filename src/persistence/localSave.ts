/**
 * Local browser save slots with a verified write and one backup.
 *
 * Keys (all values are save-file text from saveFile.ts; nothing else is stored):
 *   worldweaver.save.v1.current   the latest good save
 *   worldweaver.save.v1.backup    the previous good save
 *   worldweaver.save.v1.pending   transient, only during a save
 *
 * Save protocol: write `pending` → read it back and fully validate it → copy
 * the old `current` to `backup` → write `current` → read back → remove
 * `pending`. If any step fails (for example a quota error), the previous
 * `current` is still intact and the error is reported.
 *
 * Restore: validate `current`; if it is missing or damaged, fall back to
 * `backup` and say so. Damaged slots are never deleted automatically; they can
 * be exported for inspection or cleared explicitly.
 *
 * Storage is injected (`StorageLike`) so tests can simulate quota errors,
 * corruption and reloads. The default is `globalThis.localStorage`, resolved
 * lazily and guarded (private modes may throw on access).
 */
import type { World } from '../core/types';
import { parseSaveFile, serializeWorld, type LoadResult } from './saveFile';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SAVE_KEYS = Object.freeze({
  current: 'worldweaver.save.v1.current',
  backup: 'worldweaver.save.v1.backup',
  pending: 'worldweaver.save.v1.pending',
});

export type StorageErrorCode = 'UNAVAILABLE' | 'QUOTA' | 'WRITE_FAILED' | 'VERIFY_FAILED' | 'INVALID_WORLD' | 'TOO_LARGE' | 'UNSAFE';

export type LocalSaveResult =
  | { readonly ok: true; readonly checksum: string; readonly bytes: number; readonly savedAt: string | null; readonly backedUp: boolean }
  | { readonly ok: false; readonly code: StorageErrorCode; readonly message: string };

export type LocalLoadResult =
  | (Extract<LoadResult, { ok: true }> & { readonly slot: 'current' | 'backup'; readonly currentProblem: string | null })
  | { readonly ok: false; readonly code: 'EMPTY' | 'UNAVAILABLE' | 'DAMAGED'; readonly message: string; readonly current: string | null; readonly backup: string | null };

export interface SlotInfo {
  readonly present: boolean;
  readonly valid: boolean;
  readonly savedAt: string | null;
  readonly checksum: string | null;
  readonly entities: number | null;
  readonly problem: string | null;
}

/** Resolves browser localStorage without throwing (null if unavailable). */
export function browserStorage(): StorageLike | null {
  try {
    const s = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (!s) return null;
    const probe = 'worldweaver.save.v1.probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function isQuota(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const x = e as { name?: string; code?: number };
  return x.name === 'QuotaExceededError' || x.name === 'NS_ERROR_DOM_QUOTA_REACHED' || x.code === 22 || x.code === 1014;
}

function read(storage: StorageLike, key: string): { ok: true; value: string | null } | { ok: false } {
  try {
    return { ok: true, value: storage.getItem(key) };
  } catch {
    return { ok: false };
  }
}

export class LocalSaveSlots {
  constructor(private readonly storage: StorageLike | null) {}

  get available(): boolean {
    return this.storage !== null;
  }

  /** Saves `world`. The previous good save is kept as the backup. */
  save(world: World, savedAt: string | null): LocalSaveResult {
    const s = this.storage;
    if (!s) return { ok: false, code: 'UNAVAILABLE', message: 'Browser storage is not available here (private mode or blocked). Use Export instead.' };
    const ser = serializeWorld(world, { savedAt });
    if (!ser.ok) return { ok: false, code: ser.code === 'INVALID_WORLD' ? 'INVALID_WORLD' : ser.code, message: ser.message };

    const write = (key: string, value: string): LocalSaveResult | null => {
      try {
        s.setItem(key, value);
        return null;
      } catch (e) {
        try {
          s.removeItem(SAVE_KEYS.pending);
        } catch {
          /* ignore */
        }
        return isQuota(e)
          ? { ok: false, code: 'QUOTA', message: 'Browser storage is full, so the world was not saved. Your previous save is unchanged. Export the world to a file instead.' }
          : { ok: false, code: 'WRITE_FAILED', message: 'The browser refused to store the save. Your previous save is unchanged.' };
      }
    };
    const verify = (key: string): boolean => {
      const r = read(s, key);
      return r.ok && r.value === ser.text && parseSaveFile(r.value).ok;
    };

    const failed = write(SAVE_KEYS.pending, ser.text);
    if (failed) return failed;
    if (!verify(SAVE_KEYS.pending)) {
      this.safeRemove(SAVE_KEYS.pending);
      return { ok: false, code: 'VERIFY_FAILED', message: 'The save could not be read back correctly. Your previous save is unchanged.' };
    }
    const old = read(s, SAVE_KEYS.current);
    let backedUp = false;
    if (old.ok && old.value !== null && parseSaveFile(old.value).ok && old.value !== ser.text) {
      const b = write(SAVE_KEYS.backup, old.value);
      if (b) return b;
      backedUp = true;
    }
    const c = write(SAVE_KEYS.current, ser.text);
    if (c) return c;
    if (!verify(SAVE_KEYS.current)) {
      // Put the previous good save back if we still have it.
      if (old.ok && old.value !== null) write(SAVE_KEYS.current, old.value);
      this.safeRemove(SAVE_KEYS.pending);
      return { ok: false, code: 'VERIFY_FAILED', message: 'The save could not be verified after writing. The previous save was kept.' };
    }
    this.safeRemove(SAVE_KEYS.pending);
    return { ok: true, checksum: ser.checksum, bytes: ser.bytes, savedAt, backedUp };
  }

  /** Loads and validates the current save, falling back to the backup. Never changes storage. */
  load(): LocalLoadResult {
    const s = this.storage;
    if (!s) return { ok: false, code: 'UNAVAILABLE', message: 'Browser storage is not available here.', current: null, backup: null };
    const cur = read(s, SAVE_KEYS.current);
    const bak = read(s, SAVE_KEYS.backup);
    const curText = cur.ok ? cur.value : null;
    const bakText = bak.ok ? bak.value : null;
    let currentProblem: string | null = null;
    if (curText !== null) {
      const r = parseSaveFile(curText);
      if (r.ok) return { ...r, slot: 'current', currentProblem: null };
      currentProblem = r.message;
    }
    if (bakText !== null) {
      const r = parseSaveFile(bakText);
      if (r.ok) return { ...r, slot: 'backup', currentProblem: currentProblem ?? 'There was no current save.' };
      return { ok: false, code: 'DAMAGED', message: `Both local saves are damaged. Current: ${currentProblem ?? 'missing'}. Backup: ${r.message}`, current: currentProblem, backup: r.message };
    }
    if (currentProblem) return { ok: false, code: 'DAMAGED', message: `The local save is damaged and there is no backup: ${currentProblem}`, current: currentProblem, backup: null };
    return { ok: false, code: 'EMPTY', message: 'There is no local save yet.', current: null, backup: null };
  }

  info(slot: 'current' | 'backup'): SlotInfo {
    const r = this.storage ? read(this.storage, SAVE_KEYS[slot]) : { ok: false as const };
    if (!r.ok || r.value === null) return { present: false, valid: false, savedAt: null, checksum: null, entities: null, problem: r.ok ? null : 'Storage unavailable.' };
    const p = parseSaveFile(r.value);
    return p.ok
      ? { present: true, valid: true, savedAt: p.savedAt, checksum: p.checksum, entities: p.world.order.length, problem: null }
      : { present: true, valid: false, savedAt: null, checksum: null, entities: null, problem: p.message };
  }

  /** Raw text of a slot (to export a damaged save for inspection). */
  rawText(slot: 'current' | 'backup'): string | null {
    if (!this.storage) return null;
    const r = read(this.storage, SAVE_KEYS[slot]);
    return r.ok ? r.value : null;
  }

  /** Removes all WORLDWEAVER save keys. Explicit user action only. */
  clear(): boolean {
    if (!this.storage) return false;
    let ok = true;
    for (const k of Object.values(SAVE_KEYS)) ok = this.safeRemove(k) && ok;
    return ok;
  }

  private safeRemove(key: string): boolean {
    try {
      this.storage?.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }
}
