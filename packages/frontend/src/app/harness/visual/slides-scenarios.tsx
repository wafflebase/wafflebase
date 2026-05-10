import { useEffect, useMemo, useRef, useState } from "react";
import {
  BUILT_IN_LAYOUTS,
  BUILT_IN_THEMES,
  DEFAULT_MASTER,
  MemSlidesStore,
  SlideRenderer,
  defaultLight,
  type Element,
  type ShapeKind,
  type SlidesDocument,
  type Theme,
  type ThemeColor,
} from "@wafflebase/slides";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemePanel } from "@/app/slides/theme-panel";
import { ThemedColorPicker } from "@/app/slides/themed-color-picker";
import { ThemedFontPicker } from "@/app/slides/themed-font-picker";
import { SlidesFormattingToolbar } from "@/app/slides/slides-formatting-toolbar";

interface SlidesScenario {
  id: string;
  title: string;
  description: string;
  render: () => React.ReactNode;
}

// ---- Sample data ----

/**
 * A two-element slide that exercises the renderer's theme path:
 * a centered title text and a small accent1-filled rectangle. Both
 * use role-bound colors so the rendered output differs across themes.
 */
function makeThemedDoc(themeId: string): SlidesDocument {
  return {
    meta: { title: "Visual harness slide", themeId, masterId: "default" },
    themes: BUILT_IN_THEMES,
    masters: [DEFAULT_MASTER],
    layouts: BUILT_IN_LAYOUTS,
    slides: [
      {
        id: "s1",
        layoutId: "title-slide",
        background: { fill: { kind: "role", role: "background" } },
        elements: [
          {
            id: "title",
            type: "text",
            frame: { x: 80, y: 380, w: 1760, h: 160, rotation: 0 },
            data: {
              blocks: [
                {
                  id: "b1",
                  type: "paragraph",
                  inlines: [
                    {
                      text: "Wafflebase Slides",
                      style: {
                        fontSize: 56,
                        color: { kind: "role", role: "text" },
                      },
                    },
                  ],
                  style: {
                    alignment: "center",
                    lineHeight: 1.2,
                    marginTop: 0,
                    marginBottom: 0,
                    textIndent: 0,
                    marginLeft: 0,
                  },
                },
              ],
            },
          },
          {
            id: "accent",
            type: "shape",
            frame: { x: 760, y: 720, w: 400, h: 80, rotation: 0 },
            data: {
              kind: "rect",
              fill: { kind: "role", role: "accent1" },
            },
          },
        ],
        notes: [],
      },
    ],
  };
}

/**
 * Build a layout-only `SlidesDocument` rendering a single slide that
 * uses the given layout id. Placeholders from the layout are projected
 * to elements with text labels so the visual output reflects the
 * layout's placeholder geometry, not just the bare background.
 */
function makeLayoutDoc(layoutId: string): SlidesDocument {
  const layout = BUILT_IN_LAYOUTS.find((l) => l.id === layoutId);
  if (!layout) throw new Error(`Unknown layout: ${layoutId}`);
  const elements: Element[] = layout.placeholders.map((p, i) => ({
    id: `e${i}`,
    type: p.type,
    frame: p.frame,
    data: p.data,
  })) as Element[];
  return {
    meta: { title: layoutId, themeId: "default-light", masterId: "default" },
    themes: BUILT_IN_THEMES,
    masters: [DEFAULT_MASTER],
    layouts: BUILT_IN_LAYOUTS,
    slides: [
      {
        id: "s1",
        layoutId,
        background: { fill: { kind: "role", role: "background" } },
        elements,
        notes: [],
      },
    ],
  };
}

/**
 * Build a slide document that lays out every ShapeKind (P1 + P2) on a
 * single canvas as a 5×11 grid (55 cells, no blanks). Each cell is the
 * same frame size and uses the per-category default fill/stroke from the
 * picker (filled for basic / arrows / equation / flowchart / stars,
 * outlined for callouts, stroked for line / arrow). Used as a single
 * baseline to catch geometry changes across the entire registry.
 *
 * Shapes are ordered in picker-category order:
 *   Lines · Basic Shapes · Block Arrows · Callouts · Equation · Stars · Flowchart
 */
