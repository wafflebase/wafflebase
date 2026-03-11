import { MemStore, type Grid, type Theme } from "@wafflebase/sheet";
import { useCallback, useMemo, useState } from "react";
import type { Scenario, ScenarioSetup } from "./sheet-scenarios";
import { ScenarioCard } from "./sheet-scenarios";

async function createTextDecorationStore(): Promise<ScenarioSetup> {
  const grid: Grid = new Map([
    ["A1", { v: "Bold" }],
    ["B1", { v: "Italic" }],
    ["C1", { v: "Underline" }],
    ["D1", { v: "Strikethrough" }],
    ["A2", { v: "Bold text" }],
    ["B2", { v: "Italic text" }],
    ["C2", { v: "Underlined" }],
    ["D2", { v: "Struck out" }],
    ["A3", { v: "Bold+Italic" }],
    ["B3", { v: "Bold+Under" }],
    ["C3", { v: "All four" }],
    ["D3", { v: "Plain text" }],
  ]);

  const store = new MemStore(grid);
  await store.setDimensionSize("column", 1, 140);
  await store.setDimensionSize("column", 2, 140);
  await store.setDimensionSize("column", 3, 140);
  await store.setDimensionSize("column", 4, 140);

  // Header row
  await store.addRangeStyle({
    range: [{ r: 1, c: 1 }, { r: 1, c: 4 }],
    style: { b: true, bg: "#f1f5f9", al: "center" },
  });

  // Row 2: individual styles
  await store.addRangeStyle({
    range: [{ r: 2, c: 1 }, { r: 2, c: 1 }],
    style: { b: true },
  });
  await store.addRangeStyle({
    range: [{ r: 2, c: 2 }, { r: 2, c: 2 }],
    style: { i: true },
  });
  await store.addRangeStyle({
    range: [{ r: 2, c: 3 }, { r: 2, c: 3 }],
    style: { u: true },
  });
  await store.addRangeStyle({
    range: [{ r: 2, c: 4 }, { r: 2, c: 4 }],
    style: { st: true },
  });

  // Row 3: combined styles
  await store.addRangeStyle({
    range: [{ r: 3, c: 1 }, { r: 3, c: 1 }],
    style: { b: true, i: true },
  });
  await store.addRangeStyle({
    range: [{ r: 3, c: 2 }, { r: 3, c: 2 }],
    style: { b: true, u: true },
  });
  await store.addRangeStyle({
    range: [{ r: 3, c: 3 }, { r: 3, c: 3 }],
    style: { b: true, i: true, u: true, st: true },
  });

  return { store };
}

async function createTextBgColorsStore(): Promise<ScenarioSetup> {
  const grid: Grid = new Map([
    ["A1", { v: "Color" }],
    ["B1", { v: "On White" }],
    ["C1", { v: "On Dark" }],
    ["D1", { v: "Accent" }],
    ["A2", { v: "Red" }],
    ["B2", { v: "Red text" }],
    ["C2", { v: "Light red" }],
    ["D2", { v: "Red bg" }],
    ["A3", { v: "Blue" }],
    ["B3", { v: "Blue text" }],
    ["C3", { v: "Light blue" }],
    ["D3", { v: "Blue bg" }],
    ["A4", { v: "Green" }],
    ["B4", { v: "Green text" }],
    ["C4", { v: "Light green" }],
    ["D4", { v: "Green bg" }],
  ]);

  const store = new MemStore(grid);
  await store.setDimensionSize("column", 1, 120);
  await store.setDimensionSize("column", 2, 140);
  await store.setDimensionSize("column", 3, 140);
  await store.setDimensionSize("column", 4, 140);

  // Header row with colored backgrounds
  await store.addRangeStyle({
    range: [{ r: 1, c: 1 }, { r: 1, c: 4 }],
    style: { b: true, bg: "#e2e8f0", al: "center" },
  });

  // Red row
  await store.addRangeStyle({
    range: [{ r: 2, c: 2 }, { r: 2, c: 2 }],
    style: { tc: "#dc2626" },
  });
  await store.addRangeStyle({
    range: [{ r: 2, c: 3 }, { r: 2, c: 3 }],
    style: { tc: "#fecaca", bg: "#7f1d1d" },
  });
  await store.addRangeStyle({
    range: [{ r: 2, c: 4 }, { r: 2, c: 4 }],
    style: { tc: "#7f1d1d", bg: "#fee2e2" },
  });

  // Blue row
  await store.addRangeStyle({
    range: [{ r: 3, c: 2 }, { r: 3, c: 2 }],
    style: { tc: "#2563eb" },
  });
  await store.addRangeStyle({
    range: [{ r: 3, c: 3 }, { r: 3, c: 3 }],
    style: { tc: "#bfdbfe", bg: "#1e3a5f" },
  });
  await store.addRangeStyle({
    range: [{ r: 3, c: 4 }, { r: 3, c: 4 }],
    style: { tc: "#1e3a5f", bg: "#dbeafe" },
  });

  // Green row
  await store.addRangeStyle({
    range: [{ r: 4, c: 2 }, { r: 4, c: 2 }],
    style: { tc: "#16a34a" },
  });
  await store.addRangeStyle({
    range: [{ r: 4, c: 3 }, { r: 4, c: 3 }],
    style: { tc: "#bbf7d0", bg: "#14532d" },
  });
  await store.addRangeStyle({
    range: [{ r: 4, c: 4 }, { r: 4, c: 4 }],
    style: { tc: "#14532d", bg: "#dcfce7" },
  });

  return { store };
}

