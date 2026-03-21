import {
  initialize,
  MemDocStore,
  type Document,
  type Block,
  type EditorAPI,
  DEFAULT_BLOCK_STYLE,
  PAPER_SIZES,
} from "@wafflebase/docs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type DocsScenarioSetup = {
  document: Document;
};

type DocsScenario = {
  id: string;
  title: string;
  description: string;
  setup: () => DocsScenarioSetup;
};

type ScenarioState = "loading" | "ready" | "error";

let blockCounter = 0;
function makeBlock(
  inlines: Block["inlines"],
  style?: Partial<Block["style"]>,
): Block {
  return {
    id: `harness-block-${blockCounter++}`,
    type: "paragraph",
    inlines,
    style: { ...DEFAULT_BLOCK_STYLE, ...style },
  };
}

function createMultiPageScenario(): DocsScenarioSetup {
  const bodyTexts = [
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
    "Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Nullam varius, turpis et commodo pharetra, est eros bibendum elit, nec luctus magna felis sollicitudin mauris. Integer in mauris eu nibh euismod gravida.",
    "Praesent blandit laoreet nibh. Fusce convallis metus id felis luctus adipiscing. Pellentesque egestas, neque sit amet convallis pulvinar, justo nulla eleifend augue, ac auctor orci leo non est.",
    "Quisque id odio. Praesent venenatis metus at tortor pulvinar varius. Nulla facilisi. Sed a turpis eu lacus commodo facilisis. Morbi fringilla, wisi in dignissim interdum, justo lectus sagittis dui.",
    "Fusce fermentum. Nullam cursus lacinia erat. Praesent blandit laoreet nibh. Fusce convallis metus id felis luctus adipiscing. Pellentesque egestas, neque sit amet convallis pulvinar.",
    "Sed magna purus, fermentum eu, tincidunt eu, varius ut, felis. In auctor lobortis lacus. Quisque libero metus, condimentum at, tempor a, commodo mollis, magna. Pellentesque habitant morbi.",
    "Aenean nec lorem. In porttitor. Donec laoreet nonummy augue. Suspendisse dui purus, scelerisque at, vulputate vitae, pretium mattis, nunc. Mauris eget neque at sem venenatis eleifend.",
    "Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. Nam eget dui. Etiam rhoncus. Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero.",
    "Donec vitae orci sed dolor rutrum auctor. Fusce egestas elit eget lorem. Suspendisse nisl elit, rhoncus eget, elementum ac, condimentum eget, diam. Nam at tortor in tellus interdum sagittis.",
    "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia Curae. Morbi lacinia molestie dui. Praesent blandit dolor. Sed non quam.",
    "Morbi in ipsum sit amet pede facilisis laoreet. Donec lacus nunc, viverra nec, blandit vel, egestas et, augue. Vestibulum tincidunt malesuada tellus. Ut ultrices ultrices enim.",
  ];

  const blocks: Block[] = [
    makeBlock(
      [{ text: "Pagination Demo", style: { bold: true, fontSize: 24 } }],
      { alignment: "center", marginBottom: 16 },
    ),
    makeBlock(
      [
        {
          text: "This document demonstrates multi-page layout with text flowing across page boundaries.",
          style: { fontSize: 14, italic: true, color: "#6b7280" },
        },
      ],
      { alignment: "center", marginBottom: 24 },
    ),
    ...bodyTexts.map((text) =>
      makeBlock(
        [{ text, style: { fontSize: 14 } }],
        { lineHeight: 1.6, marginBottom: 12 },
      ),
    ),
  ];

  return {
    document: {
      blocks,
      pageSetup: {
        paperSize: PAPER_SIZES.LETTER,
        orientation: "portrait",
        margins: { top: 96, bottom: 96, left: 96, right: 96 },
      },
    },
  };
}

