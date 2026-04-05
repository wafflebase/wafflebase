# Collaboration Design Docs

Capture the recent Yorkie collaboration changes in the design docs so the
canonical worksheet shape, structural concurrency behavior, and test lanes are
documented in one place.

## Tasks

- [x] Audit current design docs for stale Yorkie worksheet/model content
- [x] Add a dedicated collaboration design document for worksheet storage,
      structural concurrency, and test strategy
- [x] Refresh the frontend design doc to reference the current worksheet shape
      and Yorkie ownership split
- [x] Update the design index and task index
- [x] Verify docs and repo health

## Review

### What Changed

- Added `docs/design/sheets/collaboration.md` as the canonical design doc
  for Yorkie-backed spreadsheet collaboration.
- Updated `docs/design/frontend.md` so its Yorkie integration section matches
  the current `Worksheet.cells + rowOrder + colOrder` model instead of the old
  `root.sheet[A1]` storage shape.
- Updated `docs/design/README.md` to index the new design document.

### Why This Helps

- The concurrency fix, worksheet schema, and test strategy now live together
  instead of being scattered across task notes and partially stale overview
  docs.
- `frontend.md` now points to the right collaboration architecture instead of
  preserving the pre-stable-identity design.
- Future work on `rowOrder`/`colOrder`, Yorkie ownership, or deferred
  delete/delete semantics now has a stable design reference.

### Verification

- `pnpm verify:fast`