const SHAPE_CATALOG: ShapeKind[] = [
  // Lines (2)
  "line", "arrow",
  // Basic (15)
  "rect", "roundRect", "ellipse", "triangle", "rtTriangle",
  "diamond", "parallelogram", "trapezoid", "pentagon", "hexagon",
  "octagon", "plus", "donut", "can", "cloud",
  // Block arrows (8)
  "rightArrow", "leftArrow", "upArrow", "downArrow",
  "leftRightArrow", "quadArrow", "chevron", "pentagonArrow",
  // Callouts (4)
  "wedgeRectCallout", "wedgeRoundRectCallout",
  "wedgeEllipseCallout", "cloudCallout",
  // Equation (6)
  "mathPlus", "mathMinus", "mathMultiply",
  "mathDivide", "mathEqual", "mathNotEqual",
  // Stars (6, P2)
  "star4", "star5", "star6", "star7", "star8", "star10",
  // Flowchart (14, P2)
  "flowChartTerminator", "flowChartPredefinedProcess",
  "flowChartInternalStorage", "flowChartDocument",
  "flowChartMultidocument", "flowChartManualInput",
  "flowChartManualOperation", "flowChartOffpageConnector",
  "flowChartPunchedCard", "flowChartPunchedTape",
  "flowChartSummingJunction", "flowChartOr",
  "flowChartDelay", "flowChartDisplay",
];

const ACCENT1: ThemeColor = { kind: "role", role: "accent1" };
const TEXT_ROLE: ThemeColor = { kind: "role", role: "text" };
const BG_ROLE: ThemeColor = { kind: "role", role: "background" };
const CALLOUT_KINDS = new Set<ShapeKind>([
  "wedgeRectCallout",
  "wedgeRoundRectCallout",
  "wedgeEllipseCallout",
  "cloudCallout",
]);
const LINE_KINDS = new Set<ShapeKind>(["line", "arrow"]);

function shapeElement(
  kind: ShapeKind,
  frame: { x: number; y: number; w: number; h: number },
): Element {
  const adjustments = undefined; // Defaults — Phase 1 has no edit UI.
  const lineSpecial = LINE_KINDS.has(kind);
  const callout = CALLOUT_KINDS.has(kind);
  return {
    id: `${kind}-${frame.x}-${frame.y}`,
    type: "shape",
    frame: { ...frame, rotation: 0 },
    data: {
      kind,
      adjustments,
      ...(lineSpecial
        ? {
            stroke: { color: TEXT_ROLE, width: 2 },
            ...(kind === "arrow" ? { fill: TEXT_ROLE } : {}),
          }
        : callout
          ? { fill: BG_ROLE, stroke: { color: TEXT_ROLE, width: 2 } }
          : { fill: ACCENT1 }),
    },
  } as Element;
}

function makeCatalogDoc(themeId: string = "default-light"): SlidesDocument {
  // 5 columns × 11 rows = 55 cells (P1 35 + P2 20). Canvas is the
  // standard 1920×1080 logical slide; cell size derived to fit with a
  // small inset.
  const cols = 5;
  const rows = 11;
  const cellW = 200;
  // 11 rows × 96 px = 1056 px ≤ 1080 — fits with 12 px top/bottom margin.
  const cellH = 96;
  const xPad = (1920 - cols * cellW) / 2;
  const yPad = (1080 - rows * cellH) / 2;
  const elements: Element[] = SHAPE_CATALOG.map((kind, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = xPad + col * cellW;
    const cellY = yPad + row * cellH;
    return shapeElement(kind, {
      x: cellX + 30,
      y: cellY + 20,
      w: cellW - 60,
      h: cellH - 40,
    });
  });
  return {
    meta: { title: "Shape catalog", themeId, masterId: "default" },
    themes: BUILT_IN_THEMES,
    masters: [DEFAULT_MASTER],
    layouts: BUILT_IN_LAYOUTS,
    slides: [
      {
        id: "s1",
        layoutId: "blank",
        background: { fill: { kind: "role", role: "background" } },
        elements,
        notes: [],
      },
    ],
  };
}

/**
 * Build a slide rendering one large donut to verify the evenodd fill
 * rule produces a visible hole. Without evenodd, the inner ellipse
 * would be filled the same accent1 colour as the outer one.
 */
function makeDonutDoc(): SlidesDocument {
  return {
    meta: { title: "Donut evenodd", themeId: "default-light", masterId: "default" },
    themes: BUILT_IN_THEMES,
    masters: [DEFAULT_MASTER],
    layouts: BUILT_IN_LAYOUTS,
    slides: [
      {
        id: "s1",
        layoutId: "blank",
        background: { fill: BG_ROLE },
        elements: [shapeElement("donut", { x: 660, y: 240, w: 600, h: 600 })],
        notes: [],
      },
    ],
  };
}

