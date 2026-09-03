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

**This is now the only gate.** An earlier revision of this feature shipped
behind a client-side flag (`VITE_WB_REVISION_HISTORY`), on the mistaken
premise below that the RPCs could not be gated without an upstream fix. That
premise was wrong, so the flag was removed — it never protected share-link
viewers either (they land on `shared-document.tsx`, which never mounts the
panel at all) and only decided whether workspace members saw the toolbar
entry point. With the flag gone, **merging this feature exposes it to every
workspace member of every document the moment the frontend deploys** — there
is no other switch. The registration + enforcement steps below are therefore
a release precondition to be applied *before or with* that merge, not a
follow-up.

An earlier draft of this document asserted the opposite — that the
auth-webhook method enum contained no `*Revision` entry, so the webhook
could never be consulted for them, and the whole feature was therefore
blocked on an upstream Yorkie change. That was inferred from a truncated
string in the server binary and is **false**. The server validates
registration against its method enum, and all four names are members:

```bash
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
- The panel entry point never reaches share-link **viewers** structurally —
  they land on `shared-document.tsx`, which has no history wiring at all —
  matching Google Docs, where viewers and commenters do not see version
  history either. That structural fact is not a gate for workspace
  **members**, who do reach the entry point in every one of the five editor
  routes with no client-side condition on it; the server-side registration
  above is what stands between them and the RPCs.

### 3. Frontend surface

A shared module at `packages/frontend/src/components/history/`, mirroring
how `components/comments/` is shared across engines:

```text
components/history/
  revision-meta.ts         # the description JSON contract from §1, parse + write
  group-revisions.ts       # flat revision list → day-keyed timeline
  use-revision-history.ts  # state + actions over @yorkie-js/react's useRevisions()
  history-panel.tsx        # right-slot panel: list, "Name current version", per-entry actions
  snapshot-adapters.ts     # YSON snapshot → engine document model, per type
  revision-preview.tsx     # per-type read-only render of a snapshot
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

