import { useEffect, useMemo, useRef, useState } from "react";
import {
  BUILT_IN_LAYOUTS,
  BUILT_IN_THEMES,
  DEFAULT_MASTER,
  GHOST_ALPHA,
  MemSlidesStore,
  SlideRenderer,
  defaultLight,
  seedPlaceholderBlocks,
  type Element,
  type PlaceholderType,
  type ShapeKind,
  type SlidesDocument,
  type SlidesEditor,
  type SlidesTextBoxEditor,
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
import { SlidesToolbar } from "@/app/slides/toolbar";

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

// Demo text per placeholder type. The raw layout placeholders carry
// empty inline text, so a baseline of the canvas-only renderer would
// show just the background — see `emptyBlocks` in slides/model/layout.ts.
// Seeding visible text here makes the placeholder geometry observable.
const PLACEHOLDER_DEMO_TEXT: Record<PlaceholderType, string> = {
  title: "Title",
  subtitle: "Subtitle",
  body: "Body text — short paragraph so the placeholder frame is visible.",
  caption: "Caption",
  "big-number": "42",
};

/**
 * Build a layout-only `SlidesDocument` rendering a single slide that
 * uses the given layout id. Placeholders from the layout are projected
 * to elements seeded with the master's placeholder typography plus
 * demo text, so the visual output reflects the layout's placeholder
 * geometry, not just the bare background.
 */
function makeLayoutDoc(layoutId: string): SlidesDocument {
  const layout = BUILT_IN_LAYOUTS.find((l) => l.id === layoutId);
  if (!layout) throw new Error(`Unknown layout: ${layoutId}`);
  const elements: Element[] = layout.placeholders.map((p, i) => {
    const placeholderType = p.placeholder.type;
    const style =
      DEFAULT_MASTER.placeholderStyles[placeholderType]
      ?? DEFAULT_MASTER.placeholderStyles.body;
    const blocks = seedPlaceholderBlocks(style, defaultLight);
    blocks[0].inlines[0].text = PLACEHOLDER_DEMO_TEXT[placeholderType];
    return {
      id: `e${i}`,
      type: p.type,
      frame: p.frame,
      data: { blocks },
    };
  }) as Element[];
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
 * outlined for callouts). Used as a single baseline to catch geometry
 * changes across the entire registry.
 *
 * Connectors (line / arrow) live outside the shape registry now —
 * connector-rendering visual coverage is deferred to a future PR.
 *
 * Order is "old before new" so the regression diff focuses on new
 * shapes as categories grow: P1 (basics, arrows, callouts, equation)
 * first, then P2 stars + flowchart, then P3-B additions appended to
 * each family (basics, snip/round rects, banners, arrows, line
 * callouts), with the 12 action buttons last (their special-cased
 * renderer makes them the natural tail of the catalog).
 *
 * The picker itself uses spec order (Lines · Shapes · Block Arrows
 * · Banners · Flowchart · Callouts · Equation · Stars · Action
 * Buttons) — see `docs/tasks/active/20260509-slides-shapes-p2-lessons.md`
 * for the original "categories may diverge between catalog and
 * picker" trade-off rationale.
 */
const SHAPE_CATALOG: ShapeKind[] = [
  // Basic — P1 (15)
  "rect", "roundRect", "ellipse", "triangle", "rtTriangle",
  "diamond", "parallelogram", "trapezoid", "pentagon", "hexagon",
  "octagon", "plus", "donut", "can", "cloud",
  // Basic — P3-B regular polys (3)
  "heptagon", "decagon", "dodecagon",
  // Basic — P3-B sector / arc (4)
  "pie", "chord", "arc", "blockArc",
  // Basic — P3-B linear (8)
  "frame", "halfFrame", "corner", "diagStripe",
  "plaque", "bevel", "foldedCorner", "cube",
  // Basic — P3-B character (7)
  "teardrop", "smileyFace", "heart", "lightningBolt",
  "sun", "moon", "noSmoking",
  // Basic — P3-B snip / round-corner rects (7)
  "snip1Rect", "snip2SameRect", "snip2DiagRect", "snipRoundRect",
  "round1Rect", "round2SameRect", "round2DiagRect",
  // Block arrows — P1 (8)
  "rightArrow", "leftArrow", "upArrow", "downArrow",
  "leftRightArrow", "quadArrow", "chevron", "pentagonArrow",
  // Block arrows — P3-B (13)
  "upDownArrow", "leftRightUpArrow",
  "notchedRightArrow", "stripedRightArrow",
  "bentArrow", "bentUpArrow", "uturnArrow", "swooshArrow",
  "circularArrow",
  "curvedRightArrow", "curvedLeftArrow",
  "curvedUpArrow", "curvedDownArrow",
  // Banners — P3-B (5)
  "ribbon", "ribbon2", "horizontalScroll", "verticalScroll",
  "leftRightRibbon",
  // Callouts — P1 (4)
  "wedgeRectCallout", "wedgeRoundRectCallout",
  "wedgeEllipseCallout", "cloudCallout",
  // Callouts — P3-B line callouts (3)
  "borderCallout1", "borderCallout2", "borderCallout3",
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
  // Action buttons — P3-B (12)
  "actionButtonBlank", "actionButtonBackPrevious",
  "actionButtonForwardNext", "actionButtonBeginning",
  "actionButtonEnd", "actionButtonHome",
  "actionButtonInformation", "actionButtonReturn",
  "actionButtonMovie", "actionButtonSound",
  "actionButtonDocument", "actionButtonHelp",
];

const ACCENT1: ThemeColor = { kind: "role", role: "accent1" };
const TEXT_ROLE: ThemeColor = { kind: "role", role: "text" };
const BG_ROLE: ThemeColor = { kind: "role", role: "background" };
const CALLOUT_KINDS = new Set<ShapeKind>([
  "wedgeRectCallout",
  "wedgeRoundRectCallout",
  "wedgeEllipseCallout",
  "cloudCallout",
  "borderCallout1",
  "borderCallout2",
  "borderCallout3",
]);
const STROKE_ONLY_KINDS = new Set<ShapeKind>(["arc"]);

function isActionButtonKind(kind: ShapeKind): boolean {
  return kind.startsWith("actionButton");
}

function shapeElement(
  kind: ShapeKind,
  frame: { x: number; y: number; w: number; h: number },
): Element {
  const adjustments = undefined;
  const callout = CALLOUT_KINDS.has(kind);
  const strokeOnly = STROKE_ONLY_KINDS.has(kind);
  const actionButton = isActionButtonKind(kind);
  return {
    id: `${kind}-${frame.x}-${frame.y}`,
    type: "shape",
    frame: { ...frame, rotation: 0 },
    data: {
      kind,
      adjustments,
      ...(strokeOnly
        ? { stroke: { color: TEXT_ROLE, width: 2 } }
        : callout || actionButton
          ? { fill: BG_ROLE, stroke: { color: TEXT_ROLE, width: 2 } }
          : { fill: ACCENT1 }),
    },
  } as Element;
}

function makeCatalogDoc(themeId: string = "default-light"): SlidesDocument {
  // 10 columns × 12 rows = 120 cells, 115 used (5 trailing empty) —
  // grew from the P1+P2 5×11=55 layout to fit the P3-B catalog. Line
  // and arrow connectors moved out of `ShapeKind` to the connector
  // pipeline (Task 14, slides connectors PR1) so the catalog now
  // covers shape-builder geometry only. Cells are roughly square so
  // character / arrow shapes don't get squashed along the longer axis.
  const cols = 10;
  const rows = 12;
  const cellW = 190;
  const cellH = 88;
  const xPad = (1920 - cols * cellW) / 2;
  const yPad = (1080 - rows * cellH) / 2;
  const elements: Element[] = SHAPE_CATALOG.map((kind, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = xPad + col * cellW;
    const cellY = yPad + row * cellH;
    return shapeElement(kind, {
      x: cellX + 20,
      y: cellY + 12,
      w: cellW - 40,
      h: cellH - 24,
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
 * Build a slide that exercises the 9 pilot shapes whose adjustment
 * handles are wired in P3-A.1. Two rows of 9 shapes verify that
 * authored adjustments produce visibly different geometry from the
 * OOXML defaults:
 *
 *  Row 1 (y≈100) — each shape at its OOXML default adjustments.
 *  Row 2 (y≈350) — each shape at a deliberately different authored
 *                   value so a regression in apply/clamp/path math
 *                   jumps out in the pixel diff.
 *  Bonus shape    — star5 at default adjustments, rotated π/6 (30°),
 *                   positioned to the right of the grid. Verifies that
 *                   the shape geometry is rotation-independent (handles
 *                   are a DOM overlay concern tested separately).
 *
 * Fill/stroke follows the same per-category rules as `makeCatalogDoc`:
 *   • roundRect   → accent1 (basic shape)
 *   • chevron     → accent1 (block arrow)
 *   • wedgeRectCallout → BG_ROLE fill + TEXT_ROLE stroke (callout)
 *   • star*       → accent1 (star)
 */
function makeAdjustmentsPilotDoc(): SlidesDocument {
  // Cell layout: 9 shapes × (140w + 30 gap) starting at x=30.
  // Two rows: y=100 (defaults) and y=350 (authored). Canvas is 1920×1080.
  const cellW = 140;
  const gap = 30;
  const cellH = 100;

  // Pilot shapes (left → right order)
  const PILOT_KINDS: ShapeKind[] = [
    "roundRect",
    "chevron",
    "wedgeRectCallout",
    "star4",
    "star5",
    "star6",
    "star7",
    "star8",
    "star10",
  ];

  // Default OOXML adjustments for each pilot shape.
  const DEFAULT_ADJUSTMENTS: (number[] | undefined)[] = [
    undefined,           // roundRect  — [16667]
    undefined,           // chevron    — [50000]
    undefined,           // wedgeRectCallout — [-20833, 62500]
    undefined,           // star4      — [12500]
    undefined,           // star5      — [19098]
    undefined,           // star6      — [28868]
    undefined,           // star7      — [34601]
    undefined,           // star8      — [37500]
    undefined,           // star10     — [42533]
  ];

  // Authored (visibly different) adjustments for each pilot shape.
  const AUTHORED_ADJUSTMENTS: number[][] = [
    [40000],          // roundRect — near-max corner radius
    [20000],          // chevron   — shallow notch
    [60000, 0],       // wedgeRectCallout — tail right of frame, mid-height
    [35000],          // star4
    [35000],          // star5
    [40000],          // star6
    [45000],          // star7
    [45000],          // star8
    [42533],          // star10 — same as default (control)
  ];

  function fillFor(kind: ShapeKind) {
    if (CALLOUT_KINDS.has(kind)) {
      return { fill: BG_ROLE, stroke: { color: TEXT_ROLE, width: 2 } };
    }
    return { fill: ACCENT1 };
  }

  const elements: Element[] = [];

  // Row 1 — default adjustments
  const row1Y = 100;
  PILOT_KINDS.forEach((kind, i) => {
    const x = 30 + i * (cellW + gap);
    elements.push({
      id: `adj-default-${kind}`,
      type: "shape",
      frame: { x, y: row1Y, w: cellW, h: cellH, rotation: 0 },
      data: {
        kind,
        adjustments: DEFAULT_ADJUSTMENTS[i],
        ...fillFor(kind),
      },
    } as Element);
  });

  // Row 2 — authored adjustments
  const row2Y = 350;
  PILOT_KINDS.forEach((kind, i) => {
    const x = 30 + i * (cellW + gap);
    elements.push({
      id: `adj-authored-${kind}`,
      type: "shape",
      frame: { x, y: row2Y, w: cellW, h: cellH, rotation: 0 },
      data: {
        kind,
        adjustments: AUTHORED_ADJUSTMENTS[i],
        ...fillFor(kind),
      },
    } as Element);
  });

  // Rotated star5 — verifies geometry is correct through a rotation transform.
  // Handles are a DOM overlay concern; this only exercises path rendering.
  elements.push({
    id: "adj-rotated-star5",
    type: "shape",
    frame: { x: 1500, y: 200, w: 140, h: 140, rotation: Math.PI / 6 },
    data: {
      kind: "star5",
      adjustments: undefined, // OOXML default [19098]
      fill: ACCENT1,
    },
  } as Element);

  return {
    meta: {
      title: "Adjustments pilot",
      themeId: "default-light",
      masterId: "default",
    },
    themes: BUILT_IN_THEMES,
    masters: [DEFAULT_MASTER],
    layouts: BUILT_IN_LAYOUTS,
    slides: [
      {
        id: "s1",
        layoutId: "blank",
        background: { fill: BG_ROLE },
        elements,
        notes: [],
      },
    ],
  };
}

/**
 * Renders the 24 shapes that P3-A.2 added to ADJUSTMENT_HANDLES at
 * their OOXML default adjustments. Catches path-builder regressions
 * on the sweep shapes; the pilot 9 keep their own scenario above.
 *
 * Layout: 6 columns × 4 rows = 24 cells (cellW=140, cellH=100,
 * gap=30, starting at x=30, y=80). Last row has 24-(6*3)=6 cells
 * exactly, so the grid is full.
 */
function makeAdjustmentsSweepDoc(): SlidesDocument {
  const cellW = 140;
  const cellH = 100;
  const gap = 30;
  const cols = 6;

  // 24 sweep shapes registered by P3-A.2 T2-T7.
  const SWEEP_KINDS: ShapeKind[] = [
    "triangle",
    "parallelogram",
    "trapezoid",
    "hexagon",
    "octagon",
    "plus",
    "pentagonArrow",
    "can",
    "donut",
    "rightArrow",
    "leftArrow",
    "upArrow",
    "downArrow",
    "leftRightArrow",
    "quadArrow",
    "wedgeRoundRectCallout",
    "wedgeEllipseCallout",
    "cloudCallout",
    "mathPlus",
    "mathMinus",
    "mathMultiply",
    "mathEqual",
    "mathDivide",
    "mathNotEqual",
  ];

  function fillFor(kind: ShapeKind) {
    if (CALLOUT_KINDS.has(kind)) {
      return { fill: BG_ROLE, stroke: { color: TEXT_ROLE, width: 2 } };
    }
    return { fill: ACCENT1 };
  }

  const elements: Element[] = SWEEP_KINDS.map((kind, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 30 + col * (cellW + gap);
    const y = 80 + row * (cellH + gap);
    return {
      id: `sweep-${kind}`,
      type: "shape",
      frame: { x, y, w: cellW, h: cellH, rotation: 0 },
      data: {
        kind,
        adjustments: undefined, // OOXML default
        ...fillFor(kind),
      },
    } as Element;
  });

  return {
    meta: {
      title: "Adjustments sweep",
      themeId: "default-light",
      masterId: "default",
    },
    themes: BUILT_IN_THEMES,
    masters: [DEFAULT_MASTER],
    layouts: BUILT_IN_LAYOUTS,
    slides: [
      {
        id: "s1",
        layoutId: "blank",
        background: { fill: BG_ROLE },
        elements,
        notes: [],
      },
    ],
  };
}

/**
 * Two-row authored-adjustment doc factory shared between the P3-B
 * basics and arrows/banners scenarios. Row 1 is each shape at the
 * picker's default adjustments; row 2 is the same shape at a
 * deliberately different value so the drag-handle math has visible
 * regression coverage (mirrors the P3-A.1 pilot doc pattern).
 */
function makeP3bAdjustmentsDoc(
  title: string,
  rows: ReadonlyArray<{
    kind: ShapeKind;
    defaultAdj: number[] | undefined;
    authoredAdj: number[];
    style?: 'filled' | 'outlined' | 'stroke';
  }>,
): SlidesDocument {
  // Compute `cellW` from the available slide width so the last
  // column never clips off-screen. 12 cells × 150 px + 11 × 24 px gap
  // + 30 px left margin = 2094 px, well past the 1920 px logical
  // slide. The earlier hard-coded constants dropped coverage for the
  // 12th kind in each scenario.
  const canvasW = 1920;
  const leftPad = 30;
  const rightPad = 30;
  const gap = 16;
  const cellW = Math.floor(
    (canvasW - leftPad - rightPad - gap * (rows.length - 1)) / rows.length,
  );
  const cellH = 110;
  const yRow1 = 80;
  const yRow2 = 80 + cellH + 60;
  function styleFor(style: 'filled' | 'outlined' | 'stroke' | undefined) {
    if (style === 'stroke') return { stroke: { color: TEXT_ROLE, width: 2 } };
    if (style === 'outlined')
      return { fill: BG_ROLE, stroke: { color: TEXT_ROLE, width: 2 } };
    return { fill: ACCENT1 };
  }
  const elements: Element[] = [];
  rows.forEach((row, i) => {
    const x = leftPad + i * (cellW + gap);
    const fillStroke = styleFor(row.style);
    elements.push({
      id: `${row.kind}-default`,
      type: "shape",
      frame: { x, y: yRow1, w: cellW, h: cellH, rotation: 0 },
      data: { kind: row.kind, adjustments: row.defaultAdj, ...fillStroke },
    } as Element);
    elements.push({
      id: `${row.kind}-authored`,
      type: "shape",
      frame: { x, y: yRow2, w: cellW, h: cellH, rotation: 0 },
      data: { kind: row.kind, adjustments: row.authoredAdj, ...fillStroke },
    } as Element);
  });
  return {
    meta: { title, themeId: "default-light", masterId: "default" },
    themes: BUILT_IN_THEMES,
    masters: [DEFAULT_MASTER],
    layouts: BUILT_IN_LAYOUTS,
    slides: [
      {
        id: "s1",
        layoutId: "blank",
        background: { fill: BG_ROLE },
        elements,
        notes: [],
      },
    ],
  };
}

function makeAdjustmentsP3bBasicsDoc(): SlidesDocument {
  return makeP3bAdjustmentsDoc("Adjustments P3-B basics", [
    // sector / arc — angular handles
    { kind: "pie", defaultAdj: undefined, authoredAdj: [0, 10800000] }, // 0°→180° bottom semi-circle
    { kind: "chord", defaultAdj: undefined, authoredAdj: [5400000, 16200000] }, // 90°→270°
    { kind: "arc", defaultAdj: undefined, authoredAdj: [10800000, 21600000], style: 'stroke' }, // 180°→360° top half
    { kind: "blockArc", defaultAdj: undefined, authoredAdj: [16200000, 10800000, 40000] }, // 270°→180° thick
    // linear-corner family
    { kind: "frame", defaultAdj: undefined, authoredAdj: [30000] },
    { kind: "halfFrame", defaultAdj: undefined, authoredAdj: [55000, 25000] },
    { kind: "plaque", defaultAdj: undefined, authoredAdj: [35000] },
    { kind: "bevel", defaultAdj: undefined, authoredAdj: [35000] },
    { kind: "foldedCorner", defaultAdj: undefined, authoredAdj: [42000] },
    { kind: "cube", defaultAdj: undefined, authoredAdj: [42000] },
    // character — radial / linear
    { kind: "sun", defaultAdj: undefined, authoredAdj: [45000] },
    { kind: "moon", defaultAdj: undefined, authoredAdj: [20000] },
  ]);
}

function makeAdjustmentsP3bArrowsDoc(): SlidesDocument {
  return makeP3bAdjustmentsDoc("Adjustments P3-B arrows + banners", [
    { kind: "upDownArrow", defaultAdj: undefined, authoredAdj: [40000, 80000] },
    { kind: "leftRightUpArrow", defaultAdj: undefined, authoredAdj: [45000, 80000, 50000] },
    { kind: "bentArrow", defaultAdj: undefined, authoredAdj: [40000, 40000] },
    { kind: "bentUpArrow", defaultAdj: undefined, authoredAdj: [40000, 40000] },
    { kind: "uturnArrow", defaultAdj: undefined, authoredAdj: [35000, 35000] },
    { kind: "swooshArrow", defaultAdj: undefined, authoredAdj: [22000, 40000] },
    { kind: "circularArrow", defaultAdj: undefined, authoredAdj: [22000, 22000, -10800000] },
    { kind: "curvedRightArrow", defaultAdj: undefined, authoredAdj: [35000, 40000] },
    { kind: "curvedDownArrow", defaultAdj: undefined, authoredAdj: [35000, 40000] },
    { kind: "ribbon", defaultAdj: undefined, authoredAdj: [85000, 30000] },
    { kind: "ribbon2", defaultAdj: undefined, authoredAdj: [85000, 30000] },
    { kind: "horizontalScroll", defaultAdj: undefined, authoredAdj: [25000] },
  ]);
}

function makeActionButtonsDoc(): SlidesDocument {
  const cellW = 140;
  const cellH = 100;
  const gap = 30;
  const cols = 4;
  const KINDS: ShapeKind[] = [
    "actionButtonBlank", "actionButtonBackPrevious", "actionButtonForwardNext", "actionButtonBeginning",
    "actionButtonEnd", "actionButtonHome", "actionButtonInformation", "actionButtonReturn",
    "actionButtonMovie", "actionButtonSound", "actionButtonDocument", "actionButtonHelp",
  ];
  const elements: Element[] = KINDS.map((kind, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      id: `action-${kind}`,
      type: "shape",
      frame: {
        x: 60 + col * (cellW + gap),
        y: 100 + row * (cellH + gap),
        w: cellW,
        h: cellH,
        rotation: 0,
      },
      data: {
        kind,
        adjustments: undefined,
        fill: BG_ROLE,
        stroke: { color: TEXT_ROLE, width: 2 },
      },
    } as Element;
  });
  return {
    meta: { title: "Action buttons", themeId: "default-light", masterId: "default" },
    themes: BUILT_IN_THEMES,
    masters: [DEFAULT_MASTER],
    layouts: BUILT_IN_LAYOUTS,
    slides: [
      {
        id: "s1",
        layoutId: "blank",
        background: { fill: BG_ROLE },
        elements,
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

// ---- Toolbar mock editor ----

/**
 * Minimal SlidesEditor stub for toolbar harness scenarios.
 *
 * The toolbar only uses:
 *   - onSelectionChange / onCurrentSlideChange / onTextEditingChange
 *   - getSelection() / getCurrentSlideId() / isTextEditing()
 *   - getEditingElementId() / getActiveTextEditor()
 *
 * Every other method is a no-op so the toolbar renders in the desired
 * state without needing a real canvas + DOM overlay + mounted editor.
 */
function makeStubEditor(opts: {
  selection?: readonly string[];
  slideId?: string;
  textEditing?: boolean;
  editingElementId?: string | null;
  textEditor?: SlidesTextBoxEditor | null;
}): SlidesEditor {
  const {
    selection = [],
    slideId = "slide-1",
    textEditing = false,
    editingElementId = null,
    textEditor = null,
  } = opts;

  const noop = () => () => {};
  const stub: SlidesEditor = {
    render: () => {},
    markDirty: () => {},
    getSelection: () => selection,
    setSelection: () => {},
    onSelectionChange: noop,
    getCellSelection: () => null,
    onCellSelectionChange: noop,
    onCurrentSlideChange: noop,
    onTextEditingChange: noop,
    onInsertModeChange: noop,
    setInsertMode: () => {},
    getInsertMode: () => null,
    isConnectorMode: () => false,
    getCurrentSlideId: () => slideId,
    setCurrentSlide: () => {},
    isTextEditing: () => textEditing,
    getEditingElementId: () => editingElementId,
    getActiveTextEditor: () => textEditor,
    enterTextEditing: () => {},
    exitTextEditing: () => {},
    setHostSize: () => {},
    setRulerScroll: () => {},
    align: () => {},
    distribute: () => {},
    bringForward: () => {},
    sendBackward: () => {},
    bringToFront: () => {},
    sendToBack: () => {},
    rotateBy: () => {},
    group: () => {},
    ungroup: () => {},
    deleteSelected: () => {},
    beginFormatPaint: () => {},
    cancelFormatPaint: () => {},
    isPaintingFormat: () => false,
    onPaintFormatChange: noop,
    detach: () => {},
  };
  return stub;
}

/**
 * Build a MemSlidesStore prepopulated with a single slide that contains
 * the given elements. The slide id is always "slide-1" for stub-editor
 * compatibility.
 */
function makeToolbarStore(elements: Element[]): MemSlidesStore {
  const store = new MemSlidesStore();
  store.batch(() => {
    const slideId = store.addSlide("blank");
    // We need slide-1 as the id for the stub editor. Easiest approach:
    // read the generated id and work with it — the stub editor returns
    // slideId dynamically, so we capture what addSlide gave us.
    // Actually, MemSlidesStore generates a random UUID; the stub editor
    // returns "slide-1". To keep them in sync we rebuild the store with
    // a known-id document instead.
    void slideId;
  });
  // Rebuild with a fixed slide id so stub editor's "slide-1" matches.
  const doc = store.read();
  doc.slides[0].id = "slide-1";
  doc.slides[0].elements = elements;
  return new MemSlidesStore(doc);
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
    id: "slides-canvas-focus",
    title: "Theme — Focus",
    description: "Same slide under the focus theme (cream + warm accents).",
    render: () => <SlideCanvas doc={makeThemedDoc("focus")} />,
  },
  {
    id: "slides-canvas-pop",
    title: "Theme — Pop",
    description: "Same slide under the vibrant pop theme.",
    render: () => <SlideCanvas doc={makeThemedDoc("pop")} />,
  },
  {
    id: "slides-canvas-slate",
    title: "Theme — Slate",
    description: "Same slide under the dark slate theme — light text on a dark background.",
    render: () => <SlideCanvas doc={makeThemedDoc("slate")} />,
  },
  {
    id: "slides-canvas-wafflebase",
    title: "Theme — Wafflebase",
    description: "Same slide under the Wafflebase brand theme (syrup/butter/berry palette).",
    render: () => <SlideCanvas doc={makeThemedDoc("wafflebase")} />,
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
  // The original idle scenario (slides-toolbar) exercises the no-selection
  // state; the six new scenarios below exercise each toolbar mode.
  {
    id: "slides-toolbar",
    title: "Formatting toolbar",
    description:
      "Slides toolbar with insert buttons, contextual Fill / Font triggers, and theme toggle. Mounted with a memory store and the default-light theme.",
    render: () => <SlidesToolbarScenario />,
  },
  {
    id: "slides-toolbar-idle",
    title: "Toolbar — idle (no selection)",
    description:
      "Toolbar with a stub editor that returns an empty selection. Shows the idle section: Insert group, slide-background color button, plus global undo/redo/slide/theme/present controls.",
    render: () => <SlidesToolbarIdleScenario />,
  },
  {
    id: "slides-toolbar-shape-selected",
    title: "Toolbar — shape selected",
    description:
      "Toolbar with a single shape selected. Contextual middle shows the Insert group + Fill color + Border picker + Arrange menu.",
    render: () => <SlidesToolbarShapeScenario />,
  },
  {
    id: "slides-toolbar-image-selected",
    title: "Toolbar — image selected",
    description:
      "Toolbar with a single image element selected. Contextual middle shows Replace / Crop (disabled placeholder) / Reset / Alt + Arrange.",
    render: () => <SlidesToolbarImageScenario />,
  },
  {
    id: "slides-toolbar-text-element-selected",
    title: "Toolbar — text element selected",
    description:
      "Toolbar with a single text element selected (not yet in text-edit mode). Contextual middle shows Background fill + Border + Font family + Font size + Arrange.",
    render: () => <SlidesToolbarTextElementScenario />,
  },
  {
    id: "slides-toolbar-text-editing",
    title: "Toolbar — text editing active",
    description:
      "Toolbar while a text-box editor is active (text-edit mode). Shows FontSizePicker + TextFormatGroup (no strikethrough, no highlight) + TextParagraphGroup with a stub SlidesTextBoxEditor. Done button appears in RightGlobals.",
    render: () => <SlidesToolbarTextEditingScenario />,
  },
  {
    id: "slides-toolbar-multi-select",
    title: "Toolbar — multi-select (mixed types)",
    description:
      "Toolbar with two elements of different types selected (shape + image = mixed). Contextual format zone is empty; only the Insert group + Arrange menu appear.",
    render: () => <SlidesToolbarMultiSelectScenario />,
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
  // Shape library — geometry baselines for all shape builders (P1 + P2 + P3-B).
  // The catalog scenario covers every kind in one go on a 10×12 grid;
  // donut and callout pin a couple of higher-risk geometries
  // (evenodd fill, tail attachment) at larger sizes for clarity.
  // Connector-rendering visual coverage (line, arrow) is deferred to a
  // follow-up PR once connectors land in the registry.
  {
    id: "slides-canvas-shapes-catalog-light",
    title: "Shapes — full 115 catalog (light)",
    description:
      "Every ShapeKind (P1 + P2 + P3-B, 115 total) on a single slide, 10×12 grid. Default fills/strokes from the picker (accent1 fill for basic / arrows / banners / equation / flowchart / stars; outlined for callouts and action buttons; stroke-only for arc). Default-light theme.",
    render: () => <SlideCanvas doc={makeCatalogDoc("default-light")} />,
  },
  {
    id: "slides-canvas-shapes-catalog-dark",
    title: "Shapes — full 115 catalog (dark)",
    description:
      "Same 115-shape catalog under default-dark theme — verifies role-bound fills/strokes flip correctly for all builders, including the P3-B drawActionButton dispatcher branch.",
    render: () => <SlideCanvas doc={makeCatalogDoc("default-dark")} />,
  },
  {
    id: "slides-canvas-shapes-catalog-material",
    title: "Shapes — full 115 catalog (material)",
    description:
      "115-shape catalog under the material theme — non-trivial accent1 colour to confirm theme resolution paths for all builders.",
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
  // P3-A.1 — Adjustment geometry baseline for the 9 pilot shapes.
  // Two rows + one rotated star verify that authored values produce
  // visibly different geometry from OOXML defaults. Handles (yellow
  // diamonds) live in the DOM overlay layer which this canvas-only
  // renderer does not include; per-shape unit tests cover the math.
  {
    id: "shapes-adjustments-pilot",
    title: "Shape adjustments — pilot 9 (P3-A.1)",
    description:
      "Two-row grid of the 9 pilot shapes. Top row: OOXML default adjustments. Bottom row: authored values that visibly differ (rounder corners, shallower chevron, callout tail position, chunkier/slimmer stars). Right: star5 rotated 30° at default adjustments. Catches regressions in apply/clamp/path math across all 4 axis types.",
    render: () => <SlideCanvas doc={makeAdjustmentsPilotDoc()} />,
  },
  // P3-A.2 — Path-builder regression baseline for the 24 sweep shapes.
  // Only default adjustments are rendered; per-shape unit tests cover
  // authored values + clamping.
  {
    id: "shapes-adjustments-sweep",
    title: "Shape adjustments — sweep 24 (P3-A.2)",
    description:
      "6×4 grid of the 24 P3-A.2 sweep shapes (triangle, parallelogram, trapezoid, hexagon, octagon, plus, pentagonArrow, can, donut, 5 directional arrows, quadArrow, 3 wedge/cloud callouts, 6 math equation shapes) at OOXML defaults. Catches path-builder regressions; the pilot 9 keep their own scenario above.",
    render: () => <SlideCanvas doc={makeAdjustmentsSweepDoc()} />,
  },
  // P3-B — Google Slides parity sweep. Four scenarios cover the 62
  // new shapes' interesting behaviours (default values already
  // covered by the full catalog above):
  //   shapes-adjustments-p3b-basics — 12 parametric basics with
  //     two rows showing default vs authored adjustments.
  //   shapes-adjustments-p3b-arrows — 12 parametric arrows / banners
  //     with default vs authored rows.
  //   shapes-action-buttons         — 12 action buttons at picker
  //     scale × 1.5 so the body + glyph two-pass dispatcher
  //     branch is verifiable in isolation.
  {
    id: "shapes-adjustments-p3b-basics",
    title: "Shape adjustments — P3-B basics (12 × 2)",
    description:
      "Two-row grid of 12 parametric P3-B basic shapes. Top row: picker defaults. Bottom row: deliberately different authored adjustments (pie sweep 0°→180°, blockArc thicker, frame border doubled, sun longer rays, moon thinner crescent, etc.). Mirrors the P3-A.1 pilot pattern — catches regressions in the angular handle + linear-corner / linear-edge inverses.",
    render: () => <SlideCanvas doc={makeAdjustmentsP3bBasicsDoc()} />,
  },
  {
    id: "shapes-adjustments-p3b-arrows",
    title: "Shape adjustments — P3-B arrows + banners (12 × 2)",
    description:
      "Two-row grid of 12 parametric P3-B arrows / banners. Top row: picker defaults. Bottom row: authored adjustments emphasising each shape's distinct parameters (bigger arrow heads, longer up arms, narrower curve sweeps, rotated `circularArrow` gap, ribbon body height changes). Exercises `polylineArc` + the directional `curved.ts` factory + `angularHandle` together.",
    render: () => <SlideCanvas doc={makeAdjustmentsP3bArrowsDoc()} />,
  },
  {
    id: "shapes-action-buttons",
    title: "Shape — P3-B action buttons (12)",
    description:
      "4×3 grid of the 12 action buttons rendered via `drawActionButton` (special-cased dispatcher branch). Body = background fill + bevel outline; glyph = text-coloured inner icon. Includes `actionButtonBlank` to verify the no-glyph path.",
    render: () => <SlideCanvas doc={makeActionButtonsDoc()} />,
  },
  // Multi-resize visual baselines — post-commit states and mid-drag ghost
  // previews for the proportional-bbox resize path (Task 5 of the
  // multi-select resize branch). Four scenarios:
  //   slides-multi-resize-basic            — 2 rects at their post-SE-drag frames.
  //   slides-multi-resize-with-rotated-child — 2 rects (one rotated 30°) post-drag.
  //   slides-resize-ghost-mid-drag         — single shape, original + GHOST_ALPHA
  //                                          ghost at a larger frame (mid-drag).
  //   slides-multi-resize-ghost-mid-drag   — 2 shapes, original + ghosts (mid-drag).
  {
    id: "slides-multi-resize-basic",
    title: "Multi-resize — basic post-commit",
    description:
      "Two axis-aligned rects after an SE-handle drag on their combined bounding box. Both grew in proportion to the original bbox (sx≈1.44, sy≈1.67). Verifies that proportional scaling keeps elements correctly positioned relative to the combined origin.",
    render: () => <SlideCanvasMultiResizeBasic />,
  },
  {
    id: "slides-multi-resize-with-rotated-child",
    title: "Multi-resize — with rotated child post-commit",
    description:
      "Two rects (one unrotated, one rotated 30°) after an SE-handle drag. The rotated child's frame grows proportionally while its rotation is preserved. Verifies that resizeMultiFrames keeps per-element rotation untouched.",
    render: () => <SlideCanvasMultiResizeRotated />,
  },
  {
    id: "slides-resize-ghost-mid-drag",
    title: "Resize ghost — single shape mid-drag",
    description:
      "Single rect at its original frame (full opacity) overlaid with a ghost copy at the post-SE-drag size rendered at GHOST_ALPHA (0.4). Captures the ghost-on-top preview channel that ships in the single-resize path.",
    render: () => <SlideCanvasResizeGhost />,
  },
  {
    id: "slides-multi-resize-ghost-mid-drag",
    title: "Resize ghost — multi-shape mid-drag",
    description:
      "Two rects at their original frames (full opacity) with ghost copies at the proportionally-scaled SE-drag positions rendered at GHOST_ALPHA (0.4). Captures the ghost-on-top preview channel for the multi-resize path.",
    render: () => <SlideCanvasMultiResizeGhost />,
  },
];

// ---- Scenario components ----

// ---------------------------------------------------------------------------
// Multi-resize and ghost scenarios (Task 7)
//
// These four scenarios use SlideRenderer.forceRender() to paint the slide
// with an optional array of ghost elements overlaid at GHOST_ALPHA (0.4).
// They do NOT drive pointer events — all frames are computed from the same
// proportional-bbox math that resizeMultiFrames uses, but written as
// constants so the visual baselines are stable across pointer-event timing
// changes.
//
// Coordinate arithmetic (SE-handle drag by +200 logical px on each axis):
//   startBbox = { x: minX, y: minY, w: bboxW, h: bboxH }
//   newBbox   = { x: minX, y: minY, w: bboxW+200, h: bboxH+200 }
//   sx = newBbox.w / startBbox.w
//   sy = newBbox.h / startBbox.h
//   newCenter = { x: newBbox.x + (cx - startBbox.x)*sx,
//                  y: newBbox.y + (cy - startBbox.y)*sy }
//   newFrame  = { x: newCenter.x - w*sx/2, y: newCenter.y - h*sy/2,
//                  w: w*sx, h: h*sy, rotation }
// ---------------------------------------------------------------------------

/**
 * Canvas component that calls SlideRenderer.forceRender so we can supply
 * an optional ghosts array on top of the committed slide elements.
 *
 * `ghostElements` — if provided, these elements are painted at GHOST_ALPHA
 * on top of the slide's committed elements, mirroring the mid-drag paint
 * path used by the editor's resize interaction.
 */
function SlideCanvasWithGhost({
  doc,
  ghostElements,
  width = 480,
  height = 270,
}: {
  doc: SlidesDocument;
  ghostElements?: readonly Element[];
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
    if (ghostElements && ghostElements.length > 0) {
      // forceRender paints the slide first, then overlays ghosts at
      // GHOST_ALPHA — mirrors the editor's live resize preview path.
      renderer.forceRender(doc.slides[0], doc, ghostElements);
    } else {
      renderer.forceRender(doc.slides[0], doc);
    }
  }, [doc, ghostElements, width, height]);

  return (
    <canvas
      ref={ref}
      className="rounded-md border bg-background"
      style={{ width, height }}
    />
  );
}

// ---------------------------------------------------------------------------
// Scenario 1: slides-multi-resize-basic
//
// Two axis-aligned rects. Original bbox: x=200, y=200, w=450, h=300.
// SE drag: dx=+200, dy=+200. newBbox: w=650, h=500.
// sx = 650/450 ≈ 1.444, sy = 500/300 ≈ 1.667.
//
// Rect A (200,200,200,150):
//   cx=300, cy=275
//   newCx = 200 + (300-200)*1.444 = 200+144.4 = 344.4
//   newCy = 200 + (275-200)*1.667 = 200+125.0 = 325.0
//   w2=288.9, h2=250.0 → frame: (200, 200, 288.9, 250.0)
//
// Rect B (500,300,150,200):
//   cx=575, cy=400
//   newCx = 200 + (575-200)*1.444 = 200+541.7 = 741.7
//   newCy = 200 + (400-200)*1.667 = 200+333.3 = 533.3
//   w2=216.7, h2=333.3 → frame: (633.3, 366.7, 216.7, 333.3)
// ---------------------------------------------------------------------------
function SlideCanvasMultiResizeBasic() {
  const doc = useMemo<SlidesDocument>(() => ({
    meta: { title: "Multi-resize basic", themeId: "default-light", masterId: "default" },
    themes: BUILT_IN_THEMES,
    masters: [DEFAULT_MASTER],
    layouts: BUILT_IN_LAYOUTS,
    slides: [{
      id: "s1",
      layoutId: "blank",
      background: { fill: BG_ROLE },
      elements: [
        {
          id: "rect-a",
          type: "shape",
          // Post-resize frame (rounded to 1 dp)
          frame: { x: 200, y: 200, w: 288.9, h: 250.0, rotation: 0 },
          data: { kind: "rect" as ShapeKind, fill: ACCENT1 },
        } as Element,
        {
          id: "rect-b",
          type: "shape",
          // Post-resize frame (rounded to 1 dp)
          frame: { x: 633.3, y: 366.7, w: 216.7, h: 333.3, rotation: 0 },
          data: {
            kind: "rect" as ShapeKind,
            fill: { kind: "role" as const, role: "accent2" } as ThemeColor,
          },
        } as Element,
      ],
      notes: [],
    }],
  }), []);
  return <SlideCanvas doc={doc} />;
}

// ---------------------------------------------------------------------------
// Scenario 2: slides-multi-resize-with-rotated-child
//
// Rect A (unrotated): (200,200,200,150).
// Rect B (rotated 30°): world tight frame ≈ (490, 270, 178, 178); but
// resizeMultiFrames uses worldFrame (the axis-aligned bbox of the rotated
// element) for its proportional math. For a 160×160 rect rotated 30°,
// worldFrame ≈ (490, 260, 178, 178).
//
// For simplicity in this harness we set Rect B's logical frame directly at
// (500, 260, 160, 160, rotation=π/6) which matches the PPTX/store frame.
// The bboxes used for proportional scaling come from worldTightFrame
// (≈ axis-aligned envelope), but for the visual baseline we only need
// a realistic-looking result, not exact pixel-perfect reproduction.
//
// Post-SE-drag (dx=+200, dy=+200) using same arithmetic as Scenario 1.
// ---------------------------------------------------------------------------
function SlideCanvasMultiResizeRotated() {
  const doc = useMemo<SlidesDocument>(() => ({
    meta: { title: "Multi-resize rotated", themeId: "default-light", masterId: "default" },
    themes: BUILT_IN_THEMES,
    masters: [DEFAULT_MASTER],
    layouts: BUILT_IN_LAYOUTS,
    slides: [{
      id: "s1",
      layoutId: "blank",
      background: { fill: BG_ROLE },
      elements: [
        {
          id: "rect-unrot",
          type: "shape",
          // Post-resize (same as Scenario 1 Rect A)
          frame: { x: 200, y: 200, w: 288.9, h: 250.0, rotation: 0 },
          data: { kind: "rect" as ShapeKind, fill: ACCENT1 },
        } as Element,
        {
          id: "rect-rotated",
          type: "shape",
          // Post-resize of a 160×160 rect rotated 30°: scale sx≈1.444, sy≈1.667
          // Original: (500, 260, 160, 160). newW≈231, newH≈267; rotation preserved.
          frame: { x: 624.4, y: 350.0, w: 231.1, h: 266.7, rotation: Math.PI / 6 },
          data: {
            kind: "rect" as ShapeKind,
            fill: { kind: "role" as const, role: "accent2" } as ThemeColor,
          },
        } as Element,
      ],
      notes: [],
    }],
  }), []);
  return <SlideCanvas doc={doc} />;
}

// ---------------------------------------------------------------------------
// Scenario 3: slides-resize-ghost-mid-drag
//
// Single rect at its original frame (full opacity via normal render pass)
// plus a ghost copy at the post-SE-drag frame (GHOST_ALPHA via forceRender).
//
// Original: (300, 250, 300, 200). SE drag +200,+200.
// Ghost: (300, 250, 500, 400) — same top-left anchor for SE handle.
// ---------------------------------------------------------------------------
function SlideCanvasResizeGhost() {
  const originalFrame = useMemo(
    () => ({ x: 300, y: 250, w: 300, h: 200, rotation: 0 }),
    [],
  );
  const doc = useMemo<SlidesDocument>(
    () => ({
      meta: { title: "Resize ghost single", themeId: "default-light", masterId: "default" },
      themes: BUILT_IN_THEMES,
      masters: [DEFAULT_MASTER],
      layouts: BUILT_IN_LAYOUTS,
      slides: [{
        id: "s1",
        layoutId: "blank",
        background: { fill: BG_ROLE },
        elements: [{
          id: "shape-orig",
          type: "shape",
          frame: originalFrame,
          data: { kind: "rect" as ShapeKind, fill: ACCENT1 },
        } as Element],
        notes: [],
      }],
    }),
    [originalFrame],
  );
  // Ghost: SE-handle drag keeps NW anchor fixed → ghost grows SE.
  const ghostElements = useMemo<readonly Element[]>(
    () => [{
      id: "shape-orig",
      type: "shape",
      frame: {
        x: originalFrame.x,
        y: originalFrame.y,
        w: originalFrame.w + 200,
        h: originalFrame.h + 200,
        rotation: 0,
      },
      data: { kind: "rect" as ShapeKind, fill: ACCENT1 },
    } as Element],
    [originalFrame],
  );
  // Use a data-attribute to expose the ghost-alpha value for test readers.
  return (
    <div data-ghost-alpha={GHOST_ALPHA}>
      <SlideCanvasWithGhost doc={doc} ghostElements={ghostElements} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenario 4: slides-multi-resize-ghost-mid-drag
//
// Two rects at their original frames (full opacity via normal render pass)
// plus ghost copies at the proportionally-scaled SE-drag frames (GHOST_ALPHA).
//
// Original bbox: x=200, y=200, w=450, h=300. SE drag +200,+200.
// sx=650/450≈1.444, sy=500/300≈1.667.
// (Same arithmetic as Scenario 1 — the original frames are the "before" view
//  and the ghosts are the "during" preview.)
// ---------------------------------------------------------------------------
function SlideCanvasMultiResizeGhost() {
  const doc = useMemo<SlidesDocument>(() => ({
    meta: { title: "Multi-resize ghost", themeId: "default-light", masterId: "default" },
    themes: BUILT_IN_THEMES,
    masters: [DEFAULT_MASTER],
    layouts: BUILT_IN_LAYOUTS,
    slides: [{
      id: "s1",
      layoutId: "blank",
      background: { fill: BG_ROLE },
      elements: [
        {
          id: "rect-a",
          type: "shape",
          frame: { x: 200, y: 200, w: 200, h: 150, rotation: 0 },
          data: { kind: "rect" as ShapeKind, fill: ACCENT1 },
        } as Element,
        {
          id: "rect-b",
          type: "shape",
          frame: { x: 500, y: 300, w: 150, h: 200, rotation: 0 },
          data: {
            kind: "rect" as ShapeKind,
            fill: { kind: "role" as const, role: "accent2" } as ThemeColor,
          },
        } as Element,
      ],
      notes: [],
    }],
  }), []);
  // Ghost frames: proportionally scaled by the SE drag (same as post-commit
  // frames in Scenario 1). The originals above are shown at full opacity;
  // the ghosts preview the pending resize at GHOST_ALPHA.
  const ghostElements = useMemo<readonly Element[]>(
    () => [
      {
        id: "rect-a",
        type: "shape",
        frame: { x: 200, y: 200, w: 288.9, h: 250.0, rotation: 0 },
        data: { kind: "rect" as ShapeKind, fill: ACCENT1 },
      } as Element,
      {
        id: "rect-b",
        type: "shape",
        frame: { x: 633.3, y: 366.7, w: 216.7, h: 333.3, rotation: 0 },
        data: {
          kind: "rect" as ShapeKind,
          fill: { kind: "role" as const, role: "accent2" } as ThemeColor,
        },
      } as Element,
    ],
    [],
  );
  return (
    <div data-ghost-alpha={GHOST_ALPHA}>
      <SlideCanvasWithGhost doc={doc} ghostElements={ghostElements} />
    </div>
  );
}

function SlidesToolbarScenario() {
  const store = useMemo(() => new MemSlidesStore(), []);
  return (
    <div className="rounded-md border bg-background">
      <SlidesToolbar
        editor={null}
        store={store}
        theme={defaultLight}
        onImagePick={() => undefined}
        onToggleThemePanel={() => undefined}
        themePanelOpen={false}
      />
    </div>
  );
}

/**
 * Scenario: toolbar idle state with a real stub editor (no selection).
 * Exercises the IdleSection path: Insert group + slide-background button.
 */
function SlidesToolbarIdleScenario() {
  const store = useMemo(() => makeToolbarStore([]), []);
  const editor = useMemo(() => makeStubEditor({ slideId: "slide-1" }), []);
  return (
    <div className="rounded-md border bg-background">
      <SlidesToolbar
        editor={editor}
        store={store}
        theme={defaultLight}
        onImagePick={() => undefined}
        onToggleThemePanel={() => undefined}
        themePanelOpen={false}
      />
    </div>
  );
}

/**
 * Scenario: toolbar with one shape selected.
 * Exercises the ObjectSection/ShapeControls path: Fill color + Border + Arrange.
 */
function SlidesToolbarShapeScenario() {
  const elements = useMemo<Element[]>(
    () => [
      {
        id: "shape-1",
        type: "shape",
        frame: { x: 400, y: 300, w: 300, h: 200, rotation: 0 },
        data: {
          kind: "rect" as ShapeKind,
          fill: { kind: "role", role: "accent1" },
        },
      } as Element,
    ],
    [],
  );
  const store = useMemo(() => makeToolbarStore(elements), [elements]);
  const editor = useMemo(
    () => makeStubEditor({ selection: ["shape-1"], slideId: "slide-1" }),
    [],
  );
  return (
    <div className="rounded-md border bg-background">
      <SlidesToolbar
        editor={editor}
        store={store}
        theme={defaultLight}
        onImagePick={() => undefined}
        onToggleThemePanel={() => undefined}
        themePanelOpen={false}
      />
    </div>
  );
}

/**
 * Scenario: toolbar with one image element selected.
 * Exercises the ObjectSection/ImageControls path: Replace + Crop (disabled) + Reset + Alt + Arrange.
 */
function SlidesToolbarImageScenario() {
  const elements = useMemo<Element[]>(
    () => [
      {
        id: "image-1",
        type: "image",
        frame: { x: 400, y: 200, w: 400, h: 300, rotation: 0 },
        data: {
          url: "https://placehold.co/400x300",
          naturalWidth: 400,
          naturalHeight: 300,
        },
      } as Element,
    ],
    [],
  );
  const store = useMemo(() => makeToolbarStore(elements), [elements]);
  const editor = useMemo(
    () => makeStubEditor({ selection: ["image-1"], slideId: "slide-1" }),
    [],
  );
  return (
    <div className="rounded-md border bg-background">
      <SlidesToolbar
        editor={editor}
        store={store}
        theme={defaultLight}
        onImagePick={() => undefined}
        onToggleThemePanel={() => undefined}
        themePanelOpen={false}
      />
    </div>
  );
}

/**
 * Scenario: toolbar with one text element selected (not in text-edit mode).
 * Exercises the ObjectSection/TextElementControls path:
 * Background fill + Border + Arrange.
 */
function SlidesToolbarTextElementScenario() {
  const elements = useMemo<Element[]>(
    () => [
      {
        id: "text-1",
        type: "text",
        frame: { x: 200, y: 200, w: 600, h: 200, rotation: 0 },
        data: {
          blocks: [
            {
              id: "b1",
              type: "paragraph",
              inlines: [{ text: "Hello slides" }],
              style: {
                alignment: "left",
                lineHeight: 1.2,
                marginTop: 0,
                marginBottom: 0,
                textIndent: 0,
                marginLeft: 0,
              },
            },
          ],
        },
      } as Element,
    ],
    [],
  );
  const store = useMemo(() => makeToolbarStore(elements), [elements]);
  const editor = useMemo(
    () => makeStubEditor({ selection: ["text-1"], slideId: "slide-1" }),
    [],
  );
  return (
    <div className="rounded-md border bg-background">
      <SlidesToolbar
        editor={editor}
        store={store}
        theme={defaultLight}
        onImagePick={() => undefined}
        onToggleThemePanel={() => undefined}
        themePanelOpen={false}
      />
    </div>
  );
}

/**
 * Minimal SlidesTextBoxEditor stub for the text-editing toolbar scenario.
 * Only the methods used by FontSizePicker / TextFormatGroup /
 * TextParagraphGroup need to return sensible values; everything else
 * is a no-op.
 */
function makeStubTextBoxEditor(): SlidesTextBoxEditor {
  const noop = () => {};
  return {
    isEditing: () => true,
    focus: noop,
    detach: noop,
    commit: noop,
    container: document.createElement("div"),
    getSelectionStyle: () => ({
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      fontSize: 18,
    }),
    getRangeStyleSummary: () => ({ fontSize: 18 }),
    applyStyle: noop,
    clearInlineFormatting: noop,
    getBlockStyle: () => ({}),
    applyBlockStyle: noop,
    getBlockType: () => ({ type: "paragraph" as const }),
    setBlockType: noop,
    toggleList: noop,
    indent: noop,
    outdent: noop,
    insertLink: noop,
    removeLink: noop,
    getLinkAtCursor: () => undefined,
    requestLink: noop,
    undo: noop,
    redo: noop,
    onCursorMove: () => noop,
  };
}

/**
 * Scenario: toolbar while a text-box editor is active.
 * Exercises the TextEditSection path:
 * FontSizePicker + TextFormatGroup + TextParagraphGroup + Done button.
 */
function SlidesToolbarTextEditingScenario() {
  const textEditor = useMemo(() => makeStubTextBoxEditor(), []);
  const elements = useMemo<Element[]>(
    () => [
      {
        id: "text-edit-1",
        type: "text",
        frame: { x: 200, y: 200, w: 600, h: 200, rotation: 0 },
        data: {
          blocks: [
            {
              id: "b1",
              type: "paragraph",
              inlines: [{ text: "Editing..." }],
              style: {
                alignment: "left",
                lineHeight: 1.2,
                marginTop: 0,
                marginBottom: 0,
                textIndent: 0,
                marginLeft: 0,
              },
            },
          ],
        },
      } as Element,
    ],
    [],
  );
  const store = useMemo(() => makeToolbarStore(elements), [elements]);
  const editor = useMemo(
    () =>
      makeStubEditor({
        selection: ["text-edit-1"],
        slideId: "slide-1",
        textEditing: true,
        editingElementId: "text-edit-1",
        textEditor,
      }),
    [textEditor],
  );
  return (
    <div className="rounded-md border bg-background">
      <SlidesToolbar
        editor={editor}
        store={store}
        theme={defaultLight}
        onImagePick={() => undefined}
        onToggleThemePanel={() => undefined}
        themePanelOpen={false}
      />
    </div>
  );
}

/**
 * Scenario: toolbar with two elements of different types selected (mixed).
 * Exercises the ObjectSection with selectionType = 'mixed':
 * contextual format zone is empty; only Insert group + Arrange appear.
 */
function SlidesToolbarMultiSelectScenario() {
  const elements = useMemo<Element[]>(
    () => [
      {
        id: "shape-ms",
        type: "shape",
        frame: { x: 200, y: 200, w: 300, h: 200, rotation: 0 },
        data: {
          kind: "ellipse" as ShapeKind,
          fill: { kind: "role", role: "accent1" },
        },
      } as Element,
      {
        id: "image-ms",
        type: "image",
        frame: { x: 600, y: 200, w: 300, h: 200, rotation: 0 },
        data: {
          url: "https://placehold.co/300x200",
          naturalWidth: 300,
          naturalHeight: 200,
        },
      } as Element,
    ],
    [],
  );
  const store = useMemo(() => makeToolbarStore(elements), [elements]);
  const editor = useMemo(
    () =>
      makeStubEditor({ selection: ["shape-ms", "image-ms"], slideId: "slide-1" }),
    [],
  );
  return (
    <div className="rounded-md border bg-background">
      <SlidesToolbar
        editor={editor}
        store={store}
        theme={defaultLight}
        onImagePick={() => undefined}
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
