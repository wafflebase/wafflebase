import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { fetchWorkspaceDataSources } from "@/api/workspaces";
import { isAuthExpiredError } from "@/api/auth";
import type { DataSource } from "@/types/datasource";
import { DataSourceList } from "@/app/datasources/datasource-list";

/**
 * Renders the workspace-scoped data sources page.
 */
export default function WorkspaceDataSources() {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const {
    data: datasources = [],
    isLoading,
    isError,
    error,
  } = useQuery<Array<DataSource>>({
    queryKey: ["workspaces", workspaceId, "datasources"],
    queryFn: () => fetchWorkspaceDataSources(workspaceId!),
    enabled: !!workspaceId,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-gray-500 text-lg">Loading datasources...</p>
      </div>
    );
  }

  if (isError) {
    if (isAuthExpiredError(error)) {
      return null;
    }
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-red-500 text-lg">Failed to load datasources.</p>
        <p className="text-gray-400">Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <DataSourceList data={datasources} />
    </div>
  );
}
