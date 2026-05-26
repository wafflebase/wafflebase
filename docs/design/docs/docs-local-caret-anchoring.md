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
  yorkiePosition: TreePos;
  lineAffinity?: 'forward' | 'backward';
};

type AnchoredDocRange = {
  anchor: AnchoredDocPosition;
  focus: AnchoredDocPosition;
  tableCellRange?: TableCellRange;
};
```

The concrete anchor is Yorkie's Tree position type. Convert a collapsed caret
or range endpoint with `tree.indexRangeToPosRange([index, index])`, and resolve
it with `tree.posRangeToIndexRange(posRange)`. A caret is a collapsed range, so
`AnchoredDocRange` maps 1:1 to two endpoint anchors. Yorkie-specific state
does not leak into the core docs model; `packages/docs` still receives only
resolved `DocPosition` values.

Headers, body, and footers all live in the same `root.content` Tree as sibling
top-level containers. Header and footer blocks are wrapped by top-level
`type: 'header' | 'footer'` nodes, while body blocks are direct top-level
block nodes. `indexRangeToPosRange` therefore handles all three regions
uniformly. The `region` tag is retained only so fallback stays region-local
when the anchor target is deleted.

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

The anchor is canonical. A resolved `DocPosition` is a cache derived from the
current Tree snapshot and is invalidated on remote change. `pendingCursorPos`
continues to store absolute offsets for undo/redo presence history for now.

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

Use Yorkie Tree position semantics for tie-breaking, then apply the local
affinity rule before fallback. The local caret uses right affinity for the
user's own insert so typing advances the caret after inserted text. Remote
inserts at the same boundary use left affinity so the local caret stays before
the remotely inserted text, matching Google Docs behavior.

```text
User B anchor: He|llo
User A inserts "y" at the same boundary
Resolved for B: He|yllo
```

Tests must assert this same-boundary affinity. If the Yorkie SDK's
`posRangeToIndexRange` semantics differ, the frontend wrapper normalizes the
resolved `DocPosition` to this rule.

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

Today's `splitBlock` implementation uses `delete + insert` rather than Yorkie's
native `splitLevel=2`, so a Yorkie Tree position pointing into the deleted
"after" portion cannot be preserved across the split. Resolution falls through
the deterministic fallback ladder to the surviving original block clamped to
its new end. Switching to native `splitLevel=2` is tracked in *Known
Follow-Ups* and would let the anchor land in the new block at the logical
offset without a fallback.

### Block Merge

If a remote edit merges two blocks and the caret was in the removed block, the
anchor should resolve into the surviving merged block at the corresponding
logical offset.

Today's `mergeBlock` also uses `delete + clone-insert`, so a Yorkie Tree
position pointing into the deleted block cannot follow the merge through CRDT
semantics. Resolution falls back to "end of the previous region block" via the
fallback ladder; the logical offset within the merged content is not
preserved. Native CRDT-preserving merge is tracked in *Known Follow-Ups*.

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
state between clients during concurrent edits. Same-boundary affinity is
applied first; if the Yorkie position no longer resolves to a usable block, the
fallback ladder above is the canonical order. During implementation, verify
and pin the exact SDK behavior for a `TreePos` whose node was deleted.

### IME Composition

The local caret anchor is captured before composition starts and should remain
tied to the composition start boundary until `compositionend`.

The text editor anchors `composition.startPosition` itself: on
`compositionstart` it notifies the collaboration layer with the current cursor
position, which captures a Yorkie Tree anchor; on `compositionend` it clears
the anchor. When a remote change arrives mid-composition, the anchor is
resolved and the text editor's cached `composition.startPosition` is replaced
with the new resolved `DocPosition` before the next composing-text replacement
or final commit. The visible composing text may shift on screen with the
anchor, but it is never committed at a stale absolute offset.

## Testing Strategy

### Unit Tests

- Convert a body `DocPosition` to an anchor and back with no document changes.
- Remote insert before caret shifts the resolved offset right.
- Remote insert at the same boundary resolves with left affinity for remote
  text.
- Remote insert after caret leaves the resolved offset unchanged.
- Remote delete before caret shifts the resolved offset left.
- Remote delete covering caret clamps to a valid nearby boundary.
- Remote block split resolves into the correct resulting block.
- Remote block merge resolves into the surviving merged block.
- Header and footer anchors preserve region identity.
- Table-cell anchors resolve through nested table paths.
- Selection anchoring resolves both `anchor` and `focus` correctly.
- The composition start anchor resolves to a shifted `DocPosition` after
  remote text is inserted before it, and is cleared on `compositionend`.
- The fallback ladder lands at the end of the previous region block when the
  anchor's block is deleted.

### Integration Tests

- Two clients open the same document.
- User B places the caret in the middle of a paragraph.
- User A inserts text before User B's caret.
- User B's caret remains attached to the same logical character boundary.
- User B creates a non-collapsed selection in a paragraph, User A inserts and
  deletes upstream text, and both `anchor` and `focus` resolve correctly.
- Repeat the same scenario for a table-cell paragraph.
- Repeat the same scenario in a header paragraph.
- Repeat the same scenario in a footer paragraph.

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

`splitBlock` and `mergeBlock` use `delete + insert` against the Yorkie Tree
rather than the SDK's native `splitLevel`. As a result, an anchor whose target
text is removed by a remote split or merge cannot follow through Yorkie CRDT
semantics and falls through the deterministic fallback ladder. Moving these
operations to native split/merge would let the anchor preserve its logical
offset across remote structural edits; this requires also restoring undo/redo
behavior previously documented as broken under `splitLevel=2`.

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

- Should remote peer cursor presence eventually use the same anchored
  representation, or remain resolved display data?
- Should fallback after a deleted block prefer visual proximity, document order,
  or region-local order?
