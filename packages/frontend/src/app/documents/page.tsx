import { useQuery } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { fetchDocuments } from "@/api/documents";
import { isAuthExpiredError } from "@/api/auth";
import { Document } from "@/types/documents";
import { DocumentList } from "@/app/documents/document-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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
  } = useQuery<Array<Document>>({
    queryKey: ["documents"],
    queryFn: fetchDocuments,
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
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-destructive text-lg">Failed to load documents.</p>
        <p className="text-sm text-muted-foreground">
          Something went wrong. Please try again.
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RotateCw className="mr-1 h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6">
      <DocumentList data={documents} />
    </div>
  );
}
