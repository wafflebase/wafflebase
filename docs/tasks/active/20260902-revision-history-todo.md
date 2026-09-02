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
      shadow mode allows every request regardless. **Not done against any
      real deployment** — `packages/backend/README.md` documents the exact
      command, and the code path is proven against the local dev server
      (Task 8's e2e suite), but no production or staging project has had
      the methods registered or enforcement flipped on as part of this
      plan. This is the actual release gate for the whole feature.
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
      policy + delete RPC. **No issues filed** — no `yorkie-team/yorkie`
      issue links exist to add here yet.
- [ ] `yorkie-team/yorkie`: replace `preprocessYSON`'s regex with a real
      tokenizer. Its `Tree(...)` pattern bottoms out at three nested brace
      levels, so `YSON.parse` throws `Unexpected token 'T'` on **every**
      wafflebase docs snapshot (`doc > block > inline > text` is four), and
      it would also misread a `}` inside a string value in any document
      type. Measured: depth 2 OK, depth 3 OK, depth 4 fails. Blocks docs
      preview. **No issue filed.**

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

- [x] `packages/frontend/src/components/history/revision-meta.ts` — the
      `{"v":1,"by":<userId>,"kind":"named"|"safety"}` description contract,
      parse + write, tolerant of malformed and empty descriptions.
- [x] `use-revisions.ts` — thin state/day-grouping layer over
      `@yorkie-js/react`'s `useRevisions()`. Do **not** port CodePair's
      `useYorkieRevisions`; it predates the hook and hand-rolls it.
      Shipped as two files, `use-revision-history.ts` (state/actions) +
      `group-revisions.ts` (day-grouping), matching §3 of the design doc.
      **No paging shipped**: the hook asks for the most recent 50
      (`REVISION_LIST_LIMIT`) and exposes no offset, no `loadMore` and no
      "more exist" signal, so older versions are unreachable from the UI.
- [x] `history-panel.tsx` — right slot (shared with ThemePanel / Format
      options / comments), grouped by day, "Name current version", per-entry
      actions. Automatic entries show time only — there is no author on a
      `RevisionSummary` and we do not invent one.
- [x] Entry point in the document header menu for `sheet`, `doc`, `slides`,
      `note`, `board`. No entry for `pdf` / `image` / `file`.
- [x] Hide the entry for share-link viewers (matches Google Docs; UI
      courtesy over the server-side gate, not a substitute for it).
- [x] Restore path: safety revision → `restoreRevision` → `sync()` → reset
      selection, caret **and the undo stack** (docs and slides both delegate
      undo to `doc.history`, which describes reverse ops against a root the
      restore just replaced).
- [x] Restore confirmation states that comments in the same root ride along
      with the restore.
- [x] Register the webhook methods on the project
      (`--auth-webhook-method-add …`) and document it in
      `packages/backend/README.md`. Documented and proven against the local
      dev server; **not yet run against any real deployment** — see the
      Prerequisite section above.
- [x] Ship behind a flag; **do not enable on a deployment running
      `YORKIE_AUTH_WEBHOOK_ENFORCE=false`** — shadow mode logs the denial
      and allows the request anyway, which reopens the hole the
      *deployment gate* closes (registration + enforcement), not an
      upstream one. Flag was `VITE_WB_REVISION_HISTORY`, default off —
      **since removed** (see Review): it shipped on the mistaken premise
      that the RPCs could not be gated without an upstream fix, and it
      never protected share-link viewers either (they never mount the
      panel, structurally). The deployment gate above is now the only
      gate.

### PR 2 — preview (sheets, slides, board, notes)

- [x] `snapshot-adapters.ts`: `YSON.parse` per type. Sheets/slides/board
      parse straight to their models; notes need `YSON.textToString`.
- [x] `MemStore.load(worksheet)` — the constructor takes only a `Grid`, and
      the cells are keyed by axis id while the grid is keyed by `Sref`
      (`getWorksheetEntries` does that resolution).
- [x] `revision-preview.tsx`: banner over the existing viewer ("Viewing a
      version from … / Restore / Back"), not a modal — four of five engines
      are canvas. An unparseable snapshot renders an error, never an empty
      document.

### PR 3 — docs preview (blocked on the YSON tokenizer)

- [ ] Extract `treeNodeToBlock` from `packages/backend/src/yorkie/docs-tree.ts`
      into `@wafflebase/docs` (that file's own header already proposes the
      extraction), add `parseDocsSnapshot`, extend the preview type union.
      Not started — still blocked on the upstream `YSON.parse` tokenizer.
      `docs-detail.tsx` mounts `HistoryPanel` with no `onPreview`, so its
      Preview button renders disabled with a reason rather than a dead
      click (fixed during Task 11's review round).

### PR 4 — retention and polish

- [ ] Measure real revision growth on a workspace with `getDocSize()`
      instrumentation before enabling broadly. Not done.
- [ ] Paging, so the cap stops hiding versions; consider raising
      `snapshotInterval` for the project (at a sync cost). Not done. The
      panel lists **at most the 50 most recent** revisions
      (`REVISION_LIST_LIMIT` in `use-revision-history.ts`) and silently
      truncates beyond that — there is no offset, no "load more", and no
      indication that older versions exist. Storage itself is untouched and
      still unbounded.

## Tests

- [x] Backend unit: `YorkieAuthController.decide()` per method, asserting
      the verb each requires, that a viewer share-link token is denied `rw`,
      and that `REVISION_READ_METHODS` denies it `ListRevisions` /
      `GetRevision` too despite their `r` verb — while a workspace member
      and a share-link editor keep both, and an ordinary `r` on `PushPull`
      stays open to the viewer.
- [x] Frontend unit: `group-revisions` day-grouping; `use-revision-history`
      (safety revision precedes restore, no restore when it fails);
      `revision-meta` round-trip incl. malformed input; one snapshot→model
      adapter test per engine. The sheets/slides/board fixtures are
      **hand-authored** to each engine's real wire format, **not captured
      from a real document** — a real capture is still open (see the lessons
      file and Task 9's ledger entry). The sheets one was hand-authored to
      the *wrong* format until the final review round, which is exactly the
      risk hand-authoring carries; it is now asserted through
      `MemStore.load` rather than by counting JSON keys, so a fixture in a
      format the engine cannot load fails the test.
- [x] Integration (`RUN_YORKIE_INTEGRATION_TESTS=true`, already in CI's
      `verify-integration`): create → list → get → restore round-trip; a
      second attached client converges after a restore. **Regression test
      that a read-only client is refused create, restore and snapshot
      reads** — the snapshot-read half (`listRevisions`/`getRevision`
      refused for the viewer, allowed for the owner as the control) was
      added in the final review round; before that the checkbox claimed
      coverage that did not exist. **It is `it.skip` and therefore never
      runs in CI**: it provisions a scratch Yorkie project through the
      `yorkie` admin CLI, which CI does not install (only the server
      container). It has been run by hand — see the comment above the test
      and `.superpowers/sdd/20260902-revision-history-plan/task-8-report.md`
      for the observed output — but the only *automated* coverage of
      viewer-denial is the mocked `yorkie-auth.controller.spec.ts`. Ticked
      for "written and passing by hand", not for "guarded by CI".

## Review

**What shipped.** A version-history panel — list, "Name current version",
restore behind a mandatory safety revision — on all five CRDT editors
(sheets, docs, slides, notes, board). It originally shipped behind
`VITE_WB_REVISION_HISTORY` (default off); that flag has since been removed
(see the flag-removal follow-up below) once it was established the RPCs are
gateable without an upstream fix and the flag never protected share-link
viewers to begin with. The entry point is now unconditional for workspace
members, and the server-side deployment gate (§2 of the design doc) is the
only gate left. Preview ("Viewing a version from … / Restore / Back" over
the document's own viewer) shipped for four of those five: sheets, slides,
board, notes. The three gateable webhook methods (`ListRevisions` /
`GetRevision` / `RestoreRevision`) are proven closable without any upstream
change, and `packages/backend/README.md` carries the exact registration
command plus the explicit warning not to register `CreateRevision`.

**Flag removal follow-up (`docs/tasks/active/20260902-revision-history-plan/`
flag-removal-report.md).** `VITE_WB_REVISION_HISTORY` and
`history-enabled.ts` were deleted; the five detail routes now always render
the history entry point and mounts, gated only by `currentUser` (the panel
still needs a resolved numeric `userId`). With no client flag left,
**merging this change exposes the feature to every workspace member the
moment the frontend deploys** — the deployment gate (registration +
`YORKIE_AUTH_WEBHOOK_ENFORCE=true`) must be applied before or with that
merge, not after.

**What did not ship, and why.**

- **Docs preview.** Upstream Yorkie's `YSON.parse` cannot read a docs
  snapshot: `preprocessYSON`'s regex-based `Tree(...)` matcher bottoms out
  at three nested brace levels, and every wafflebase docs document nests
  `doc > block > inline > text` — depth four. This is not an edge case; it
  fails on **every** docs document that exists. `docs-detail.tsx` mounts
  `HistoryPanel` with no `onPreview`, so the Preview button renders
  disabled with an explanatory reason rather than doing nothing when
  clicked. Unblocks only when the upstream tokenizer fix lands (PR 3).
- **Mobile slides has no entry point.** `HistoryPanel` is a desktop side
  `<aside>` by construction; the mobile slides layout renders its panels
  as bottom sheets via `variant="sheet"`, which `HistoryPanel` does not
  implement. Accepted as a follow-up rather than a wiring-task change (see
  Task 7's ruling in `progress.md`).
- **Retention is untouched.** No growth measurement against a real
  workspace, no cap on what the panel lists, no `snapshotInterval` change.
  Storage stays unbounded — one full snapshot per 500 changes, forever,
  with no delete RPC anywhere in Yorkie's public surface.

**The deployment gate, stated precisely.** Register `ListRevisions`,
`GetRevision` and `RestoreRevision` on the Yorkie project
(`--auth-webhook-method-add`) **and** set
`YORKIE_AUTH_WEBHOOK_ENFORCE=true`. Both together are the release
precondition — shadow mode (`ENFORCE=false`, the default) computes the
decision, logs what it would have denied, and allows the request anyway,
so registering the methods alone protects nothing. **Do NOT register
`CreateRevision`.** The server sends it `attributes: null` for every
caller, so the unmodified `decide()` fails closed and denies it to
everyone, including the document's own owner — "Name current version"
would stop working for legitimate users on any deployment that registered
it. Leaving it unregistered leaves it ungated (a nuisance — a viewer could
create junk named versions — not a destructive hole). This has been
verified against the local dev Yorkie server (Task 8's e2e suite,
including an owner-side control probe) but **has not been executed against
any real deployment** as part of this plan; it remains an open operational
step, not a shipped fact.

**Honest limitations a user would notice, even with the deployment gate
closed:**

- A sheet preview cannot show charts or floating images — `Store`/
  `MemStore` have no surface for `Worksheet.charts` or `.images`, so a
  previewed version silently renders as if it never had them.
- Automatic (Yorkie-written) revisions show no author, only a timestamp —
  `RevisionSummary` has no actor field, and nothing is guessed on the
  client. Named and safety revisions show `by` because we write it
  ourselves.
- A board preview renders from the canvas origin rather than fit-to-content.
- A sheet preview shows only the first tab that *has* a worksheet; a
  workbook whose only tabs are `datasource` / `lakehouse` renders an
  explanatory message instead, since those tabs' rows are not in the CRDT.
- The version list is capped at the 50 most recent revisions, with no way
  to reach older ones (see PR 4 above).
- There is no loading state between opening a revision and its fetch
  resolving — the UI is quiet during that window rather than showing
  progress.

**Fixed in the final review round** (each had shipped as a defect):

- `parseBoardSnapshot` was an alias of `parseSlidesSnapshot`, and a board is
  not stored as a `SlidesDocument` — its root is `{meta, elements}` and the
  synthetic slide is built at read time. The alias yielded a document with
  no `slides`, silently (a missing key, not a parse error), so a board
  preview painted a blank canvas under a banner naming a date, and Restore
  from that banner would have restored content the user was never shown.
  Now parses the real board root through `boardToSlidesDocument`, against a
  board-format fixture.
- An open preview did not stop the live editor receiving keystrokes. The
  overlay is a sibling of the still-mounted live view, and both engines bind
  keydown on `document`, so `Cmd+Z` undid a real change in the live document
  and `Delete` deleted the live selection. The overlay now suppresses
  keydown/keyup from `window` in the capture phase (upstream of every
  `document` listener regardless of registration order) and takes focus on
  mount; `Escape` is the one deliberate pass-through.
- Share-link viewers could still read history. `ListRevisions` /
  `GetRevision` carry verb `r`, which `hasAccess` let a viewer through, so
  the documented claim that registering the methods stops a viewer reading
  history was false for the reads. `REVISION_READ_METHODS` now demands
  editor-or-member authority for those two.
- A failed restore surfaced nothing at either call site. Both now report it:
  the panel renders the failure the same way it renders a failed load, and
  the preview keeps itself open with the error in its banner instead of
  closing and firing the restore into the void.
- A restore started from the preview left the open panel stale (missing the
  "Before restore" entry it had just promised). The editors now pass their
  `historyResetToken` as the panel's `refreshKey`.
- The sheets adapter fixture was keyed by A1 notation, which is not the
  worksheet wire format — through `MemStore.load` it yielded zero cells. The
  fixture is now axis-ID keyed and asserted through `MemStore.load`.

**The verification that has NOT been done: no manual browser smoke test.**
`CLAUDE.md` asks for a manual smoke in `pnpm dev` when UI changed, and that
step is outstanding for this entire feature. It matters more than usual
here because the slides and board canvas mounts (`SlidesPreview`,
`BoardPreview` and their editors) have **no automated coverage at all** —
jsdom has no working Canvas 2D context anywhere in this repo, so every test
that touches those mounts stubs or skips the actual paint. Everything known
about whether the panel opens, previews render, and restore behaves
correctly in a real browser is inference from unit/integration tests plus
one implementer's self-report (Task 11), not observation. This is the
single most important thing in this section: before this feature is
considered done, someone needs to run `pnpm dev` and click through open →
preview → restore on at least the two canvas-based editors (slides, board)
that have zero automated coverage of their mount path. There is no flag to
turn on anymore — the entry point is live for any workspace member as soon
as the app is running, which makes this manual smoke more urgent, not less.
