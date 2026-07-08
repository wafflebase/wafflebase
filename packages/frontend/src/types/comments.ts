import type { TreePosStructRange } from '@yorkie-js/sdk';
import type {
  CommentAnchor as SheetCellAnchorBase,
  Thread as BaseThread,
} from '@wafflebase/sheets';

// `Comment`/`CommentAuthor` and the base `Thread` shape are owned by
// `@wafflebase/sheets` (the lowest package in the dependency graph). The
// frontend re-exports them and only adds the anchor variants its richer
// consumers (docs ranges) need, so there is a single thread declaration
// rather than two coincidentally-identical ones.
export type { Comment, CommentAuthor } from '@wafflebase/sheets';

/**
 * Sheet-cell anchor — owned by `@wafflebase/sheets`; positions survive
 * row/column shifts because `rowId` / `colId` are stable axis ids, not
 * numeric indices.
 */
export type SheetCellAnchor = SheetCellAnchorBase;

/**
 * Docs text-range anchor. `posRange` is the authoritative CRDT-stable
 * position from Yorkie Tree; `blockId` is a hint captured at creation
 * (may go stale after structural edits); `quotedText` is an immutable
 * snapshot of the anchored text, used by the side-panel orphan card when
 * the range no longer resolves.
 */
export type DocsRangeAnchor = {
  kind: 'docs-range';
  blockId: string;
  posRange: TreePosStructRange;
  quotedText: string;
};

/** A rectangle in [0,1] page-relative coordinates (zoom/scale independent). */
export type PdfRect = { x: number; y: number; w: number; h: number };

/**
 * PDF region anchor — a rectangle on a given page. Unlike docs ranges, a
 * PDF anchor never moves (pages/coordinates are static), so it never
 * orphans except when `pageIndex` is out of range for the loaded file.
 */
export type PdfRegionAnchor = {
  kind: 'pdf-region';
  pageIndex: number;
  rect: PdfRect;
};

/**
 * Discriminated union of all supported comment anchor types. New
 * consumers add their variant alongside the existing ones — the shared
 * comment helpers stay anchor-generic.
 */
export type CommentAnchor = SheetCellAnchor | DocsRangeAnchor | PdfRegionAnchor;

/**
 * Comment thread — aliases the base shape owned by `@wafflebase/sheets`
 * so the sheets store's `Thread` and this shared type are literally the
 * same type (no bridging casts needed).
 *
 * Invariants enforced by every store implementation:
 * - `comments.length >= 1` — deleting `comments[0]` deletes the whole
 *   thread.
 * - `comments[i].body` is non-empty after trim.
 * - `comments[i].createdAt` is a Unix millisecond timestamp; replies
 *   are appended in author order.
 * - `resolved === true` implies `resolvedAt` and `resolvedBy` are set;
 *   reopening clears both.
 * - `editedAt > createdAt` when present.
 */
export type Thread<A extends CommentAnchor = CommentAnchor> = BaseThread<A>;
