import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import { fetchWorkspaceDocuments } from "@/api/workspaces";
import { fetchFolders } from "@/api/folders";
import { isAuthExpiredError } from "@/api/auth";
import { HttpError } from "@/api/http-error";
import { Document, Folder } from "@/types/documents";
import { DocumentList } from "@/app/documents/document-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Renders the workspace-scoped documents page.
 */
export default function WorkspaceDocuments() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const folderId = searchParams.get("folder");

  const { data: folders = [] } = useQuery<Array<Folder>>({
    queryKey: ["workspaces", workspaceId, "folders"],
    queryFn: () => fetchFolders(workspaceId!),
    enabled: !!workspaceId,
  });

  const {
    data: documents = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<Array<Document>>({
    queryKey: ["workspaces", workspaceId, "documents", folderId ?? "root"],
    queryFn: () => fetchWorkspaceDocuments(workspaceId!, folderId),
    enabled: !!workspaceId,
    // Refresh "currently editing" indicators without forcing a manual reload.
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
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
    // A 403 / 404 is the server's answer, not a hiccup: "try again later"
    // would send someone back to a workspace they cannot open.
    // Widened first: `AuthExpiredError` is structurally a plain `Error`, so
    // the guard above narrows `error` to `never` in TypeScript's eyes.
    const failure: unknown = error;
    const noAccess =
      failure instanceof HttpError &&
      (failure.status === 403 || failure.status === 404);
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-64">
        <div className="text-center">
          <p className="text-destructive text-lg">Failed to load documents.</p>
          <p className="text-sm text-muted-foreground">
            {noAccess
              ? "This workspace doesn't exist, or you no longer have access to it."
              : "Check your connection, then try again."}
          </p>
        </div>
        {!noAccess && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? "Retrying…" : "Try again"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6">
      <DocumentList
        data={documents}
        workspaceId={workspaceId}
        folders={folders}
        folderId={folderId}
        onNavigateFolder={(id) =>
          setSearchParams(
            (prev) => {
              // Merge rather than replace so any unrelated future query param
              // on this route survives folder navigation.
              const next = new URLSearchParams(prev);
              if (id) next.set("folder", id);
              else next.delete("folder");
              return next;
            },
            { replace: false },
          )
        }
      />
    </div>
  );
}
