import type { TreePosStructRange } from '@yorkie-js/sdk';

export type CommentAuthor = {
  userId: string;
  username: string;
  photo?: string;
};

/**
 * Discriminated union of all supported comment anchor types. New
 * consumers add their variant alongside the existing ones — the
 * shared comment helpers stay anchor-generic.
 *
 * - `sheet-cell` — anchored to a cell in a specific tab; positions
 *   survive row/column shifts because `rowId` / `colId` are stable
 *   axis ids, not numeric indices.
 * - `docs-range` — anchored to a text range. `posRange` is the
 *   authoritative CRDT-stable position from Yorkie Tree; `blockId` is
 *   a hint captured at creation (may go stale after structural edits);
 *   `quotedText` is an immutable snapshot of the anchored text, used by
 *   the side-panel orphan card when the range no longer resolves.
 */
export type CommentAnchor =
  | { kind: 'sheet-cell'; tabId: string; rowId: string; colId: string }
  | {
      kind: 'docs-range';
      blockId: string;
      posRange: TreePosStructRange;
      quotedText: string;
    };

export type DocsRangeAnchor = Extract<CommentAnchor, { kind: 'docs-range' }>;
export type SheetCellAnchor = Extract<CommentAnchor, { kind: 'sheet-cell' }>;

export type Comment = {
  id: string;
  author: CommentAuthor;
  body: string;
  createdAt: number;
  editedAt?: number;
};

/**
 * Comment thread.
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
export type Thread<A extends CommentAnchor = CommentAnchor> = {
  id: string;
  anchor: A;
  comments: Comment[];
  resolved: boolean;
  resolvedAt?: number;
  resolvedBy?: CommentAuthor;
  createdAt: number;
};
