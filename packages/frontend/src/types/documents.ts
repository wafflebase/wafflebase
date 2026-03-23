export type DocumentType = "sheet" | "doc";

export type Document = {
  id: string;
  title: string;
  type: DocumentType;
  description: string;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
};
