/**
 * Persistence controller: Save, Restore, Export, Import and the unsaved-change
 * indicator, as one typed contract for the studio UI (docs/persistence/).
 *
 * RESTORE POLICY (WW-016, provisional, approved approach):
 * - The controller NEVER mutates the store. Restore and Import produce a fully
 *   validated World and hand it to `replaceWorld(world, info)`. The studio
 *   then rebuilds its session with that world as the new starting world
 *   (new WorldStore, ledger, futures manager, renderer sync, empty selection).
 * - Consequences: undo/redo history, the session log, the Causal Ledger and
 *   open Parallel Futures of the old session are discarded. Restore therefore
 *   asks for confirmation (`confirmation()`) whenever there are unsaved changes
 *   or undo history.
 * - Restore is atomic: if validation fails, `replaceWorld` is never called and
 *   the current session is untouched.
 * - Only the canonical world (`store.getState()`) is ever saved. Futures and
 *   their previews live outside the store and are never saved.
 */
import { worldFingerprint } from '../core/fingerprint';
import type { WorldStore } from '../core/store';
import type { World } from '../core/types';
import { LocalSaveSlots, type LocalLoadResult, type LocalSaveResult, type SlotInfo } from './localSave';
import { parseSaveFile, SAVE_LIMITS, serializeWorld, type LoadResult } from './saveFile';

export type RestoreSource = 'local' | 'backup' | 'import';

export interface RestoreInfo {
  readonly source: RestoreSource;
  readonly savedAt: string | null;
  readonly checksum: string;
  /** Set when the current local save was damaged and the backup was used. */
  readonly recoveredFrom: string | null;
}

export interface ImportSummary {
  readonly worldName: string;
  readonly biome: string;
  readonly entities: number;
  readonly pinned: number;
  readonly savedAt: string | null;
  readonly version: number;
}

export type ImportCheck = { readonly ok: true; readonly summary: ImportSummary; readonly result: Extract<LoadResult, { ok: true }> } | Extract<LoadResult, { ok: false }>;

export type RestoreOutcome =
  | { readonly ok: true; readonly info: RestoreInfo }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface ExportFile {
  readonly filename: string;
  readonly mime: 'application/json';
  readonly text: string;
  readonly bytes: number;
}

export interface PersistenceStatus {
  readonly storageAvailable: boolean;
  /** Content differs from the last save, restore or import (seq ignored, so undo back to it is clean). */
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly lastSavedAt: string | null;
  readonly local: SlotInfo;
  readonly backup: SlotInfo;
  readonly lastMessage: { readonly tone: 'info' | 'warn' | 'error'; readonly text: string } | null;
}

export interface PersistenceDeps {
  readonly store: WorldStore;
  readonly slots: LocalSaveSlots;
  /** Rebuilds the studio session with a validated world (see RESTORE POLICY). */
  replaceWorld(world: World, info: RestoreInfo): void;
  /** ISO timestamp source (injected for deterministic tests). */
  now?(): string;
  /**
   * Fingerprint of the content the current session started from if it came
   * from a save (so a freshly restored world is not "dirty"). Default: the
   * store's current state at construction.
   */
  readonly baselineFingerprint?: string;
  /**
   * Number of open Parallel Futures. Futures live outside the store, so a
   * world with no edits can still have work that a load would discard.
   */
  openFutures?(): number;
}

export interface PersistenceController {
  status(): PersistenceStatus;
  subscribe(listener: (status: PersistenceStatus) => void): () => void;
  save(): LocalSaveResult;
  /** Validates the local save (with backup fallback) without applying it. */
  checkLocal(): LocalLoadResult;
  restoreLocal(): RestoreOutcome;
  exportFile(): { readonly ok: true; readonly file: ExportFile } | { readonly ok: false; readonly code: string; readonly message: string };
  /** Validates import text and returns a summary for confirmation. Applies nothing. */
  checkImport(text: unknown): ImportCheck;
  /** Applies a previously checked import. */
  applyImport(check: ImportCheck): RestoreOutcome;
  /** Whether Restore/Import must be confirmed, and why. */
  confirmation(): { readonly required: boolean; readonly reason: string | null };
  dispose(): void;
}

/** Extension of exported world files. The content is JSON (see saveFile.ts). */
export const EXPORT_EXTENSION = '.worldweaver.world';

export function exportFilename(worldName: string, savedAt: string | null): string {
  const slug = worldName.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'world';
  const stamp = savedAt ? savedAt.replace(/[^0-9]/g, '').slice(0, 14) : 'unsaved';
  return `worldweaver-${slug}-${stamp}${EXPORT_EXTENSION}`;
}

