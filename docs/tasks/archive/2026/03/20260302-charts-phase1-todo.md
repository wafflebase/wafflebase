# Charts Phase 1 Implementation Plan

> **Status:** COMPLETED — all tasks done, pushed to `feat/charts-phase1`.

**Goal:** Expand chart system from 2 types (bar, line) to 5 types (bar, line, area, pie, scatter) with a registry architecture and Setup/Customize editor.

**Architecture:** Registry pattern maps each ChartType to a renderer component and editor metadata. Renderers are pure presentation components using Recharts. Editor restructured into Setup/Customize tabs using Radix Tabs.

**Tech Stack:** React 19, Recharts 2.15, Radix UI (Tabs, Select, Checkbox), Tabler Icons, Vitest

**Design doc:** `design/charts.md`

## Summary

16 commits on `feat/charts-phase1`:

- Tasks 1–12: core implementation (types, palette, pie dataset, registry,
  5 renderers, editor tabs, Yorkie persistence, docs)
- Task 13: final verification
- Visual regression baselines for all 5 chart types (desktop + mobile)
- Recharts animation disabled (`isAnimationActive={false}`) for deterministic SVG
- Scatter chart fixes: data point rendering (x/y mapping) and legend labels

## Completed Tasks

- [x] Task 1: Extend ChartType and SheetChart model
- [x] Task 2: Add color palette system
- [x] Task 3: Add buildPieDataset
- [x] Task 4: Create chart registry
- [x] Task 5: Extract bar and line renderers
- [x] Task 6: Add area chart renderer
- [x] Task 7: Add pie chart renderer
- [x] Task 8: Add scatter chart renderer
- [x] Task 9: Restructure chart editor (Setup/Customize tabs)
- [x] Task 10: Update handleUpdateChart for new fields
- [x] Task 11: Pass colorPalette through dataset building
- [x] Task 12: Update frontend.md design doc
- [x] Task 13: Final verification and cleanup
- [x] Extra: Visual regression baselines (5 chart types × 2 viewports)
- [x] Extra: Fix Recharts animation non-determinism
- [x] Extra: Fix scatter chart data point rendering
- [x] Extra: Fix scatter chart legend labels

---

### Task 1: Extend ChartType and SheetChart model

**Files:**
- Modify: `packages/frontend/src/types/worksheet.ts:11-26`

**Step 1: Update ChartType union**

In `packages/frontend/src/types/worksheet.ts`, change line 11:

```typescript
// Before
export type ChartType = "bar" | "line";

// After
export type ChartType = "bar" | "line" | "area" | "pie" | "scatter";
```

**Step 2: Add optional customization fields to SheetChart**

After the existing `height: number;` field (line 25), add:

```typescript
export type SheetChart = {
  id: string;
  type: ChartType;
  title?: string;
  sourceTabId: string;
  sourceRange: string;
  xAxisColumn?: string;
  seriesColumns?: string[];
  anchor: Sref;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  legendPosition?: "top" | "bottom" | "right" | "left" | "none";
  showGridlines?: boolean;
  colorPalette?: string;
};
```

**Step 3: Run type check**

Run: `cd packages/frontend && pnpm tsc --noEmit`
Expected: PASS (all new fields are optional, backward compatible)

**Step 4: Commit**

```
Extend ChartType with area, pie, and scatter

Add three new chart types to the union and optional
customization fields (legendPosition, showGridlines,
colorPalette) to SheetChart. All new fields are optional
for backward compatibility with existing Yorkie documents.
```

---

### Task 2: Add color palette system to chart-utils

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/chart-utils.ts:312-322`

**Step 1: Write test for color palettes**

Create `packages/frontend/src/app/spreadsheet/__tests__/chart-utils.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { getSeriesColor, COLOR_PALETTES } from "../chart-utils";

