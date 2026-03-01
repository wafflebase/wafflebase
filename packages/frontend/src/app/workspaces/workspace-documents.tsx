import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { fetchWorkspaceDocuments } from "@/api/workspaces";
import { isAuthExpiredError } from "@/api/auth";
import { Document } from "@/types/documents";
import { DocumentList } from "@/app/documents/document-list";
import { Skeleton } from "@/components/ui/skeleton";

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
      <div className="p-4 lg:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="rounded-md border">
          <div className="p-4 space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    if (isAuthExpiredError(error)) {
      return null;
    }
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-destructive text-lg">Failed to load documents.</p>
        <p className="text-sm text-muted-foreground">Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6">
      <DocumentList data={documents} workspaceId={workspaceId} />
    </div>
  );
}
