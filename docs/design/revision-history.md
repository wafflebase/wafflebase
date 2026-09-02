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
RPCs are ungated until a deployment registers them, and three of the four
can be closed by wafflebase alone, today.**

An earlier draft of this document asserted the opposite — that the
auth-webhook method enum contained no `*Revision` entry, so the webhook
could never be consulted for them, and the whole feature was therefore
blocked on an upstream Yorkie change. That was inferred from a truncated
string in the server binary and is **false**. The server validates
registration against its method enum, and all four names are members:

```
$ yorkie project update <p> --auth-webhook-method-add ListRevisions   → accepted
$ yorkie project update <p> --auth-webhook-method-add NotARealMethod  → invalid_argument,
                                                    "given AuthWebhookMethods is invalid method"
```

Registered, the server calls the webhook for `ListRevisions`,
`GetRevision` and `RestoreRevision` with real attributes
(`{key: "sheet-…", verb: "r"|"rw"}`), and the existing unmodified
`decide()` authorizes them correctly. `revision-history.e2e-spec.ts`
demonstrates the viewer's `restoreRevision` being refused, with the
owner's document never rolling back — and, as the control that makes that
observation mean what it says, the *owner's* `restoreRevision` succeeding
against the same registration. Without that control the refusal would be
equally consistent with `RestoreRevision` sharing `CreateRevision`'s
`attributes: null` bug and denying everyone, since `decide()`'s
no-attributes branch fails closed before it ever looks at identity.

So the deployment posture is:

- **Register `ListRevisions`, `GetRevision`, `RestoreRevision`** and run
  `YORKIE_AUTH_WEBHOOK_ENFORCE=true`. That closes the destructive hole — a
  share-link viewer can no longer roll a document back, nor read its
  history — with no upstream dependency.
- **Do NOT register `CreateRevision`.** The server calls the webhook for it
  with `attributes: null` — no document key, no verb — for every caller.
  `decide()` fails closed on a document method carrying no attributes, so
  registering it denies `CreateRevision` to **everyone, the owner
  included**, and "Name current version" stops working for legitimate
  users. Leaving it unregistered leaves it ungated: anyone attached can
  create a revision. That residual is a nuisance (a viewer could add junk
  named versions) rather than destructive, and it is the narrow thing
  upstream ask 1 now exists to fix.

- `ListRevisions` / `GetRevision` need verb `r`, `CreateRevision` /
  `RestoreRevision` need `rw`.
- **The verb alone is not the authorization.** `decide()` falls unknown
  methods through to `checkAttribute`, which checks the verb against
  `WorkspaceMember` / `ShareLink` exactly as it does for `PushPull` — and a
  share-link *viewer* passes every `r`. That would leave `ListRevisions` and
  `GetRevision` open to viewers, and `getRevision` returns a **full snapshot
  of every past state**, including content deleted before the link was
  shared. So `yorkie-auth.controller.ts` carries one addition,
  `REVISION_READ_METHODS`: those two methods require the same
  editor-or-member authority a write does, despite their verb. Workspace
  members and share-link editors are unaffected; an ordinary `r` on
  `PushPull`/`Watch` is untouched, so a viewer can still read the document
  itself. The rest of the work is registering the methods on the project and
  pinning each method's verb and role outcome in unit tests.
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
the current `DocumentProvider`. What we add is list state and the grouping
in §1. CodePair's `useYorkieRevisions` predates that hook and hand-rolls the
same thing against `client` + `doc`; we should not copy it.

**There is no paging.** The hook asks `listRevisions` for the most recent
50 (`REVISION_LIST_LIMIT`) and stops there: no offset, no `loadMore`, and no
"more exist" signal, so on a document with more revisions than that the
panel silently shows the newest 50 and the older ones cannot be reached from
the UI at all. That is a real limitation, not a phrasing of one — and given
storage is unbounded (see Risks), it is the truncation that most needs
saying out loud. Paging is follow-up work (§7 PR 5).

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

