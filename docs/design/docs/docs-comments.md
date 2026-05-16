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
`packages/frontend/src/components/comments/` that owns the comment data
model, pure helpers, the `CommentStore` interface, and the framework UI
(composer, side panel, thread card, orphaned card). The domain packages
(`packages/docs`, `packages/sheets`) **stay comment-naive** — they expose
small render-time hooks (e.g., `editor.setCommentMarkers(rects)` analogous
to `setSearchMatches`) and know nothing about Threads.

This PR delivers docs comments end-to-end. Sheets has a pre-existing
comments implementation (different layout, inside `packages/sheets`); it
keeps working unchanged in this PR and migrates to the shared module in a
follow-up PR. Slides comments and mentions/notifications follow after that.

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

- Changes to `packages/sheets` or the existing sheets comments
  implementation. Sheets migrates in a follow-up PR.
- Changes to `packages/docs` beyond a thin marker-rendering hook on the
  editor. Comment types, store, and React UI live in `packages/frontend`.
- Slides comments (third consumer of the shared module — follow-up PR).
- `@user` mentions and notifications (later phase, across all consumers).
- Rich-text body (bold, italics, links). Plain text + newlines only.
- Block-only or document-wide anchors. A range covering a whole block is
  expressed as a range, not a separate anchor kind.
- Email / external notifications.
- Comment search.
- Per-user read/unread state.

## Proposal Details

### 1. Module Layout

This PR is a single mergeable unit. Sheets is untouched.

```
packages/frontend/src/components/comments/        NEW — shared, anchor-generic
├── types.ts
│   ├── CommentAuthor
│   ├── Comment
│   ├── Thread<A extends CommentAnchor = CommentAnchor>
│   └── CommentAnchor = sheet-cell | docs-range
│                       (+ slide-element placeholder, no implementation yet)
├── thread.ts            # pure helpers — create / validate / mutate
├── comment-store.ts     # CommentStore<A> interface (6 methods)
├── mem-comment-store.ts # in-memory implementation for tests / dev
├── components/
│   ├── CommentComposer.tsx      # author avatar + textarea + cancel/submit
│   ├── CommentThreadCard.tsx    # one thread render (popover + side panel reuse)
│   ├── CommentSidePanel.tsx     # tabs, list, "Orphaned" sub-section
│   │                            # (row renderer is a prop for feature-specific labels)
│   └── OrphanedCard.tsx         # gray quotedText card
└── __tests__/

packages/frontend/src/app/docs/comments/          NEW — docs glue (the only consumer in this PR)
├── docs-anchor.ts               # DocSelection ↔ posRange,
│                                #   extractAnchorContext, resolveAnchor
├── yorkie-comment-store.ts      # implements CommentStore<DocsRangeAnchor>
│                                #   against root.comments on the docs Yorkie document
├── decorations.ts               # thread[] → HighlightRect[]
│                                #   (computeSelectionRects reuse from docs/view)
├── DocsCommentPopover.tsx       # docs-specific positioning
└── docs-comments-controller.ts  # wires store ↔ editor ↔ React state

packages/docs/src/view/editor.ts                  MODIFY (small)
└── setCommentMarkers(rects: HighlightRect[]): void
    Add a setter analogous to setSearchMatches. The editor draws yellow
    background + 1px underline rects; it does not know they are comments.

packages/frontend/src/app/docs/docs-view.tsx      MODIFY
└── instantiate YorkieCommentStore (sharing the Yorkie Document with
    YorkieDocStore); mount CommentSidePanel; bind controller; wire entry
    points (context menu, toolbar, Cmd+Alt+M, side panel toggle).

packages/frontend/visual/docs-comments.spec.ts    NEW
```

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
- `packages/sheets` is **not** touched.

### 2. Data Model

```typescript
// packages/frontend/src/components/comments/types.ts

import type { TreePosStructRange } from '@yorkie-js/sdk';

export type CommentAuthor = {
  userId: string;
  username: string;
  photo?: string;
};

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
    };
  // future: { kind: 'slide-element'; slideId: string; elementId: string };

export type Comment = {
  id: string;
  author: CommentAuthor;
  body: string;          // plain text, '\n' allowed, non-empty after trim
  createdAt: number;
  editedAt?: number;
};

export type Thread<A extends CommentAnchor = CommentAnchor> = {
  id: string;            // UUID v4
  anchor: A;
  comments: Comment[];   // [0] is root, rest are replies in author order
  resolved: boolean;
  resolvedAt?: number;
  resolvedBy?: CommentAuthor;
  createdAt: number;
};
```

The discriminated `CommentAnchor` includes the `sheet-cell` variant
**now**, even though sheets does not yet consume the shared module. This
locks the schema in advance so the sheets migration PR is a
copy-and-import-path-swap rather than a redesign.

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

