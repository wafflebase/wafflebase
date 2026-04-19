import { CartesianGrid, Scatter, ScatterChart, XAxis, YAxis } from "recharts";
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

export function ScatterChartRenderer({
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
      <ScatterChart>
        {showGridlines && <CartesianGrid />}
        <XAxis
          dataKey="x"
          type="number"
          tickLine={false}
          axisLine={false}
          tickFormatter={formatYAxisTick}
        />
        <YAxis
          dataKey="y"
          tickLine={false}
          axisLine={false}
          width={yAxisWidth}
          tickFormatter={formatYAxisTick}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        {legendPosition !== "none" && (
          <ChartLegend content={<ChartLegendContent />} {...getLegendProps(legendPosition)} />
        )}
        {dataset.series.map((series) => {
          const seriesData = dataset.rows.map((row) => ({
            x: row[dataset.xKey],
            y: row[series.key],
          }));
          return (
            <Scatter
              key={series.key}
              name={series.key}
              data={seriesData}
              fill={`var(--color-${series.key})`}
              isAnimationActive={false}
            />
          );
        })}
      </ScatterChart>
    </ChartContainer>
  );
}