**The overlay must cover the whole editing surface, not just the canvas.**
It renders `absolute inset-0`, so what it hides is decided entirely by which
ancestor is positioned. Mounted beside the canvas alone it left the slides
toolbar, the notes toolbar and the sheet tab bar live and clickable
underneath a banner reading "Viewing a version" — "Delete slide" and
"Delete sheet" among them, mutating the **live** document with no visible
feedback because the canvas that would have shown the change was behind the
preview. `PreviewSurface`
(`packages/frontend/src/components/history/preview-surface.tsx`) is the one
place that rule lives: chrome goes in `children`, the overlay in `preview`.
The version-history panel deliberately stays *outside* it, so a user can
still reach the next version. Google Docs does the same — opening a version
replaces the editing surface, not the page.

**A read-only mount has no navigation of its own, so the preview supplies
it.** `readOnly: true` skips `attachInteractions()` and the overlay's
capture-phase keyboard suppressor blocks the arrow keys, and the surfaces
that would otherwise navigate — the slides thumbnail rail, board's
wheel-pan / drag-pan / minimap — live in `SlidesView` / `board-view.tsx`,
behind the overlay. So the banner carries a prev/next slide control with a
position indicator for decks, and a board preview opens framed on its own
content via `boardPreviewViewport`, which reuses the live board's
`fitViewportToScene` + `sceneBounds`. Without the latter a board whose
content sits off-origin (a Miro import; this repo's own fixture has an
element at `x: -240`) rendered an empty canvas the user could not pan to.
A multi-tab *sheet* preview still shows only its first tab — the panel that
opens the preview is document-level, not tab-scoped — which remains a
known gap.

### 5. Restore

1. `createRevision("Before restore", {kind:"safety", by})` — so restore is
   never destructive and the pre-restore state is one click away.
2. `restoreRevision(id)`. No explicit `client.sync()` — an earlier draft
   mandated one, and the code does not call it. Measured against the running
   server: a Realtime-mode attachment (which is how every wafflebase editor
   attaches) converges on the restored root on its own, so the sync the
   mandate asked for is the one the attachment already performs. A manual
   deployment mode would need it.
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

1. **Populate the auth-webhook attributes for `CreateRevision`.** The other
   three revision RPCs already send `{key, verb}` and are authorized
   correctly by the existing webhook; `CreateRevision` sends
   `attributes: null` for every caller, which leaves a deployment only two
   bad options — register it and deny everyone including the owner, or
   leave it unregistered and ungated. This is the whole of the upstream
   dependency, and it blocks nothing in the rollout below.

   Two earlier framings of this ask were wrong and are recorded here
   because the corrections are the useful part. It first read "add the four
   methods to the method set" — they are already in it. It then paired that
   with "and refuse create/restore on a `readOnly: true` attachment, as
   defense in depth" — `AttachOptions` has no `readOnly` field, so there is
   no such attachment to refuse.
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
| 1 | wafflebase | History panel: list / name / restore + safety revision, all five types, flagged off; register the three gateable webhook methods; backend README + this doc |
| 2 | wafflebase | Preview for sheets, slides, board and notes |
| 3 | yorkie | `YSON.parse` tokenizer (upstream ask 4) |
| 4 | wafflebase | Docs preview: extract `treeNodeToBlock` into `@wafflebase/docs`, mount it |
| 5 | wafflebase | Retention handling and polish |

There is no longer a blocking PR 0. Registering `ListRevisions` /
`GetRevision` / `RestoreRevision` and enforcing the webhook closes the
destructive hole without upstream; the `CreateRevision` attributes bug
(upstream ask 1) leaves only the nuisance residual described in §2. PR 1
and PR 2 are independent of each other's engines and of every upstream ask.

### 8. Testing

- **Backend unit**: `YorkieAuthController.decide()` for each of the four
  methods, asserting the verb each requires, that a viewer share-link token
  is denied `rw`, and that it is denied the two revision **reads** as well
  despite their `r` verb — with a workspace member and a share-link editor
  still allowed on both, and an ordinary `r` on `PushPull` still open to the
  viewer.
- **Frontend unit**: `use-revision-history` grouping and the restore
  ordering; `revision-meta` parse/write round-trip including malformed
  descriptions; one snapshot→model adapter test per engine against a fixture
  in that engine's real wire format — for sheets, asserted *through*
  `MemStore.load`, since an A1-keyed fixture parses fine and then loads zero
  cells.
