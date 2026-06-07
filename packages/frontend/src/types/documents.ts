export type DocumentType = "sheet" | "doc" | "slides";

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

export type Document = {
  id: string;
  title: string;
  type: DocumentType;
  description: string;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  editors?: DocumentEditor[];
};
