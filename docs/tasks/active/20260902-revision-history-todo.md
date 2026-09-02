# Revision history (version panel on all CRDT document types)

Design: [`docs/design/revision-history.md`](../../design/revision-history.md)

## Problem

Every wafflebase CRDT document has exactly one state: the current one. No
way to see yesterday's version, mark a milestone, or get back from a bad
edit once the per-session undo stack is gone. Yorkie `0.7.18` — already
pinned — exposes `createRevision` / `listRevisions` / `getRevision` /
`restoreRevision`, `@yorkie-js/react` ships `useRevisions()`, and the
server writes an automatic revision per snapshot with
`autoRevisionEnabled: true` on by default. What is missing is a permission
boundary, a way to render a past snapshot of five different models, and an
answer for snapshot storage growth.

## Prerequisite (blocking, upstream)

Yorkie's revision RPCs are gated by nothing. Reproduced locally: a client
attached `readOnly: true` listed revisions, read a full past snapshot, and
restored the document. The auth-webhook method enum carries no `*Revision`
entry, so `yorkie-auth.controller.ts` is never consulted.

- [ ] `yorkie-team/yorkie`: add `ListRevisions` / `GetRevision` /
      `CreateRevision` / `RestoreRevision` to the auth-webhook method set
      with verbs `r` / `r` / `rw` / `rw`.
- [ ] `yorkie-team/yorkie`: refuse create + restore on a `readOnly: true`
      attachment, independent of webhook configuration.
- [ ] `yorkie-team/yorkie` (separate, unrelated): fix the
      `ListRevisionsByAdmin` panic under `API-Key` auth —
      `interface conversion: interface {} is nil, not *types.User` at
      `server/rpc/admin_server.go:1165` via `server/users.From`. Kills the
      connection with `NGHTTP2_INTERNAL_ERROR`; works with an admin login
      token. `YorkieAdminService` authenticates with `API-Key`.
- [ ] File upstream asks: record the acting client on a revision (so
      automatic revisions can show an author), and a revision retention
      policy + delete RPC.

## Plan

### PR 1 — move the snapshot converters into the engine packages

- [ ] Move `readDocsRoot` / `readPageSetup` (`packages/backend/src/yorkie/docs-tree.ts`)
      and `readSlidesRoot` (`slides-tree.ts`) and `readNoteRoot`
      (`note-content.ts`) into `@wafflebase/docs` / `@wafflebase/slides` /
      the notes path, keeping the backend as an importer. Pure functions
      over a root shape — they were written for the CLI and belong to the
      engines, not the backend.
- [ ] Backend imports from the new home; `pnpm backend test` unchanged
      (this PR has no behavior change).
- [ ] Watch the `@wafflebase/core` subpath/tsconfig trap if anything lands
      there: classic CJS ignores `exports`, so the backend tsconfig needs a
      matching `paths` entry.

### PR 2 — history panel: list / name / restore

- [ ] `packages/frontend/src/components/history/revision-meta.ts` — the
      `{"v":1,"by":<userId>,"kind":"named"|"safety"}` description contract,
      parse + write, tolerant of malformed and empty descriptions.
- [ ] `use-revisions.ts` — thin state/paging/day-grouping layer over
      `@yorkie-js/react`'s `useRevisions()`. Do **not** port CodePair's
      `useYorkieRevisions`; it predates the hook and hand-rolls it.
- [ ] `history-panel.tsx` — right slot (shared with ThemePanel / Format
      options / comments), grouped by day, "Name current version", per-entry
      actions. Automatic entries show time only — there is no author on a
      `RevisionSummary` and we do not invent one.
- [ ] Entry point in the document header menu for `sheet`, `doc`, `slides`,
      `note`, `board`. No entry for `pdf` / `image` / `file`.
- [ ] Hide the entry for share-link viewers (matches Google Docs; UI
      courtesy over the server-side gate, not a substitute for it).
- [ ] Restore path: safety revision → `restoreRevision` → `sync()` → reset
      selection, caret **and the undo stack** (docs and slides both delegate
      undo to `doc.history`, which describes reverse ops against a root the
      restore just replaced).
- [ ] Restore confirmation states that comments in the same root ride along
      with the restore.
- [ ] Register the webhook methods on the project
      (`--auth-webhook-method-add …`) and document it in
      `packages/backend/README.md`.
- [ ] Ship behind a flag; **do not enable on a deployment running
      `YORKIE_AUTH_WEBHOOK_ENFORCE=false`** — shadow mode logs the denial
      and allows the request anyway, which reopens the hole the upstream
      fix closes.

### PR 3 — preview

- [ ] `revision-preview.tsx`: `getRevision` → `YSON.parse` → per-type
      adapter → engine model → `MemStore` / `MemDocStore` /
      `MemSlidesStore` → the document's own viewer, read-only.
- [ ] Per-adapter shim from `YSON.Tree` to the live-proxy shape the
      converters expect (`readDocsRoot` calls `root.content.getRootTreeNode()`).
- [ ] Banner over the existing viewer ("Viewing a version from … /
      Restore / Back"), not a modal — four of five engines are canvas.

### PR 4 — retention and polish

- [ ] Measure real revision growth on a workspace with `getDocSize()`
      instrumentation before enabling broadly.
- [ ] Cap what the panel lists; consider raising `snapshotInterval` for the
      project (at a sync cost).

## Tests

- [ ] Backend unit: `YorkieAuthController.decide()` per method, asserting
      the verb each requires and that a viewer share-link token is denied
      `rw`.
- [ ] Frontend unit: `use-revisions` grouping/paging; `revision-meta`
      round-trip incl. malformed input; one snapshot→model adapter test per
      engine against a fixture from a real document.
- [ ] Integration (`RUN_YORKIE_INTEGRATION_TESTS=true`, already in CI's
      `verify-integration`): create → list → get → restore round-trip; a
      second attached client converges after a restore; **regression test
      that a read-only client is refused create, restore and snapshot
      reads**.

## Review

_(fill in at completion)_