- **Integration** (`RUN_YORKIE_INTEGRATION_TESTS=true`, already wired into
  CI's `verify-integration` job): create → list → get → restore
  round-trip; a second attached client converges after a restore. The
  read-only-client regression test (refused create, restore *and* snapshot
  reads) is written but **`it.skip`** — it needs the `yorkie` admin CLI to
  provision a scratch project, and CI installs only the server container.
  It runs by hand; CI's coverage of that property is the mocked
  `yorkie-auth.controller.spec.ts` alone.

## Risks and Mitigation

**An unregistered revision RPC bypasses every permission control
wafflebase has.** Demonstrated against a local server by
`packages/backend/test/revision-history.e2e-spec.ts` — **by hand, not in
CI**: that suite's `refuses a read-only client` case is `it.skip`, because it
provisions a scratch Yorkie project through the `yorkie` admin CLI, which CI
does not install. It is the only test that exercises viewer-denial against a
real server, so nothing in CI guards this property end to end; what CI does
guard is the decision logic, in
`packages/backend/src/document/yorkie-auth.controller.spec.ts`. Unskipping it
needs the admin CLI on `PATH` plus `RUN_DB_INTEGRATION_TESTS=true` and
`RUN_YORKIE_INTEGRATION_TESTS=true`. With the auth webhook
enforcing but the revision methods *not* registered, a share-link
`viewer`'s ordinary write is correctly denied at `PushPull` with
`permission_denied` — and that same viewer's `restoreRevision` still
succeeds, rolling the document back for the owner's client too. Register
the three gateable methods and the same test shows the restore refused and
the owner's document intact. *Mitigation*: registration plus
`YORKIE_AUTH_WEBHOOK_ENFORCE=true` is a release precondition, and
`packages/backend/README.md` carries the exact command. `CreateRevision`
stays unregistered and therefore ungated until upstream ask 1 — see §2 for
why registering it would deny everyone.

Two earlier drafts of this paragraph were wrong, and both corrections are
worth keeping. The first cited a probe that attached with `readOnly: true`
— `AttachOptions` has no such field, so it was dropped as an excess
property and that client was never read-only. The second asserted the
method enum contained no `*Revision` entry, inferred from a truncated
string in the server binary; the server in fact validates registration
against that enum and accepts all four names. Each error pointed the same
direction — toward believing the hole was deeper and less fixable than it
is — which is the failure mode to watch for when a probe and a hypothesis
agree. Note that `YORKIE_AUTH_WEBHOOK_ENFORCE=false`
is **shadow mode — it logs the denial it would have made and allows the
request anyway**, so registering the methods on a deployment still in
shadow mode protects nothing. Registration *and* enforcement are both
release preconditions, not follow-ups.

**Revision storage is unbounded.** One full snapshot per `snapshotInterval`
(500) changes, forever; there is no delete-revision RPC in the SDK or the
server's public surface. wafflebase sheets reach ~7 MB (the 10 MB Yorkie
document cap is a node-count limit we already push against), so a heavily
edited document could accumulate gigabytes. *Mitigation*: all partial until
upstream ask 3 lands — raise `snapshotInterval` for the project (at a sync
cost) and measure real growth with the `getDocSize()` instrumentation
already used for import sizing. This should be measured on a real workspace
before the feature is enabled broadly. The panel's 50-revision cap (§3)
bounds only what the *panel reads*, not what is stored — and it is what
makes older versions unreachable, so it is a symptom of this risk rather
than a mitigation of it.

**The snapshot format's parser is regex-based.** `YSON.parse` cannot read a
snapshot of any docs document (§4), and the same preprocessing would also
misread a `}` appearing inside a string value in any document type. We
depend on it for every preview. *Mitigation*: upstream ask 4 replaces it
with a tokenizer; until then docs preview is out and the other four types
are covered by adapter tests built from fixtures **hand-authored** to each
engine's wire format — *not* captured off real documents, which is a real
weakness of the coverage: the sheets fixture was hand-authored to the wrong
format until the final review round. Asserting the sheets one *through*
`MemStore.load` rather than by counting JSON keys is what caught that, and
capturing fixtures from real documents remains open. A regression in the
parser does surface in CI rather than in a user's preview; a fixture that
drifts from the real wire format does not.

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
