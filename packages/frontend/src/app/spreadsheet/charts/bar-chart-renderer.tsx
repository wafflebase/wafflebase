import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartDataset } from "../chart-utils";
import { getLegendProps } from "./chart-registry";

type Props = {
  dataset: ChartDataset;
  yAxisWidth: number;
  showGridlines: boolean;
  legendPosition: "top" | "bottom" | "right" | "left" | "none";
  formatYAxisTick: (value: number | string) => string;
};

export function BarChartRenderer({
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
      <BarChart data={dataset.rows}>
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
          <Bar
            key={series.key}
            dataKey={series.key}
            fill={`var(--color-${series.key})`}
            radius={2}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
