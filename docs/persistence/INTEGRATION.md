# World Persistence — Integration Handoff for Kilo Code

From Kiro, 2026-11-20. Branch `feature/world-persistence-1120` (from
`release/rc-2026-11-19` at `0bbb16e`). Kiro did not modify `src/main.ts`,
`src/ui/shell.ts`, `src/ui/director.ts`, `src/ui/styles.css`,
`src/render/**`, `playwright.config.ts`, `package.json`, the lockfile or
`.gitignore`. The branch merges independently of
`feature/ledger-futures-ui-1120` (no shared files).

## 1. Boot with a chosen world

Restore needs the session to be rebuilt with a new starting world, so `boot`
takes the world as a parameter. Today `boot(host)` builds the Crystal Kingdom
itself.

```ts
import { createPersistence, startupWorld, type PersistenceController } from './persistence/controller';
import { browserStorage, LocalSaveSlots } from './persistence/localSave';
import { PersistencePanel } from './ui/persistencePanel';

const slots = new LocalSaveSlots(browserStorage());   // null storage is handled (private mode)

function boot(host: HTMLElement, start = startupWorld(slots, buildCrystalKingdom)) {
  const genesis = start.world;
  const store = new WorldStore(genesis);
  // ... existing setup unchanged ...

  const persistence = createPersistence({
    store,
    slots,
    ...(start.baselineFingerprint ? { baselineFingerprint: start.baselineFingerprint } : {}),
    replaceWorld: (world) => requestReboot(world),       // see §2
  });
  const persistencePanel = new PersistencePanel(persistence, { notify: (m, t) => shell.toast(m, t) });
  shell.left.append(persistencePanel.element);          // placement: Kilo's choice (topbar menu also fine)
  if (start.notice) shell.toast(start.notice);           // "A local save from … is available."

  // teardown additions:
  //   persistencePanel.dispose(); persistence.dispose();
}
```

## 2. Rebuilding the session on Restore and Import

`replaceWorld` is called from a click handler in the panel. Do not tear the
DOM down synchronously inside that handler; schedule it:

```ts
let teardown = boot(host);
function requestReboot(world: World) {
  queueMicrotask(() => {
    teardown();                                          // existing teardown: renderer, panels, listeners
    teardown = boot(host, { world, from: 'local', notice: null, baselineFingerprint: worldFingerprint(world) });
  });
}
if (import.meta.hot) import.meta.hot.dispose(() => teardown());
```

Effects (documented policy):
- new store, so undo/redo history starts empty;
- a new ledger recorder and futures manager, if mounted;
- the selection is cleared;
- the renderer is re-synced to the new world.

The panel asks for confirmation first when there are unsaved changes or undo
history. If `boot` throws, report it; the controller has already returned.
To keep the old session on failure, build the new session before tearing the
old one down.

## 3. Optional: unsaved-change warning on page close

```ts
const onBeforeUnload = (e: BeforeUnloadEvent) => { if (persistence.status().dirty) e.preventDefault(); };
window.addEventListener('beforeunload', onBeforeUnload);   // remove in teardown
```

## 4. Must not

- Do not auto-save futures or previews. Persistence reads `store.getState()`
  only, which already guarantees this.
- Do not call `store.dispatch` to "load" a world. Pinned entities and
  removal rules make that unsafe, and it would mix two worlds in one undo
  history.
- Do not store anything else under `worldweaver.save.v1.*`.

## 5. Browser tests to add after wiring (not run yet)

Run them in the shared studio suite, one worker, recorded mode:

1. Save, then reload the page, then Restore. The inspector shows the saved
   names and positions, and the pinned citadel is still pinned and still
   cannot be removed.
2. Edit after saving: the indicator shows "Unsaved changes". Ctrl+Z back to
   the saved state shows "All changes saved".
3. Export, then Import of the same file, after a confirmation. The world is
   identical and undo history is empty.
4. Import a hand-damaged file: an error with the reason, and the world
   unchanged.
5. Import a 3 MB file: refused before reading.
6. With localStorage full (fill it in the test): Save reports the quota error
   and the previous save still restores.
7. Console clean throughout.
