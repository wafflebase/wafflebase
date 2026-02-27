import {
  initialize,
  MemStore,
  Spreadsheet,
  type Grid,
} from "@wafflebase/sheet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ScenarioSetup = {
  store: MemStore;
  afterInitialize?: (spreadsheet: Spreadsheet) => Promise<void> | void;
};

type Scenario = {
  id: string;
  title: string;
  description: string;
  setup: () => Promise<ScenarioSetup>;
};

type ScenarioState = "loading" | "ready" | "error";

async function createFreezeScenarioStore(): Promise<ScenarioSetup> {
  const grid: Grid = new Map([
    ["A1", { v: "Region" }],
    ["B1", { v: "Jan" }],
    ["C1", { v: "Feb" }],
    ["D1", { v: "Mar" }],
    ["E1", { v: "Apr" }],
    ["F1", { v: "May" }],
    ["G1", { v: "Jun" }],
    ["H1", { v: "Total" }],
    ["A2", { v: "Seoul" }],
    ["B2", { v: "120" }],
    ["C2", { v: "140" }],
    ["D2", { v: "135" }],
    ["E2", { v: "150" }],
    ["F2", { v: "148" }],
    ["G2", { v: "160" }],
    ["H2", { f: "=SUM(B2:G2)" }],
    ["A3", { v: "Busan" }],
    ["B3", { v: "95" }],
    ["C3", { v: "102" }],
    ["D3", { v: "110" }],
    ["E3", { v: "107" }],
    ["F3", { v: "112" }],
    ["G3", { v: "109" }],
    ["H3", { f: "=SUM(B3:G3)" }],
    ["A4", { v: "Incheon" }],
    ["B4", { v: "88" }],
    ["C4", { v: "91" }],
    ["D4", { v: "95" }],
    ["E4", { v: "98" }],
    ["F4", { v: "101" }],
    ["G4", { v: "105" }],
    ["H4", { f: "=SUM(B4:G4)" }],
    ["A5", { v: "Daegu" }],
    ["B5", { v: "70" }],
    ["C5", { v: "76" }],
    ["D5", { v: "81" }],
    ["E5", { v: "78" }],
    ["F5", { v: "84" }],
    ["G5", { v: "86" }],
    ["H5", { f: "=SUM(B5:G5)" }],
    ["A6", { v: "Gwangju" }],
    ["B6", { v: "65" }],
    ["C6", { v: "69" }],
    ["D6", { v: "74" }],
    ["E6", { v: "77" }],
    ["F6", { v: "79" }],
    ["G6", { v: "82" }],
    ["H6", { f: "=SUM(B6:G6)" }],
    ["A7", { v: "Daejeon" }],
    ["B7", { v: "58" }],
    ["C7", { v: "62" }],
    ["D7", { v: "67" }],
    ["E7", { v: "70" }],
    ["F7", { v: "71" }],
    ["G7", { v: "73" }],
    ["H7", { f: "=SUM(B7:G7)" }],
    ["A8", { v: "Ulsan" }],
    ["B8", { v: "55" }],
    ["C8", { v: "58" }],
    ["D8", { v: "63" }],
    ["E8", { v: "66" }],
    ["F8", { v: "68" }],
    ["G8", { v: "72" }],
    ["H8", { f: "=SUM(B8:G8)" }],
    ["A9", { v: "Jeju" }],
    ["B9", { v: "41" }],
    ["C9", { v: "45" }],
    ["D9", { v: "48" }],
    ["E9", { v: "52" }],
    ["F9", { v: "57" }],
    ["G9", { v: "60" }],
    ["H9", { f: "=SUM(B9:G9)" }],
  ]);

  const store = new MemStore(grid);
  await store.setFreezePane(1, 1);
  await store.addRangeStyle({
    range: [
      { r: 1, c: 1 },
      { r: 1, c: 8 },
    ],
    style: { b: true, bg: "#f1f5f9", al: "center" },
  });
  await store.addRangeStyle({
    range: [
      { r: 2, c: 8 },
      { r: 9, c: 8 },
    ],
    style: { b: true, bg: "#eff6ff" },
  });

  return {
    store,
    afterInitialize: async (spreadsheet) => {
      await spreadsheet.focusCell({ r: 8, c: 8 });
    },
  };
}

