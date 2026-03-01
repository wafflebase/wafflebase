import { useQuery } from "@tanstack/react-query";
import { fetchDataSources } from "@/api/datasources";
import { isAuthExpiredError } from "@/api/auth";
import type { DataSource } from "@/types/datasource";
import { DataSourceList } from "./datasource-list";

/**
 * Renders the data sources page.
 */
export default function DataSourcesPage() {
  const {
    data: datasources = [],
    isLoading,
    isError,
    error,
  } = useQuery<Array<DataSource>>({
    queryKey: ["datasources"],
    queryFn: fetchDataSources,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-muted-foreground text-lg">Loading datasources...</p>
      </div>
    );
  }

  if (isError) {
    if (isAuthExpiredError(error)) {
      return null;
    }
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-destructive text-lg">Failed to load datasources.</p>
        <p className="text-muted-foreground">Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <DataSourceList data={datasources} />
    </div>
  );
}
