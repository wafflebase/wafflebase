export type DocumentType = "sheet" | "doc" | "slides" | "pdf";

/**
 * Backend-projected "currently editing" user. The server unwraps Yorkie's
 * wire format and dedupes by stable identity before sending — the React
 * layer only renders.
 */
export type DocumentEditor = {
  username: string;
  photo?: string;
  email?: string;
};

/**
 * Document owner surfaced on the documents list. `select`ed server-side
 * (never the full User). Null for legacy documents with no author.
 */
export type DocumentAuthor = {
  id: number;
  username: string;
  photo?: string | null;
};

export type Document = {
  id: string;
  title: string;
  type: DocumentType;
  description: string;
  createdAt: string;
  // Last-modified time (ISO), populated only by the documents-list endpoints
  // (from Yorkie). Absent on single-document / REST v1 responses.
  updatedAt?: string;
  workspaceId: string;
  author?: DocumentAuthor | null;
  editors?: DocumentEditor[];
};
