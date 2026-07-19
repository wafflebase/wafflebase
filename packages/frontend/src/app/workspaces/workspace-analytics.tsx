import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getWorkspaceAnalytics } from "@/api/workspaces";
import { Loader } from "@/components/loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DateRangePicker } from "@/app/analytics/date-range";
import {
  DEFAULT_PRESET,
  rangeForPreset,
  type RangePreset,
} from "@/app/analytics/presets";
import { Stat } from "@/app/analytics/stat";
import { ViewsTrendChart } from "@/app/analytics/views-trend-chart";

/**
 * Workspace-level view-analytics dashboard: aggregate totals across the
 * workspace's documents plus a per-document ranking. Each row links to that
 * document's detailed analytics (`/w/:workspaceId/analytics/:id`).
 */
export function WorkspaceAnalyticsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [preset, setPreset] = useState<RangePreset>(DEFAULT_PRESET);
  const { data, isLoading, error } = useQuery({
    queryKey: ["workspaces", workspaceId, "analytics", preset],
    queryFn: () => getWorkspaceAnalytics(workspaceId!, rangeForPreset(preset)),
    enabled: Boolean(workspaceId),
    retry: false,
  });

  if (isLoading) return <Loader />;
  if (error) return <div className="p-6">Failed to load analytics.</div>;
  if (!data) return null;
  if (!data.enabled) {
    return (
      <div className="p-6 text-muted-foreground">
        Analytics is not enabled for this deployment. Start the local stack with{" "}
        <code>docker compose --profile analytics up -d</code> and set the
        <code> WAFFLEBASE_KAFKA_ADDRESSES</code> /
        <code> WAFFLEBASE_STARROCKS_DSN</code> backend env vars.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-end">
        <DateRangePicker value={preset} onChange={setPreset} />
      </div>

      <ViewsTrendChart data={data.viewsByDay} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat label="Total views" value={data.totalViews} />
        <Stat label="Unique visitors" value={data.uniqueVisitors} />
        <Stat label="Documents tracked" value={data.byDocument.length} />
      </div>

      <section>
        <h2 className="mb-2 font-medium">Most viewed documents</h2>
        {data.byDocument.length === 0 ? (
          <p className="text-sm text-muted-foreground">No views yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead className="text-right">Unique</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byDocument.map((r) => (
                <TableRow key={r.documentId}>
                  <TableCell>{r.title || r.documentId}</TableCell>
                  <TableCell className="text-right">{r.views}</TableCell>
                  <TableCell className="text-right">
                    {r.uniqueVisitors}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      className="text-primary hover:underline"
                      to={`/w/${workspaceId}/analytics/${r.documentId}`}
                    >
                      Details
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

export default WorkspaceAnalyticsPage;
