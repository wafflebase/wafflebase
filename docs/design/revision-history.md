---
title: revision-history
target-version: 0.7.0
---

# Revision History

## Summary

Every wafflebase CRDT document type — sheets, docs, slides, notes, board —
is a single Yorkie document with exactly one state: the current one. There
is no way to see what a document looked like yesterday, no way to mark a
milestone, and no way back from a bad edit once the undo stack is gone (it
is per-session, and a peer's concurrent change makes it shorter than it
looks).

Yorkie already stores the material for all three. As of `0.7.18` the SDK
exposes `client.createRevision / listRevisions / getRevision /
restoreRevision`, `@yorkie-js/react` ships a `useRevisions()` hook, and the
server writes an **automatic** revision on every snapshot it takes. The
running server in `docker-compose.yaml` answers those RPCs today, and the
default project already has `autoRevisionEnabled: true`.

So this design is mostly about the three things Yorkie does *not* give us:
a permission boundary (there is none — see Risks), a way to render a past
snapshot of five different document models, and an answer for unbounded
snapshot storage.

Prior art reviewed: **Google Docs** version history (automatic time-grouped
versions, "Name current version", non-destructive restore, editors-only
visibility, per-author change highlighting, "make a copy of a version") and
**CodePair**'s `packages/frontend/src/features/editor/` (~918 lines: a
`useYorkieRevisions` hook plus a right `Drawer` with Create / Preview /
Restore dialogs — manual named revisions only, no automatic timeline, no
diff, no permission gating, and a preview that works only because a note is
one `YSON.Text`).

### Goals

- A **Version history** panel on all five CRDT document types listing both
  automatic and user-named versions, grouped by day.
- **Name current version**, so a user can mark a milestone.
- **Preview**: open any version read-only in the document's own viewer.
- **Restore**, non-destructively — the pre-restore state is always
  recoverable.
- Close the permission hole first: a read-only visitor must not be able to
  read or restore history.

### Non-Goals