async function createOverflowScenarioStore(): Promise<ScenarioSetup> {
  const grid: Grid = new Map([
    ["A1", { v: "Case" }],
    ["B1", { v: "Cell B" }],
    ["C1", { v: "Cell C" }],
    ["D1", { v: "Cell D" }],
    ["A2", { v: "Overflow" }],
    [
      "B2",
      {
        v: "Long text should overflow into empty neighboring cells for readability.",
      },
    ],
    ["A3", { v: "Clipped" }],
    [
      "B3",
      {
        v: "This line should clip because C3 contains data and blocks overflow rendering.",
      },
    ],
    ["C3", { v: "BLOCK" }],
    ["A4", { v: "Merged-look" }],
    ["B4", { v: "Header-like band with borders" }],
    ["C4", { v: "" }],
    ["D4", { v: "" }],
  ]);

  const store = new MemStore(grid);
  await store.setDimensionSize("column", 1, 110);
  await store.setDimensionSize("column", 2, 170);
  await store.setDimensionSize("column", 3, 110);
  await store.setDimensionSize("column", 4, 110);
  await store.addRangeStyle({
    range: [
      { r: 1, c: 1 },
      { r: 1, c: 4 },
    ],
    style: { b: true, bg: "#f8fafc" },
  });
  await store.addRangeStyle({
    range: [
      { r: 3, c: 3 },
      { r: 3, c: 3 },
    ],
    style: { b: true, bg: "#fee2e2", tc: "#7f1d1d", al: "center" },
  });
  await store.addRangeStyle({
    range: [
      { r: 4, c: 2 },
      { r: 4, c: 4 },
    ],
    style: {
      b: true,
      bg: "#ecfeff",
      bt: true,
      bb: true,
      bl: true,
      br: true,
    },
  });

  return {
    store,
    afterInitialize: async (spreadsheet) => {
      await spreadsheet.focusCell({ r: 2, c: 2 });
    },
  };
}

async function createMergeScenarioStore(): Promise<ScenarioSetup> {
  const grid: Grid = new Map([
    ["A1", { v: "Metric" }],
    ["B1", { v: "Q1" }],
    ["C1", { v: "Q2" }],
    ["D1", { v: "Q3" }],
    ["E1", { v: "Q4" }],
    ["A2", { v: "Revenue" }],
    ["B2", { v: "Q1 TOTAL\n$1,240,000" }],
    ["E2", { v: "$340k" }],
    ["A3", { v: "Growth" }],
    ["E3", { v: "+14%" }],
    ["A4", { v: "Cost" }],
    ["B4", { v: "$180k" }],
    ["C4", { v: "$175k" }],
    ["D4", { v: "$190k" }],
    ["E4", { v: "$200k" }],
  ]);

  const store = new MemStore(grid);
  await store.setMerge({ r: 2, c: 2 }, { rs: 2, cs: 3 });
  await store.setDimensionSize("column", 1, 120);
  await store.setDimensionSize("column", 2, 140);
  await store.setDimensionSize("column", 3, 120);
  await store.setDimensionSize("column", 4, 120);
  await store.setDimensionSize("column", 5, 120);
  await store.setDimensionSize("row", 2, 44);
  await store.setDimensionSize("row", 3, 44);
  await store.addRangeStyle({
    range: [
      { r: 1, c: 1 },
      { r: 1, c: 5 },
    ],
    style: { b: true, bg: "#f8fafc", al: "center" },
  });
  await store.addRangeStyle({
    range: [
      { r: 2, c: 2 },
      { r: 2, c: 2 },
    ],
    style: { b: true, bg: "#e0f2fe", al: "center", va: "middle" },
  });

  return {
    store,
    afterInitialize: async (spreadsheet) => {
      await spreadsheet.focusCell({ r: 2, c: 2 });
    },
  };
}

