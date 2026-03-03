import type { ComponentType } from "react";
import type { ChartType } from "@/types/worksheet";
import {
  IconChartBar,
  IconChartLine,
  IconChartArea,
  IconChartPie,
  IconChartDots,
} from "@tabler/icons-react";
import type { ChartDataset } from "../chart-utils";
import { AreaChartRenderer } from "./area-chart-renderer";
import { BarChartRenderer } from "./bar-chart-renderer";
import { LineChartRenderer } from "./line-chart-renderer";
import { PieChartRenderer } from "./pie-chart-renderer";
import { ScatterChartRenderer } from "./scatter-chart-renderer";

export type ChartCategory = "cartesian" | "radial" | "scatter";

export type EditorCapabilities = {
  xAxis: boolean;
  series: boolean;
  multiSeries: boolean;
  gridlines: boolean;
  legendPosition: boolean;
};

export type ChartRendererProps = {
  dataset: ChartDataset;
  yAxisWidth: number;
  showGridlines: boolean;
  legendPosition: "top" | "bottom" | "right" | "left" | "none";
  formatYAxisTick: (value: number | string) => string;
};

export type ChartRegistryEntry = {
  type: ChartType;
  label: string;
  icon: ComponentType<{ size: number }>;
  category: ChartCategory;
  editorCapabilities: EditorCapabilities;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Pie and cartesian renderers have distinct prop shapes; caller branches by category.
  renderer: ComponentType<any> | null;
};

const registry = new Map<ChartType, ChartRegistryEntry>();

const entries: ChartRegistryEntry[] = [
  {
    type: "bar",
    label: "Bar chart",
    icon: IconChartBar,
    category: "cartesian",
    editorCapabilities: {
      xAxis: true,
      series: true,
      multiSeries: true,
      gridlines: true,
      legendPosition: true,
    },
    renderer: BarChartRenderer,
  },
  {
    type: "line",
    label: "Line chart",
    icon: IconChartLine,
    category: "cartesian",
    editorCapabilities: {
      xAxis: true,
      series: true,
      multiSeries: true,
      gridlines: true,
      legendPosition: true,
    },
    renderer: LineChartRenderer,
  },
  {
    type: "area",
    label: "Area chart",
    icon: IconChartArea,
    category: "cartesian",
    editorCapabilities: {
      xAxis: true,
      series: true,
      multiSeries: true,
      gridlines: true,
      legendPosition: true,
    },
    renderer: AreaChartRenderer,
  },
  {
    type: "pie",
    label: "Pie chart",
    icon: IconChartPie,
    category: "radial",
    editorCapabilities: {
      xAxis: true,
      series: true,
      multiSeries: false,
      gridlines: false,
      legendPosition: true,
    },
    renderer: PieChartRenderer,
  },
  {
    type: "scatter",
    label: "Scatter chart",
    icon: IconChartDots,
    category: "scatter",
    editorCapabilities: {
      xAxis: true,
      series: true,
      multiSeries: true,
      gridlines: true,
      legendPosition: true,
    },
    renderer: ScatterChartRenderer,
  },
];

for (const entry of entries) {
  if (registry.has(entry.type)) {
    throw new Error(`Duplicate chart type in registry: ${entry.type}`);
  }
  registry.set(entry.type, entry);
}

export function getChartEntry(type: ChartType): ChartRegistryEntry {
  const entry = registry.get(type);
  if (!entry) {
    throw new Error(`Unknown chart type: ${type}`);
  }
  return entry;
}

export function getAllChartEntries(): ChartRegistryEntry[] {
  return [...registry.values()];
}
