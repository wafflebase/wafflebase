# Yorkie Worksheet Shape Migration

Prepare and document the one-time Yorkie document migration required before
the canonical `cells` / `rowOrder` / `colOrder` worksheet shape is treated as
the only runtime format.

## Tasks

- [x] Add a pure backend helper that converts current, empty, flat-legacy, and
  tabbed-legacy Yorkie spreadsheet roots into the canonical worksheet document
  shape
- [x] Cover the migration helper with backend unit tests, including datasource
  tabs and metadata-driven axis extent cases
- [x] Add a backend admin CLI that loads document ids from Prisma, attaches the
  corresponding Yorkie document, rewrites the root to the canonical shape, and
  reports a summary
- [x] Make the CLI explicit about scope selection (`--document` or `--all`)
  and avoid pretending to offer a side-effect-free dry run
- [x] Document the rollout procedure and the non-goal around same-index
  delete/delete concurrency
- [x] Verify the helper tests, CLI entrypoint, backend test lane, and fast
  verification gate

## Review

### What Changed

- Added `packages/backend/src/yorkie/worksheet-shape-migration.ts` as the pure
  Yorkie root migration helper.
- Added `packages/backend/src/yorkie/worksheet-shape-migration.spec.ts` to
  cover current roots, empty roots, flat legacy worksheets, and tabbed legacy
  documents with datasource tabs.
- Added
  `packages/backend/scripts/migrate-yorkie-worksheet-shape.ts` as the admin
  CLI that:
  - loads target document ids from Prisma
  - attaches `sheet-${documentId}` in Yorkie manual sync mode
  - snapshots the current root with `doc.toJSON()`
  - rewrites the root to the canonical `SpreadsheetDocument` shape when needed
  - prints per-document and aggregate migration summaries
- Added the backend package script
  `pnpm --filter @wafflebase/backend migrate:yorkie:worksheet-shape`.
- Documented the rollout guidance in
  `docs/design/collaboration.md`.
- Hardened the migration detector and snapshot parsing based on restored
  production-like documents:
  - support flat current worksheet roots
  - normalize `tabOrder` when it arrives as a Yorkie metadata object
  - normalize legacy list fields when they arrive as Yorkie object snapshots
  - sanitize control characters in raw `doc.toJSON()` output before falling
    back to lossy snapshot paths
- Hardened the admin CLI write path to rewrite worksheet payloads
  field-by-field instead of replacing the entire nested `sheets` object in one
  assignment.

### Why This Helps

- The collaboration refactor no longer depends on runtime fallback logic for
  historical Yorkie document shapes.
- Migration semantics are now testable without needing a live Yorkie server.
- The operational path is explicit: sample a few documents by id, then run the
  bulk migration during a maintenance window with `--all`.
- The CLI avoids a misleading dry-run mode, which matters because Yorkie
  `attach()` can create an empty document as a side effect.
- The migration path now reflects real restored-data edge cases instead of only
  idealized worksheet JSON.
- The raw Yorkie JSON path stays authoritative even when some cell values
  contain control characters.

### Rollout Notes

1. Start infrastructure first: `docker compose up -d`.
2. Sample known documents:
   `pnpm --filter @wafflebase/backend migrate:yorkie:worksheet-shape --document <id>`.
3. Run the bulk migration during a maintenance window:
   `pnpm --filter @wafflebase/backend migrate:yorkie:worksheet-shape --all`.
4. Deploy the collaboration code that assumes only the canonical worksheet
   shape after the migration completes successfully.

### Rehearsal Outcome

The restored local rehearsal validated the rollout on realistic data:

- restored PostgreSQL documents: `17`
- copied Yorkie roots: `16` existing production roots, plus one local current
  placeholder for the missing Yorkie document id
- one real problematic document discovered during rehearsal:
  `3f54103b-9ba0-446b-a13b-96331d6a4199` (`"Yorkie Task"`)
- after detector and snapshot hardening:
  - first migration pass for that document:
    `kind=legacy-tabbed`, `sheets=5`, `cells=2410`
  - second migration pass:
    `kind=current`, `changed=0`, `cells=2410`
- final full local rerun:
  - `processed: 17`
  - `changed: 0`
  - `unchanged: 17`
  - `by kind: current=17`

### Verification

- `pnpm --filter @wafflebase/backend test -- worksheet-shape-migration.spec.ts`
- `pnpm --filter @wafflebase/backend exec tsc --noEmit`
- `pnpm --filter @wafflebase/backend migrate:yorkie:worksheet-shape --help`
- `pnpm --filter @wafflebase/backend test`
- `pnpm verify:fast`