/**
 * Build a slide with a single rectangular callout so the tail's
 * attachment to the closest edge (default `[-20833, 62500]` →
 * bottom-edge tail pointing down-left) is visible in the baseline.
 */
function makeCalloutDoc(): SlidesDocument {
  return {
    meta: { title: "Callout tail", themeId: "default-light", masterId: "default" },
    themes: BUILT_IN_THEMES,
    masters: [DEFAULT_MASTER],
    layouts: BUILT_IN_LAYOUTS,
    slides: [
      {
        id: "s1",
        layoutId: "blank",
        background: { fill: BG_ROLE },
        elements: [
          shapeElement("wedgeRectCallout", { x: 760, y: 320, w: 400, h: 200 }),
        ],
        notes: [],
      },
    ],
  };
}

/**
 * Mount `SlideRenderer` onto a real DOM canvas at the given size. The
 * dpr is fixed at 1 so the captured pixel output is deterministic
 * across the harness profiles.
 */
function SlideCanvas({
  doc,
  width = 480,
  height = 270,
}: {
  doc: SlidesDocument;
  width?: number;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const renderer = new SlideRenderer(ctx, {
      hostWidth: width,
      hostHeight: height,
      dpr: 1,
    });
    renderer.render(doc.slides[0], doc);
  }, [doc, width, height]);

  return (
    <canvas
      ref={ref}
      className="rounded-md border bg-background"
      style={{ width, height }}
    />
  );
}

// ---- Scenarios ----

const PICKER_THEME: Theme = defaultLight;

const SLIDES_SCENARIOS: SlidesScenario[] = [
  // Theme coverage — same composition across all five built-in themes
  // catches role→hex resolution regressions for every palette.
  {
    id: "slides-canvas-default-light",
    title: "Theme — Simple Light",
    description:
      "Themed slide rendered through the real browser canvas under default-light. Title (text role) + rect (accent1 role).",
    render: () => <SlideCanvas doc={makeThemedDoc("default-light")} />,
  },
  {
    id: "slides-canvas-default-dark",
    title: "Theme — Simple Dark",
    description:
      "Same slide under default-dark to verify role colors flip with the active theme.",
    render: () => <SlideCanvas doc={makeThemedDoc("default-dark")} />,
  },
  {
    id: "slides-canvas-streamline",
    title: "Theme — Streamline",
    description: "Same slide under the streamline theme.",
    render: () => <SlideCanvas doc={makeThemedDoc("streamline")} />,
  },
  {
    id: "slides-canvas-focus",
    title: "Theme — Focus",
    description: "Same slide under the focus theme (cream + warm accents).",
    render: () => <SlideCanvas doc={makeThemedDoc("focus")} />,
  },
  {
    id: "slides-canvas-material",
    title: "Theme — Material",
    description: "Same slide under the material theme.",
    render: () => <SlideCanvas doc={makeThemedDoc("material")} />,
  },
  // Layout coverage — three structurally diverse layouts to validate
  // placeholder geometry on the canvas pipeline.
  {
    id: "slides-canvas-layout-section-header",
    title: "Layout — Section header",
    description:
      "Section-header layout (single big-title placeholder, vertical centre).",
    render: () => <SlideCanvas doc={makeLayoutDoc("section-header")} />,
  },
  {
    id: "slides-canvas-layout-title-body",
    title: "Layout — Title and body",
    description:
      "Title and body layout (two stacked placeholders, top title + body).",
    render: () => <SlideCanvas doc={makeLayoutDoc("title-body")} />,
  },
  {
    id: "slides-canvas-layout-big-number",
    title: "Layout — Big number",
    description:
      "Big-number layout (large centred number placeholder + caption).",
    render: () => <SlideCanvas doc={makeLayoutDoc("big-number")} />,
  },
  // UI surfaces — toolbar, theme panel, and combined picker dropdowns.
  {
    id: "slides-toolbar",
    title: "Formatting toolbar",
    description:
      "Slides toolbar with insert buttons, contextual Fill / Font triggers, and theme toggle. Mounted with a memory store and the default-light theme.",
    render: () => <SlidesToolbarScenario />,
  },
  {
    id: "slides-theme-panel",
    title: "Theme picker panel",
    description:
      "Right-docked theme panel with five built-in theme thumbnails and the close button.",
    render: () => <SlidesThemePanelScenario />,
  },
  {
    id: "slides-pickers",
    title: "Themed color + font pickers",
    description:
      "Contextual picker layouts — color picker (Theme / Standard / Custom) and font picker (Theme fonts / System) — rendered standalone for baseline coverage independent of toolbar state.",
    render: () => <SlidesPickersScenario />,
  },
  // Shape library — geometry baselines for all 55 shape builders (P1 + P2).
  // The catalog scenario covers every kind in one go on a 5×11 grid;
  // donut and callout pin a couple of higher-risk geometries
  // (evenodd fill, tail attachment) at larger sizes for clarity.
  {
    id: "slides-canvas-shapes-catalog-light",
    title: "Shapes — full 55 catalog (light)",
    description:
      "Every ShapeKind (P1 + P2, 55 total) on a single slide, 5×11 grid. Default fills/strokes from the picker (accent1 fill for basic/arrows/equation/flowchart/stars, outlined for callouts). Default-light theme.",
    render: () => <SlideCanvas doc={makeCatalogDoc("default-light")} />,
  },
  {
    id: "slides-canvas-shapes-catalog-dark",
    title: "Shapes — full 55 catalog (dark)",
    description:
      "Same 55-shape catalog under default-dark theme — verifies role-bound fills/strokes flip correctly for all builders.",
    render: () => <SlideCanvas doc={makeCatalogDoc("default-dark")} />,
  },
  {
    id: "slides-canvas-shapes-catalog-material",
    title: "Shapes — full 55 catalog (material)",
    description:
      "55-shape catalog under the material theme — non-trivial accent1 colour to confirm theme resolution paths for all builders.",
    render: () => <SlideCanvas doc={makeCatalogDoc("material")} />,
  },
  {
    id: "slides-canvas-donut-evenodd",
    title: "Shape — donut evenodd hole",
    description:
      "Single large donut. Hole must be visible; without the dispatcher's evenodd opt-in the inner ellipse would fill the same accent1 colour.",
    render: () => <SlideCanvas doc={makeDonutDoc()} />,
  },
  {
    id: "slides-canvas-callout-tail",
    title: "Shape — callout tail attachment",
    description:
      "wedgeRectCallout with default adjustments (`[-20833, 62500]`). Tail attaches to the closest edge — bottom — and points down-left. Verifies the tail-edge selection logic and outline default fill.",
    render: () => <SlideCanvas doc={makeCalloutDoc()} />,
  },
];