```text
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

**`YSON.parse` could not reliably read a snapshot wrapped in `Tree(...)` or
`Text([...])` before `@yorkie-js/sdk@0.7.19`.** `preprocessYSON` was a chain
of regex replacements, and it failed two independent ways. Measured against
the running server, with real documents, on both versions:

| Case | 0.7.18 | 0.7.19 |
| --- | --- | --- |
| sheets / slides / board (plain JSON root — no wrapper at all) | OK | OK |
| docs `Tree` depth 3 (`doc > block > text`) | OK | OK |
| docs `Tree` depth 4 (`doc > block > inline > text`) | **fails** | OK |
| docs `Tree` depth 6 (a table) | **fails** | OK |
| a note containing `arr[1:]` (balanced brackets) | OK | OK |
| a note containing `Fix issue 3] later` (one unbalanced `]`) | **fails** | OK |
| a note containing `a [b [c [d [e] f] g] h] i` (4 levels) | **fails** | OK |

1. **Nesting depth was hard-coded in the pattern** — three levels per type.
   Every wafflebase docs document is `doc > block > inline > text`, which is
   four, and tables go deeper. So docs preview never worked.
2. **The patterns were not string-aware.** They counted `{}`/`[]` appearing
   *inside string values* as structure. Balanced ones happened to survive,
   which is why an ordinary markdown link parsed; an unbalanced one did not.

An earlier revision of this document recorded only the first defect and
called it docs-specific. That was wrong: the second defect reached
**notes**, which did ship. A note whose text contained an unmatched bracket
previewed as "Couldn't read this version" instead of its content. It failed
*safely* — the adapter throws, `RevisionPreview` renders `role="alert"`,
and nothing incorrect is drawn — but it failed.

**0.7.19 fixed both** by replacing the chain with a single-pass string-aware
scanner (`skipString` / `findMatchingParen` / `splitTopLevelArgs`), which is
exactly what upstream ask 4 requested. Preview now ships for all five types
with no caveat. The contingency plan — our own snapshot parser — was not
needed and is dropped; had it been written, the rule was that it must be a
string-aware scanner, because a second regex-based parser is how this bug
was born.

**A parsed snapshot node is not the same shape as a live proxy node.**
Making docs preview work took more than a parser that no longer throws,
because docs is the one type needing a real tree→model converter, and the
two dialects disagree twice — neither of which raises anything:

| | live proxy (`tree.getRootTreeNode()`) | `YSON.parse` of a snapshot |
| --- | --- | --- |
| attribute key | `attributes` | `attrs` |
| attribute value | decoded (`center`) | JSON-encoded (`"center"`) |

The SDK's live path runs every attribute through `JSON.parse`
(`parseObjectValues`); `YSON.parse` assigns the map verbatim, and its
`postprocessTreeNode` whitelists `{type, value, attrs, children}`. Reusing
the backend's reader unchanged would therefore have produced a document
whose every block fell back to `paragraph` with no style and no table —
plausible-looking content that is not what the user wrote, which is the one
outcome this feature's error handling exists to prevent. So the shared
converter (`docsTreeToDocument` in `@wafflebase/docs`, which the backend's
`readDocsRoot` also calls, so the two readers cannot drift) reads a neutral
`DocsTreeNode`, and the snapshot caller normalizes the dialect explicitly
before delegating. The docs fixture backing those tests is captured from a
real server through the production writer, like every other fixture here.

Presentation is a banner over the existing viewer — "Viewing a version from
… / Restore / Back" — not a modal. Four of the five engines are canvas, and
a canvas in a dialog loses the scroll, zoom and pan the viewer already
implements.

**A preview must contain the whole editing surface, not just the canvas.**
The overlay renders `absolute inset-0`, so what it hides is decided entirely
by which ancestor is positioned. Mounted beside the canvas alone it left the
slides toolbar, the notes toolbar and the sheet tab bar live and clickable
underneath a banner reading "Viewing a version" — "Delete slide" and
"Delete sheet" among them, mutating the **live** document with no visible
feedback because the canvas that would have shown the change was behind the
preview.

The rule lives in one module,
`packages/frontend/src/components/history/preview-surface.tsx`, in two
forms, because chrome sits in two different places:

- `PreviewSurface` contains chrome by **covering** it — the box the overlay
  is positioned against. Sheets' tab bar is inside it (under the grid, in
  the same column), and board's toolbar is inside it by virtue of being
  rendered by `BoardView`.
- `EditingChrome` contains chrome by **removing** it — `previewing ? null :
  children`. Slides and notes put their toolbar full-width above the row
  that also holds the right-slot panels, so pulling it into the covered box
  would narrow it by the panel's 288px whenever one is open: a layout
  regression for every user, and a divergence from Google Slides, where side
  panels start below a full-width toolbar.

Both are driven by one `previewing` expression per editor, so they cannot
disagree — a preview painted over a toolbar that was never removed is the
original bug. Not rendering is strictly stronger than disabling (no control
to click, focus, or reach with a screen reader) and costs only the toolbar's
own transient state; the view inside `PreviewSurface` stays mounted and
attached throughout. It also matches Google Docs, where opening a version
replaces the editing surface.

The version-history panel deliberately stays outside both, so a user can
still reach the next version rather than being left with only "Back to
current version".

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

Four asks, in `yorkie-team/yorkie`. The fourth is done; the first is the
only one that still constrains a deployment:

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
4. ~~**Fix `YSON.parse`**~~ — **done, shipped in `@yorkie-js/sdk@0.7.19`**
   ([yorkie-team/yorkie#1966](https://github.com/yorkie-team/yorkie/issues/1966)).
   `preprocessYSON`'s regex chain had two independent defects: its patterns
   bottomed out at three nested levels per type, and they were not
   string-aware, counting `{}`/`[]` inside string *values* as structure. It
   was replaced with the single-pass string-aware scanner this ask asked
   for, not a deeper regex. This had blocked docs preview entirely and made
   some note previews content-dependent (§4); both are resolved.

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
| 1 | wafflebase | History panel: list / name / restore + safety revision, all five types, shipped behind a now-removed client flag; register the three gateable webhook methods; backend README + this doc |
| 2 | wafflebase | Preview for sheets, slides, board and notes |
| 3 | yorkie | `YSON.parse` tokenizer (upstream ask 4) — **shipped in 0.7.19** |
| 4 | wafflebase | Bump to 0.7.19; docs preview: move the tree read path into `@wafflebase/docs` (`docsTreeToDocument`, shared with the backend's `readDocsRoot`), normalize the snapshot node dialect, mount it |
| 5 | wafflebase | Retention handling and polish |
| — | wafflebase | Remove `VITE_WB_REVISION_HISTORY`: the flag's premise (RPCs ungateable without upstream) was false, and it never protected share-link viewers either (structural, §2). The deployment gate (registration + enforcement) is now the only gate — see §2 |

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
`packages/backend/README.md` carries the exact command. With no client-side
flag left to trail behind (§2), this precondition must be satisfied *before
or with* the deploy that ships the frontend, not after it. `CreateRevision`
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
depend on it for every preview. *Mitigation*: upstream ask 4 replaced it
with a tokenizer in 0.7.19, which is what this risk asked for. Before that
docs preview was out and the other four types
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
