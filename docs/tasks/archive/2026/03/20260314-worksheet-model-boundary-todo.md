# Worksheet Model Boundary

Create a single shared worksheet/document model boundary so frontend and
backend stop maintaining duplicated worksheet schema and creation logic.

## Tasks

- [x] Add a shared worksheet/document model module with canonical factories
- [x] Switch frontend and backend to consume the shared model instead of local
  duplicated definitions
- [x] Update worksheet creation and legacy migration paths to use the shared
  factories
- [x] Collapse active worksheet cell write paths behind shared mutation helpers
- [x] Split the old collab-grid module into clearer worksheet grid/legacy layers
- [x] Remove pre-tab and `worksheet.sheet` legacy compatibility paths after
  Yorkie data cleanup
- [x] Replace stable-named sheet exports with generic worksheet document APIs
- [x] Move Yorkie-only worksheet axis mutation helpers out of
  `@wafflebase/sheet`
- [x] Move Yorkie worksheet structure remap orchestration behind a local
  helper and add direct frontend unit coverage
- [x] Split `sheet/model` into clearer worksheet vs workbook folders without
  changing behavior
- [x] Replace internal root shim imports with direct worksheet/workbook paths
  and remove the shims
- [x] Reorganize the remaining sheet model helpers into
  `core / worksheet / workbook / pivot` folders and align internal imports
- [x] Rename the canonical worksheet cell record from `stableCells` to `cells`
  and remove the temporary pre-push compatibility path
- [x] Verify the affected tests and record follow-up cleanup work

## Review

### What Changed

- Added a canonical worksheet/document schema module in
  `packages/sheet/src/model/workbook/worksheet-document.ts`.
- Moved default worksheet/document construction into shared factories:
  `createWorksheet()` and `createSpreadsheetDocument()`.
- Replaced duplicated frontend worksheet definitions with re-exports from
  `@wafflebase/sheet`.
- Replaced duplicated backend Yorkie document types with re-exports from
  `@wafflebase/sheet`.
- Switched sheet tab creation and pivot tab creation to the shared factories.
- Added shared worksheet mutation helpers so store-adjacent paths update the
  canonical stable-grid model without manually coordinating storage details.
- Switched backend cell writes and pivot grid replacement to those helpers so
  the remaining direct Yorkie write paths use one mutation protocol.
- Split the old `collab-grid.ts` module into `worksheet-grid.ts` and
  `worksheet-record.ts`, then removed the temporary `worksheet-legacy.ts`
  layer after confirming legacy Yorkie documents had already been cleaned up.
- Removed the frontend flat-document migration path and deleted the remaining
  `worksheet.sheet` fallback from the shared worksheet model.
- Renamed the shared worksheet document helpers to generic names
  (`getWorksheetCell`, `getWorksheetEntries`, `writeWorksheetCell`,
  `insertWorksheetAxis`, etc.) so frontend/backend code no longer depends on
  stable-grid terminology from `@wafflebase/sheet`.
- Moved the worksheet axis order mutation helpers out of the shared
  `@wafflebase/sheet` package and into a Yorkie-local helper next to
  `yorkie-store.ts`, leaving the shared package responsible only for generic
  worksheet cell read/write helpers.
- Extracted the remaining Yorkie worksheet structure remap orchestration
  (formula rewrite, dimension/style remap, range style / conditional format
  shift, merge remap, chart anchor remap) into a second frontend-local helper
  so `YorkieStore` delegates structure edits instead of open-coding them.
- Added a focused frontend unit test for the new structure helper to verify
  row shift/move keeps worksheet cells, keyed metadata, merges, and chart
  anchors aligned.
- Moved the single-sheet engine implementation to
  `packages/sheet/src/model/worksheet/sheet.ts` and the worksheet/workbook
  document-storage files to `packages/sheet/src/model/workbook/`.
- Updated internal `packages/sheet` imports and tests to use the new
  `model/worksheet/` and `model/workbook/` paths directly, then removed the
  temporary root `model/` shim files.
- Moved high-fan-out primitives like `types.ts`, `coordinates.ts`, and
  `locale.ts` into `packages/sheet/src/model/core/`.
- Moved single-sheet helpers like `calculator.ts`, `shifting.ts`,
  `merging.ts`, `dimensions.ts`, `format.ts`, `input.ts`,
  `conditional-format.ts`, and `range-styles.ts` into
  `packages/sheet/src/model/worksheet/`.
- Kept pivot logic isolated under `packages/sheet/src/model/pivot/` and
  updated the package/test import graph so it reads the new
  `core / worksheet / workbook / pivot` layout directly.
- Renamed the canonical persisted worksheet cell record from `stableCells` to
  `cells`, then removed the temporary compatibility code once it was clear the
  old field name had never been pushed.

### Why This Helps

- There is now one canonical place that defines the persisted worksheet shape.
- New sheets are created directly in the stable-grid shape.
- Backend and frontend no longer have independent worksheet schema copies that
  can drift during future collaboration changes.
- The runtime no longer carries compatibility code for pre-tab flat roots or
  `worksheet.sheet`, so every active code path assumes the canonical stable
  worksheet shape.
- Store-adjacent paths now share one worksheet cell mutation contract instead
  of open-coding worksheet storage details.
- The public `@wafflebase/sheet` API now exposes worksheet document helpers in
  generic terms, which makes it easier to move the remaining Yorkie-specific
  structure handling out of the shared package later.
- Yorkie structure edits now own their axis-order mutation logic locally, so
  the shared sheet package no longer exports helpers that only make sense for
  the CRDT-backed worksheet persistence layout.
- `YorkieStore` now has a narrower role during structure edits: it chooses the
  document/tab/update boundary, while a Yorkie-local worksheet helper owns the
  CRDT-specific remap choreography.
- The `sheet/model` tree now visually distinguishes the single-sheet engine
  from workbook/document storage concerns, which makes the remaining
  worksheet-storage extraction path easier to reason about.
- Internal code now follows that boundary directly, so the package structure
  and the import graph no longer disagree about where worksheet and workbook
  responsibilities live.
- The highest fan-out shared primitives now live in `core/`, which makes it
  clearer which helpers are generic foundations versus worksheet/workbook
  domain code.
- Pivot logic now sits as a peer to worksheet/workbook instead of looking like
  a loose exception under the old flat `model/` directory.

### Remaining Follow-up

- Direct Yorkie document mutations still exist outside `YorkieStore`
  (for example pivot metadata updates). The cell write paths now share helpers,
  but they still bypass the store abstraction.
- Row/column metadata is still index-based even though cell storage is now the
  canonical stable-grid model.
- The persisted field names inside the worksheet schema still use
  `rowOrder`/`colOrder`, so the storage schema itself has only been partially
  neutralized.
- `YorkieStore` still owns a large amount of post-structure metadata shifting
  in one file. The axis list mutation moved local, but the broader structure
  side effects have not yet been factored into a smaller Yorkie-specific layer.
- Formula-specific structure tests in the frontend Node test lane are still
  constrained by the existing `shiftFormula`/`moveFormula` runtime issue, so
  the new direct helper tests currently focus on cell/metadata movement rather
  than parser-backed formula rewrites.

### Verification

- `pnpm --filter @wafflebase/sheet typecheck`
- `pnpm --filter @wafflebase/sheet build`
- `pnpm --filter @wafflebase/frontend test`
- `pnpm --filter @wafflebase/frontend build`
- `pnpm --filter @wafflebase/backend test`
- `pnpm verify:fast`
