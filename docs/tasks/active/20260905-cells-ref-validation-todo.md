# Cells ref validation (#1030)

Two independent bugs found while using the CLI to fill a sheet:

1. `sheets cells batch` double-wraps a `--data`/stdin payload that is already
   in the `{"cells": {...}}` shape `docs/design/rest-api.md` §5.3 documents.
2. The backend's `ApiV1CellsController` passes a client-controlled `sref`
   straight into `parseRef()` with no validation, so a malformed ref (from
   the double-wrap above, or any other bad input) throws a plain `Error`
   that Nest turns into a 500 instead of a 400.

## Plan

- [x] Commit 1 (CLI): `cells.ts` unwraps the enveloped `{cells: {...}}` shape
      before calling `batchCells()`, reusing `payload.ts`'s `unwrap` /
      `isPlainObject` — the pair the worksheet `get | set` commands already
      round-trip through — which also rejects a payload that parses but is
      not an object. CLI tests added.
- [x] Commit 2 (backend): `parseCellRef()` turns a `parseRef()` failure into
      `BadRequestException`, used by `setCell`, `deleteCell`, `getCell` and
      the `batchUpdate` pre-validation loop, so a bad ref 400s before any
      write. Controller spec tests added.
- [x] `pnpm verify:fast`
- [x] `/code-review` over the branch diff

## Found while fixing, in scope

- `getCell` reached `parseRef` *inside* the Yorkie callback, so the read path
  500'd on a bad ref even after the write verbs were fixed. Confirmed live
  against a running server before and after.
- `batchUpdate` never validated its body: `Object.entries` threw a TypeError
  on a missing or `null` `cells`, so the payload's shape is now checked before
  anything iterates it.
- `comments.controller.ts` already turned the same `parseRef` failure into
  the same 400, so `parseCellRef` is shared between the two controllers
  rather than written twice.
