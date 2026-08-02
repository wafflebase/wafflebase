---
title: docs-comments
target-version: 0.5.0
---

# Docs Comments

## Summary

Bring Google-Docs-style threaded comments to the Docs editor: a user selects
a text range, leaves a comment, and other collaborators see a yellow
highlight, a popover with the thread, and the thread in a right-side panel.
Comments survive concurrent text edits via Yorkie Tree's CRDT-stable
position ranges, and remain visible as "orphaned" cards in the side panel
when their anchor text is fully deleted.

The work introduces a **shared frontend module** at
`packages/frontend/src/components/comments/` that owns the comment anchor
union, pure helpers, the `CommentStore` interface, and the framework UI
(composer, side panel, thread card, orphaned card). The base data model
(`Comment`, `CommentAuthor`, and the generic `Thread<A>`) is owned by
`@wafflebase/sheets` — the lowest package in the dependency graph — and
re-exported through `@/types/comments.ts`; `components/comments/types.ts`
is a re-export shim, and the anchor union itself lives in
`@/types/comments.ts`. The domain packages (`packages/docs`,
`packages/sheets`) **stay comment-naive** — they expose small render-time
hooks (e.g., `editor.setCommentMarkers(markers)` analogous to
`setSearchMatches`) and know nothing about Threads.

Docs comments ship end-to-end. Sheets, which had a pre-existing comments
implementation, now shares this module's UI (composer, side panel, thread
card) while keeping its own Yorkie store, and a PDF-region comment
consumer (`app/files/comments/`) has also shipped. `@user` mentions are
implemented across the composer and rendered bodies; in-app / email
notifications and slides comments remain future work.

## Goals / Non-Goals

### Goals

- Threaded comments anchored to a **text range** in any block, including
  blocks inside (nested) table cells.
- Anchor stability under concurrent edits via Yorkie Tree CRDT positions
  (`TreePosStructRange`).
- Orphan preservation: when anchored text is fully deleted, the thread
  stays in the document and is presented as a quoted card in the side panel.
- Thread lifecycle: open → resolved → reopen, performed by any
  collaborator.
- Comment lifecycle: edit / delete by author only.
- Five UI surfaces: in-canvas yellow highlight, range-click popover, side
  panel ("Open" / "Resolved" tabs with an "Orphaned" sub-section under
  "Open"), composer entry points (right-click menu, toolbar, `Cmd/Ctrl+Alt+M`),
  and side-panel-to-anchor navigation.
- Plain-text body with newlines.
- Real-time sync via the existing Yorkie pipeline.
- Read-only access for unauthenticated viewers (markers + popover render;
  composer disabled).
- A **shared `packages/frontend/src/components/comments/` module** that is
  anchor-generic and built to be reused by sheets (migration follow-up) and
  slides (later) without further redesign.

### Non-Goals

- Reworking the existing sheets comments implementation. Sheets now shares
  this module's UI while keeping its own Yorkie store, and the base
  `Comment`/`CommentAuthor`/`Thread<A>` types live in `@wafflebase/sheets`
  and are re-exported here.
- Changes to `packages/docs` beyond a thin marker-rendering hook on the
  editor. Comment types, store, and React UI live in `packages/frontend`.
- Slides comments (a future consumer of the shared module).
- Notifications (in-app / email) for `@user` mentions. Mentions themselves
  are implemented (see `components/comments/mentions.ts`); only the
  notification delivery remains future work.
- Rich-text body (bold, italics, links). Plain text + newlines only.
- Block-only or document-wide anchors. A range covering a whole block is
  expressed as a range, not a separate anchor kind.
- Email / external notifications.
- Comment search.
- Per-user read/unread state.

## Proposal Details

### 1. Module Layout

The shared module is anchor-generic and consumed by docs, sheets (UI), and
PDF today.

