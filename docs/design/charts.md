---
title: charts
target-version: 0.1.0
---

# Charts

## Summary

Expand the chart system from 2 types (bar, line) to 5 types (bar, line, area,
pie, scatter) with a registry-based architecture and a Setup/Customize editor
panel. This is Phase 1 of a multi-phase effort toward Google Sheets chart
parity.

## Goals / Non-Goals

### Goals

- Add area, pie, and scatter chart types using Recharts
- Refactor chart rendering into a registry pattern for easy future extension
- Restructure the chart editor panel into Setup / Customize tabs
- Add basic customization options: title, legend position, gridlines, color
  palette
- Maintain backward compatibility with existing chart data in Yorkie documents

### Non-Goals

- Stacked / 100% stacked variants (Phase 2)
- Combo charts with mixed series render types (Phase 2)
- Horizontal bar charts (Phase 2: rename current "bar" to horizontal, add
  "column" for vertical)
- Multiple data range combination (Phase 2)
- Row/column switch, header recognition toggle (Phase 2)
- Advanced customization: axis min/max, log scale, trendlines, data labels,
  error bars (Phase 2+)
- Specialized chart types: histogram, candlestick, waterfall, treemap,
  organizational, geo, radar, gauge, scorecard, timeline, table (Phase 3+)
- SPARKLINE formula function (separate track)

## Proposal Details

### 1. Type System

Extend `ChartType` in `packages/frontend/src/types/worksheet.ts`:

```typescript
export type ChartType = "bar" | "line" | "area" | "pie" | "scatter";
```

