import {
  initialize,
  MemStore,
  parseRef,
  toSref,
  type Cell,
  type Grid,
  type Spreadsheet,
} from "@wafflebase/sheet";
import { useEffect, useRef, useState } from "react";

const BRIDGE_KEY = "__WB_INTERACTION__";

type HarnessStatus = "loading" | "ready" | "error";

type CellSnapshot = Pick<Cell, "v" | "f">;

type InteractionBridge = {
  isReady: () => boolean;
  getCell: (sref: string) => Promise<CellSnapshot | null>;
  getActiveCell: () => string | null;
  getSelectionRange: () => { start: string; end: string } | null;
  getFocusTarget: () => string;
  getCellInputState: () =>
    | {
        value: string;
        pointerEvents: string;
        caretColor: string;
      }
    | null;
  getFormulaInputState: () =>
    | {
        value: string;
        focused: boolean;
      }
    | null;
  editViaFormulaBar: (
    targetSref: string,
    value: string,
    commitSref: string,
  ) => Promise<{
    activeCell: string | null;
    targetCell: CellSnapshot | null;
  }>;
  focusCell: (sref: string) => Promise<void>;
  getScrollContainerCenterClientPoint: () => { x: number; y: number } | null;
  getScrollContainerRect: () =>
    | { left: number; top: number; width: number; height: number }
    | null;
  panBy: (deltaX: number, deltaY: number) => void;
  getCellCenterClientPoint: (sref: string) => { x: number; y: number };
  getScrollableViewportCenterClientPoint: () => { x: number; y: number };
  getScrollPosition: () => { left: number; top: number };
};

function createInteractionGrid(): Grid {
  const grid: Grid = new Map([
    ["A1", { v: "10" }],
    ["A2", { v: "20" }],
    ["B1", { v: "Manual Input" }],
    ["C1", { v: "Formula Input" }],
    ["D1", { v: "Scroll Marker" }],
  ]);

  for (let row = 2; row <= 240; row++) {
    grid.set(`D${row}`, { v: `Row ${row}` });
  }

  return grid;
}

function getScrollContainer(container: HTMLDivElement): HTMLDivElement | null {
  return (
    container.querySelector<HTMLDivElement>("[data-testid='interaction-scroll-container']") ||
    container.querySelector<HTMLDivElement>("div[style*='overflow: auto']")
  );
}

function tagSheetInternals(container: HTMLDivElement): void {
  const editables = container.querySelectorAll<HTMLDivElement>("div[contenteditable='true']");
  for (const editable of editables) {
    if (editable.style.whiteSpace === "nowrap") {
      editable.setAttribute("data-testid", "interaction-formula-input");
      continue;
    }
    if (editable.style.whiteSpace === "pre") {
      editable.setAttribute("data-testid", "interaction-cell-input");
    }
  }

  const scrollContainer = getScrollContainer(container);
  if (scrollContainer) {
    scrollContainer.setAttribute("data-testid", "interaction-scroll-container");
  }
}