```text
packages/frontend/src/components/comments/        NEW — shared, anchor-generic
├── types.ts            # re-export shim over @/types/comments.ts (below);
│                       #   Comment/CommentAuthor/Thread<A> are re-exported
│                       #   from @wafflebase/sheets
├── mentions.ts         # @user mention encode/parse/query/apply helpers
├── thread.ts            # pure helpers — create / validate / mutate
├── comment-store.ts     # CommentStore<A, AnchorInput = A> interface (7 methods)
├── mem-comment-store.ts # in-memory implementation for tests / dev

packages/frontend/src/types/comments.ts           the actual type home
├── CommentAnchor = sheet-cell | docs-range | pdf-region
│                   (base Comment/CommentAuthor/Thread<A> from @wafflebase/sheets)
├── components/
│   ├── CommentComposer.tsx      # author avatar + textarea + cancel/submit
│   ├── CommentThreadCard.tsx    # one thread render (popover + side panel reuse)
│   ├── CommentSidePanel.tsx     # tabs, list, "Orphaned" sub-section
│   │                            # (row renderer is a prop for feature-specific labels)
│   └── OrphanedCard.tsx         # gray quotedText card
└── __tests__/

packages/frontend/src/app/docs/comments/          docs glue
├── docs-anchor.ts               # DocSelection ↔ posRange,
│                                #   extractAnchorContext, resolveAnchor
├── yorkie-comment-store.ts      # implements CommentStore<DocsRangeAnchor>
│                                #   against root.comments on the docs Yorkie document
├── decorations.ts               # thread[] → CommentMarker[] (computeCommentMarkers)
├── DocsCommentPopover.tsx       # docs-specific positioning
└── docs-comments-controller.ts  # wires store ↔ editor ↔ React state

packages/docs/src/view/editor.ts                  MODIFY (small)
└── setCommentMarkers(markers: CommentMarker[]): void
    Add a setter analogous to setSearchMatches. The editor computes the
    yellow background + 1px underline rects from each marker's range; it
    does not know they are comments.

packages/frontend/src/app/docs/docs-view.tsx      MODIFY
└── instantiate YorkieCommentStore (sharing the Yorkie Document with
    YorkieDocStore); mount CommentSidePanel; bind controller; wire entry
    points (context menu, toolbar, Cmd+Alt+M, side panel toggle).
```

A PDF-region consumer ships alongside docs under
`packages/frontend/src/app/files/comments/` (`pdf-comment-store.ts`,
`pdf-comments-controller.ts`), following the same store-per-consumer shape.

**Boundary rules:**

- `packages/frontend/src/components/comments/` has **no** Yorkie import. It
  consumes a `CommentStore<A>` and emits store calls. It is pure
  React + the in-memory store helper.
- `packages/frontend/src/app/docs/comments/` is the only place
  Yorkie-specific docs code lives. It implements the store interface and
  converts threads to canvas rects.
- `packages/docs` knows nothing about comments. The single new editor
  setter is named `setCommentMarkers` for clarity but its contract is
  agnostic ("draw these yellow highlight rects until I clear them").
- `packages/sheets` owns the base `Comment`/`CommentAuthor`/`Thread<A>`
  types (re-exported by the frontend) but has no docs-specific code.

### 2. Data Model

`Comment`, `CommentAuthor`, and the generic `Thread<A>` are declared in
`@wafflebase/sheets` (`packages/sheets/src/comment/types.ts`) and
re-exported from `@/types/comments.ts`, which owns the anchor union:

```typescript
// packages/frontend/src/types/comments.ts

import type { TreePosStructRange } from '@yorkie-js/sdk';
// Comment / CommentAuthor / the base Thread<A> are owned by @wafflebase/sheets.
import type { Thread as BaseThread } from '@wafflebase/sheets';
export type { Comment, CommentAuthor } from '@wafflebase/sheets';

export type CommentAnchor =
  | { kind: 'sheet-cell'; tabId: string; rowId: string; colId: string }
  | {
      kind: 'docs-range';
      /** Block id of the first character of the range at creation time.
       *  Stale after structural edits — UI hint only, not authoritative. */
      blockId: string;
      /** Yorkie Tree CRDT-stable position range. Authoritative current
       *  location; resolved live via tree.posRangeToPathRange. */
      posRange: TreePosStructRange;
      /** Snapshot of anchored text at creation, capped (~240 chars + ellipsis).
       *  Used by the "Orphaned" side-panel card when posRange no longer
       *  resolves. */
      quotedText: string;
    }
  | {
      kind: 'pdf-region';
      /** Page-index + [0,1] page-relative rect. Static coordinates, so a
       *  PDF anchor never orphans except when pageIndex is out of range. */
      pageIndex: number;
      rect: { x: number; y: number; w: number; h: number };
    };
  // future: { kind: 'slide-element'; slideId: string; elementId: string };

// From @wafflebase/sheets, generic over the anchor:
//   Comment { id, author, body, createdAt, editedAt? }
//   Thread<A> { id, anchor: A, comments: Comment[], resolved,
//               resolvedAt?, resolvedBy?, createdAt }
export type Thread<A extends CommentAnchor = CommentAnchor> = BaseThread<A>;
```

The discriminated `CommentAnchor` carries the `sheet-cell` variant (shared
with the sheets store) and the shipped `pdf-region` variant alongside
`docs-range`, so all three consumers reuse the same anchor-generic helpers
and UI.

`TreePosStructRange` is imported from `@yorkie-js/sdk` — a plain
JSON-serializable struct. The dependency is intentional and contained to
this one field; owning a hand-rolled duplicate type would be more fragile.

