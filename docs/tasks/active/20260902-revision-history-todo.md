# Revision history (version panel on all CRDT document types)

Design: [`docs/design/revision-history.md`](../../design/revision-history.md)
Plan: [`20260902-revision-history-plan.md`](./20260902-revision-history-plan.md)

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

## Prerequisite (deployment, NOT upstream)

An unregistered revision RPC is gated by nothing. Reproduced by
`packages/backend/test/revision-history.e2e-spec.ts`: with the auth webhook
enforcing but the revision methods unregistered, a share-link `viewer`'s
ordinary write is denied at `PushPull` with `permission_denied`, and that
same viewer's `restoreRevision` still succeeds, rolling the document back
for the owner's client too. Register the three gateable methods and the
same test shows the restore refused.

This was originally filed as blocking-upstream on the belief that the
method enum had no `*Revision` entry. That was wrong — the server validates
registration against the enum and accepts all four names.

- [ ] Deployment: register `ListRevisions` / `GetRevision` /
      `RestoreRevision` (verbs `r` / `r` / `rw`) and set
      `YORKIE_AUTH_WEBHOOK_ENFORCE=true`. Both are release preconditions;
      shadow mode allows every request regardless.
- [ ] Do NOT register `CreateRevision` until the upstream fix below: the
      server sends it `attributes: null`, so `decide()` fails closed and
      denies it to everyone, the owner included.
- [ ] `yorkie-team/yorkie`: populate `{key, verb}` attributes on the
      `CreateRevision` auth-webhook call, as the other three already do.
- [ ] `yorkie-team/yorkie` (separate, unrelated): fix the
      `ListRevisionsByAdmin` panic under `API-Key` auth —
      `interface conversion: interface {} is nil, not *types.User` at
      `server/rpc/admin_server.go:1165` via `server/users.From`. Kills the
      connection with `NGHTTP2_INTERNAL_ERROR`; works with an admin login
      token. `YorkieAdminService` authenticates with `API-Key`.
- [ ] File upstream asks: record the acting client on a revision (so
      automatic revisions can show an author), and a revision retention
      policy + delete RPC.
- [ ] `yorkie-team/yorkie`: replace `preprocessYSON`'s regex with a real
      tokenizer. Its `Tree(...)` pattern bottoms out at three nested brace
      levels, so `YSON.parse` throws `Unexpected token 'T'` on **every**
      wafflebase docs snapshot (`doc > block > inline > text` is four), and
      it would also misread a `}` inside a string value in any document
      type. Measured: depth 2 OK, depth 3 OK, depth 4 fails. Blocks docs
      preview.

## Plan

Step-by-step tasks live in
[`20260902-revision-history-plan.md`](./20260902-revision-history-plan.md);
this section is the PR-level shape.

Note: the design's original "move the `read*Root` converters into the
engine packages" PR was **dropped**. Those helpers exist to unwrap live
Yorkie proxies; a parsed snapshot is already plain JSON, so sheets, slides
and board need no converter and notes need only `YSON.textToString`. Only
docs needs one (`treeNodeToBlock`), and only once the YSON fix above lands.

### PR 1 — history panel: list / name / restore

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

### PR 2 — preview (sheets, slides, board, notes)

- [ ] `snapshot-adapters.ts`: `YSON.parse` per type. Sheets/slides/board
      parse straight to their models; notes need `YSON.textToString`.
- [ ] `MemStore.load(worksheet)` — the constructor takes only a `Grid`, and
      the cells are keyed by axis id while the grid is keyed by `Sref`
      (`getWorksheetEntries` does that resolution).
- [ ] `revision-preview.tsx`: banner over the existing viewer ("Viewing a
      version from … / Restore / Back"), not a modal — four of five engines
      are canvas. An unparseable snapshot renders an error, never an empty
      document.

### PR 3 — docs preview (blocked on the YSON tokenizer)

- [ ] Extract `treeNodeToBlock` from `packages/backend/src/yorkie/docs-tree.ts`
      into `@wafflebase/docs` (that file's own header already proposes the
      extraction), add `parseDocsSnapshot`, extend the preview type union.

### PR 4 — retention and polish

- [ ] Measure real revision growth on a workspace with `getDocSize()`
      instrumentation before enabling broadly.
- [ ] Cap what the panel lists; consider raising `snapshotInterval` for the
      project (at a sync cost).

## Tests

- [ ] Backend unit: `YorkieAuthController.decide()` per method, asserting
      the verb each requires and that a viewer share-link token is denied
      `rw`.
- [ ] Frontend unit: `group-revisions` day-grouping; `use-revision-history`
      (safety revision precedes restore, no restore when it fails);
      `revision-meta` round-trip incl. malformed input; one snapshot→model
      adapter test per engine against a fixture captured from a real
      document.
- [ ] Integration (`RUN_YORKIE_INTEGRATION_TESTS=true`, already in CI's
      `verify-integration`): create → list → get → restore round-trip; a
      second attached client converges after a restore; **regression test
      that a read-only client is refused create, restore and snapshot
      reads**.

## Review

_(fill in at completion)_