describe("getSeriesColor", () => {
  it("returns default palette colors when no palette specified", () => {
    const color = getSeriesColor(0);
    expect(color).toBe(COLOR_PALETTES.default[0]);
  });

  it("returns named palette color", () => {
    const color = getSeriesColor(0, "warm");
    expect(color).toBe(COLOR_PALETTES.warm[0]);
  });

  it("wraps around when index exceeds palette length", () => {
    const color = getSeriesColor(5);
    expect(color).toBe(COLOR_PALETTES.default[0]);
  });

  it("falls back to default for unknown palette", () => {
    const color = getSeriesColor(0, "nonexistent");
    expect(color).toBe(COLOR_PALETTES.default[0]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/frontend && pnpm vitest run src/app/spreadsheet/__tests__/chart-utils.test.ts`
Expected: FAIL (getSeriesColor and COLOR_PALETTES not exported)

**Step 3: Implement color palettes**

In `packages/frontend/src/app/spreadsheet/chart-utils.ts`, replace the
existing `getSeriesThemeColor` function (lines 312-322) with:

```typescript
export const COLOR_PALETTES: Record<string, string[]> = {
  default: [
    "var(--color-primary)",
    "color-mix(in oklch, var(--color-primary) 78%, var(--color-background))",
    "color-mix(in oklch, var(--color-primary) 68%, var(--color-foreground))",
    "color-mix(in oklch, var(--color-primary) 56%, var(--color-background))",
    "color-mix(in oklch, var(--color-primary) 46%, var(--color-foreground))",
  ],
  warm: ["#e76f51", "#f4a261", "#e9c46a", "#d4a373", "#c97c5d"],
  cool: ["#264653", "#2a9d8f", "#457b9d", "#6a8caf", "#84a9c4"],
};

export function getSeriesColor(index: number, palette?: string): string {
  const colors = COLOR_PALETTES[palette ?? "default"] ?? COLOR_PALETTES.default;
  return colors[index % colors.length];
}
```

Update `buildChartDataset` to use the new `getSeriesColor` instead of
`getSeriesThemeColor`. In the for-loop at line ~219:

```typescript
// Before
color: getSeriesThemeColor(index),

// After
color: getSeriesColor(index),
```

Remove the old `getSeriesThemeColor` function.

**Step 4: Run test to verify it passes**

Run: `cd packages/frontend && pnpm vitest run src/app/spreadsheet/__tests__/chart-utils.test.ts`
Expected: PASS

**Step 5: Commit**

```
Add color palette system for chart series

Replace getSeriesThemeColor with getSeriesColor that
supports named palettes (default, warm, cool). The default
palette preserves existing theme-based color behavior.
```

---

### Task 3: Add buildPieDataset to chart-utils

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/chart-utils.ts`
- Modify: `packages/frontend/src/app/spreadsheet/__tests__/chart-utils.test.ts`

**Step 1: Write test for buildPieDataset**

Append to `chart-utils.test.ts`:

```typescript
import { buildPieDataset } from "../chart-utils";
import type { SpreadsheetDocument } from "@/types/worksheet";

function makeDoc(cells: Record<string, string>): SpreadsheetDocument {
  const sheet: Record<string, { v: string }> = {};
  for (const [ref, value] of Object.entries(cells)) {
    sheet[ref] = { v: value };
  }
  return {
    tabs: { "tab-1": { id: "tab-1", name: "Sheet1", type: "sheet" } },
    tabOrder: ["tab-1"],
    sheets: {
      "tab-1": {
        sheet,
        rowHeights: {},
        colWidths: {},
        colStyles: {},
        rowStyles: {},
        frozenRows: 0,
        frozenCols: 0,
      },
    },
  };
}

describe("buildPieDataset", () => {
  it("builds pie entries from label and value columns", () => {
    const doc = makeDoc({
      A1: "Category",
      B1: "Sales",
      A2: "Apples",
      B2: "30",
      A3: "Bananas",
      B3: "20",
      A4: "Cherries",
      B4: "50",
    });
    const result = buildPieDataset(doc, {
      sourceTabId: "tab-1",
      sourceRange: "A1:B4",
      xAxisColumn: "A",
      seriesColumns: ["B"],
    });
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]).toEqual(
      expect.objectContaining({ name: "Apples", value: 30 }),
    );
  });

  it("excludes non-positive values", () => {
    const doc = makeDoc({
      A1: "Cat",
      B1: "Val",
      A2: "X",
      B2: "10",
      A3: "Y",
      B3: "0",
      A4: "Z",
      B4: "-5",
    });
    const result = buildPieDataset(doc, {
      sourceTabId: "tab-1",
      sourceRange: "A1:B4",
      xAxisColumn: "A",
      seriesColumns: ["B"],
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].name).toBe("X");
  });

  it("returns empty for missing source", () => {
    const doc = makeDoc({});
    const result = buildPieDataset(doc, {
      sourceTabId: "nonexistent",
      sourceRange: "A1:B4",
      xAxisColumn: "A",
      seriesColumns: ["B"],
    });
    expect(result.entries).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/frontend && pnpm vitest run src/app/spreadsheet/__tests__/chart-utils.test.ts`
Expected: FAIL (buildPieDataset not exported)

**Step 3: Implement buildPieDataset**

Add to `chart-utils.ts` after the existing types:

```typescript
export type PieDatasetEntry = { name: string; value: number; color: string };
export type PieDataset = { entries: PieDatasetEntry[] };

export function buildPieDataset(
  root: SpreadsheetDocument,
  chart: Pick<
    SheetChart,
    "sourceTabId" | "sourceRange" | "xAxisColumn" | "seriesColumns"
  >,
  palette?: string,
): PieDataset {
  const sourceSheet = root.sheets[chart.sourceTabId];
  if (!sourceSheet) {
    return { entries: [] };
  }

  const parsed = parseA1Range(chart.sourceRange);
  if (!parsed) {
    return { entries: [] };
  }

  const [from, to] = parsed;
  const labelColIndex = toColumnIndex(
    normalizeColumnName(chart.xAxisColumn) ?? "",
  );
  const valueCol = chart.seriesColumns?.[0];
  const valueColIndex = valueCol
    ? toColumnIndex(normalizeColumnName(valueCol) ?? "")
    : null;

  if (!labelColIndex || !valueColIndex) {
    return { entries: [] };
  }

  const entries: PieDatasetEntry[] = [];
  for (let r = from.r + 1; r <= to.r; r++) {
    const name =
      getCellDisplayValue(sourceSheet, r, labelColIndex) || `Row ${r - from.r}`;
    const numeric = toNumeric(
      getCellDisplayValue(sourceSheet, r, valueColIndex),
    );
    if (numeric !== null && numeric > 0) {
      entries.push({
        name,
        value: numeric,
        color: getSeriesColor(entries.length, palette),
      });
    }
  }

  return { entries };
}
```

Note: `getCellDisplayValue`, `toNumeric`, `toColumnIndex`, and
`normalizeColumnName` are existing private functions. `normalizeColumnName`
must be exported or `buildPieDataset` placed in the same file (it already is).

**Step 4: Run test to verify it passes**

Run: `cd packages/frontend && pnpm vitest run src/app/spreadsheet/__tests__/chart-utils.test.ts`
Expected: PASS

**Step 5: Commit**

```
Add buildPieDataset for pie chart data transformation

Extracts label and value columns into a flat array of
entries suitable for Recharts PieChart. Non-positive
values are excluded per Google Sheets behavior.
```

---

### Task 4: Create chart registry

**Files:**
- Create: `packages/frontend/src/app/spreadsheet/charts/chart-registry.ts`

**Step 1: Write test**

Create `packages/frontend/src/app/spreadsheet/charts/__tests__/chart-registry.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { getChartEntry, getAllChartEntries } from "../chart-registry";

describe("chart-registry", () => {
  it("returns entry for bar", () => {
    const entry = getChartEntry("bar");
    expect(entry).toBeDefined();
    expect(entry.label).toBe("Bar chart");
    expect(entry.category).toBe("cartesian");
  });

  it("returns entry for line", () => {
    const entry = getChartEntry("line");
    expect(entry).toBeDefined();
    expect(entry.category).toBe("cartesian");
  });

  it("returns entry for area", () => {
    const entry = getChartEntry("area");
    expect(entry).toBeDefined();
    expect(entry.category).toBe("cartesian");
  });

  it("returns entry for pie", () => {
    const entry = getChartEntry("pie");
    expect(entry).toBeDefined();
    expect(entry.category).toBe("radial");
    expect(entry.editorCapabilities.multiSeries).toBe(false);
    expect(entry.editorCapabilities.gridlines).toBe(false);
  });

  it("returns entry for scatter", () => {
    const entry = getChartEntry("scatter");
    expect(entry).toBeDefined();
    expect(entry.category).toBe("scatter");
  });

  it("getAllChartEntries returns all 5 types", () => {
    const entries = getAllChartEntries();
    expect(entries).toHaveLength(5);
    const types = entries.map((e) => e.type);
    expect(types).toContain("bar");
    expect(types).toContain("line");
    expect(types).toContain("area");
    expect(types).toContain("pie");
    expect(types).toContain("scatter");
  });

  it("throws for unknown type", () => {
    expect(() => getChartEntry("unknown" as never)).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/frontend && pnpm vitest run src/app/spreadsheet/charts/__tests__/chart-registry.test.ts`
Expected: FAIL (module not found)

**Step 3: Implement registry (without renderers initially)**

Create `packages/frontend/src/app/spreadsheet/charts/chart-registry.ts`:

```typescript
import type { ComponentType } from "react";
import {
  IconChartArea,
  IconChartBar,
  IconChartDots,
  IconChartLine,
  IconChartPie,
} from "@tabler/icons-react";
import type { ChartType } from "@/types/worksheet";

export type ChartCategory = "cartesian" | "radial" | "scatter";

export type EditorCapabilities = {
  xAxis: boolean;
  series: boolean;
  multiSeries: boolean;
  gridlines: boolean;
  legendPosition: boolean;
};

export type ChartRendererProps = {
  dataset: unknown;
  yAxisWidth: number;
  showGridlines: boolean;
  legendPosition: "top" | "bottom" | "right" | "left" | "none";
};

export type ChartRegistryEntry = {
  type: ChartType;
  label: string;
  icon: ComponentType<{ size: number }>;
  category: ChartCategory;
  editorCapabilities: EditorCapabilities;
  renderer: ComponentType<ChartRendererProps> | null;
};

const REGISTRY: ChartRegistryEntry[] = [
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
    renderer: null, // set in Task 5
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
    renderer: null,
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
    renderer: null,
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
    renderer: null,
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
    renderer: null,
  },
];

const REGISTRY_MAP = new Map(REGISTRY.map((entry) => [entry.type, entry]));

export function getChartEntry(type: ChartType): ChartRegistryEntry {
  const entry = REGISTRY_MAP.get(type);
  if (!entry) {
    throw new Error(`Unknown chart type: ${type}`);
  }
  return entry;
}

export function getAllChartEntries(): ChartRegistryEntry[] {
  return REGISTRY;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/frontend && pnpm vitest run src/app/spreadsheet/charts/__tests__/chart-registry.test.ts`
Expected: PASS

**Step 5: Commit**

```
Add chart registry with 5 chart type entries

Registry maps each ChartType to display info, editor
capabilities, and a renderer slot. Renderers are wired
in subsequent tasks.
```

---

### Task 5: Extract bar and line renderers

**Files:**
- Create: `packages/frontend/src/app/spreadsheet/charts/bar-chart-renderer.tsx`
- Create: `packages/frontend/src/app/spreadsheet/charts/line-chart-renderer.tsx`
- Modify: `packages/frontend/src/app/spreadsheet/charts/chart-registry.ts`
- Modify: `packages/frontend/src/app/spreadsheet/chart-object-layer.tsx`

**Step 1: Create bar-chart-renderer.tsx**

Extract the BarChart JSX from `chart-object-layer.tsx` (lines 400-419):

```tsx
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartDataset } from "../chart-utils";

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
    <ChartContainer config={dataset.config} className="!aspect-auto h-full w-full">
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
        {dataset.series.map((series) => (
          <Bar
            key={series.key}
            dataKey={series.key}
            fill={`var(--color-${series.key})`}
            radius={2}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
```

**Step 2: Create line-chart-renderer.tsx**

Same pattern with `LineChart` and `Line`:

```tsx
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartDataset } from "../chart-utils";

type Props = {
  dataset: ChartDataset;
  yAxisWidth: number;
  showGridlines: boolean;
  legendPosition: "top" | "bottom" | "right" | "left" | "none";
  formatYAxisTick: (value: number | string) => string;
};

export function LineChartRenderer({
  dataset,
  yAxisWidth,
  showGridlines,
  legendPosition,
  formatYAxisTick,
}: Props) {
  return (
    <ChartContainer config={dataset.config} className="!aspect-auto h-full w-full">
      <LineChart data={dataset.rows}>
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
        {dataset.series.map((series) => (
          <Line
            key={series.key}
            type="monotone"
            dataKey={series.key}
            stroke={`var(--color-${series.key})`}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
```

**Step 3: Wire renderers into registry**

In `chart-registry.ts`, import and assign:

```typescript
import { BarChartRenderer } from "./bar-chart-renderer";
import { LineChartRenderer } from "./line-chart-renderer";

// In REGISTRY array:
{ type: "bar", ..., renderer: BarChartRenderer },
{ type: "line", ..., renderer: LineChartRenderer },
```

**Step 4: Refactor chart-object-layer.tsx to use registry**

Replace the inline bar/line rendering (lines 374-420) with:

```tsx
import { getChartEntry } from "./charts/chart-registry";
import { buildPieDataset } from "./chart-utils";

// Inside ChartObject, replace the chart type if/else:
const entry = getChartEntry(chart.type);
const showGridlines = chart.showGridlines ?? true;
const legendPosition = chart.legendPosition ?? (entry.category === "radial" ? "right" : "bottom");

if (entry.category === "radial") {
  const pieData = buildPieDataset(root, chart, chart.colorPalette);
  if (pieData.entries.length === 0) {
    // show empty state
  }
  const Renderer = entry.renderer;
  // render pie (handled in Task 7)
} else {
  const dataset = buildChartDataset(root, chart);
  if (dataset.rows.length === 0 || dataset.series.length === 0) {
    // show empty state
  }
  const Renderer = entry.renderer!;
  <Renderer
    dataset={dataset}
    yAxisWidth={yAxisWidth}
    showGridlines={showGridlines}
    legendPosition={legendPosition}
    formatYAxisTick={formatYAxisTick}
  />
}
```

Remove direct Recharts imports (Bar, BarChart, Line, LineChart, CartesianGrid,
XAxis, YAxis) from chart-object-layer.tsx since they now live in renderers.

**Step 5: Run verify:fast**

Run: `pnpm verify:fast`
Expected: PASS (existing bar/line behavior preserved)

**Step 6: Commit**

```
Extract bar and line chart renderers from object layer

Move BarChart and LineChart rendering into dedicated
renderer components and wire them through the chart
registry. ChartObject now delegates rendering via
registry lookup instead of inline if/else.
```

---

### Task 6: Add area chart renderer

**Files:**
- Create: `packages/frontend/src/app/spreadsheet/charts/area-chart-renderer.tsx`
- Modify: `packages/frontend/src/app/spreadsheet/charts/chart-registry.ts`

**Step 1: Create area-chart-renderer.tsx**

```tsx
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartDataset } from "../chart-utils";

type Props = {
  dataset: ChartDataset;
  yAxisWidth: number;
  showGridlines: boolean;
  legendPosition: "top" | "bottom" | "right" | "left" | "none";
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
    <ChartContainer config={dataset.config} className="!aspect-auto h-full w-full">
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
        {dataset.series.map((series) => (
          <Area
            key={series.key}
            type="monotone"
            dataKey={series.key}
            stroke={`var(--color-${series.key})`}
            fill={`var(--color-${series.key})`}
            fillOpacity={0.2}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}
```

**Step 2: Wire into registry**

```typescript
import { AreaChartRenderer } from "./area-chart-renderer";

// In REGISTRY:
{ type: "area", ..., renderer: AreaChartRenderer },
```

**Step 3: Run verify:fast**

Run: `pnpm verify:fast`
Expected: PASS

**Step 4: Commit**

```
Add area chart renderer

Area chart uses filled regions with 20% opacity below
the line, following the same cartesian layout as bar
and line charts.
```

---

### Task 7: Add pie chart renderer

**Files:**
- Create: `packages/frontend/src/app/spreadsheet/charts/pie-chart-renderer.tsx`
- Modify: `packages/frontend/src/app/spreadsheet/charts/chart-registry.ts`
- Modify: `packages/frontend/src/app/spreadsheet/chart-object-layer.tsx`

**Step 1: Create pie-chart-renderer.tsx**

```tsx
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
          innerRadius={0}
          outerRadius="70%"
          label={({ name }) => name}
          labelLine
        >
          {dataset.entries.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}
```

**Step 2: Wire into registry**

```typescript
import { PieChartRenderer } from "./pie-chart-renderer";

// In REGISTRY:
{ type: "pie", ..., renderer: PieChartRenderer },
```

**Step 3: Update ChartObject rendering in chart-object-layer.tsx**

Add pie rendering branch. The ChartObject function needs to handle pie
differently since it uses `buildPieDataset` instead of `buildChartDataset`:

```tsx
const entry = getChartEntry(chart.type);
const showGridlines = chart.showGridlines ?? true;
const legendPosition = chart.legendPosition ??
  (entry.category === "radial" ? "right" : "bottom");

if (entry.category === "radial") {
  const pieData = buildPieDataset(root, chart, chart.colorPalette);
  return pieData.entries.length === 0 ? (
    <EmptyState range={chart.sourceRange} />
  ) : (
    <PieChartRenderer dataset={pieData} legendPosition={legendPosition} />
  );
}

// existing cartesian path...
```

**Step 4: Run verify:fast**

Run: `pnpm verify:fast`
Expected: PASS

**Step 5: Commit**

```
Add pie chart renderer with PieChart and Cell components

Pie chart uses buildPieDataset for data transformation
and renders slices with per-entry colors. Non-positive
values are excluded. Legend defaults to right position.
```

---

### Task 8: Add scatter chart renderer

**Files:**
- Create: `packages/frontend/src/app/spreadsheet/charts/scatter-chart-renderer.tsx`
- Modify: `packages/frontend/src/app/spreadsheet/charts/chart-registry.ts`

**Step 1: Create scatter-chart-renderer.tsx**

```tsx
import {
  CartesianGrid,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartDataset } from "../chart-utils";

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
    <ChartContainer config={dataset.config} className="!aspect-auto h-full w-full">
      <ScatterChart>
        {showGridlines && <CartesianGrid />}
        <XAxis
          dataKey={dataset.xKey}
          type="number"
          name="X"
          tickLine={false}
          axisLine={false}
          tickFormatter={formatYAxisTick}
        />
        <YAxis
          dataKey={dataset.series[0]?.key}
          type="number"
          name="Y"
          tickLine={false}
          axisLine={false}
          width={yAxisWidth}
          tickFormatter={formatYAxisTick}
        />
        <ZAxis range={[40, 40]} />
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
        {dataset.series.map((series) => (
          <Scatter
            key={series.key}
            name={series.label}
            data={dataset.rows}
            fill={`var(--color-${series.key})`}
            dataKey={series.key}
          />
        ))}
      </ScatterChart>
    </ChartContainer>
  );
}
```

**Step 2: Wire into registry**

```typescript
import { ScatterChartRenderer } from "./scatter-chart-renderer";

// In REGISTRY:
{ type: "scatter", ..., renderer: ScatterChartRenderer },
```

**Step 3: Handle scatter in chart-object-layer.tsx**

Scatter uses the same `buildChartDataset` as bar/line/area, but the X axis
should be numeric. The existing dataset builder already puts the X column
value in `xKey`. For scatter, the X values need to be numeric too. Add a
numeric coercion step in the cartesian rendering path or in
`buildChartDataset` when the chart type is scatter.

Simple approach: in the cartesian rendering path of `ChartObject`, when
`entry.category === "scatter"`, coerce the `xKey` values to numbers:

```typescript
if (entry.category === "scatter") {
  for (const row of dataset.rows) {
    const xVal = row[dataset.xKey];
    if (typeof xVal === "string") {
      const num = Number(xVal.replace(/,/g, ""));
      if (Number.isFinite(num)) {
        row[dataset.xKey] = num;
      }
    }
  }
}
```

**Step 4: Run verify:fast**

Run: `pnpm verify:fast`
Expected: PASS

**Step 5: Commit**

```
Add scatter chart renderer with numeric axes

Scatter chart renders data points with both numeric X
and Y axes. X-axis values are coerced from string to
number for proper axis scaling.
```

---

### Task 9: Restructure chart editor into Setup/Customize tabs

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/chart-editor-panel.tsx`

**Step 1: Refactor editor to use tabs**

Replace the flat layout with Setup/Customize tabs. Import the Tabs
components:

```typescript
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAllChartEntries, getChartEntry } from "./charts/chart-registry";
```

Restructure the editor body (`<div className="min-h-0 flex-1 ...">`) into:

```tsx
<Tabs defaultValue="setup" className="flex min-h-0 flex-1 flex-col">
  <TabsList className="mx-4 mt-2 grid w-auto grid-cols-2">
    <TabsTrigger value="setup">Setup</TabsTrigger>
    <TabsTrigger value="customize">Customize</TabsTrigger>
  </TabsList>

  <TabsContent
    value="setup"
    className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 pb-6"
  >
    {/* Chart type selector — use registry for options */}
    <section className="space-y-2">
      <Label htmlFor="chart-type">Chart type</Label>
      <Select
        value={chart.type}
        onValueChange={(value) => {
          onUpdateChart(chart.id, { type: value as ChartType });
        }}
      >
        <SelectTrigger id="chart-type" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {getAllChartEntries().map((entry) => {
            const Icon = entry.icon;
            return (
              <SelectItem key={entry.type} value={entry.type}>
                <span className="flex items-center gap-2">
                  <Icon size={14} />
                  {entry.label}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </section>

    <Separator />

    {/* Data range — existing code */}

    <Separator />

    {/* X-axis / Label column — conditional label */}
    {capabilities.xAxis && (
      <section className="space-y-2">
        <Label htmlFor="chart-x-axis">
          {entry.category === "radial" ? "Label column" : "X-axis"}
        </Label>
        {/* existing dropdown */}
      </section>
    )}

    {/* Series / Value columns — conditional single/multi */}
    {capabilities.series && (
      <section className="space-y-2">
        <Label>
          {entry.category === "radial" ? "Value column" : "Series"}
        </Label>
        {/* existing checkboxes, but for pie: radio-like single select */}
      </section>
    )}
  </TabsContent>

  <TabsContent
    value="customize"
    className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 pb-6"
  >
    {/* Title */}
    <section className="space-y-2">
      <Label htmlFor="chart-title">Chart title</Label>
      <Input
        id="chart-title"
        value={chart.title || ""}
        onChange={(e) => onUpdateChart(chart.id, { title: e.target.value })}
        placeholder="Chart"
      />
    </section>

    <Separator />

    {/* Legend position */}
    {capabilities.legendPosition && (
      <section className="space-y-2">
        <Label htmlFor="chart-legend">Legend</Label>
        <Select
          value={chart.legendPosition ?? (entry.category === "radial" ? "right" : "bottom")}
          onValueChange={(value) =>
            onUpdateChart(chart.id, {
              legendPosition: value as SheetChart["legendPosition"],
            })
          }
        >
          <SelectTrigger id="chart-legend" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="top">Top</SelectItem>
            <SelectItem value="bottom">Bottom</SelectItem>
            <SelectItem value="right">Right</SelectItem>
            <SelectItem value="left">Left</SelectItem>
            <SelectItem value="none">None</SelectItem>
          </SelectContent>
        </Select>
      </section>
    )}

    {/* Gridlines */}
    {capabilities.gridlines && (
      <section className="flex items-center justify-between">
        <Label htmlFor="chart-gridlines">Gridlines</Label>
        <Switch
          id="chart-gridlines"
          checked={chart.showGridlines ?? true}
          onCheckedChange={(checked) =>
            onUpdateChart(chart.id, { showGridlines: checked })
          }
        />
      </section>
    )}

    <Separator />

    {/* Color palette */}
    <section className="space-y-2">
      <Label>Color palette</Label>
      <Select
        value={chart.colorPalette ?? "default"}
        onValueChange={(value) =>
          onUpdateChart(chart.id, { colorPalette: value })
        }
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Theme (default)</SelectItem>
          <SelectItem value="warm">Warm</SelectItem>
          <SelectItem value="cool">Cool</SelectItem>
        </SelectContent>
      </Select>
    </section>
  </TabsContent>
</Tabs>
```

**Step 2: Handle pie single-series selection**

For pie charts (`!capabilities.multiSeries`), replace series checkboxes
with radio-like behavior: clicking one series column deselects others.

```tsx
const handleSeriesToggle = (column: string, enabled: boolean) => {
  if (!capabilities.multiSeries) {
    // Pie: single select — always set to just this column
    onUpdateChart(chart.id, { seriesColumns: [column] });
    return;
  }
  // existing multi-select logic
};
```

**Step 3: Check if Switch component exists**

Search for Switch in `packages/frontend/src/components/ui/`. If it does
not exist, use a Checkbox instead:

```tsx
<Checkbox
  id="chart-gridlines"
  checked={chart.showGridlines ?? true}
  onCheckedChange={(checked) =>
    onUpdateChart(chart.id, { showGridlines: checked === true })
  }
/>
```

**Step 4: Run verify:fast**

Run: `pnpm verify:fast`
Expected: PASS

**Step 5: Commit**

```
Restructure chart editor into Setup/Customize tabs

Setup tab contains chart type, data range, axis, and
series controls. Customize tab contains title, legend
position, gridlines toggle, and color palette selector.
Pie charts enforce single series selection.
```

---

### Task 10: Update handleUpdateChart for new fields

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/sheet-view.tsx`

**Step 1: Add new fields to the update handler**

In `handleUpdateChart` (around line 283), ensure the new optional fields
are included in the patch application. The current code patches individual
known fields. Add the new ones:

```typescript
if (patch.legendPosition !== undefined) {
  root.sheets[tabId].charts[chartId].legendPosition = patch.legendPosition;
}
if (patch.showGridlines !== undefined) {
  root.sheets[tabId].charts[chartId].showGridlines = patch.showGridlines;
}
if (patch.colorPalette !== undefined) {
  root.sheets[tabId].charts[chartId].colorPalette = patch.colorPalette;
}
```

**Step 2: Run verify:fast**

Run: `pnpm verify:fast`
Expected: PASS

**Step 3: Commit**

```
Persist chart customization fields through Yorkie

Add legendPosition, showGridlines, and colorPalette
to the Yorkie update handler so customization changes
are saved and synced in real time.
```

---

### Task 11: Pass colorPalette through dataset building

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/chart-utils.ts`
- Modify: `packages/frontend/src/app/spreadsheet/chart-object-layer.tsx`

**Step 1: Update buildChartDataset to accept palette**

Add `palette?: string` parameter to `buildChartDataset`:

```typescript
export function buildChartDataset(
  root: SpreadsheetDocument,
  chart: Pick<
    SheetChart,
    "sourceTabId" | "sourceRange" | "xAxisColumn" | "seriesColumns"
  >,
  palette?: string,
): ChartDataset {
```

Replace `getSeriesColor(index)` call with `getSeriesColor(index, palette)`.

**Step 2: Update ChartObject to pass palette**

In `chart-object-layer.tsx`, pass `chart.colorPalette`:

```typescript
const dataset = buildChartDataset(root, chart, chart.colorPalette);
```

**Step 3: Run verify:fast**

Run: `pnpm verify:fast`
Expected: PASS

**Step 4: Commit**

```
Thread color palette through chart dataset building

Both buildChartDataset and buildPieDataset now accept
an optional palette name, enabling warm/cool color
schemes selected in the Customize tab.
```

---

### Task 12: Update frontend.md design doc

**Files:**
- Modify: `design/frontend.md`

**Step 1: Update SheetChart type in design doc**

Update the `SheetChart` type definition in `design/frontend.md` (around
line 140) to include the new chart types and customization fields:

```typescript
type SheetChart = {
  id: string;
  type: 'bar' | 'line' | 'area' | 'pie' | 'scatter';
  title?: string;
  sourceTabId: string;
  sourceRange: string;
  xAxisColumn?: string;
  seriesColumns?: string[];
  anchor: Sref;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  legendPosition?: 'top' | 'bottom' | 'right' | 'left' | 'none';
  showGridlines?: boolean;
  colorPalette?: string;
};
```

**Step 2: Update chart description text**

Update the "Insert chart" paragraph (around line 110) to mention the new
chart types and editor tabs.

**Step 3: Commit**

```
Update frontend.md for chart Phase 1 changes

Add new chart types and customization fields to
SheetChart type, and update chart description to
reflect Setup/Customize editor structure.
```

---

### Task 13: Final verification and cleanup

**Step 1: Run full verify**

Run: `pnpm verify:fast`
Expected: All checks PASS

**Step 2: Manual smoke test**

1. `pnpm dev`
2. Create a sheet with sample data (A1:C6)
3. Select range, click "Insert chart"
4. Verify bar chart appears (default)
5. Open editor, switch to each type: line, area, pie, scatter
6. Verify each renders correctly
7. Switch to Customize tab, change legend, gridlines, palette
8. Verify visual changes

**Step 3: Archive task**

Run: `pnpm tasks:archive && pnpm tasks:index`

---

## Task Dependency Graph

```
Task 1 (types)
  ├─→ Task 2 (color palettes)
  │     └─→ Task 3 (pie dataset)
  │           └─→ Task 7 (pie renderer)
  ├─→ Task 4 (registry)
  │     ├─→ Task 5 (extract bar/line)
  │     │     ├─→ Task 6 (area renderer)
  │     │     ├─→ Task 8 (scatter renderer)
  │     │     └─→ Task 9 (editor tabs) ──→ Task 10 (update handler)
  │     └───────────────────────────────→ Task 11 (palette threading)
  └─→ Task 12 (docs)

Task 13 (verification) depends on all above
```