async function createErrorScenarioStore(): Promise<ScenarioSetup> {
  const grid: Grid = new Map([
    ["A1", { v: "Formula" }],
    ["B1", { v: "Rendered Value" }],
    ["A2", { v: "=MOD(10,0)" }],
    ["B2", { f: "=MOD(10,0)" }],
    ["A3", { v: "=INDEX(A1:A2,3,1)" }],
    ["B3", { f: "=INDEX(A1:A2,3,1)" }],
    ["A4", { v: "=1+" }],
    ["B4", { f: "=1+" }],
    ["A5", { v: "=IFS(FALSE,1)" }],
    ["B5", { f: "=IFS(FALSE,1)" }],
    ["A6", { v: "=VLOOKUP(\"x\",A1:B2,3,FALSE)" }],
    ["B6", { f: "=VLOOKUP(\"x\",A1:B2,3,FALSE)" }],
  ]);

  const store = new MemStore(grid);
  await store.setDimensionSize("column", 1, 260);
  await store.setDimensionSize("column", 2, 170);
  await store.addRangeStyle({
    range: [
      { r: 1, c: 1 },
      { r: 1, c: 2 },
    ],
    style: { b: true, bg: "#f8fafc" },
  });

  return {
    store,
    afterInitialize: async (spreadsheet) => {
      await spreadsheet.focusCell({ r: 4, c: 2 });
    },
  };
}

async function createDimensionScenarioStore(): Promise<ScenarioSetup> {
  const grid: Grid = new Map([
    ["A1", { v: "Task" }],
    ["B1", { v: "Owner" }],
    ["C1", { v: "ETA" }],
    ["D1", { v: "Notes" }],
    ["A2", { v: "Chunk gate cleanup" }],
    ["B2", { v: "alice" }],
    ["C2", { v: "2d" }],
    ["D2", { v: "High priority and needs wider note column" }],
    ["A3", { v: "Visual browser lane" }],
    ["B3", { v: "bruno" }],
    ["C3", { v: "1d" }],
    ["D3", { v: "Snapshot drift triage" }],
    ["A4", { v: "Integration docker" }],
    ["B4", { v: "chloe" }],
    ["C4", { v: "3d" }],
    ["D4", { v: "Interruption-safe cleanup" }],
    ["A5", { v: "PR evidence" }],
    ["B5", { v: "derek" }],
    ["C5", { v: "1d" }],
    ["D5", { v: "Auto-link lane reports" }],
    ["A6", { v: "Smoke suite" }],
    ["B6", { v: "ella" }],
    ["C6", { v: "2d" }],
    ["D6", { v: "Refresh-auth + API error cases" }],
    ["A7", { v: "Docs sync" }],
    ["B7", { v: "frank" }],
    ["C7", { v: "1d" }],
    ["D7", { v: "README + CLAUDE update" }],
    ["A8", { v: "CI hardening" }],
    ["B8", { v: "grace" }],
    ["C8", { v: "2d" }],
    ["D8", { v: "Add retry on flaky service boot" }],
  ]);

  const store = new MemStore(grid);
  await store.setFreezePane(2, 0);
  await store.setDimensionSize("column", 1, 190);
  await store.setDimensionSize("column", 2, 130);
  await store.setDimensionSize("column", 3, 72);
  await store.setDimensionSize("column", 4, 280);
  await store.setDimensionSize("row", 2, 44);
  await store.setDimensionSize("row", 4, 52);
  await store.setDimensionSize("row", 8, 40);
  await store.addRangeStyle({
    range: [
      { r: 1, c: 1 },
      { r: 1, c: 4 },
    ],
    style: { b: true, bg: "#f1f5f9", al: "center" },
  });

  return {
    store,
    afterInitialize: async (spreadsheet) => {
      await spreadsheet.focusCell({ r: 8, c: 4 });
    },
  };
}

