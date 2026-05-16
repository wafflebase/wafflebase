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

export type Thread<A extends CommentAnchor = CommentAnchor> = {
  id: string;
  anchor: A;
  comments: Comment[];
  resolved: boolean;
  resolvedAt?: number;
  resolvedBy?: CommentAuthor;
  createdAt: number;
};
