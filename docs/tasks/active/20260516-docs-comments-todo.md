# Docs Comments — v1 (text-range threads, shared frontend module)

**Goal:** Bring Google-Docs-style threaded comments to the Docs editor.
Users select a text range, leave a comment, see a yellow highlight,
popover, and right-side panel. Anchor stability via Yorkie Tree
`TreePosStructRange`. Threads survive concurrent edits; when anchor
text is fully deleted, the thread appears as an "Orphaned" card.

This PR also stands up the **shared frontend comments module** at
`packages/frontend/src/components/comments/`, with an anchor-generic
`CommentStore<A>` interface that the existing sheets implementation
will migrate to in a follow-up PR, and that slides comments will plug
into later.

**Design doc:** [docs-comments.md](../../design/docs/docs-comments.md)

**Architecture:**

- `packages/docs` stays comment-naive. The only change is a small
  `editor.setCommentMarkers(rects)` setter, analogous to
  `setSearchMatches` — the editor draws rects without knowing they
  represent comments.
- `packages/sheets` is **not** touched in this PR.
- All comment code lives in `packages/frontend`:
  - `src/components/comments/` — shared types, helpers, store
    interface, in-memory store, React UI (composer / side panel /
    thread card / orphaned card).
  - `src/app/docs/comments/` — docs-specific glue: anchor helpers,
    Yorkie store implementation, decoration computation, popover,
    controller.

**Tech stack:** TS, Vitest, Yorkie Tree (`pathRangeToPosRange` /
`posRangeToPathRange` / `TreePosStructRange`), React 19, existing
docs canvas pipeline.

---

## Task 1 — Shared module: types + helpers + in-memory store

**Files:**

- Create: `packages/frontend/src/components/comments/types.ts`
- Create: `packages/frontend/src/components/comments/thread.ts`
- Create: `packages/frontend/src/components/comments/comment-store.ts`
- Create: `packages/frontend/src/components/comments/mem-comment-store.ts`
- Create: `packages/frontend/src/components/comments/__tests__/thread.test.ts`
- Create: `packages/frontend/src/components/comments/__tests__/mem-comment-store.test.ts`

Define the anchor-generic data model and a pure in-memory store. No
React, no Yorkie.

- [ ] **1.1** Write failing tests in `thread.test.ts`:
  - `createThread` rejects empty body (after trim)
  - `createThread` accepts newlines in body
  - `appendReply` rejects empty body
  - `editComment` sets `editedAt > createdAt`
  - `deleteComment` on `comments[0]` returns `null` (thread cascades)
  - `setResolved(true)` requires `resolvedBy` + sets `resolvedAt`
  - `setResolved(false)` clears `resolvedAt` and `resolvedBy`
- [ ] **1.2** Write failing tests in `mem-comment-store.test.ts`:
  - `addThread` returns the persisted thread; `listThreads()` includes it
  - `addReply` appends to `comments[]`
  - `editComment` updates body + `editedAt`
  - `deleteComment` of root removes thread; non-root keeps thread
  - `setThreadResolved(true)` then `listThreads({resolved: true})` lists it
  - `subscribe` fires on every mutation; returns working unsubscribe
- [ ] **1.3** Implement `types.ts` — `CommentAuthor`, `Comment`,
  `Thread<A>`, `CommentAnchor` union with **both** `sheet-cell` and
  `docs-range` variants (schema locked for sheets migration follow-up).
- [ ] **1.4** Implement `thread.ts` pure helpers.
- [ ] **1.5** Implement `comment-store.ts` interface.
- [ ] **1.6** Implement `mem-comment-store.ts`.
- [ ] **1.7** Tests pass. `pnpm verify:fast` green.

---

## Task 2 — Docs anchor helpers (Yorkie position translation)

**Files:**

- Create: `packages/frontend/src/app/docs/comments/docs-anchor.ts`
- Create: `packages/frontend/src/app/docs/comments/__tests__/docs-anchor.test.ts`

The anchor stability layer. Pure functions over a `yorkie.Tree`.