Current "bar" renders vertical bars (equivalent to Google Sheets' "Column
chart"). Phase 2 will introduce the horizontal bar / column distinction.

### 2. SheetChart Data Model

The existing `SheetChart` structure is reused with semantic reinterpretation
per chart type. No Yorkie schema migration required.

```typescript
export type SheetChart = {
  id: string;
  type: ChartType;
  title?: string;
  sourceTabId: string;
  sourceRange: string;       // A1 notation (e.g. "A1:C20")
  xAxisColumn?: string;      // column letter (e.g. "A")
  seriesColumns?: string[];  // column letters (e.g. ["B", "C"])
  anchor: Sref;
  offsetX: number;           // logical px from anchor cell
  offsetY: number;
  width: number;             // logical px
  height: number;
  // Phase 1 customization (all optional, defaults applied at render)
  legendPosition?: "top" | "bottom" | "right" | "left" | "none";
  showGridlines?: boolean;   // default: true for cartesian, N/A for pie
  colorPalette?: string;     // preset name: "default" | "warm" | "cool" etc.
};
```

#### Field Semantics by Chart Type

| Field            | bar / line / area          | pie                    | scatter                |
| ---------------- | -------------------------- | ---------------------- | ---------------------- |
| `xAxisColumn`    | Category axis column       | Label column           | X-value column (num)   |
| `seriesColumns`  | Value columns (multi)      | Value column (single)  | Y-value columns (num)  |

#### Pie Dataset

Pie charts need a flat `{ name, value, color }[]` structure. A dedicated
builder function converts the standard SheetChart fields:

```typescript
type PieDatasetEntry = { name: string; value: number; color: string };
type PieDataset = { entries: PieDatasetEntry[] };

function buildPieDataset(root, chart): PieDataset;
```

- Rows with non-positive values are excluded.
- The label column provides slice names; the first series column provides
  values.

#### Scatter Dataset

Scatter reuses the existing `ChartDataset` structure. Both X and Y values
are numeric. The `xKey` field references numeric X values instead of
categorical labels.

### 3. Chart Registry

A central registry maps each `ChartType` to its renderer component,
editor metadata, and display information.

File: `packages/frontend/src/app/spreadsheet/charts/chart-registry.ts`

```typescript
type ChartCategory = "cartesian" | "radial" | "scatter";

type EditorCapabilities = {
  xAxis: boolean;          // show X-axis column selector
  series: boolean;         // show series checkboxes
  multiSeries: boolean;    // allow multiple series selection
  gridlines: boolean;      // show gridlines toggle in Customize
  legendPosition: boolean; // show legend position in Customize
};

type ChartRegistryEntry = {
  type: ChartType;
  label: string;           // display name (e.g. "Bar chart")
  icon: ComponentType<{ size: number }>;
  category: ChartCategory;
  editorCapabilities: EditorCapabilities;
  renderer: ComponentType<ChartRendererProps>;
};
```

Registry entries for Phase 1:

| Type    | Category   | xAxis | series | multiSeries | gridlines | legend |
| ------- | ---------- | ----- | ------ | ----------- | --------- | ------ |
| bar     | cartesian  | yes   | yes    | yes         | yes       | yes    |
| line    | cartesian  | yes   | yes    | yes         | yes       | yes    |
| area    | cartesian  | yes   | yes    | yes         | yes       | yes    |
| pie     | radial     | yes   | yes    | no          | no        | yes    |
| scatter | scatter    | yes   | yes    | yes         | yes       | yes    |

### 4. Chart Renderers

Each renderer is a pure presentation component receiving a dataset and
layout props.

File structure:

```
packages/frontend/src/app/spreadsheet/charts/
  chart-registry.ts
  bar-chart-renderer.tsx
  line-chart-renderer.tsx
  area-chart-renderer.tsx
  pie-chart-renderer.tsx
  scatter-chart-renderer.tsx
```

#### Shared Renderer Props (Cartesian)

```typescript
type CartesianChartRendererProps = {
  dataset: ChartDataset;
  yAxisWidth: number;
  showGridlines: boolean;
  legendPosition: LegendPosition;
};
```

#### Pie Renderer Props

```typescript
type PieChartRendererProps = {
  dataset: PieDataset;
  legendPosition: LegendPosition;
};
```

#### Scatter Renderer Props

```typescript
type ScatterChartRendererProps = {
  dataset: ChartDataset;
  yAxisWidth: number;
  showGridlines: boolean;
  legendPosition: LegendPosition;
};
```

#### Recharts Component Mapping

| Type    | Recharts Components                    | Notes                          |
| ------- | -------------------------------------- | ------------------------------ |
| bar     | `BarChart`, `Bar`                      | Existing, extract to renderer  |
| line    | `LineChart`, `Line`                    | Existing, extract to renderer  |
| area    | `AreaChart`, `Area`                    | Fill with gradient, stroke     |
| pie     | `PieChart`, `Pie`, `Cell`              | No axes, label on slices       |
| scatter | `ScatterChart`, `Scatter`, `ZAxis`     | Both axes numeric              |

### 5. Chart Editor Panel

Restructure the chart editor panel from a flat layout into a two-tab
structure using the existing `Tabs` component from Radix UI.

#### Setup Tab

Contains the data-binding controls:

1. **Chart type** — dropdown with icon + label from registry
2. **Data range** — A1 input + Apply button + "Use selected range"
3. **X-axis / Label column** — dropdown (label changes per chart type via
   registry)
4. **Series / Value columns** — checkboxes (single select for pie via
   `multiSeries` flag)

When the chart type changes, the editor re-evaluates which controls to
show based on `editorCapabilities`.

#### Customize Tab

Contains style/presentation controls:

1. **Chart title** — text input (moved from current top-level)
2. **Legend position** — dropdown: Top / Bottom / Right / Left / None
   (shown when `legendPosition` capability is true)
3. **Gridlines** — toggle switch (shown when `gridlines` capability is
   true)
4. **Color palette** — preset selector with color swatches

### 6. Color Palettes

Phase 1 provides 3 built-in palettes:

```typescript
const COLOR_PALETTES = {
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
```

The `default` palette preserves the existing theme-based color behavior.
Named palettes use fixed colors that work across light and dark themes.

### 7. Data Flow

```
User inserts chart
  → handleInsertChart() creates SheetChart with defaults
  → Yorkie doc.update() persists chart
  → ChartObjectLayer reads charts from root.sheets[tabId].charts
  → For each chart:
      1. getChartEntry(chart.type) from registry
      2. Build dataset via buildChartDataset() or buildPieDataset()
      3. Resolve customization options (fallback to defaults)
      4. Render via entry.renderer component
  → Chart editor panel reads registry for Setup/Customize UI
```

### 8. Backward Compatibility

All new `SheetChart` fields are optional with render-time defaults:
- `legendPosition` defaults to `"bottom"` for cartesian, `"right"` for pie
- `showGridlines` defaults to `true`
- `colorPalette` defaults to `"default"`

Existing charts with `type: "bar" | "line"` continue to work unchanged.

### 9. Lazy Loading

The current lazy-loading strategy is preserved:
- `ChartObjectLayer` and `ChartEditorPanel` are loaded via `React.lazy`
- Individual chart renderers are imported statically within the lazy boundary
  (they share the same Recharts dependency, so code-splitting per renderer
  adds complexity without meaningful bundle savings)

### 10. Testing Strategy

- **Unit tests** for chart-utils: `buildPieDataset()`, scatter dataset
  building with numeric X values
- **Unit tests** for chart-registry: all types registered, lookup
  returns correct entry
- **Visual regression tests**: snapshot each chart type with sample data
- **Editor interaction tests**: tab switching, type change updates UI,
  pie enforces single series selection

## Risks and Mitigation

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Recharts PieChart has different API than cartesian charts | Medium | Separate renderer with dedicated props type |
| Scatter with non-numeric X values produces empty chart | Low | Validate at dataset build time, show "Not enough numeric data" fallback |
| Adding optional fields to Yorkie doc may cause issues with old clients | Low | All fields optional with render-time defaults; old clients ignore unknown fields |
| Bundle size increase from new Recharts components | Low | Already lazy-loaded; Area/Scatter/Pie are part of the Recharts package |

## Phase Roadmap

### Phase 1 (this document)
- 5 chart types: bar, line, area, pie, scatter
- Registry pattern architecture
- Setup/Customize editor tabs
- Basic customization: title, legend, gridlines, color palette

### Phase 2
- Stacked / 100% stacked variants for bar, area
- Combo chart (mixed series render types)
- Horizontal bar (rename current "bar")
- Multiple data range combination
- Row/column switch, header recognition toggle
- Axis options: min/max, log scale

### Phase 3+
- Histogram, candlestick, waterfall
- Treemap, organizational
- Radar, gauge, scorecard
- Trendlines, data labels, error bars
- Geo chart (requires map library)
- Annotated timeline, table chart
- SPARKLINE formula function
