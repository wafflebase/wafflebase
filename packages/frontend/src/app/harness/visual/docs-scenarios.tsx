import {
  MemDocStore,
  createBlock,
  generateBlockId,
  initialize,
  DEFAULT_BLOCK_STYLE,
  type Block,
  type Document as DocsDocument,
  type PageSetup,
  type EditorAPI,
  type ThemeMode,
} from "@wafflebase/docs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type DocsScenario = {
  id: string;
  title: string;
  description: string;
  buildDocument: () => DocsDocument;
};

type ScenarioState = "loading" | "ready" | "error";

/**
 * Small paper size + tight margins so the screenshot frames the content
 * being tested instead of mostly the page's default 96px margins.
 */
const COMPACT_PAGE_SETUP: PageSetup = {
  paperSize: { name: "Compact", width: 640, height: 260 },
  orientation: "portrait",
  margins: { top: 24, bottom: 24, left: 24, right: 24 },
};

function createMixedFontSizeLineDocument(): DocsDocument {
  const block: Block = {
    id: generateBlockId(),
    type: "paragraph",
    inlines: [
      { text: "Small ", style: { fontSize: 11 } },
      { text: "Medium ", style: { fontSize: 18 } },
      { text: "LARGE", style: { fontSize: 32, bold: true } },
    ],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
  return { blocks: [block], pageSetup: COMPACT_PAGE_SETUP };
}

function createMixedFontSizeListDocument(): DocsDocument {
  const block: Block = {
    ...createBlock("list-item", { listKind: "unordered", listLevel: 0 }),
    inlines: [
      { text: "small, ", style: { fontSize: 11 } },
      { text: "BIG", style: { fontSize: 32, bold: true } },
      { text: ", small", style: { fontSize: 11 } },
    ],
  };
  return { blocks: [block], pageSetup: COMPACT_PAGE_SETUP };
}

const DOCS_SCENARIOS: DocsScenario[] = [
  {
    id: "docs-mixed-font-size-line",
    title: "Mixed Font-Size Line Baseline",
    description:
      "Verifies runs of different font sizes on one line share a common baseline instead of each floating at its own size.",
    buildDocument: createMixedFontSizeLineDocument,
  },
  {
    id: "docs-mixed-font-size-list-marker",
    title: "List Marker Baseline With Mixed Runs",
    description:
      "Verifies the bullet marker's Y position follows the line's max font size, not the marker's own (smaller) font size.",
    buildDocument: createMixedFontSizeListDocument,
  },
];

function DocsScenarioCard({
  scenario,
  theme,
  onReadyChange,
}: {
  scenario: DocsScenario;
  theme: ThemeMode;
  onReadyChange: (id: string, ready: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ScenarioState>("loading");

  useEffect(() => {
    onReadyChange(scenario.id, state === "ready");
  }, [onReadyChange, scenario.id, state]);

  useEffect(() => {
    let mounted = true;
    let editor: EditorAPI | undefined;
    const container = containerRef.current;

    function setupScenario() {
      if (!container) {
        return;
      }

      setState("loading");
      container.innerHTML = "";

      try {
        const store = new MemDocStore();
        store.setDocument(scenario.buildDocument());

        editor = initialize(container, store, theme, /* readOnly */ true);

        // The editor pins its canvas with `position: sticky` for scroll
        // behavior in the real (scrollable) document view. Inside this
        // fixed-height, non-scrolling scenario card it only fights with
        // Playwright's scroll-into-view stability check when the card
        // sits below the fold (e.g. the mobile capture profile) — so pin
        // it statically for this read-only snapshot instead.
        const canvas = container.querySelector<HTMLCanvasElement>("canvas[data-role='doc-canvas']");
        if (canvas) {
          canvas.style.position = "static";
        }

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

    setupScenario();

    return () => {
      mounted = false;
      editor?.dispose();
      if (container) {
        container.innerHTML = "";
      }
    };
  }, [scenario, theme]);

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
            className={`h-[260px] w-full overflow-hidden rounded-sm ${theme === "dark" ? "bg-[#1E1E1E]" : "bg-white"}`}
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

export function DocsVisualScenarios({ theme }: { theme: ThemeMode }) {
  const [readyMap, setReadyMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(DOCS_SCENARIOS.map((s) => [s.id, false])),
  );

  const handleReadyChange = useCallback((id: string, ready: boolean) => {
    setReadyMap((current) => {
      if (current[id] === ready) return current;
      return { ...current, [id]: ready };
    });
  }, []);

  const allReady = useMemo(
    () => DOCS_SCENARIOS.every((s) => readyMap[s.id] === true),
    [readyMap],
  );

  return (
    <section
      className="space-y-4"
      data-testid="visual-harness-docs-section"
      data-visual-docs-ready={allReady ? "true" : "false"}
    >
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Docs Engine Visual Scenarios</h2>
        <p className="text-sm text-muted-foreground">
          Validates canvas-based document rendering (line baselines, list markers) against
          browser baselines.
        </p>
      </header>
      {/*
        grid-cols-1 (not just the bare `grid` sheet/format/chart siblings use)
        is required here: below `xl` there is no explicit column template, so
        the track sizes to max-content. The docs canvas has no CSS width of
        its own (only an intrinsic pixel-width attribute set by the editor's
        resize logic, which in turn measures the container's *parent* width)
        — so an unconstrained max-content column and the canvas's own width
        feed back into each other and grow without bound every resize tick.
        Pinning the column to minmax(0, 1fr) breaks the loop.
      */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {DOCS_SCENARIOS.map((scenario) => (
          <DocsScenarioCard
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
