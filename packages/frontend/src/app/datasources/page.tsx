import { useQuery } from "@tanstack/react-query";
import { fetchDataSources } from "@/api/datasources";
import type { DataSource } from "@/types/datasource";
import { DataSourceList } from "./datasource-list";

export default function DataSourcesPage() {
  const {
    data: datasources = [],
    isLoading,
    isError,
  } = useQuery<Array<DataSource>>({
    queryKey: ["datasources"],
    queryFn: fetchDataSources,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-gray-500 text-lg">Loading datasources...</p>
      </div>
    );
  }

  if (isError) {
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
