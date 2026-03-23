export type DocumentType = "sheet" | "doc";

export type Document = {
  id: number;
  title: string;
  type: DocumentType;
  description: string;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
};
