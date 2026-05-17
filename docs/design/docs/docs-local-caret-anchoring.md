---
title: docs-local-caret-anchoring
target-version: 0.4.1
---

# Docs Local Caret Anchoring

## Summary

Keep the local caret and text selection attached to the user's intended
logical text position when remote collaborators edit the same document.

Today the docs editor stores the local caret as an absolute
`{ blockId, offset }`. In collaborative mode, remote document changes invalidate
the render cache, but they do not transform that local offset. If another user
inserts text before the local caret in the same block, the caret keeps the same
numeric offset and ends up pointing to a different character.

The proposed fix is to anchor the local caret and selection to Yorkie Tree
positions in the frontend collaboration layer, then resolve those anchors back
to `{ blockId, offset }` only when the editor needs to render or operate on the
current document snapshot.

## Background

Issue #237 reported that when User A inserts text before User B's caret within
the same paragraph, User B's caret stays at the same absolute offset instead of
shifting with the logical text position. The expected behavior matches editors
like Google Docs and Notion: the caret should remain attached to the character
boundary it originally represented.

The maintainer confirmed this is a bug, not intentional behavior. The current
local caret uses `DocPosition` from `packages/docs/src/model/types.ts`, while
remote changes in `packages/frontend/src/app/docs/yorkie-doc-store.ts`
invalidate render state without transforming the stored local offset.

The maintainer also pointed to the preferred direction: anchor the caret to a
Yorkie Tree position, then resolve back to `DocPosition` at render time. This
is similar to the position-preserving approach needed for collaborative cursor
state, but this note focuses on the local caret and selection first. Because
the change touches headers, footers, tables, and selection paths, this note
records the expected edge-case behavior before implementation.

## Goals

- Preserve local caret intent across remote inserts, deletes, splits, and
  merges.
- Preserve non-collapsed text selection intent by anchoring both range
  endpoints.
- Support body blocks, header blocks, footer blocks, and table-cell blocks.
- Avoid ad-hoc offset transformation logic in response to remote operations.
- Keep Yorkie-specific anchor state in the frontend collaboration layer where
  possible.

## Non-Goals

- Redesigning `DocPosition` throughout `packages/docs`.
- Changing the visual caret rendering behavior.
- Replacing remote peer cursor presence in this change.
- Implementing collaborative undo/redo.
- Adding off-screen cursor indicators or new cursor UI.

## Proposal Details

### API Boundary

`packages/docs` should continue to use resolved `DocPosition` values for
editing, layout, hit-testing, and rendering:

```ts
interface DocPosition {
  blockId: string;
  offset: number;
}
```

The Yorkie-backed frontend integration should own the anchored representation:

```ts
type AnchoredDocPosition = {
  region: 'body' | 'header' | 'footer';
  yorkiePosition: unknown;
};

type AnchoredDocRange = {
  anchor: AnchoredDocPosition;
  focus: AnchoredDocPosition;
  tableCellRange?: TableCellRange;
};
```

The concrete `yorkiePosition` type should be selected from the Yorkie SDK Tree
position APIs used by the collaboration layer. The important boundary is that
Yorkie-specific state does not leak into the core docs model unless
implementation proves that the boundary is too expensive or ambiguous.

### Data Flow

```text
Local cursor or selection changes
  -> editor emits DocPosition / DocRange
  -> YorkieDocStore converts endpoints to Yorkie Tree anchors
  -> frontend stores the anchored local caret/range

Remote document change arrives
  -> YorkieDocStore refreshes the cached document
  -> frontend resolves anchored caret/range to current DocPosition / DocRange
  -> editor cursor and selection are updated
  -> render cache is invalidated and repaint happens
```

### Converting DocPosition To An Anchor

1. Resolve `blockId` to the current Yorkie Tree path using existing recursive
   block path helpers.
2. Preserve the resolved region: `body`, `header`, or `footer`.
3. Walk the block's inline/text children to map the concatenated block offset
   to a Yorkie Tree text boundary.
4. Store the resulting Yorkie Tree position as the local anchor.

For a non-collapsed selection, apply the same conversion to both `anchor` and
`focus`.

### Resolving An Anchor To DocPosition

1. Resolve the Yorkie Tree position against the current Tree.
2. Find the containing block node.
3. Read the block id from the block node attributes.
4. Convert the resolved text boundary back to a concatenated inline offset.
5. Clamp to a valid nearby position if the exact boundary was deleted.

The resolved position is then passed back into the existing editor APIs as
`DocPosition`.

## Edge Cases

### Remote Insert Before Caret

If a remote user inserts text before the local caret in the same block, the
resolved `DocPosition` should shift right so the caret stays attached to the
same logical text boundary.

```text
Before: Hello wo|rld
After remote insert at start: Hi Hello wo|rld
```

### Remote Insert At The Same Boundary

Use Yorkie Tree position semantics for tie-breaking. The implementation should
document whether the local caret resolves before or after the concurrently
inserted remote text at the same boundary.

### Remote Delete Before Caret

If remote text before the local caret is deleted, the resolved offset should
shift left while preserving the same logical boundary.

### Remote Delete Covering Caret

If the text around the local caret is deleted, resolve to the nearest valid
surviving boundary. Prefer the same block when it still exists. If the block was
removed, move to the nearest valid neighboring editable block.