- [ ] **2.1** Write failing tests for:
  - `selectionToPath` — converts `DocSelection` (block id + offset) to
    Yorkie path `[blockIdx, inlineIdx, charOffset]`
  - `extractAnchorContext` — returns `{blockId, quotedText}` capped at
    240 chars + ellipsis; multi-block range uses start block's id
  - `resolveDocsAnchor` returns `{kind: 'live', startPath, endPath}`
    when posRange resolves
  - `resolveDocsAnchor` returns `{kind: 'orphan'}` when both endpoints
    reference deleted nodes (mock `posRangeToPathRange` to throw)
  - Round-trip: build posRange from a selection, resolve it back —
    paths match
- [ ] **2.2** Implement `docs-anchor.ts`.
- [ ] **2.3** Tests pass. `pnpm verify:fast` green.

---

## Task 3 — Yorkie comment store for docs

**Files:**

- Create: `packages/frontend/src/app/docs/comments/yorkie-comment-store.ts`
- Create: `packages/frontend/src/app/docs/__tests__/comments.test.ts`

Implement `CommentStore<DocsRangeAnchor>` against `root.comments` on the
docs Yorkie document. Shares the `yorkie.Document` handle with the
existing `YorkieDocStore` so `addThread` can run inside a single
`doc.update()` that also reads the tree.

- [ ] **3.1** Write failing Yorkie integration tests in `comments.test.ts`:
  - Concurrent thread creation on the same range — both preserved
  - Concurrent replies — both preserved, deterministic order
  - Partial deletion of anchor text — posRange shrinks, resolve still
    returns `live`
  - Full deletion of anchor text — resolve returns `orphan`
  - Block-spanning anchor, one block deleted — resolve returns `live`
    with the surviving portion
  - Concurrent `setThreadResolved` — final state consistent
  - Undo of anchor text deletion — resolve returns `live` again
- [ ] **3.2** Implement `yorkie-comment-store.ts`. Use the same Yorkie
  doc handle that `YorkieDocStore` already exposes.
- [ ] **3.3** Wire `subscribe` to Yorkie change events filtered to
  `root.comments`.
- [ ] **3.4** Tests pass. `pnpm verify:full` green (needs
  `docker compose up -d`).

---

## Task 4 — Docs editor: `setCommentMarkers` setter

**Files:**

- Modify: `packages/docs/src/view/editor.ts`
- Modify: `packages/docs/src/view/doc-canvas.ts` (or wherever the
  render pass lives)
- Create: `packages/docs/src/view/__tests__/comment-markers.test.ts`

Small, comment-naive change to the docs package. Modeled directly on
`setSearchMatches`.

- [ ] **4.1** Add `HighlightRect` type (id + x/y/w/h) and
  `setCommentMarkers(rects)` / `getCommentMarkerAt(x, y)` to the
  `DocsEditor` interface.
- [ ] **4.2** Write failing tests:
  - `setCommentMarkers([])` clears any prior set
  - `getCommentMarkerAt` returns the id of an overlapping rect, or `null`
- [ ] **4.3** Wire the rect list through the canvas render pass —
  yellow background + 1px underline, drawn between block backgrounds
  and the inline text (same z-order as search highlights).
- [ ] **4.4** Tests pass. `pnpm verify:fast` green.

---

## Task 5 — Decoration computation

**Files:**

- Create: `packages/frontend/src/app/docs/comments/decorations.ts`
- Create: `packages/frontend/src/app/docs/comments/__tests__/decorations.test.ts`

Convert a thread list + current tree state into `HighlightRect[]` ready
for the editor.

- [ ] **5.1** Write failing tests for:
  - Live anchor on a single line → one rect
  - Live anchor across a line wrap → multiple rects (one per visual line)
  - Live anchor across a page break → rects partitioned correctly
  - Resolved thread → contributes no rect
  - Orphan thread → contributes no rect
  - Two overlapping live threads → distinct rects with distinct ids
- [ ] **5.2** Implement `decorations.ts` using the existing
  `computeSelectionRects` helper from `packages/docs/src/view/`.
- [ ] **5.3** Tests pass.

---

## Task 6 — Shared React components

**Files:**

- Create: `packages/frontend/src/components/comments/components/CommentComposer.tsx`
- Create: `packages/frontend/src/components/comments/components/CommentThreadCard.tsx`
- Create: `packages/frontend/src/components/comments/components/CommentSidePanel.tsx`
- Create: `packages/frontend/src/components/comments/components/OrphanedCard.tsx`

Feature-agnostic UI. Takes a `CommentStore<A>` plus a feature-specific
row-renderer prop.

