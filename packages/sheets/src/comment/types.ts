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

export type Thread = {
  id: string;
  anchor: CommentAnchor;
  comments: Comment[];
  resolved: boolean;
  resolvedAt?: number;
  resolvedBy?: CommentAuthor;
  createdAt: number;
};
