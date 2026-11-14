import { useQuery } from "@tanstack/react-query";
import { fetchDocuments } from "@/api/documents";
import { isAuthExpiredError } from "@/api/auth";
import { Document } from "@/types/documents";
import { DocumentList } from "@/app/documents/document-list";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadErrorState } from "@/components/load-error-state";

/**
 * Renders the documents page entry component.
 */
export default function Page() {
  const {
    data: documents = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<Array<Document>>({
    queryKey: ["documents"],
    queryFn: fetchDocuments,
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
    return (
      <LoadErrorState
        title="Couldn't load documents."
        error={error}
        onRetry={() => void refetch()}
        isRetrying={isFetching}
      />
    );
  }

  return (
    <div className="p-4 lg:p-6">
      <DocumentList data={documents} />
    </div>
  );
}