**Orphan state is computed, not stored.** A docs-range thread is "orphan"
when `tree.posRangeToPathRange(anchor.posRange)` either throws or returns
a path shorter than `[blockIdx, inlineIdx, charOffset]` (the SDK collapses
both endpoints onto a deleted node's tomb and yields a 1-level path).
Storing `orphaned: true` would invite divergent transitions between
clients; lazy resolution at read time keeps a single source of truth.

#### Invariants

| Invariant                                                     | Where enforced               |
| ------------------------------------------------------------- | ---------------------------- |
| `comments.length >= 1` for any persisted thread               | `addThread`, `deleteComment` |
| Body is non-empty after trim                                  | `addThread`, `addReply`, `editComment` |
| `editedAt > createdAt` whenever set                           | `editComment`                |
| `resolved=true` ⇒ `resolvedAt` and `resolvedBy` are set       | `setThreadResolved`          |
| Deleting `comments[0]` deletes the whole thread               | `deleteComment`              |
| `quotedText` is captured at `addThread` and never mutated     | `addThread`                  |

### 3. `CommentStore<A>` Interface

A single anchor-generic interface, implemented per consumer.

`AnchorInput` is what the caller passes to `addThread`; `A` is what is
persisted. They coincide for sheets (its stored `sheet-cell` anchor) but
differ for docs, which passes path endpoints the Yorkie store converts into
a CRDT-stable `posRange` inside the same `doc.update()`.

```typescript
// packages/frontend/src/components/comments/comment-store.ts
export interface CommentStore<
  A extends CommentAnchor = CommentAnchor,
  AnchorInput = A,
> {
  addThread(input: AnchorInput, body: string, author: CommentAuthor): Promise<Thread<A>>;
  addReply(threadId: string, body: string, author: CommentAuthor): Promise<Comment>;
  editComment(threadId: string, commentId: string, body: string): Promise<void>;
  deleteComment(threadId: string, commentId: string): Promise<void>;
  setThreadResolved(
    threadId: string,
    resolved: boolean,
    by: CommentAuthor,
  ): Promise<void>;

  /** Read threads. Filter by resolved state; anchor-based filtering happens
   *  in the UI because anchor resolution is a live tree operation. */
  listThreads(opts?: { resolved?: boolean }): Promise<Thread<A>[]>;

  /** Subscribe to thread-set changes (add/remove/edit) from both local and
   *  remote sources. Returns unsubscribe. */
  subscribe(cb: () => void): () => void;
}
```

Shipped implementations:

- `MemCommentStore<A>` — in-memory map, used by Vitest tests and `MemDocStore`
  fixtures.
- `YorkieCommentStore` (docs) — reads/writes `root.comments` on the same
  `yorkie.Document` as `YorkieDocStore`. `addThread` runs inside a single
  `doc.update()` so the snapshot is consistent.
- PDF store (`app/files/comments/pdf-comment-store.ts`) — persists
  `pdf-region` threads against the `pdf-<id>` Yorkie document.
- Sheets keeps its own store on `worksheet.comments` (per-tab) and adopts
  the shared UI.

Future implementations:

- `YorkieCommentStore` (slides) — reads/writes `slide.comments` or a top-level
  map keyed by slide id (decided when slides comments lands).

### 4. Yorkie Schema (Docs)

The Docs Yorkie document already mixes a `Tree` and several JSON fields
(`root.content`, `root.pageSetup`, `root.stylesJson`). One more optional
JSON field is added (see `packages/frontend/src/types/docs-document.ts`):

```typescript
type YorkieDocsRoot = {
  content: yorkie.Tree;
  pageSetup?: PageSetup;
  stylesJson?: string;
  comments?: { [threadId: string]: Thread<DocsRangeAnchor> };   // NEW
};
```

Threads are keyed by their own `id`, not by `blockId`, because multiple
threads can overlap on the same range. The anchor lives inside the thread.

New documents seed `comments: {}` at bootstrap inside
`initialDocsRoot()` (alongside the `content` Tree), so every replica
shares one container CRDT from creation. This is required for
convergence: Yorkie resolves concurrent assignment of the same object
key by LWW, so if two users created the container concurrently (the
lazy `if (!root.comments) root.comments = {}` path) one map — and its
thread — would be discarded wholesale. Seeding at bootstrap means
concurrent inserts only set distinct keys, which merge.

The field stays optional so existing documents need no migration: the
lazy guard remains as a fallback for legacy docs created before the
seeding. On those, two users adding the *first-ever* comment
concurrently can still race to create the container; the window is a
single document's first concurrent comment and self-heals after one
sync.

**Comments are intentionally outside the `Tree`.** Two alternatives were
considered:

| Option                                          | Pros                                | Cons |
| ----------------------------------------------- | ----------------------------------- | ---- |
| `<comment>` element nodes inside the Tree       | Anchor moves automatic              | Multi-block ranges awkward; serialization coupling; no clean home for orphans |
| Per-block `comments` attribute                  | Co-located with block               | Multi-block ranges impossible; orphan threads vanish when block is deleted |
| **Top-level `root.comments` JSON map (chosen)** | Multi-block ranges OK; orphans keep a home; clean store API | One new JSON field; relies on `TreePosStructRange` for stability |

#### Concurrency semantics

| Scenario                                                  | Yorkie behavior                          | Outcome |
| --------------------------------------------------------- | ---------------------------------------- | ------- |
| Two users add a thread on the same range concurrently     | Different `threadId` keys on the shared, bootstrap-seeded `comments` container | Both preserved (see container-seeding note above) |
| Two users add a reply to the same thread concurrently     | `Thread.comments[]` array CRDT push       | Both preserved, deterministic order |
| One user edits, another deletes the same comment          | Delete wins (parent removal)              | Comment lost (Google parity) |
| Two users resolve the same thread concurrently            | LWW on `resolved`                         | Final state consistent |
| One user deletes anchored text, another edits a comment   | Tree edit + JSON edit independent         | Comment survives; client renders orphan card on next read |
| Anchor text partially deleted                             | Yorkie shrinks `posRange` automatically   | Marker tracks surviving characters |
| Anchored block fully deleted                              | Both endpoints collapse onto deleted node | `posRangeToPathRange` returns a 1-level path → orphan |
| Range spans two blocks, only one deleted                  | One endpoint survives; Yorkie stitches    | Marker covers the surviving portion |

`Thread.comments: Comment[]` is a Yorkie array CRDT, so concurrent replies
merge correctly.

### 5. Anchor Stability and Orphan Handling

This is the principal docs-specific concern.

#### Creation flow

```typescript
// packages/frontend/src/app/docs/comments/yorkie-comment-store.ts
async addThread(
  anchor: PendingDocsAnchor,  // { startPath, endPath } from the editor selection
  body: string,
  author: CommentAuthor,
): Promise<Thread<DocsRangeAnchor>> {
  return this.doc.update((root) => {
    const tree = root.content;
    const posRange = tree.pathRangeToPosRange([anchor.startPath, anchor.endPath]);
    const { blockId, quotedText } = extractAnchorContext(
      tree, anchor.startPath, anchor.endPath,
    );

    const thread: Thread<DocsRangeAnchor> = {
      id: uuidv4(),
      anchor: { kind: 'docs-range', blockId, posRange, quotedText },
      comments: [{
        id: uuidv4(),
        author,
        body: body.trim(),
        createdAt: Date.now(),
      }],
      resolved: false,
      createdAt: Date.now(),
    };

    if (!root.comments) root.comments = {};
    root.comments[thread.id] = thread;
    return thread;
  });
}
```

`extractAnchorContext` captures `quotedText` (capped, ellipsized) and
resolves `blockId` from the start path. Both are best-effort hints; the
authoritative location is always `posRange`.

#### Read flow

```typescript
// packages/frontend/src/app/docs/comments/docs-anchor.ts
export function resolveDocsAnchor(
  tree: yorkie.Tree,
  anchor: DocsRangeAnchor,
): { kind: 'live'; startPath: number[]; endPath: number[] }
 | { kind: 'orphan' } {
  try {
    const [startPath, endPath] = tree.posRangeToPathRange(anchor.posRange);
    // A text-level position has 3 components — [blockIdx, inlineIdx, charOffset].
    // The SDK collapses both endpoints to a shorter path (e.g. [blockIdx]) when
    // the anchored block is fully deleted; treat that as orphan.
    if (startPath.length < 3 || endPath.length < 3) return { kind: 'orphan' };
    return { kind: 'live', startPath, endPath };
  } catch {
    return { kind: 'orphan' };
  }
}
```

Every UI surface consumes this single helper:

- `decorations.ts` builds the rect list — orphans contribute nothing, so
  the canvas never knows about them.
- The popover only opens from a `live` highlight click.
- `CommentSidePanel` groups threads as Open / Open-Orphaned / Resolved.

#### Comparison with the existing sheets policy

The sheets implementation auto-deletes threads when their row/column is
removed (same transaction as the structural edit). Docs preserves the
thread because text-level edits are everyday actions and the conversation
around a phrase usually retains value even when the phrase is gone.

| Aspect                | Sheets (row/col deletion)            | Docs (anchor text deletion) |
| --------------------- | ------------------------------------ | --------------------------- |
| Data handling         | same-transaction auto-delete         | preserved verbatim          |
| Undo behavior         | row + thread restored together       | text restored → posRange resolves → marker reappears |
| Side panel display    | disappears entirely                  | "Orphaned" sub-section with `quotedText` quote |
| Explicit confirmation | none                                 | none                        |

When sheets migrates to the shared module, it keeps its current policy
(implemented inside its own `YorkieCommentStore` and structure-edit hooks).
The shared module imposes no orphan policy — each consumer decides.

### 6. Domain Package Surface

This is the small change in `packages/docs`. Nothing else.

```typescript
// packages/docs/src/view/editor.ts (types in packages/docs/src/view/comment-markers.ts)
export interface DocsEditor {
  // ... existing methods, including:
  setSearchMatches(matches: SearchMatch[], activeIndex: number): void;

  // NEW
  /** Draw yellow highlights for each marker until cleared. Comment-naive:
   *  docs does not interpret the ids. Pass [] to clear. */
  setCommentMarkers(markers: CommentMarker[]): void;
}

export interface CommentMarker {
  /** Opaque id the caller uses to map click → thread on the frontend side. */
  id: string;
  anchor: { blockId: string; offset: number };
  focus: { blockId: string; offset: number };
}
```

The editor turns each marker's `anchor`/`focus` range into highlight rects
itself, via the same selection layout used for search matches and peer
cursors, so markers track resize / zoom / line wrap automatically — the
frontend does not pre-compute rects.

A `getCommentMarkerAt(clientX: number, clientY: number): string | null`
helper on the editor lets the controller match a viewport-relative click to
a marker id without re-running geometry (the editor converts to
canvas-internal document coordinates first). When rects overlap at the hit
point, the last-set marker wins (so newer threads take precedence over older
ones at the same spot).

### 7. UI

#### 7.1 Component tree (docs)

```text
DocsView
├── DocsCanvas (DocsEditor)
│   └── (canvas) yellow rects from editor.setCommentMarkers(...)
├── DocsCommentPopover                       — opens on marker click (live only)
└── CommentSidePanel (shared)                — right side, tabs + Orphaned section
    └── CommentComposer (shared)             — also embedded in popover for replies
```

The yellow highlight rects are drawn directly on the existing docs canvas
during its render pass, like search matches and peer selections. The
docs-comments-controller in frontend recomputes the `CommentMarker` list
whenever threads change or the document re-paginates; the editor turns
each marker's range into rects itself.

#### 7.2 Entry points

| Action                   | Trigger                                                                | Result                                                |
| ------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| New comment              | Range selected → right-click "Insert comment" / `Cmd+Alt+M` / toolbar  | Empty composer anchored at selection                  |
| View thread              | Click any highlighted range                                            | Popover with all live threads overlapping that point  |
| Reply                    | "Reply" button inside popover                                          | Inline composer                                       |
| Resolve                  | ✓ button on a thread                                                   | Optimistic UI, then `setThreadResolved(true)`         |
| Reopen                   | "Reopen" button on a resolved thread                                   | `setThreadResolved(false)`                            |
| Side panel toggle        | Toolbar comment icon / `Cmd+Alt+Shift+M`                               | Toggle right-side panel                               |
| View resolved            | "Resolved" tab in side panel                                           | List of `resolved=true` threads                       |
| View orphaned            | "Open" tab → "Orphaned" sub-section                                    | `quotedText` quote, conversation, reply/resolve OK; jump-to disabled |
| Jump to anchor           | Click a live thread row in side panel                                  | Scroll into view + caret to anchor + flash highlight  |

#### 7.3 Marker style

| Property            | Value                                          |
| ------------------- | ---------------------------------------------- |
| Background          | `rgba(251, 188, 4, 0.25)` (Google Docs parity) |
| Underline           | `#fbbc04`, 1px, beneath the affected glyphs    |
| Resolved threads    | Not rendered                                    |
| Orphan threads      | Not rendered (no live range to highlight)       |
| Overlapping threads | Same shading; popover lists every overlapping thread |

#### 7.4 Read-only / unauthenticated users

- Highlights and popover render normally.
- Composer is disabled. Click → toast "Sign in to leave a comment."
- Resolve / reopen / edit / delete buttons hidden.

### 8. Testing Strategy

Tests live under the top-level `packages/frontend/tests/` mirror, not
colocated `__tests__/` folders.

#### 8.1 Unit (Vitest)

```text
packages/frontend/tests/components/comments/
├── thread.test.ts        # thread/comment creation, body validation, root
│                         # delete cascade, edit timestamps, resolve transitions
├── mem-comment-store.test.ts
└── comment-composer-mentions.test.ts   # @user mention picker + body encoding

packages/frontend/tests/app/docs/comments/
├── docs-anchor.test.ts   # selectionToPath, extractAnchorContext, anchor
│                         # resolution under: identical tree, partial deletion,
│                         # full deletion (orphan), block-spanning range with
│                         # one block deleted, undo restoration
└── decorations.test.ts   # thread[] → marker list
```

#### 8.2 Yorkie integration (frontend, e2e)

```text
packages/frontend/tests/app/docs/comments/yorkie-comment-store-concurrent.integration.ts
├── concurrent thread creation on the same range — both preserved
├── concurrent replies — both preserved, deterministic order
├── partial deletion of anchor text — posRange shrinks, marker follows
├── full deletion of anchor text — orphan path triggered
├── block-spanning anchor, one block deleted — marker covers remainder
├── concurrent resolve — final state consistent (LWW)
└── undo of anchor text deletion — posRange revives, marker returns
```

#### 8.3 Visual / interaction (browser harness)

No dedicated docs-comments browser harness spec ships today (there is no
`packages/frontend/visual/` directory). The behaviors below — composer
entry, highlight render across line wraps, popover positioning, overlapping
threads, side-panel tab counts, orphan cards, and jump-to-anchor — are
covered by the unit and Yorkie integration suites above; a browser spec
remains a future addition.

#### 8.4 Verify lanes

- `pnpm verify:fast` — unit.
- `pnpm verify:full` — Yorkie integration (needs `docker compose up -d`).

### 9. Phase Plan

The steps are PR-sized and independently mergeable.

| Step | Status | Scope                                                                                                                   | Files touched                                                                  |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1    | Shipped | Shared module + docs comments end-to-end.                                                                              | `components/comments/`, `app/docs/comments/`, `packages/docs/src/view/editor.ts` |
| 2    | Shipped (UI) | Sheets shares the module's UI (composer / side panel / thread card) while keeping its own Yorkie store; the base `Comment`/`Thread` types now live in `@wafflebase/sheets`. | sheets package + `app/spreadsheet/comments/`                        |
| —    | Shipped | PDF-region comments — `pdf-region` anchor variant + `app/files/comments/` store & controller.                          | shared `types.ts`, `app/files/comments/`                                       |
| 3    | Future | Slides comments. Adds the `slide-element` anchor variant and `app/slides/comments/`.                                    | shared `types.ts`, new `app/slides/comments/`, small slides editor hook       |
| 4    | Partial | `@user` mentions are shipped (composer picker + `@[username](userId)` body tokens rendered in threads). In-app / email notifications remain future work. | shared `components/comments/mentions.ts`; notification job (backend) unbuilt |

Rather than deleting `packages/sheets/src/comment/`, the sheets migration
promoted it to the *canonical home* of the base `Comment`/`CommentAuthor`/
`Thread<A>` types: the frontend re-exports them so the sheets store and the
shared type are literally the same declaration. Sheets adopted the shared
UI (composer / side panel / thread card) while retaining its own Yorkie
store and orphan policy.

## Risks and Mitigation

| Risk                                                                                                  | Mitigation                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `TreePosStructRange` is an SDK type; future SDK upgrades may change its shape                          | Direct import from `@yorkie-js/sdk`. An SDK bump that changes the struct triggers a one-time migration of stored values; covered by integration tests on upgrade. |
| Lazy orphan resolution hides a programming error from the data layer                                   | Integration tests assert posRange behavior across partial/full deletes; orphan resolution is centralized in `resolveDocsAnchor` for easy instrumentation.        |
| Highlight rendering cost on large documents                                                            | Rect draw is O(threads on visible blocks); reuses line metrics already computed by `paginateLayout`. No extra layout pass.              |
| Sheets migration in step 2 silently changes sheets behavior                                            | Step 2 is refactor-only with no UX delta; sheets's existing unit, integration, and visual suites run unchanged.                          |
| Slides anchor needs differ from `docs-range` and don't fit the union cleanly                            | The discriminated union is the extension point; adding a `slide-element` variant is a new entry, not a redesign of existing variants.    |
| Component sharing (composer / side panel) breaks under sheets and slides specifics                     | Component props expose feature-specific bits (row renderer, popover positioner). Each consumer wires its own positioner; only the cell/range/element-agnostic body is shared. |
| Read-only / anonymous viewer authorization                                                             | Yorkie backend enforces read-only for anonymous sessions; this design adds no new permission surface beyond store-level write rejection on the server. |