export function createPersistence(deps: PersistenceDeps): PersistenceController {
  const { store, slots } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  let baseline = deps.baselineFingerprint ?? worldFingerprint(store.getState());
  let lastSavedAt: string | null = null;
  let lastMessage: PersistenceStatus['lastMessage'] = null;
  const listeners = new Set<(s: PersistenceStatus) => void>();

  const status = (): PersistenceStatus => ({
    storageAvailable: slots.available,
    dirty: worldFingerprint(store.getState()) !== baseline,
    canUndo: store.canUndo(),
    lastSavedAt,
    local: slots.info('current'),
    backup: slots.info('backup'),
    lastMessage,
  });
  const emit = () => {
    const s = status();
    for (const l of listeners) l(s);
  };
  const unsubscribe = store.subscribe(() => emit());

  const restore = (world: World, info: RestoreInfo): RestoreOutcome => {
    try {
      deps.replaceWorld(world, info);
    } catch {
      lastMessage = { tone: 'error', text: 'The studio could not load the restored world. The current world was kept.' };
      emit();
      return { ok: false, code: 'REPLACE_FAILED', message: lastMessage.text };
    }
    baseline = worldFingerprint(world);
    lastMessage = info.recoveredFrom
      ? { tone: 'warn', text: `The latest local save was damaged (${info.recoveredFrom}). The backup was restored instead.` }
      : { tone: 'info', text: info.source === 'import' ? 'World imported. Undo history starts fresh.' : 'Local save restored. Undo history starts fresh.' };
    emit();
    return { ok: true, info };
  };

  return {
    status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    save() {
      const savedAt = now();
      const r = slots.save(store.getState(), savedAt);
      if (r.ok) {
        baseline = worldFingerprint(store.getState());
        lastSavedAt = savedAt;
        lastMessage = { tone: 'info', text: r.backedUp ? 'Saved in this browser. The previous save was kept as a backup.' : 'Saved in this browser.' };
      } else {
        lastMessage = { tone: 'error', text: r.message };
      }
      emit();
      return r;
    },

    checkLocal: () => slots.load(),

    restoreLocal() {
      const r = slots.load();
      if (!r.ok) {
        lastMessage = { tone: r.code === 'EMPTY' ? 'info' : 'error', text: r.message };
        emit();
        return { ok: false, code: r.code, message: r.message };
      }
      return restore(r.world, { source: r.slot === 'current' ? 'local' : 'backup', savedAt: r.savedAt, checksum: r.checksum, recoveredFrom: r.slot === 'backup' ? r.currentProblem : null });
    },

    exportFile() {
      const savedAt = now();
      const world = store.getState();
      const ser = serializeWorld(world, { savedAt });
      if (!ser.ok) {
        lastMessage = { tone: 'error', text: ser.message };
        emit();
        return { ok: false, code: ser.code, message: ser.message };
      }
      return { ok: true, file: { filename: exportFilename(world.name, savedAt), mime: 'application/json', text: ser.text, bytes: ser.bytes } };
    },

    checkImport(text) {
      const r = parseSaveFile(text);
      if (!r.ok) return r;
      const w = r.world;
      return {
        ok: true,
        result: r,
        summary: { worldName: w.name, biome: w.biome, entities: w.order.length, pinned: w.order.filter((id) => w.entities[id]!.pinned).length, savedAt: r.savedAt, version: r.version },
      };
    },

    applyImport(check) {
      if (!check.ok) return { ok: false, code: check.code, message: check.message };
      return restore(check.result.world, { source: 'import', savedAt: check.result.savedAt, checksum: check.result.checksum, recoveredFrom: null });
    },

    confirmation() {
      const s = status();
      if (s.dirty) return { required: true, reason: 'You have unsaved changes. Loading another world discards them, along with undo history and open futures.' };
      let futures = 0;
      try {
        futures = Math.max(0, Math.floor(deps.openFutures?.() ?? 0));
      } catch {
        futures = 1; // unknown: ask rather than discard silently
      }
      if (futures > 0) return { required: true, reason: `Loading another world discards ${futures === 1 ? 'the open future' : `${futures} open futures`}, along with undo history and the history panel.` };
      if (s.canUndo) return { required: true, reason: 'Loading another world clears undo history, the history panel and open futures.' };
      return { required: false, reason: null };
    },

    dispose() {
      unsubscribe();
      listeners.clear();
    },
  };
}

/** Maximum import size, for UIs that check `File.size` before reading. */
export const MAX_IMPORT_BYTES = SAVE_LIMITS.maxBytes;

/**
 * Startup helper: the world to boot with. `autoRestore` false (recommended
 * default) always boots `fallback()` and reports whether a local save exists,
 * so the user chooses to restore it.
 */
export function startupWorld(slots: LocalSaveSlots, fallback: () => World, autoRestore = false): { readonly world: World; readonly from: 'fresh' | 'local' | 'backup'; readonly notice: string | null; readonly baselineFingerprint?: string } {
  const r = slots.load();
  if (!autoRestore || !r.ok) {
    const notice = r.ok ? `A local save from ${r.savedAt ?? 'an earlier session'} is available. Choose Restore to load it.` : r.code === 'DAMAGED' ? r.message : null;
    return { world: fallback(), from: 'fresh', notice };
  }
  return {
    world: r.world,
    from: r.slot === 'current' ? 'local' : 'backup',
    notice: r.slot === 'backup' ? `The latest local save was damaged; the backup was restored. (${r.currentProblem})` : null,
    baselineFingerprint: worldFingerprint(r.world),
  };
}
