import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getWorkspaceAnalytics } from "@/api/workspaces";
import { Loader } from "@/components/loader";

/**
 * Workspace-level view-analytics dashboard: aggregate totals across the
 * workspace's documents plus a per-document ranking. Each row links to that
 * document's detailed analytics (`/analytics/:id`).
 */
export function WorkspaceAnalyticsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["workspaces", workspaceId, "analytics"],
    queryFn: () => getWorkspaceAnalytics(workspaceId!),
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
      <h1 className="text-xl font-semibold">Analytics</h1>
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
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th>Document</th>
                <th>Views</th>
                <th>Unique</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.byDocument.map((r) => (
                <tr key={r.documentId} className="border-t">
                  <td className="py-1">{r.title || r.documentId}</td>
                  <td>{r.views}</td>
                  <td>{r.uniqueVisitors}</td>
                  <td>
                    <Link
                      className="text-primary hover:underline"
                      to={`/analytics/${r.documentId}`}
                    >
                      Details
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

export default WorkspaceAnalyticsPage;
