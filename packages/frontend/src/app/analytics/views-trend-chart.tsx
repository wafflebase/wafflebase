import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { MetricSeriesPoint } from "@/api/analytics";
import { densifyDaily } from "./series";

const config = {
  views: { label: "Views", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * Daily views trend, shared by the document and workspace dashboards. Renders
 * the `viewsByDay` series the backend already computes (previously unused).
 */
export function ViewsTrendChart({ data }: { data: MetricSeriesPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border text-sm text-muted-foreground">
        No views in this range yet.
      </div>
    );
  }

  // Fill zero-view days so quiet gaps render as troughs, not a smooth slope.
  const series = densifyDaily(data);

  return (
    <ChartContainer config={config} className="!aspect-auto h-64 w-full">
      <AreaChart data={series} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          // Show MM-DD; the full YYYY-MM-DD is in the tooltip label.
          tickFormatter={(d: string) => String(d).slice(5)}
        />
        <YAxis
          width={32}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          dataKey="value"
          name="views"
          type="monotone"
          stroke="var(--color-views)"
          fill="var(--color-views)"
          fillOpacity={0.15}
        />
      </AreaChart>
    </ChartContainer>
  );
}
