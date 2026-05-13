import { useEffect, useMemo, useRef, useState } from "react";
import {
  BUILT_IN_LAYOUTS,
  BUILT_IN_THEMES,
  DEFAULT_MASTER,
  MemSlidesStore,
  SlideRenderer,
  defaultLight,
  seedPlaceholderBlocks,
  type Element,
  type PlaceholderType,
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
 * outlined for callouts, stroked for line / arrow). Used as a single
 * baseline to catch geometry changes across the entire registry.
 *
 * Order is "old before new" so the regression diff focuses on new
 * shapes as categories grow: P1 (lines, basics, arrows, callouts,
 * equation) first, then P2 stars + flowchart, then P3-B additions
 * appended to each family (basics, snip/round rects, banners,
 * arrows, line callouts), with the 12 action buttons last (their
 * special-cased renderer makes them the natural tail of the
 * catalog).
 *
 * The picker itself uses spec order (Lines · Shapes · Block Arrows
 * · Banners · Flowchart · Callouts · Equation · Stars · Action
 * Buttons) — see `docs/tasks/active/20260509-slides-shapes-p2-lessons.md`
 * for the original "categories may diverge between catalog and
 * picker" trade-off rationale.
 */
const SHAPE_CATALOG: ShapeKind[] = [
  // Lines (2)
  "line", "arrow",
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
const LINE_KINDS = new Set<ShapeKind>(["line", "arrow"]);
const STROKE_ONLY_KINDS = new Set<ShapeKind>(["arc"]);

function isActionButtonKind(kind: ShapeKind): boolean {
  return kind.startsWith("actionButton");
}

function shapeElement(
  kind: ShapeKind,
  frame: { x: number; y: number; w: number; h: number },
): Element {
  const adjustments = undefined;
  const lineSpecial = LINE_KINDS.has(kind);
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
      ...(lineSpecial
        ? {
            stroke: { color: TEXT_ROLE, width: 2 },
            ...(kind === "arrow" ? { fill: TEXT_ROLE } : {}),
          }
        : strokeOnly
          ? { stroke: { color: TEXT_ROLE, width: 2 } }
          : callout || actionButton
            ? { fill: BG_ROLE, stroke: { color: TEXT_ROLE, width: 2 } }
            : { fill: ACCENT1 }),
    },
  } as Element;
}

function makeCatalogDoc(themeId: string = "default-light"): SlidesDocument {
  // 10 columns × 12 rows = 120 cells, 117 used (3 trailing empty) —
  // grew from the P1+P2 5×11=55 layout to fit the P3-B catalog. Cells
  // are roughly square so character / arrow shapes don't get squashed
  // along the longer axis.
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
    title: "Shapes — full 117 catalog (light)",
    description:
      "Every ShapeKind (P1 + P2 + P3-B, 117 total) on a single slide, 10×12 grid. Default fills/strokes from the picker (accent1 fill for basic / arrows / banners / equation / flowchart / stars; outlined for callouts and action buttons; stroke-only for arc). Default-light theme.",
    render: () => <SlideCanvas doc={makeCatalogDoc("default-light")} />,
  },
  {
    id: "slides-canvas-shapes-catalog-dark",
    title: "Shapes — full 117 catalog (dark)",
    description:
      "Same 117-shape catalog under default-dark theme — verifies role-bound fills/strokes flip correctly for all builders, including the P3-B drawActionButton dispatcher branch.",
    render: () => <SlideCanvas doc={makeCatalogDoc("default-dark")} />,
  },
  {
    id: "slides-canvas-shapes-catalog-material",
    title: "Shapes — full 117 catalog (material)",
    description:
      "117-shape catalog under the material theme — non-trivial accent1 colour to confirm theme resolution paths for all builders.",
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
