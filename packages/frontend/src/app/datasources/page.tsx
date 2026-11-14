import { useQuery } from "@tanstack/react-query";
import { fetchDataSources } from "@/api/datasources";
import { isAuthExpiredError } from "@/api/auth";
import type { DataSource } from "@/types/datasource";
import { DataSourceList } from "./datasource-list";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadErrorState } from "@/components/load-error-state";

/**
 * Renders the data sources page.
 */
export default function DataSourcesPage() {
  const {
    data: datasources = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<Array<DataSource>>({
    queryKey: ["datasources"],
    queryFn: fetchDataSources,
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
        title="Couldn't load data sources."
        error={error}
        onRetry={() => void refetch()}
        isRetrying={isFetching}
      />
    );
  }

  return (
    <div className="p-4 lg:p-6">
      <DataSourceList data={datasources} />
    </div>
  );
}