const SCENARIOS: Scenario[] = [
  {
    id: "sheet-freeze-selection",
    title: "Freeze + Selection",
    description: "Verifies frozen row/column panes and scrolled selection cell overlay via baseline snapshot.",
    setup: createFreezeScenarioStore,
  },
  {
    id: "sheet-overflow-clip",
    title: "Text Overflow + Clip",
    description: "Verifies text overflow and clipping regression based on neighboring cell data.",
    setup: createOverflowScenarioStore,
  },
  {
    id: "sheet-merge-layout",
    title: "Merge Layout",
    description: "Verifies merged cell rendering (background, alignment, borders, selection box) consistency.",
    setup: createMergeScenarioStore,
  },
  {
    id: "sheet-formula-errors",
    title: "Formula Errors",
    description: "Verifies rendering regression of #VALUE!, #REF!, #ERROR!, and #N/A! error displays.",
    setup: createErrorScenarioStore,
  },
  {
    id: "sheet-dimensions-freeze",
    title: "Custom Dimensions",
    description: "Verifies layout regression of custom row/column sizes with top freeze pane.",
    setup: createDimensionScenarioStore,
  },
];

function ScenarioCard({
  scenario,
  onReadyChange,
}: {
  scenario: Scenario;
  onReadyChange: (id: string, ready: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ScenarioState>("loading");

  useEffect(() => {
    onReadyChange(scenario.id, state === "ready");
  }, [onReadyChange, scenario.id, state]);

  useEffect(() => {
    let mounted = true;
    let spreadsheet: Spreadsheet | undefined;
    const container = containerRef.current;

    async function setupScenario() {
      if (!container) {
        return;
      }

      setState("loading");
      container.innerHTML = "";

      try {
        const result = await scenario.setup();
        if (!mounted) {
          return;
        }

        spreadsheet = await initialize(container, {
          theme: "light",
          store: result.store,
          readOnly: true,
        });
        await result.afterInitialize?.(spreadsheet);

        if (mounted) {
          setState("ready");
        }
      } catch (error) {
        console.error(`[visual-harness] failed to set up scenario ${scenario.id}`, error);
        if (mounted) {
          setState("error");
        }
      }
    }

    void setupScenario();

    return () => {
      mounted = false;
      spreadsheet?.cleanup();
      if (container) {
        container.innerHTML = "";
      }
    };
  }, [scenario]);

  return (
    <Card
      data-visual-scenario-id={scenario.id}
      data-visual-scenario-ready={state === "ready" ? "true" : "false"}
      data-visual-scenario-state={state}
      className="border-border/80"
    >
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{scenario.title}</CardTitle>
        <CardDescription>{scenario.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="rounded-md border bg-background p-2">
          <div
            className="h-[320px] w-full overflow-hidden rounded-sm bg-white"
            ref={containerRef}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {state === "ready" && "Scenario ready"}
          {state === "loading" && "Rendering scenario..."}
          {state === "error" && "Failed to render scenario"}
        </p>
      </CardContent>
    </Card>
  );
}

export function SheetVisualScenarios() {
  const [readyMap, setReadyMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SCENARIOS.map((scenario) => [scenario.id, false])),
  );

  const handleReadyChange = useCallback((id: string, ready: boolean) => {
    setReadyMap((current) => {
      if (current[id] === ready) {
        return current;
      }
      return {
        ...current,
        [id]: ready,
      };
    });
  }, []);

  const allReady = useMemo(
    () => SCENARIOS.every((scenario) => readyMap[scenario.id] === true),
    [readyMap],
  );

  return (
    <section
      className="space-y-4"
      data-testid="visual-harness-sheet-section"
      data-visual-sheet-ready={allReady ? "true" : "false"}
    >
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Spreadsheet Engine Visual Scenarios</h2>
        <p className="text-sm text-muted-foreground">
          Validates core rendering states of the canvas-based spreadsheet against browser baselines.
        </p>
      </header>
      <div className="grid gap-4 xl:grid-cols-2">
        {SCENARIOS.map((scenario) => (
          <ScenarioCard
            key={scenario.id}
            onReadyChange={handleReadyChange}
            scenario={scenario}
          />
        ))}
      </div>
    </section>
  );
}
