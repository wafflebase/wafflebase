export type CommentAuthor = {
  userId: string;
  username: string;
  photo?: string;
};

export type CommentAnchor = {
  kind: 'sheet-cell';
  tabId: string;
  rowId: string;
  colId: string;
};

export type Comment = {
  id: string;
  author: CommentAuthor;
  body: string;
  createdAt: number;
  editedAt?: number;
};

/**
 * Comment thread. Generic over the anchor so this same shape is the
 * canonical base for every consumer (sheets cells, docs ranges, …): the
 * frontend's shared `Thread<A>` aliases this type, keeping the two in
 * lockstep instead of relying on coincidentally-identical declarations.
 * Sheets itself only ever uses the default `sheet-cell` anchor.
 */
export type Thread<A extends { kind: string } = CommentAnchor> = {
  id: string;
  anchor: A;
  comments: Comment[];
  resolved: boolean;
  resolvedAt?: number;
  resolvedBy?: CommentAuthor;
  createdAt: number;
};