function createStyledTextScenario(): DocsScenarioSetup {
  const blocks: Block[] = [
    makeBlock(
      [{ text: "Styled Text Demo", style: { bold: true, fontSize: 28 } }],
      { marginBottom: 20 },
    ),
    makeBlock([
      { text: "Bold text", style: { bold: true, fontSize: 16 } },
      { text: " mixed with ", style: { fontSize: 16 } },
      { text: "italic text", style: { italic: true, fontSize: 16 } },
      { text: " and ", style: { fontSize: 16 } },
      { text: "underlined text", style: { underline: true, fontSize: 16 } },
      { text: " in one paragraph.", style: { fontSize: 16 } },
    ]),
    makeBlock([
      { text: "Colors: ", style: { fontSize: 16, bold: true } },
      { text: "Red ", style: { fontSize: 16, color: "#dc2626" } },
      { text: "Green ", style: { fontSize: 16, color: "#16a34a" } },
      { text: "Blue ", style: { fontSize: 16, color: "#2563eb" } },
      { text: "Purple", style: { fontSize: 16, color: "#9333ea" } },
    ]),
    makeBlock(
      [{ text: "Left-aligned paragraph (default)", style: { fontSize: 14 } }],
      { marginTop: 16 },
    ),
    makeBlock(
      [{ text: "Center-aligned paragraph", style: { fontSize: 14 } }],
      { alignment: "center" },
    ),
    makeBlock(
      [{ text: "Right-aligned paragraph", style: { fontSize: 14 } }],
      { alignment: "right" },
    ),
    makeBlock(
      [
        { text: "Large ", style: { fontSize: 24, bold: true } },
        { text: "and ", style: { fontSize: 16 } },
        { text: "small", style: { fontSize: 11 } },
        { text: " font sizes together.", style: { fontSize: 16 } },
      ],
      { marginTop: 12 },
    ),
  ];

  return {
    document: {
      blocks,
      pageSetup: {
        paperSize: PAPER_SIZES.LETTER,
        orientation: "portrait",
        margins: { top: 96, bottom: 96, left: 96, right: 96 },
      },
    },
  };
}

const DOCS_SCENARIOS: DocsScenario[] = [
  {
    id: "docs-multi-page",
    title: "Multi-Page Pagination",
    description:
      "Verifies text flowing across page boundaries with page shadows, gaps, and margin rendering.",
    setup: createMultiPageScenario,
  },
  {
    id: "docs-styled-text",
    title: "Styled Text",
    description:
      "Verifies inline formatting (bold, italic, underline, color) and block alignment rendering.",
    setup: createStyledTextScenario,
  },
];

function DocsScenarioCard({
  scenario,
  onReadyChange,
}: {
  scenario: DocsScenario;
  onReadyChange: (id: string, ready: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ScenarioState>("loading");
  const editorRef = useRef<EditorAPI | undefined>(undefined);

  useEffect(() => {
    onReadyChange(scenario.id, state === "ready");
  }, [onReadyChange, scenario.id, state]);

  useEffect(() => {
    let mounted = true;
    const container = containerRef.current;

    function setupScenario() {
      if (!container) return;

      setState("loading");
      editorRef.current = undefined;
      container.innerHTML = "";

      try {
        const result = scenario.setup();
        if (!mounted) return;

        const store = new MemDocStore(result.document);
        const editor = initialize(container, store);

        if (mounted) {
          editorRef.current = editor;
          setState("ready");
        } else {
          editor.dispose();
        }
      } catch (error) {
        console.error(`[visual-harness] failed to set up docs scenario ${scenario.id}`, error);
        if (mounted) setState("error");
      }
    }

    setupScenario();

    return () => {
      mounted = false;
      editorRef.current?.dispose();
      editorRef.current = undefined;
      if (container) container.innerHTML = "";
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
            className="h-[400px] w-full overflow-hidden rounded-sm bg-[#f0f0f0]"
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

export function DocsVisualScenarios() {
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
        <h2 className="text-xl font-semibold tracking-tight">
          Document Editor Visual Scenarios
        </h2>
        <p className="text-sm text-muted-foreground">
          Validates canvas-based document editor rendering with pagination, styling, and page layout.
        </p>
      </header>
      <div className="grid gap-4 xl:grid-cols-2">
        {DOCS_SCENARIOS.map((scenario) => (
          <DocsScenarioCard
            key={scenario.id}
            onReadyChange={handleReadyChange}
            scenario={scenario}
          />
        ))}
      </div>
    </section>
  );
}