function attachBridge(
  container: HTMLDivElement,
  spreadsheet: Spreadsheet,
  store: MemStore,
): InteractionBridge {
  const bridge: InteractionBridge = {
    isReady: () => true,
    getCell: async (sref: string) => {
      const cell = await store.get(parseRef(sref));
      if (!cell) {
        return null;
      }
      return {
        v: cell.v,
        f: cell.f,
      };
    },
    getActiveCell: () => {
      const active = spreadsheet.getActiveCell();
      return active ? toSref(active) : null;
    },
    getSelectionRange: () => {
      const range = spreadsheet.getSelectionRangeOrActiveCell();
      if (!range) {
        return null;
      }
      return {
        start: toSref(range[0]),
        end: toSref(range[1]),
      };
    },
    getFocusTarget: () => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) {
        return "null";
      }
      const testId = active.getAttribute("data-testid");
      const editable = active.getAttribute("contenteditable");
      const suffix = [
        testId ? `[data-testid=${testId}]` : "",
        editable !== null ? `[contenteditable=${editable}]` : "",
      ]
        .filter(Boolean)
        .join("");
      return `${active.tagName.toLowerCase()}${suffix}`;
    },
    getCellInputState: () => {
      const input = container.querySelector<HTMLDivElement>(
        "[data-testid='interaction-cell-input']",
      );
      if (!input) {
        return null;
      }
      const frame = input.parentElement as HTMLDivElement | null;
      return {
        value: input.innerText,
        pointerEvents: frame?.style.pointerEvents || "",
        caretColor: input.style.caretColor,
      };
    },
    getFormulaInputState: () => {
      const input = container.querySelector<HTMLDivElement>(
        "[data-testid='interaction-formula-input']",
      );
      if (!input) {
        return null;
      }
      return {
        value: input.innerText,
        focused: document.activeElement === input,
      };
    },
    editViaFormulaBar: async (
      targetSref: string,
      value: string,
      commitSref: string,
    ) => {
      const targetRef = parseRef(targetSref);
      const sheetHandle = spreadsheet as unknown as {
        sheet?: { setData: (ref: ReturnType<typeof parseRef>, value: string) => Promise<void> };
      };
      if (!sheetHandle.sheet) {
        throw new Error("spreadsheet sheet handle is unavailable");
      }

      await sheetHandle.sheet.setData(targetRef, value);
      await spreadsheet.focusCell(parseRef(commitSref));
      tagSheetInternals(container);

      const targetCell = await store.get(targetRef);
      const active = spreadsheet.getActiveCell();
      return {
        activeCell: active ? toSref(active) : null,
        targetCell: targetCell
          ? {
              v: targetCell.v,
              f: targetCell.f,
            }
          : null,
      };
    },
    focusCell: async (sref: string) => {
      await spreadsheet.focusCell(parseRef(sref));
      tagSheetInternals(container);
    },
    getScrollContainerCenterClientPoint: () => {
      const scrollContainer = getScrollContainer(container);
      if (!scrollContainer) {
        return null;
      }
      const rect = scrollContainer.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    },
    getScrollContainerRect: () => {
      const scrollContainer = getScrollContainer(container);
      if (!scrollContainer) {
        return null;
      }
      const rect = scrollContainer.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    },
    panBy: (deltaX: number, deltaY: number) => {
      spreadsheet.panBy(deltaX, deltaY);
    },
    getCellCenterClientPoint: (sref: string) => {
      const rect = spreadsheet.getCellRect(parseRef(sref));
      const hostRect = container.getBoundingClientRect();
      return {
        x: Math.round(hostRect.left + rect.left + rect.width / 2),
        y: Math.round(hostRect.top + rect.top + rect.height / 2),
      };
    },
    getScrollableViewportCenterClientPoint: () => {
      const rect = spreadsheet.getScrollableGridViewportRect();
      const hostRect = container.getBoundingClientRect();
      return {
        x: Math.round(hostRect.left + rect.left + rect.width / 2),
        y: Math.round(hostRect.top + rect.top + rect.height / 2),
      };
    },
    getScrollPosition: () => {
      const scrollContainer = getScrollContainer(container);
      return {
        left: scrollContainer?.scrollLeft || 0,
        top: scrollContainer?.scrollTop || 0,
      };
    },
  };

  (window as unknown as Record<string, unknown>)[BRIDGE_KEY] = bridge;
  return bridge;
}

function detachBridge(bridge: InteractionBridge): void {
  const bridgeOwner = window as unknown as Record<string, unknown>;
  if (bridgeOwner[BRIDGE_KEY] === bridge) {
    delete bridgeOwner[BRIDGE_KEY];
  }
}

export default function InteractionHarnessPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<HarnessStatus>("loading");

  useEffect(() => {
    let mounted = true;
    let spreadsheet: Spreadsheet | undefined;
    let bridge: InteractionBridge | undefined;
    const host = hostRef.current;

    if (!host) {
      return undefined;
    }

    async function setup() {
      setStatus("loading");
      host.innerHTML = "";

      try {
        const store = new MemStore(createInteractionGrid());
        await store.setDimensionSize("column", 1, 110);
        await store.setDimensionSize("column", 2, 160);
        await store.setDimensionSize("column", 3, 180);
        await store.setDimensionSize("column", 4, 260);

        spreadsheet = await initialize(host, {
          theme: "light",
          store,
        });
        await spreadsheet.focusCell({ r: 1, c: 1 });
        tagSheetInternals(host);
        bridge = attachBridge(host, spreadsheet, store);

        if (mounted) {
          setStatus("ready");
        }
      } catch (error) {
        console.error("[interaction-harness] failed to initialize", error);
        if (mounted) {
          setStatus("error");
        }
      }
    }

    void setup();

    return () => {
      mounted = false;
      if (bridge) {
        detachBridge(bridge);
      }
      spreadsheet?.cleanup();
      host.innerHTML = "";
    };
  }, []);

  return (
    <main
      className="h-screen overflow-clip bg-muted/20 p-6 md:p-10"
      data-testid="interaction-harness-root"
      data-interaction-harness-ready={status === "ready" ? "true" : "false"}
      data-interaction-harness-status={status}
    >
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4">
        <header className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Wafflebase Harness</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Frontend Interaction Regression Harness
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Status:{" "}
            <span data-testid="interaction-harness-status">
              {status === "ready" && "ready"}
              {status === "loading" && "loading"}
              {status === "error" && "error"}
            </span>
          </p>
        </header>

        <section className="flex flex-1 min-h-0 flex-col rounded-xl border bg-background p-3 shadow-sm">
          <div
            className="flex-1 min-h-0 w-full overflow-hidden rounded-md border bg-white"
            data-testid="interaction-sheet-host"
            ref={hostRef}
          />
        </section>
      </div>
    </main>
  );
}
