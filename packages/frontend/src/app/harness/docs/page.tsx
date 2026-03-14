import { initialize, MemStore, type Grid, type Theme } from "@wafflebase/sheet";
import { useEffect, useRef, useState } from "react";

function useThemeFromSearchParams(): Theme {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

type ScenarioProps = {
  id: string;
  title: string;
  grid: Grid;
  theme: Theme;
  columnWidths?: Record<number, number>;
  width?: number;
  height?: number;
};

function SheetScenario({
  id,
  title,
  grid,
  theme,
  columnWidths,
  width = 700,
  height = 260,
}: ScenarioProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const store = new MemStore(grid);
    const setup = async () => {
      if (columnWidths) {
        for (const [col, w] of Object.entries(columnWidths)) {
          await store.setDimensionSize("column", Number(col), w);
        }
      }
    };

    let destroyed = false;
    let instance: Awaited<ReturnType<typeof initialize>> | undefined;
    setup().then(() => initialize(el, { theme, store, readOnly: true, hideFormulaBar: true, hideAutofillHandle: true })).then((s) => {
      if (destroyed) {
        s.destroy();
        return;
      }
      instance = s;
      setReady(true);
    });
    return () => {
      destroyed = true;
      instance?.destroy();
    };
  }, [grid, theme, columnWidths]);

  return (
    <div
      data-docs-scenario-id={id}
      data-docs-scenario-ready={ready ? "true" : "false"}
      style={{ marginBottom: 32 }}
    >
      <h3 style={{ marginBottom: 8, fontFamily: "sans-serif", fontSize: 14, color: "#888" }}>
        {title}
      </h3>
      <div
        ref={containerRef}
        style={{ width, height, border: "1px solid #ddd", borderRadius: 4 }}
      />
    </div>
  );
}

// --- Scenario data ---

const contactListGrid: Grid = new Map([
  ["A1", { v: "Name" }],
  ["B1", { v: "Email" }],
  ["C1", { v: "Role" }],
  ["A2", { v: "Alice" }],
  ["B2", { v: "alice@example.com" }],
  ["C2", { v: "Engineer" }],
  ["A3", { v: "Bob" }],
  ["B3", { v: "bob@example.com" }],
  ["C3", { v: "Designer" }],
  ["A4", { v: "Carol" }],
  ["B4", { v: "carol@example.com" }],
  ["C4", { v: "Manager" }],
]);

const budgetGrid: Grid = new Map([
  ["A1", { v: "Category" }],
  ["B1", { v: "Budget" }],
  ["C1", { v: "Actual" }],
  ["D1", { v: "Difference" }],
  ["E1", { v: "Status" }],
  ["A2", { v: "Rent" }],
  ["B2", { v: "1500" }],
  ["C2", { v: "1500" }],
  ["D2", { v: "0", f: "=B2-C2" }],
  ["E2", { v: "OK", f: '=IF(D2<0,"Over","OK")' }],
  ["A3", { v: "Groceries" }],
  ["B3", { v: "400" }],
  ["C3", { v: "380" }],
  ["D3", { v: "20", f: "=B3-C3" }],
  ["E3", { v: "OK", f: '=IF(D3<0,"Over","OK")' }],
  ["A4", { v: "Transport" }],
  ["B4", { v: "200" }],
  ["C4", { v: "220" }],
  ["D4", { v: "-20", f: "=B4-C4" }],
  ["E4", { v: "Over", f: '=IF(D4<0,"Over","OK")' }],
  ["A5", { v: "Utilities" }],
  ["B5", { v: "150" }],
  ["C5", { v: "135" }],
  ["D5", { v: "15", f: "=B5-C5" }],
  ["E5", { v: "OK", f: '=IF(D5<0,"Over","OK")' }],
  ["A6", { v: "Entertainment" }],
  ["B6", { v: "100" }],
  ["C6", { v: "95" }],
  ["D6", { v: "5", f: "=B6-C6" }],
  ["E6", { v: "OK", f: '=IF(D6<0,"Over","OK")' }],
  ["A7", { v: "Savings" }],
  ["B7", { v: "500" }],
  ["C7", { v: "500" }],
  ["D7", { v: "0", f: "=B7-C7" }],
  ["E7", { v: "OK", f: '=IF(D7<0,"Over","OK")' }],
  ["A8", { v: "Total" }],
  ["B8", { v: "2850", f: "=SUM(B2:B7)" }],
  ["C8", { v: "2830", f: "=SUM(C2:C7)" }],
  ["D8", { v: "20", f: "=SUM(D2:D7)" }],
]);

const formulaExamplesGrid: Grid = new Map([
  ["A1", { v: "Item" }],
  ["B1", { v: "Price" }],
  ["C1", { v: "Qty" }],
  ["D1", { v: "Subtotal" }],
  ["A2", { v: "Widget A" }],
  ["B2", { v: "25" }],
  ["C2", { v: "10" }],
  ["D2", { v: "250", f: "=B2*C2" }],
  ["A3", { v: "Widget B" }],
  ["B3", { v: "15" }],
  ["C3", { v: "20" }],
  ["D3", { v: "300", f: "=B3*C3" }],
  ["A4", { v: "Widget C" }],
  ["B4", { v: "40" }],
  ["C4", { v: "5" }],
  ["D4", { v: "200", f: "=B4*C4" }],
  ["A5", { v: "Total" }],
  ["D5", { v: "750", f: "=SUM(D2:D4)" }],
  ["A6", { v: "Average" }],
  ["D6", { v: "250", f: "=AVERAGE(D2:D4)" }],
  ["A7", { v: "Max" }],
  ["D7", { v: "300", f: "=MAX(D2:D4)" }],
]);

export default function DocsHarnessPage() {
  const theme = useThemeFromSearchParams();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    return () => {
      root.classList.remove("dark", "light");
    };
  }, [theme]);

  return (
    <main
      data-testid="docs-harness-root"
      style={{ padding: 24, background: theme === "dark" ? "#1a1a1a" : "#fff" }}
    >
      <SheetScenario
        id="getting-started-contact-list"
        title="Getting Started: Contact List"
        grid={contactListGrid}
        theme={theme}
        columnWidths={{ 2: 180 }}
        height={160}
      />
      <SheetScenario
        id="budget-complete"
        title="Build a Budget: Complete Spreadsheet"
        grid={budgetGrid}
        theme={theme}
        columnWidths={{ 1: 140, 4: 110, 5: 80 }}
        width={700}
        height={230}
      />
      <SheetScenario
        id="formula-examples"
        title="Formulas: Calculation Examples"
        grid={formulaExamplesGrid}
        theme={theme}
        columnWidths={{ 1: 120, 4: 100 }}
        height={210}
      />
    </main>
  );
}