// ---- Scenario components ----

function SlidesToolbarScenario() {
  const store = useMemo(() => new MemSlidesStore(), []);
  return (
    <div className="rounded-md border bg-background">
      <SlidesFormattingToolbar
        editor={null}
        store={store}
        theme={defaultLight}
        onToggleThemePanel={() => undefined}
        themePanelOpen={false}
      />
    </div>
  );
}

function SlidesThemePanelScenario() {
  const store = useMemo(() => new MemSlidesStore(), []);
  const [currentThemeId] = useState("default-light");
  return (
    <div className="flex justify-center bg-background">
      <ThemePanel
        store={store}
        currentThemeId={currentThemeId}
        onClose={() => undefined}
      />
    </div>
  );
}

function SlidesPickersScenario() {
  return (
    <div className="grid gap-4 rounded-md border bg-background p-3 sm:grid-cols-2">
      <ThemedColorPicker
        value={{ kind: "role", role: "accent1" }}
        theme={PICKER_THEME}
        onChange={() => undefined}
      />
      <ThemedFontPicker
        value={{ kind: "role", role: "heading" }}
        theme={PICKER_THEME}
        onChange={() => undefined}
      />
    </div>
  );
}

// ---- Layout ----

function SlidesScenarioCard({ scenario }: { scenario: SlidesScenario }) {
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
      <CardContent>{scenario.render()}</CardContent>
    </Card>
  );
}

export function SlidesVisualScenarios() {
  return (
    <section
      className="space-y-4"
      data-testid="visual-harness-slides-section"
      data-visual-slides-ready="true"
    >
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          Slides Visual Scenarios
        </h2>
        <p className="text-sm text-muted-foreground">
          Validates the slides canvas renderer (across themes and layouts),
          formatting toolbar, theme picker panel, and contextual pickers
          against browser baselines. This is the single visual regression
          surface for slides; there is no separate node-canvas golden lane.
        </p>
      </header>
      <div className="grid gap-4 xl:grid-cols-2">
        {SLIDES_SCENARIOS.map((scenario) => (
          <SlidesScenarioCard key={scenario.id} scenario={scenario} />
        ))}
      </div>
    </section>
  );
}
