import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getDocumentAnalytics } from "@/api/analytics";
import { Loader } from "@/components/loader";

export function DocumentAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["analytics", id],
    queryFn: () => getDocumentAnalytics(id!),
    enabled: Boolean(id),
    retry: false,
  });

  if (isLoading) return <Loader />;
  if (error) return <div className="p-6">Failed to load analytics.</div>;
  if (!data) return null;
  if (!data.enabled) {
    return <div className="p-6">Analytics is not enabled for this deployment.</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Document Analytics</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Total views" value={data.totalViews} />
        <Stat label="Unique visitors" value={data.uniqueVisitors} />
        <Stat label="Returning visitors" value={data.returningVisitors} />
        <Stat label="Avg. dwell (s)" value={data.avgDwellSeconds} />
      </div>

      <section>
        <h2 className="mb-2 font-medium">By share link</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th>Share link</th><th>Views</th><th>Unique</th>
            </tr>
          </thead>
          <tbody>
            {data.byShareLink.map((r) => (
              <tr key={r.shareLinkId}>
                <td className="font-mono">{r.shareLinkId.slice(0, 8)}</td>
                <td>{r.views}</td><td>{r.uniqueVisitors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {data.byTarget.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">By tab / slide</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground"><th>Target</th><th>Views</th></tr>
            </thead>
            <tbody>
              {data.byTarget.map((r) => (
                <tr key={r.target}><td className="font-mono">{r.target}</td><td>{r.views}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
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

export default DocumentAnalyticsPage;
