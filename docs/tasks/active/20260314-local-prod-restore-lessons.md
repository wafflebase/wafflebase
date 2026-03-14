# Local Production Restore Rehearsal — Lessons

## Restore Into A Separate Local Database First

- For production rehearsal, restore into a dedicated local database like
  `wafflebase_prod_restore` instead of overwriting the default dev database.
  It keeps normal local work intact and makes rollback trivial.

## Enumerate Source Yorkie Documents Before Attaching

- Yorkie `attach()` can create an empty document when the key does not already
  exist. If the source environment is production, enumerate valid document keys
  first and only attach known-existing keys.

## Production Yorkie Discovery May Require Looking Past The App Deployment

- The backend deployment exposed the Yorkie public API key and internal RPC
  address, but not enough admin credentials to list documents safely through
  the CLI. Mongo metadata ended up being the reliable source of truth for
  existence checks.

## Sanitize `doc.toJSON()` Before Falling Back

- Some Yorkie documents can fail `JSON.parse(doc.toJSON())` because the raw
  JSON path includes control characters.
- Do not immediately fall back to `JSON.stringify(doc.getRoot())` or a manual
  Yorkie proxy detach. Those paths can be lossy for current worksheet shapes
  and can silently turn a valid `cells` map into an empty worksheet.
- First sanitize control characters inside the raw JSON string and parse the
  corrected `toJSON()` output. Only use lossy fallbacks after that fails.

## Yorkie Snapshot Artifacts Need Explicit Normalization

- Real restored documents can expose Yorkie-specific snapshot artifacts:
  `tabOrder` as a metadata object instead of a string array, and legacy list
  fields such as `hiddenRows`, `rangeStyles`, and `conditionalFormats` as
  object snapshots instead of arrays.
- Migration tooling should normalize these shapes explicitly instead of assuming
  plain JSON arrays everywhere.

## Backend Admin Scripts Must Stay Out Of Nest Watch Input

- In `packages/backend`, adding `.ts` files under `scripts/` is enough to break
  `nest start --watch` if `tsconfig.json` still relies on the default
  `**/*` include. Keep backend `tsconfig.json` scoped to `src/**/*.ts` so
  admin scripts do not trip TS6059 against the app's `sourceRoot`.