```typescript
// packages/frontend/src/components/comments/comment-store.ts
export interface CommentStore<A extends CommentAnchor = CommentAnchor> {
  addThread(anchor: A, body: string, author: CommentAuthor): Promise<Thread<A>>;
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

Implementations in this PR:

- `MemCommentStore<A>` — in-memory map, used by Vitest tests and `MemDocStore`
  fixtures.
- `YorkieCommentStore` (docs) — reads/writes `root.comments` on the same
  `yorkie.Document` as `YorkieDocStore`. `addThread` runs inside a single
  `doc.update()` so the snapshot is consistent.

Future implementations (out of scope for this PR):

- `YorkieCommentStore` (sheets) — reads/writes `worksheet.comments` (per-tab),
  replaces the comment methods currently on the sheets `Store` interface.
- `YorkieCommentStore` (slides) — reads/writes `slide.comments` or a top-level
  map keyed by slide id (decided when slides comments lands).

### 4. Yorkie Schema (Docs)

The Docs Yorkie document already mixes a `Tree` and several JSON fields
(`root.content`, `root.pageSetup`, `root.header`, `root.footer`). One more
optional JSON field is added:

```typescript
type DocsDocument = {
  content: yorkie.Tree;
  pageSetup?: PageSetup;
  header?: HeaderFooter;
  footer?: HeaderFooter;
  comments?: { [threadId: string]: Thread<DocsRangeAnchor> };   // NEW
};
```

Threads are keyed by their own `id`, not by `blockId`, because multiple
threads can overlap on the same range. The anchor lives inside the thread.

The optional field means existing documents need no migration — `comments`
materializes on first thread insertion.

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
| Two users add a thread on the same range concurrently     | Different `threadId` keys; both insert    | Both preserved |
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
// packages/docs/src/view/editor.ts
export interface DocsEditor {
  // ... existing methods, including:
  setSearchMatches(matches: SearchMatch[], activeIndex: number): void;

  // NEW
  /** Draw yellow highlight rects until cleared. Comment-naive: docs does
   *  not know what these rects represent. */
  setCommentMarkers(rects: HighlightRect[]): void;
}

export type HighlightRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Opaque id the caller uses to map click → thread on the frontend side. */
  id: string;
};
```

Editor click handling already dispatches by (x, y); the comment controller
in frontend listens for clicks inside reported marker rects and opens its
popover. The editor itself routes only the geometry.

A `getCommentMarkerAt(x: number, y: number): string | null` helper on the
editor lets the controller match a click to a marker id without
re-running geometry. Implementation is O(rects). When rects overlap at the
hit point, the last-set rect wins (so newer threads take precedence over
older ones at the same spot).

### 7. UI

#### 7.1 Component tree (docs)

```
DocsView
├── DocsCanvas (DocsEditor)
│   └── (canvas) yellow rects from editor.setCommentMarkers(...)
├── DocsCommentPopover                       — opens on marker click (live only)
└── CommentSidePanel (shared)                — right side, tabs + Orphaned section
    └── CommentComposer (shared)             — also embedded in popover for replies
```

The yellow highlight rects are drawn directly on the existing docs canvas
during its render pass, like search matches and peer selections. The
docs-comments-controller in frontend computes the rect list whenever
threads change or the document re-paginates.

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

#### 8.1 Unit (Vitest)

```
packages/frontend/src/components/comments/__tests__/
├── thread.test.ts        # thread/comment creation, body validation, root
│                         # delete cascade, edit timestamps, resolve transitions
└── mem-comment-store.test.ts

packages/frontend/src/app/docs/comments/__tests__/
└── docs-anchor.test.ts   # selectionToPath, extractAnchorContext, anchor
                          # resolution under: identical tree, partial deletion,
                          # full deletion (orphan), block-spanning range with
                          # one block deleted, undo restoration
```

#### 8.2 Yorkie integration (frontend, e2e)

```
packages/frontend/src/app/docs/__tests__/comments.test.ts
├── concurrent thread creation on the same range — both preserved
├── concurrent replies — both preserved, deterministic order
├── partial deletion of anchor text — posRange shrinks, marker follows
├── full deletion of anchor text — orphan path triggered
├── block-spanning anchor, one block deleted — marker covers remainder
├── concurrent resolve — final state consistent (LWW)
└── undo of anchor text deletion — posRange revives, marker returns
```

#### 8.3 Visual / interaction (browser harness)

```
packages/frontend/visual/docs-comments.spec.ts
├── range selection + Cmd+Alt+M opens composer focused
├── highlight render across a line wrap (per-line rects)
├── highlight click → popover positioning (flips when near canvas edge)
├── overlapping threads → popover lists both
├── side panel tab counts update on resolve / reopen
├── "Orphaned" sub-section renders quotedText, jump-to disabled
└── side panel thread click → scroll + caret + flash highlight
```

#### 8.4 Verify lanes

- `pnpm verify:fast` — unit.
- `pnpm verify:full` — Yorkie integration (needs `docker compose up -d`).
- `pnpm verify:browser:docker` — visual.

### 9. Phase Plan

The four steps are PR-sized and independently mergeable.

| Step | Scope                                                                                                                   | Files touched                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **1 — this PR** | Shared module + docs comments end-to-end. Sheets unchanged.                                                  | new `components/comments/`, new `app/docs/comments/`, small `packages/docs/src/view/editor.ts` |
| 2    | Sheets migrates to the shared module. UX unchanged. `packages/sheets/src/comment/*` removed; `Store` loses the 6 comment methods; new `app/spreadsheet/comments/` mirrors `app/docs/comments/`. | sheets package + `app/spreadsheet/comments/`                                  |
| 3    | Slides comments. Third consumer of the shared module. Adds the `slide-element` anchor variant and `app/slides/comments/`. | shared `types.ts`, new `app/slides/comments/`, small slides editor hook       |
| 4    | `@user` mentions + notifications (in-app + email) across all three consumers. Composer gains mention picker; Thread/Comment gain `mentionedUserIds`; backend gains notification job. | shared `components/comments/`, backend                                         |

After step 2, the `packages/sheets/src/comment/` folder is gone and the
shared module is the single source of truth. The Sheets migration is
mechanical: data shapes already match (the schema was locked in step 1),
so it amounts to changing imports, moving Yorkie store code, and deleting
the old marker renderer.

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
