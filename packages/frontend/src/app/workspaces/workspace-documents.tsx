import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { fetchWorkspaceDocuments } from "@/api/workspaces";
import { isAuthExpiredError } from "@/api/auth";
import { Document } from "@/types/documents";
import { DocumentList } from "@/app/documents/document-list";

/**
 * Renders the workspace-scoped documents page.
 */
export default function WorkspaceDocuments() {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const {
    data: documents = [],
    isLoading,
    isError,
    error,
  } = useQuery<Array<Document>>({
    queryKey: ["workspaces", workspaceId, "documents"],
    queryFn: () => fetchWorkspaceDocuments(workspaceId!),
    enabled: !!workspaceId,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-gray-500 text-lg">Loading documents...</p>
      </div>
    );
  }

  if (isError) {
    if (isAuthExpiredError(error)) {
      return null;
    }
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-red-500 text-lg">Failed to load documents.</p>
        <p className="text-gray-400">Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <DocumentList data={documents} workspaceId={workspaceId} />
    </div>
  );
}
