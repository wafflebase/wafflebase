import { useEffect, useMemo, useRef, useState } from "react";
import {
  BUILT_IN_LAYOUTS,
  BUILT_IN_THEMES,
  DEFAULT_MASTER,
  MemSlidesStore,
  SlideRenderer,
  defaultLight,
  type Element,
  type SlidesDocument,
  type Theme,
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