async function createAlignmentStore(): Promise<ScenarioSetup> {
  const grid: Grid = new Map([
    ["A1", { v: "Top-Left" }],
    ["B1", { v: "Top-Center" }],
    ["C1", { v: "Top-Right" }],
    ["A2", { v: "Mid-Left" }],
    ["B2", { v: "Mid-Center" }],
    ["C2", { v: "Mid-Right" }],
    ["A3", { v: "Bot-Left" }],
    ["B3", { v: "Bot-Center" }],
    ["C3", { v: "Bot-Right" }],
  ]);

  const store = new MemStore(grid);
  await store.setDimensionSize("column", 1, 160);
  await store.setDimensionSize("column", 2, 160);
  await store.setDimensionSize("column", 3, 160);
  await store.setDimensionSize("row", 1, 70);
  await store.setDimensionSize("row", 2, 70);
  await store.setDimensionSize("row", 3, 70);

  // Light alternating backgrounds for clarity
  await store.addRangeStyle({
    range: [{ r: 1, c: 1 }, { r: 1, c: 3 }],
    style: { bg: "#f8fafc" },
  });
  await store.addRangeStyle({
    range: [{ r: 3, c: 1 }, { r: 3, c: 3 }],
    style: { bg: "#f8fafc" },
  });

  // Top row: vertical top
  await store.addRangeStyle({
    range: [{ r: 1, c: 1 }, { r: 1, c: 1 }],
    style: { al: "left", va: "top" },
  });
  await store.addRangeStyle({
    range: [{ r: 1, c: 2 }, { r: 1, c: 2 }],
    style: { al: "center", va: "top" },
  });
  await store.addRangeStyle({
    range: [{ r: 1, c: 3 }, { r: 1, c: 3 }],
    style: { al: "right", va: "top" },
  });

  // Middle row: vertical middle
  await store.addRangeStyle({
    range: [{ r: 2, c: 1 }, { r: 2, c: 1 }],
    style: { al: "left", va: "middle" },
  });
  await store.addRangeStyle({
    range: [{ r: 2, c: 2 }, { r: 2, c: 2 }],
    style: { al: "center", va: "middle" },
  });
  await store.addRangeStyle({
    range: [{ r: 2, c: 3 }, { r: 2, c: 3 }],
    style: { al: "right", va: "middle" },
  });

  // Bottom row: vertical bottom
  await store.addRangeStyle({
    range: [{ r: 3, c: 1 }, { r: 3, c: 1 }],
    style: { al: "left", va: "bottom" },
  });
  await store.addRangeStyle({
    range: [{ r: 3, c: 2 }, { r: 3, c: 2 }],
    style: { al: "center", va: "bottom" },
  });
  await store.addRangeStyle({
    range: [{ r: 3, c: 3 }, { r: 3, c: 3 }],
    style: { al: "right", va: "bottom" },
  });

  return { store };
}

async function createBordersStore(): Promise<ScenarioSetup> {
  const grid: Grid = new Map([
    ["A1", { v: "Top" }],
    ["B1", { v: "Right" }],
    ["C1", { v: "Bottom" }],
    ["D1", { v: "Left" }],
    ["A2", { v: "Top only" }],
    ["B2", { v: "Right only" }],
    ["C2", { v: "Bottom only" }],
    ["D2", { v: "Left only" }],
    ["A3", { v: "All borders" }],
    ["B3", { v: "Adjacent" }],
    ["C3", { v: "Adjacent" }],
    ["D3", { v: "Outer only" }],
  ]);

  const store = new MemStore(grid);
  await store.setDimensionSize("column", 1, 130);
  await store.setDimensionSize("column", 2, 130);
  await store.setDimensionSize("column", 3, 130);
  await store.setDimensionSize("column", 4, 130);
  await store.setDimensionSize("row", 2, 44);
  await store.setDimensionSize("row", 3, 44);

  // Header row
  await store.addRangeStyle({
    range: [{ r: 1, c: 1 }, { r: 1, c: 4 }],
    style: { b: true, bg: "#f1f5f9", al: "center" },
  });

  // Single borders
  await store.addRangeStyle({
    range: [{ r: 2, c: 1 }, { r: 2, c: 1 }],
    style: { bt: true },
  });
  await store.addRangeStyle({
    range: [{ r: 2, c: 2 }, { r: 2, c: 2 }],
    style: { br: true },
  });
  await store.addRangeStyle({
    range: [{ r: 2, c: 3 }, { r: 2, c: 3 }],
    style: { bb: true },
  });
  await store.addRangeStyle({
    range: [{ r: 2, c: 4 }, { r: 2, c: 4 }],
    style: { bl: true },
  });

  // All borders
  await store.addRangeStyle({
    range: [{ r: 3, c: 1 }, { r: 3, c: 1 }],
    style: { bt: true, br: true, bb: true, bl: true },
  });

  // Adjacent cells with shared borders
  await store.addRangeStyle({
    range: [{ r: 3, c: 2 }, { r: 3, c: 2 }],
    style: { bt: true, br: true, bb: true, bl: true },
  });
  await store.addRangeStyle({
    range: [{ r: 3, c: 3 }, { r: 3, c: 3 }],
    style: { bt: true, br: true, bb: true, bl: true },
  });

  // Outer borders only (top + bottom + left + right on edges)
  await store.addRangeStyle({
    range: [{ r: 3, c: 4 }, { r: 3, c: 4 }],
    style: { bt: true, bb: true, bl: true, br: true, bg: "#f0fdf4" },
  });

  return { store };
}

