import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartDataset } from "../chart-utils";
import { getLegendProps, type LegendPosition } from "./chart-registry";

type Props = {
  dataset: ChartDataset;
  yAxisWidth: number;
  showGridlines: boolean;
  legendPosition: LegendPosition;
  formatYAxisTick: (value: number | string) => string;
};

export function AreaChartRenderer({
  dataset,
  yAxisWidth,
  showGridlines,
  legendPosition,
  formatYAxisTick,
}: Props) {
  return (
    <ChartContainer
      config={dataset.config}
      className="!aspect-auto h-full w-full"
    >
      <AreaChart data={dataset.rows}>
        {showGridlines && <CartesianGrid vertical={false} />}
        <XAxis dataKey={dataset.xKey} tickLine={false} axisLine={false} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={yAxisWidth}
          tickFormatter={formatYAxisTick}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        {legendPosition !== "none" && (
          <ChartLegend content={<ChartLegendContent />} {...getLegendProps(legendPosition)} />
        )}
        {dataset.series.map((series) => (
          <Area
            key={series.key}
            type="monotone"
            dataKey={series.key}
            stroke={`var(--color-${series.key})`}
            fill={`var(--color-${series.key})`}
            fillOpacity={0.2}
            strokeWidth={2}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}
