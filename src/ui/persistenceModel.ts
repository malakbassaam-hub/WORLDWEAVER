/**
 * World persistence controls — pure view state (no DOM). Derives button
 * states, labels and the unsaved indicator from `PersistenceStatus`.
 */
import type { ImportCheck, PersistenceStatus } from '../persistence/controller';
import { MAX_IMPORT_BYTES } from '../persistence/controller';

export interface PersistenceView {
  readonly indicator: { readonly dirty: boolean; readonly text: string };
  readonly save: { readonly enabled: boolean; readonly title: string };
  readonly restore: { readonly enabled: boolean; readonly title: string };
  readonly exportEnabled: boolean;
  readonly importEnabled: boolean;
  readonly slotLine: string;
  readonly message: PersistenceStatus['lastMessage'];
}

function when(iso: string | null): string {
  if (!iso) return 'an earlier session';
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]} UTC` : iso;
}

export function persistenceView(s: PersistenceStatus): PersistenceView {
  const local = s.local;
  const backup = s.backup;
  const canRestore = s.storageAvailable && ((local.present && local.valid) || (backup.present && backup.valid));
  const slotLine = !s.storageAvailable
    ? 'Browser storage is unavailable here. Use Export and Import.'
    : local.present && local.valid
      ? `Local save: ${when(local.savedAt)} · ${local.entities} entities${backup.present ? (backup.valid ? ' · backup available' : ' · backup damaged') : ''}`
      : local.present
        ? `Local save is damaged${backup.valid ? '; the backup can be restored' : ''}.`
        : 'No local save yet.';
  return {
    indicator: { dirty: s.dirty, text: s.dirty ? 'Unsaved changes' : 'All changes saved' },
    save: { enabled: s.storageAvailable, title: s.storageAvailable ? 'Save this world in this browser (keeps the previous save as a backup)' : 'Browser storage is unavailable' },
    restore: { enabled: canRestore, title: canRestore ? 'Load the local save. Undo history starts fresh.' : 'There is no valid local save' },
    exportEnabled: true,
    importEnabled: true,
    slotLine,
    message: s.lastMessage,
  };
}

/** Text for the import confirmation, from a successful check. */
export function importPrompt(check: Extract<ImportCheck, { ok: true }>, confirmationReason: string | null): string {
  const s = check.summary;
  const base = `Import “${s.worldName}” (${s.biome}): ${s.entities} entities, ${s.pinned} pinned, saved ${when(s.savedAt)}.`;
  return confirmationReason ? `${base} ${confirmationReason}` : base;
}

/** Refuses a file before reading it if it is clearly too large or not JSON. */
export function precheckFile(file: { readonly size: number; readonly name: string; readonly type?: string }): string | null {
  if (file.size > MAX_IMPORT_BYTES) return `The file is larger than ${MAX_IMPORT_BYTES / (1024 * 1024)} MB.`;
  if (file.size === 0) return 'The file is empty.';
  // `.world` covers `*.worldweaver.world`; `.json` is accepted for hand-edited or older exports.
  if (!/\.(world|json)$/i.test(file.name) && file.type !== 'application/json') return 'Choose a .worldweaver.world file exported from WORLDWEAVER.';
  return null;
}