- [ ] **6.1** `CommentComposer` — author avatar, textarea (newlines
  allowed), cancel/submit, disabled in read-only mode.
- [ ] **6.2** `CommentThreadCard` — root comment + replies, edit/delete
  visible only to author, resolve/reopen visible to everyone signed in.
- [ ] **6.3** `CommentSidePanel` — "Open" tab (live + "Orphaned"
  sub-section) and "Resolved" tab; row renderer is a prop so each
  consumer labels rows their own way.
- [ ] **6.4** `OrphanedCard` — gray box quoting `anchor.quotedText`,
  jump-to disabled.
- [ ] **6.5** Light unit tests for visibility logic (read-only,
  author-only buttons).

---

## Task 7 — Docs popover + controller (the docs-specific UI layer)

**Files:**

- Create: `packages/frontend/src/app/docs/comments/DocsCommentPopover.tsx`
- Create: `packages/frontend/src/app/docs/comments/docs-comments-controller.ts`
- Modify: `packages/frontend/src/app/docs/docs-view.tsx`

Wire the store, decorations, editor setter, and React components
together.

- [ ] **7.1** `DocsCommentPopover` — positions itself near the clicked
  marker; falls back to flipped position when near the canvas edge.
  Re-uses `CommentThreadCard` and `CommentComposer`.
- [ ] **7.2** `docs-comments-controller.ts` — subscribes to
  `CommentStore.subscribe()`, recomputes rects on thread or tree
  change, calls `editor.setCommentMarkers(rects)`, listens for marker
  clicks via `editor.getCommentMarkerAt`, opens the popover.
- [ ] **7.3** `docs-view.tsx` — instantiates `YorkieCommentStore`
  sharing the Yorkie document with `YorkieDocStore`; mounts side panel;
  wires entry points: right-click "Insert comment", toolbar comment
  icon, `Cmd+Alt+M` (composer at current selection),
  `Cmd+Alt+Shift+M` (toggle panel).
- [ ] **7.4** Read-only mode honored — composer disabled, edit/delete
  hidden.

---

## Task 8 — Visual harness

**Files:**

- Create: `packages/frontend/visual/docs-comments.spec.ts`

Cases:

- [ ] Range selection + `Cmd+Alt+M` opens composer focused at input
- [ ] Highlight render across a line wrap (per-line rects)
- [ ] Highlight click → popover positioned correctly; flips near edge
- [ ] Two overlapping threads → popover lists both
- [ ] Side panel tab counts update on resolve / reopen
- [ ] "Orphaned" sub-section renders quotedText; jump-to disabled
- [ ] Side panel thread click → scroll + caret + flash highlight
- [ ] Read-only mode: composer hidden, resolve/edit/delete hidden
- [ ] `pnpm verify:browser:docker` green

---

## Task 9 — Self-review + smoke + PR

- [ ] **9.1** Run `pnpm verify:fast`, `pnpm verify:full`,
  `pnpm verify:browser:docker` — all green.
- [ ] **9.2** Manual smoke in `pnpm dev`:
  - Two browser tabs as different users — create / reply / resolve /
    reopen / edit / delete (author-only) all sync
  - Delete anchor text → "Orphaned" appears; undo restores marker
  - Read-only viewer (logged out) → markers visible, composer disabled
- [ ] **9.3** Dispatch `superpowers:requesting-code-review` over the
  branch diff; apply blocking findings.
- [ ] **9.4** Open PR. Title ≤70 chars (e.g.,
  "Add Docs comments + shared frontend comments module").
- [ ] **9.5** Capture lessons in `20260516-docs-comments-lessons.md`.
- [ ] **9.6** `pnpm tasks:archive && pnpm tasks:index` after merge.

---

## Out of scope (future PRs in this roadmap)

- **Step 2** — sheets migrates to the shared module. Removes
  `packages/sheets/src/comment/*` and the 6 comment methods from
  `Store`; adds `packages/frontend/src/app/spreadsheet/comments/`
  mirroring the docs glue. UX unchanged.
- **Step 3** — slides comments. Adds `slide-element` variant to the
  shared `CommentAnchor` union, plus `app/slides/comments/`.
- **Step 4** — `@user` mentions + notifications (in-app + email) across
  all consumers.
