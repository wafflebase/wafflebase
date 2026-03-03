import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ChartDataset } from "@/app/spreadsheet/chart-utils";
import type { PieDataset } from "@/app/spreadsheet/chart-utils";
import { BarChartRenderer } from "@/app/spreadsheet/charts/bar-chart-renderer";
import { LineChartRenderer } from "@/app/spreadsheet/charts/line-chart-renderer";
import { AreaChartRenderer } from "@/app/spreadsheet/charts/area-chart-renderer";
import { PieChartRenderer } from "@/app/spreadsheet/charts/pie-chart-renderer";
import { ScatterChartRenderer } from "@/app/spreadsheet/charts/scatter-chart-renderer";

// Shared Y-axis tick formatter (same as chart-object-layer)
const compactTickFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const plainTickFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

function formatYAxisTick(value: number | string): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (Math.abs(numeric) >= 10_000) return compactTickFormatter.format(numeric);
  return plainTickFormatter.format(numeric);
}

// ---- Sample Data ----

const CARTESIAN_DATASET: ChartDataset = {
  xKey: "category",
  rows: [
    { category: "Jan", series_A: 120, series_B: 90, series_C: 60 },
    { category: "Feb", series_A: 150, series_B: 110, series_C: 80 },
    { category: "Mar", series_A: 180, series_B: 130, series_C: 95 },
    { category: "Apr", series_A: 140, series_B: 160, series_C: 110 },
    { category: "May", series_A: 200, series_B: 140, series_C: 130 },
    { category: "Jun", series_A: 170, series_B: 180, series_C: 105 },
  ],
  series: [
    { key: "series_A", label: "Revenue" },
    { key: "series_B", label: "Expenses" },
    { key: "series_C", label: "Profit" },
  ],
  config: {
    series_A: { label: "Revenue", color: "var(--color-primary)" },
    series_B: {
      label: "Expenses",
      color:
        "color-mix(in oklch, var(--color-primary) 78%, var(--color-background))",
    },
    series_C: {
      label: "Profit",
      color:
        "color-mix(in oklch, var(--color-primary) 68%, var(--color-foreground))",
    },
  },
};

const PIE_DATASET: PieDataset = {
  entries: [
    { name: "Electronics", value: 350, color: "#2563eb" },
    { name: "Clothing", value: 200, color: "#60a5fa" },
    { name: "Food", value: 180, color: "#3b82f6" },
    { name: "Books", value: 120, color: "#93c5fd" },
    { name: "Other", value: 80, color: "#bfdbfe" },
  ],
};

const SCATTER_DATASET: ChartDataset = {
  xKey: "category",
  rows: [
    { category: 10, series_A: 25, series_B: 15 },
    { category: 20, series_A: 40, series_B: 30 },
    { category: 30, series_A: 35, series_B: 45 },
    { category: 40, series_A: 55, series_B: 38 },
    { category: 50, series_A: 48, series_B: 52 },
    { category: 60, series_A: 70, series_B: 60 },
    { category: 70, series_A: 62, series_B: 72 },
    { category: 80, series_A: 85, series_B: 68 },
  ],
  series: [
    { key: "series_A", label: "Group A" },
    { key: "series_B", label: "Group B" },
  ],
  config: {
    series_A: { label: "Group A", color: "#2563eb" },
    series_B: { label: "Group B", color: "#60a5fa" },
  },
};

// ---- Scenario definitions ----

type ChartScenario = {
  id: string;
  title: string;
  description: string;
  render: () => React.ReactNode;
};

const CHART_SCENARIOS: ChartScenario[] = [
  {
    id: "chart-bar",
    title: "Bar Chart",
    description:
      "Verifies bar chart rendering with 3 series, legend, gridlines, and tooltip.",
    render: () => (
      <BarChartRenderer
        dataset={CARTESIAN_DATASET}
        yAxisWidth={48}
        showGridlines={true}
        legendPosition="bottom"
        formatYAxisTick={formatYAxisTick}
      />
    ),
  },
  {
    id: "chart-line",
    title: "Line Chart",
    description:
      "Verifies line chart rendering with monotone curves, 3 series, and legend.",
    render: () => (
      <LineChartRenderer
        dataset={CARTESIAN_DATASET}
        yAxisWidth={48}
        showGridlines={true}
        legendPosition="bottom"
        formatYAxisTick={formatYAxisTick}
      />
    ),
  },
  {
    id: "chart-area",
    title: "Area Chart",
    description:
      "Verifies area chart rendering with filled regions at 20% opacity.",
    render: () => (
      <AreaChartRenderer
        dataset={CARTESIAN_DATASET}
        yAxisWidth={48}
        showGridlines={true}
        legendPosition="bottom"
        formatYAxisTick={formatYAxisTick}
      />
    ),
  },
  {
    id: "chart-pie",
    title: "Pie Chart",
    description:
      "Verifies pie chart rendering with 5 slices and right-aligned legend.",
    render: () => (
      <PieChartRenderer dataset={PIE_DATASET} legendPosition="right" />
    ),
  },
  {
    id: "chart-scatter",
    title: "Scatter Chart",
    description:
      "Verifies scatter chart rendering with numeric axes and 2 series.",
    render: () => (
      <ScatterChartRenderer
        dataset={SCATTER_DATASET}
        yAxisWidth={48}
        showGridlines={true}
        legendPosition="bottom"
        formatYAxisTick={formatYAxisTick}
      />
    ),
  },
];

// ---- Components ----

function ChartScenarioCard({ scenario }: { scenario: ChartScenario }) {
  return (
    <Card
      data-visual-scenario-id={scenario.id}
      data-visual-scenario-ready="true"
      data-visual-scenario-state="ready"
      className="border-border/80"
    >
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{scenario.title}</CardTitle>
        <CardDescription>{scenario.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[280px] w-full rounded-md border bg-background p-2">
          {scenario.render()}
        </div>
      </CardContent>
    </Card>
  );
}

export function ChartVisualScenarios() {
  return (
    <section
      className="space-y-4"
      data-testid="visual-harness-chart-section"
      data-visual-chart-ready="true"
    >
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          Chart Visual Scenarios
        </h2>
        <p className="text-sm text-muted-foreground">
          Validates rendering of each chart type with sample data against
          browser baselines.
        </p>
      </header>
      <div className="grid gap-4 xl:grid-cols-2">
        {CHART_SCENARIOS.map((scenario) => (
          <ChartScenarioCard key={scenario.id} scenario={scenario} />
        ))}
      </div>
    </section>
  );
}
