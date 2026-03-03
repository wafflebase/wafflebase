import { Cell, Pie, PieChart } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { PieDataset } from "../chart-utils";

type Props = {
  dataset: PieDataset;
  legendPosition: "top" | "bottom" | "right" | "left" | "none";
};

export function PieChartRenderer({ dataset, legendPosition }: Props) {
  const config: Record<string, { label: string; color: string }> = {};
  for (const entry of dataset.entries) {
    config[entry.name] = { label: entry.name, color: entry.color };
  }

  return (
    <ChartContainer config={config} className="!aspect-auto h-full w-full">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent />} />
        {legendPosition !== "none" && (
          <ChartLegend
            content={<ChartLegendContent />}
            verticalAlign={
              legendPosition === "top" || legendPosition === "bottom"
                ? legendPosition
                : undefined
            }
            align={
              legendPosition === "left" || legendPosition === "right"
                ? legendPosition
                : undefined
            }
          />
        )}
        <Pie
          data={dataset.entries}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius="70%"
          isAnimationActive={false}
        >
          {dataset.entries.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}