- **Change highlighting / diff** (Google Docs' "Show changes"). Needs a
  per-engine diff and authorship data Yorkie's `RevisionSummary` does not
  carry. Deferred.
- **Make a copy of a version.** Cheap later — `DocumentCopyService` already
  does whole-root Yorkie JSON snapshot copies — but not v1.
- **Blob document types** (`pdf`, `image`, `file`). Their bytes never
  change; there is nothing to version. The `pdf-<id>` comments document is
  also out of scope.
- **Comment history.** Sheet/docs comments live in the same root and so
  ride along with a restore; that is a consequence, not a feature, and is
  called out under Risks.
- **Per-revision retention UI.** No delete RPC exists (see Risks).

## Proposal Details

### 1. The version model

A Yorkie revision is the unit. Three kinds, distinguished by `label` and a
JSON `description` we own:

| Kind | Created by | `label` | `description` |
| --- | --- | --- | --- |
| Automatic | Yorkie, one per server snapshot | `snapshot-<serverSeq>` | empty |
| Named | us, `createRevision` | the user's text | `{"v":1,"by":<userId>,"kind":"named"}` |
| Safety | us, immediately before a restore | `Before restore` | `{"v":1,"by":<userId>,"kind":"safety"}` |

`RevisionSummary` is `{id, label, description, snapshot, createdAt}`.
`listRevisions` returns everything but `snapshot` (bodies are omitted, so
the list is cheap); `getRevision` returns the full YSON. Ordering is
newest-first by default (`isForward: false`).

Two consequences worth stating plainly rather than papering over:

**The automatic timeline is activity-shaped, not clock-shaped.** Yorkie
writes one revision per server snapshot, i.e. per `snapshotInterval`
changes (default 500). Measured: 620 changes on a probe document produced
exactly one revision, `snapshot-503`. A heavily edited document gets many
entries; a document nobody touched for a month has none for that month.
Google Docs looks different only because it snapshots on a timer. The panel
therefore presents automatic entries by their `createdAt` and never implies
a regular cadence.

**Automatic revisions have no author.** There is no actor field on
`RevisionSummary`. Named revisions carry `by` in the description because we
write it; automatic ones show no author at all rather than a guess. Fixing
this properly is an upstream ask (§6), not something to synthesize on the
client.

### 2. Permission model

Restated from Risks because it drives the sequencing: **Yorkie's revision
RPCs are gated by nothing today.** The wafflebase feature does not reach
production until the upstream fix in §6 has landed *and* the deployment
runs `YORKIE_AUTH_WEBHOOK_ENFORCE=true`.

Once it has:

- `ListRevisions` / `GetRevision` need verb `r`, `CreateRevision` /
  `RestoreRevision` need `rw`.
- `yorkie-auth.controller.ts` needs **no change**. Its `decide()` falls
  unknown methods through to `checkAttribute`, which resolves the docKey
  and checks the verb against `WorkspaceMember` / `ShareLink` exactly as it
  does for `PushPull`. The work is registering the methods on the project
  and adding unit tests that pin each method's verb.
- The panel entry point is hidden for share-link **viewers**, matching
  Google Docs, where viewers and commenters do not see version history at
  all. This is UI courtesy layered on the server-side gate, not a
  substitute for it.

### 3. Frontend surface

A shared module at `packages/frontend/src/components/history/`, mirroring
how `components/comments/` is shared across engines:

```
components/history/
  revision-meta.ts         # the description JSON contract from §1, parse + write
  group-revisions.ts       # flat revision list → day-keyed timeline
  use-revision-history.ts  # state + actions over @yorkie-js/react's useRevisions()
  history-panel.tsx        # right-slot panel: list, "Name current version", per-entry actions
  snapshot-adapters.ts     # YSON snapshot → engine document model, per type
  revision-preview.tsx     # per-type read-only render of a snapshot
  history-enabled.ts       # flag + viewer gating
```

The hook is named `use-revision-history` rather than `use-revisions` so it
cannot be confused at an import site with the SDK hook it wraps.

`use-revision-history.ts` is deliberately thin — `@yorkie-js/react@0.7.18`
already exports `useRevisions()` returning
`{createRevision, listRevisions, getRevision, restoreRevision}` bound to
the current `DocumentProvider`. What we add is list state, paging, and the
grouping in §1. CodePair's `useYorkieRevisions` predates that hook and
hand-rolls the same thing against `client` + `doc`; we should not copy it.

The panel occupies the existing right slot (the one ThemePanel, Format
options and the comments side panel share), and is opened from the
document header menu. Document types: `sheet`, `doc`, `slides`, `note`,
`board`.

### 4. Preview

```
getRevision(id) → YSON string → YSON.parse → per-type adapter
               → engine model → MemStore | MemDocStore | MemSlidesStore
               → the document's own viewer, read-only
```

Each engine already accepts a plain model in its in-memory store
(`MemStore(grid?)`, `MemDocStore(doc?)`, `MemSlidesStore(doc?)`), so the
viewer half is nearly free — `MemStore` takes only a `Grid`, so a sheet
preview additionally needs a bulk-load path for styles, merges, dimensions
and freeze state, which today have no setter beyond the async `Store` API.
The visual-harness scenarios in
`packages/frontend/src/app/harness/visual/sheet-scenarios.tsx` are the
existing pattern for standing up a read-only sheet from a model.

**A parsed snapshot is already plain data, so most of the conversion work
does not exist.** The backend's `readDocsRoot` / `readSlidesRoot` /
`readNoteRoot` exist to unwrap *live Yorkie proxies* — `unwrapJson`,
`getRootTreeNode()`, the double-encoding dance. `YSON.parse` yields plain
JSON objects, so slides, board and sheets need no converter at all, and
notes need only `YSON.textToString`. Only docs genuinely needs one, because
its body is a `Tree` and its nodes must become `DocsBlock`s — and exactly
that code already exists as `treeNodeToBlock` inside
`packages/backend/src/yorkie/docs-tree.ts`. So the extraction is scoped to
the docs tree→blocks half, pulled into `@wafflebase/docs` when the docs
preview is built, rather than a wholesale move of three modules up front.
(`docs-tree.ts`'s own header already proposes this extraction.)

**Docs preview is blocked upstream: `YSON.parse` cannot parse a snapshot
containing a real docs tree.** `preprocessYSON` is regex-based, and its
`Tree(...)` pattern hard-codes a maximum of three nested brace levels.
Measured against the running server:

| Root shape | `YSON.parse` |
| --- | --- |
| sheets / slides / board (plain JSON) | OK |
| notes (`Text([...])`) | OK |
| docs `Tree` depth 3 (`doc > block > text`) | OK |
| docs `Tree` depth 4 (`doc > block > inline > text`) | **fails** |

Every wafflebase docs document is depth 4 or more, and tables go deeper, so
this is not an edge case — it is every document of that type. Preview
therefore ships for sheets, slides, board and notes first, and docs follows
the upstream fix (§6). The fallback, if that fix is slow, is our own
snapshot parser in the frontend; it is a fallback rather than the plan
because a second regex-based parser is how this bug was born.

Presentation is a banner over the existing viewer — "Viewing a version from
… / Restore / Back" — not a modal. Four of the five engines are canvas, and
a canvas in a dialog loses the scroll, zoom and pan the viewer already
implements.

### 5. Restore

1. `createRevision("Before restore", {kind:"safety", by})` — so restore is
   never destructive and the pre-restore state is one click away.
2. `restoreRevision(id)` then `client.sync()`.
3. Reset view-local state: selection, caret, and **the undo stack**.

Step 3 is not cosmetic. Docs delegate undo to Yorkie `doc.history` and
slides to the native `doc.history` migration; both describe reverse
operations against a root that a whole-document restore has just replaced.
An undo issued after a restore against a stale stack is the failure mode to
test for, not to reason about.

Whether peers watching the document converge on the restored state is the
other thing to prove rather than assume — it belongs in the
Yorkie-attached integration lane (`RUN_YORKIE_INTEGRATION_TESTS=true`),
which already exists and runs in CI.

### 6. Upstream Yorkie work

Three asks, in `yorkie-team/yorkie`. The first blocks this feature:

1. **Gate the revision RPCs.** Add `ListRevisions` / `GetRevision` /
   `CreateRevision` / `RestoreRevision` to the auth-webhook method set with
   verbs `r` / `r` / `rw` / `rw`, and independently refuse create and
   restore on a `readOnly: true` attachment — defense in depth for
   deployments running no webhook at all.
2. **Record the acting client on a revision**, so automatic revisions can
   show an author (§1) instead of nothing.
3. **A retention policy and a delete RPC** (max count and/or TTL per
   document). See Risks.
4. **Fix `YSON.parse` for nested trees** — `preprocessYSON`'s `Tree(...)`
   regex bottoms out at three nested brace levels, so parsing any
   snapshot of a document whose tree is deeper throws
   `Unexpected token 'T'`. The fix is a real tokenizer rather than a
   deeper regex; the current one also cannot survive a `}` inside a string
   value. Blocks docs preview (§4).

Plus one unrelated bug found while probing: `ListRevisionsByAdmin` panics
under `API-Key` authentication —
`interface conversion: interface {} is nil, not *types.User` at
`server/rpc/admin_server.go:1165`, via `server/users.From` — killing the
connection with `NGHTTP2_INTERNAL_ERROR`. It works with an admin login
token. wafflebase's `YorkieAdminService` authenticates with
`API-Key <secretKey>`, so any future backend-side use of the admin revision
RPCs hits this.

### 7. Rollout

| PR | Repo | Content |
| --- | --- | --- |
| 0 | yorkie | Auth-webhook methods + `readOnly` guard (upstream ask 1) |
| 1 | wafflebase | History panel: list / name / restore + safety revision, all five types, flagged off; register webhook methods; backend README + this doc |
| 2 | wafflebase | Preview for sheets, slides, board and notes |
| 3 | yorkie | `YSON.parse` tokenizer (upstream ask 4) |
| 4 | wafflebase | Docs preview: extract `treeNodeToBlock` into `@wafflebase/docs`, mount it |
| 5 | wafflebase | Retention handling and polish |

PR 1 and PR 2 are independent of each other's engines and of upstream asks
2–4; only the ship-to-production gate depends on PR 0.

### 8. Testing

- **Backend unit**: `YorkieAuthController.decide()` for each of the four
  methods, asserting the verb each requires and that a viewer share-link
  token is denied `rw`.
- **Frontend unit**: `use-revisions` grouping and paging;
  `revision-meta` parse/write round-trip including malformed descriptions;
  one snapshot→model adapter test per engine against a fixture captured
  from a real document.
- **Integration** (`RUN_YORKIE_INTEGRATION_TESTS=true`, already wired into
  CI's `verify-integration` job): create → list → get → restore
  round-trip; a second attached client converges after a restore; and a
  regression test that a read-only client is refused create, restore
  *and* snapshot reads.

## Risks and Mitigation

**Yorkie's revision RPCs bypass every permission control wafflebase has.**
Demonstrated against the local server: a client attached with
`readOnly: true` listed revisions, read a past snapshot in full, and
restored the document. The auth-webhook method enum in the server binary is
`ActivateClient / AttachDocument / DetachDocument / RemoveDocument /
PushPull / Watch / Broadcast` — no `*Revision` entry — so
`yorkie-auth.controller.ts` is never consulted. In wafflebase terms: an
anonymous viewer holding a share link could silently revert a document and
read its entire history. *Mitigation*: upstream ask 1 in §6, which this
feature is sequenced behind. Note that `YORKIE_AUTH_WEBHOOK_ENFORCE=false`
is **shadow mode — it logs the denial it would have made and allows the
request anyway**, so shipping history to a deployment still in shadow mode
reopens the same hole. Enforcement being on is a release precondition, not
a follow-up.

**Revision storage is unbounded.** One full snapshot per `snapshotInterval`
(500) changes, forever; there is no delete-revision RPC in the SDK or the
server's public surface. wafflebase sheets reach ~7 MB (the 10 MB Yorkie
document cap is a node-count limit we already push against), so a heavily
edited document could accumulate gigabytes. *Mitigation*: all partial until
upstream ask 3 lands — raise `snapshotInterval` for the project (at a sync
cost), cap what the panel lists, and measure real growth with the
`getDocSize()` instrumentation already used for import sizing. This should
be measured on a real workspace before the feature is enabled broadly.

**The snapshot format's parser is regex-based.** `YSON.parse` cannot read a
snapshot of any docs document (§4), and the same preprocessing would also
misread a `}` appearing inside a string value in any document type. We
depend on it for every preview. *Mitigation*: upstream ask 4 replaces it
with a tokenizer; until then docs preview is out and the other four types
are covered by adapter tests built from fixtures captured off real
documents, so a regression in the parser surfaces in CI rather than in a
user's preview.

**A restore is a whole-root replacement, and comments ride along.** Sheet
and docs comment threads live in the same Yorkie root, so restoring a
version from before a discussion removes that discussion. Google Docs keeps
comments out of version restore. *Mitigation*: state it in the restore
confirmation dialog. Preserving comments across a restore would mean
re-writing them after the fact and is deliberately out of scope for v1.

**Undo after restore.** Covered in §5 — the stack refers to a root that no
longer exists. *Mitigation*: reset it as part of the restore path, and test
it per engine.

**Label collision as the kind discriminator.** A user can name a version
`snapshot-503` and have it render as automatic. *Mitigation*: the
`description` JSON is authoritative and the label prefix is only a
fallback for revisions we did not write; a named revision always has
`kind` in its description.