### Block Split

If a remote edit splits a block before or at the local caret, the anchor should
resolve into the correct resulting block according to Yorkie Tree semantics.
The resolved `blockId` may change.

### Block Merge

If a remote edit merges two blocks and the caret was in the removed block, the
anchor should resolve into the surviving merged block at the corresponding
logical offset.

### Headers And Footers

Anchors must preserve region identity. Header and footer blocks are not body
blocks, even though they reuse the same `Block` and `Inline` model. Resolution
should not search the wrong region if ids collide or if layout traversal order
changes.

### Tables

Table-cell blocks are nested inside table nodes. Anchor conversion should use
the existing recursive block path resolution so cell-internal text positions
behave like body text positions.

Text selection endpoints inside table cells should be anchored individually.
`tableCellRange` remains selection metadata for table-cell range selection mode
and should not replace endpoint anchoring for normal text selections.

### Invalid Or Missing Anchor

If an anchor cannot be resolved because its target content no longer exists,
fall back along a deterministic ladder so two clients in the same remote race
land at the same position:

1. Same block, clamp to the nearest surviving offset using left affinity.
2. End of the previous block in the same region.
3. Start of the next block in the same region.
4. First editable block in the same region (`body`, `header`, or `footer`).
5. First editable body block.

Determinism matters because non-deterministic fallback would diverge selection
state between clients during concurrent edits. The order above is illustrative
and should be confirmed during implementation against the concrete Yorkie Tree
semantics.

### IME Composition

The local caret anchor is captured before composition starts and should remain
tied to the composition start boundary until `compositionend`.

The current editor updates the model during composition by replacing the
previous composing text at `composition.startPosition`, then normalizes the
final text again on `compositionend`. This design should anchor
`composition.startPosition` itself, so a remote edit before the composing text
does not leave composition commits targeting the old absolute offset.

If a remote edit lands mid-composition, resolve the composition-start anchor
before the next composition replacement or final commit. The visible composing
text may shift on screen with the anchor, but it should not be committed at a
stale absolute offset.

## Testing Strategy

### Unit Tests

- Convert a body `DocPosition` to an anchor and back with no document changes.
- Remote insert before caret shifts the resolved offset right.
- Remote insert after caret leaves the resolved offset unchanged.
- Remote delete before caret shifts the resolved offset left.
- Remote delete covering caret clamps to a valid nearby boundary.
- Remote block split resolves into the correct resulting block.
- Remote block merge resolves into the surviving merged block.
- Header and footer anchors preserve region identity.
- Table-cell anchors resolve through nested table paths.
- Selection anchoring resolves both `anchor` and `focus` correctly.

### Integration Tests

- Two clients open the same document.
- User B places the caret in the middle of a paragraph.
- User A inserts text before User B's caret.
- User B's caret remains attached to the same logical character boundary.
- Repeat the same scenario for a table-cell paragraph.
- Repeat the same scenario for a header or footer paragraph.

## Rollout Plan

1. Add local anchor conversion helpers in the Yorkie-backed docs integration.
2. Store a local caret anchor whenever the editor cursor changes.
3. Resolve and restore the local caret after remote document changes.
4. Extend the same mechanism to non-collapsed text selections.
5. Add tests for body text first, then tables, headers, and footers.
6. Revisit remote peer cursor presence separately if the same anchor strategy
   should be shared later.

## Known Follow-Ups

The undo/redo cursor snapshot in
`packages/frontend/src/app/docs/yorkie-doc-store.ts` (`pendingCursorPos`) is
also stored as an absolute `{ blockId, offset }` and has the same drift
behavior under concurrent remote edits. It is intentionally out of scope for
this note so the first change stays focused on live caret and selection, but
it is a natural follow-up that can reuse the same anchor representation.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Yorkie Tree position semantics for affinity or deleted nodes differ from this note's assumptions | Keep all anchor conversion in the frontend collaboration layer (one file) so the gap can be narrowed without touching the docs model |
| Anchor lifecycle is unclear if the chosen Yorkie SDK type has attach/detach semantics | Centralize anchor ownership in the cursor/selection state owner and document whether the concrete anchor type needs cleanup |
| Anchor resolution runs on every render and becomes a hot path | Resolve lazily: only after a remote change is observed, or before a cursor read; local edits update the resolved position in lockstep with the mutation |
| Fallback for missing anchors diverges between clients | Use the deterministic ladder described under "Invalid Or Missing Anchor"; covered by integration tests with two clients in the same race |
| Header, footer, or table-cell region becomes invalid (disabled, removed) | Region is captured at anchor creation; if the region is gone, resolution returns no result and the fallback ladder applies |
| Region identity is lost when block ids are reused or layout traversal order changes | Region tag is part of the anchor itself, not inferred from block id lookup at resolve time |
| Local edits race with anchor resolution and produce a transient wrong caret position | Resolve before the next render and before any command reads the caret; never expose a stale anchored value to commands |

## Open Questions

- Which concrete Yorkie SDK Tree position type should local anchors store?
- What affinity should the local caret use when remote text is inserted at the
  exact same boundary?
- Should remote peer cursor presence eventually use the same anchored
  representation, or remain resolved display data?
- Should fallback after a deleted block prefer visual proximity, document order,
  or region-local order?
