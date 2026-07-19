import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getDocumentAnalytics } from "@/api/analytics";
import { Loader } from "@/components/loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DateRangePicker } from "./date-range";
import { DEFAULT_PRESET, rangeForPreset, type RangePreset } from "./presets";
import { formatDwell, returningRate } from "./format";
import { Stat } from "./stat";
import { ViewsTrendChart } from "./views-trend-chart";

type ShareLinkRow = {
  shareLinkId: string;
  views: number;
  uniqueVisitors: number;
  role?: string;
  createdAt?: string;
  creator?: string;
};

/**
 * Human label for a share-link row. `ShareLink` has no name column, so enriched
 * rows read as `role · creator · date`; the short id is always kept so two
 * links of the same role/creator/day remain distinguishable.
 */
function shareLinkLabel(r: ShareLinkRow): string {
  const id = r.shareLinkId.slice(0, 8);
  if (!r.role) return id;
  const parts = [r.role];
  if (r.creator) parts.push(r.creator);
  if (r.createdAt) parts.push(r.createdAt.slice(0, 10));
  return `${parts.join(" · ")} · #${id}`;
}

export function DocumentAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const [preset, setPreset] = useState<RangePreset>(DEFAULT_PRESET);
  const { data, isLoading, error } = useQuery({
    queryKey: ["analytics", id, preset],
    queryFn: () => getDocumentAnalytics(id!, rangeForPreset(preset)),
    enabled: Boolean(id),
    retry: false,
  });

  if (isLoading) return <Loader />;
  if (error) return <div className="p-6">Failed to load analytics.</div>;
  if (!data) return null;
  if (!data.enabled) {
    return (
      <div className="p-6 text-muted-foreground">
        Analytics is not enabled for this deployment.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-end">
        <DateRangePicker value={preset} onChange={setPreset} />
      </div>

      <ViewsTrendChart data={data.viewsByDay} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Total views" value={data.totalViews} />
        <Stat label="Unique visitors" value={data.uniqueVisitors} />
        <Stat
          label="Returning visitors"
          value={data.returningVisitors}
          hint={returningRate(data.returningVisitors, data.uniqueVisitors)}
        />
        <Stat label="Avg. dwell" value={formatDwell(data.avgDwellSeconds)} />
      </div>

      <section>
        <h2 className="mb-2 font-medium">By share link</h2>
        {data.byShareLink.length === 0 ? (
          <p className="text-sm text-muted-foreground">No views yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Share link</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead className="text-right">Unique</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byShareLink.map((r) => (
                <TableRow key={r.shareLinkId}>
                  <TableCell>{shareLinkLabel(r)}</TableCell>
                  <TableCell className="text-right">{r.views}</TableCell>
                  <TableCell className="text-right">
                    {r.uniqueVisitors}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {data.byTarget.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">By tab / slide</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Target</TableHead>
                <TableHead className="text-right">Views</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byTarget.map((r) => (
                <TableRow key={r.target}>
                  <TableCell className="font-mono">{r.target}</TableCell>
                  <TableCell className="text-right">{r.views}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}

export default DocumentAnalyticsPage;
