# World Persistence — Recovery Instructions

For users, and for developers diagnosing a save problem. All saves are local
to this browser and this site; nothing is uploaded.

## "The latest local save was damaged; the backup was restored"

The current save failed its checks: it was not valid JSON, or its checksum
or a field was wrong. The previous save (the backup) was loaded instead.
Nothing was deleted.

- Save again to make the restored world the current save.
- To keep the damaged save for inspection, export it before saving (a
  developer can read it with `slots.rawText('current')`).

## "Both local saves are damaged" or "The local save is damaged and there is no backup"

No world was loaded, and the world on screen is unchanged.

1. If you have an exported `.json` file, use **Import**.
2. Otherwise, continue with the current world and **Save** it. That writes a
   new valid save and **replaces the damaged one** (damaged saves are never
   kept as backups). If the damaged save matters, a developer should copy it
   first with `slots.rawText('current')`.
3. To start clean, clear the site data for this page in the browser
   settings, or (developer) call `slots.clear()`.

## "Browser storage is full" or "Browser storage is not available"

The world was **not** saved, and the previous save is unchanged.

- Use **Export** to save to a file instead.
- Private or incognito windows and some privacy settings block storage. Use a
  normal window or Export.

## "This file was saved by a newer WORLDWEAVER"

The file uses a newer save-format version. Open it with that newer version,
or ask for a migration. Older versions are migrated automatically when a
migration exists.

## "Import refused: …"

The reason names the field, for example
`world.entities.ck:spire-004.parentId: Parent entity not found.` The file was
not applied. Common causes are hand-edited files (the checksum no longer
matches), truncated downloads, and files from other programs.

## Developer checklist

- Keys: `worldweaver.save.v1.current`, `.backup`, `.pending` (pending is left
  only by a crash mid-save; it is ignored by restore and removed on the next
  save).
- Validate any file: `parseSaveFile(text)` in `src/persistence/saveFile.ts`
  returns the error code (`TOO_LARGE`, `NOT_JSON`, `NOT_A_SAVE`,
  `UNSUPPORTED_VERSION`, `INVALID`, `CHECKSUM`, `UNSAFE`) and the issues
  with their paths.