async function createNumberFormatStore(): Promise<ScenarioSetup> {
  const grid: Grid = new Map([
    ["A1", { v: "Format" }],
    ["B1", { v: "Value" }],
    ["A2", { v: "Plain" }],
    ["B2", { v: "1234567.89" }],
    ["A3", { v: "Number (2dp)" }],
    ["B3", { v: "1234567.89" }],
    ["A4", { v: "Currency USD" }],
    ["B4", { v: "9876.5" }],
    ["A5", { v: "Percent" }],
    ["B5", { v: "0.8525" }],
    ["A6", { v: "Date" }],
    ["B6", { v: "2026-03-11" }],
  ]);

  const store = new MemStore(grid);
  await store.setDimensionSize("column", 1, 160);
  await store.setDimensionSize("column", 2, 200);

  // Header row
  await store.addRangeStyle({
    range: [{ r: 1, c: 1 }, { r: 1, c: 2 }],
    style: { b: true, bg: "#f1f5f9", al: "center" },
  });

  // Plain — no format
  await store.addRangeStyle({
    range: [{ r: 2, c: 2 }, { r: 2, c: 2 }],
    style: { nf: "plain", al: "right" },
  });

  // Number with 2 decimal places
  await store.addRangeStyle({
    range: [{ r: 3, c: 2 }, { r: 3, c: 2 }],
    style: { nf: "number", dp: 2, al: "right" },
  });

  // Currency USD
  await store.addRangeStyle({
    range: [{ r: 4, c: 2 }, { r: 4, c: 2 }],
    style: { nf: "currency", cu: "USD", dp: 2, al: "right" },
  });

  // Percent
  await store.addRangeStyle({
    range: [{ r: 5, c: 2 }, { r: 5, c: 2 }],
    style: { nf: "percent", dp: 2, al: "right" },
  });

  // Date
  await store.addRangeStyle({
    range: [{ r: 6, c: 2 }, { r: 6, c: 2 }],
    style: { nf: "date", al: "right" },
  });

  return { store };
}

const FORMAT_SCENARIOS: Scenario[] = [
  {
    id: "format-text-decoration",
    title: "Text Decoration Styles",
    description:
      "Verifies bold, italic, underline, strikethrough and combined text decorations.",
    setup: createTextDecorationStore,
  },
  {
    id: "format-text-bg-colors",
    title: "Text & Background Colors",
    description:
      "Verifies text color and background color combinations including light-on-dark.",
    setup: createTextBgColorsStore,
  },
  {
    id: "format-alignment",
    title: "Horizontal & Vertical Alignment",
    description:
      "Verifies all 9 combinations of horizontal and vertical cell alignment.",
    setup: createAlignmentStore,
  },
  {
    id: "format-borders",
    title: "Border Styles",
    description:
      "Verifies individual and combined cell border directions and adjacency.",
    setup: createBordersStore,
  },
  {
    id: "format-number",
    title: "Number Formatting",
    description:
      "Verifies plain, number, currency, percent, and date format rendering.",
    setup: createNumberFormatStore,
  },
];

export function FormatVisualScenarios({ theme }: { theme: Theme }) {
  const [readyMap, setReadyMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(FORMAT_SCENARIOS.map((s) => [s.id, false])),
  );

  const handleReadyChange = useCallback((id: string, ready: boolean) => {
    setReadyMap((current) => {
      if (current[id] === ready) return current;
      return { ...current, [id]: ready };
    });
  }, []);

  const allReady = useMemo(
    () => FORMAT_SCENARIOS.every((s) => readyMap[s.id] === true),
    [readyMap],
  );

  return (
    <section
      className="space-y-4"
      data-testid="visual-harness-format-section"
      data-visual-format-ready={allReady ? "true" : "false"}
    >
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          Cell Formatting Visual Scenarios
        </h2>
        <p className="text-sm text-muted-foreground">
          Validates cell formatting features (text styles, colors, alignment,
          borders, number formats) against browser baselines.
        </p>
      </header>
      <div className="grid gap-4 xl:grid-cols-2">
        {FORMAT_SCENARIOS.map((scenario) => (
          <ScenarioCard
            key={scenario.id}
            onReadyChange={handleReadyChange}
            scenario={scenario}
            theme={theme}
          />
        ))}
      </div>
    </section>
  );
}
