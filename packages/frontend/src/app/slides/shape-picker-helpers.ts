import { type ShapeKind } from "@wafflebase/slides";

/**
 * One entry in a `Category.kinds` list — a single ShapeKind paired
 * with the user-facing label used as both the IconButton's tooltip
 * and `aria-label` for keyboard / screen-reader users.
 */
export type CategoryEntry = {
  kind: ShapeKind;
  label: string;
};

/**
 * One section in the `<ShapePicker />` popover. The picker renders
 * each category as a titled section containing a 6-column grid of
 * icon buttons (`CategoryEntry`).
 */
export type Category = {
  id: string;
  title: string;
  kinds: readonly CategoryEntry[];
};

/**
 * The 35-shape catalogue surfaced by the toolbar's `Shape ▾` picker.
 *
 * Categories mirror the OOXML / Google Slides shape menu groups —
 * Lines (2), Shapes (15), Block Arrows (8), Callouts (4), Equation
 * (6) — and the ordering inside each category matches Google Slides
 * so habits transfer. Each `kind` MUST be a ShapeKind that has a
 * registered PATH_BUILDER + a label > 0 chars; both invariants are
 * asserted in `shape-picker.test.ts`.
 *
 * Exported as a `readonly` `Category[]` so consumers don't mutate
 * the canonical list. The picker re-exports this through
 * `shape-picker.tsx`; the helpers module exists separately because
 * `tests/resolve-hooks.mjs` stubs `.tsx` modules at test load.
 */
export const SHAPE_PICKER_CATEGORIES: readonly Category[] = [
  {
    id: "lines",
    title: "Lines",
    kinds: [
      { kind: "line", label: "Line" },
      { kind: "arrow", label: "Arrow" },
    ],
  },
  {
    id: "shapes",
    title: "Shapes",
    kinds: [
      { kind: "rect", label: "Rectangle" },
      { kind: "roundRect", label: "Rounded rectangle" },
      { kind: "ellipse", label: "Ellipse" },
      { kind: "triangle", label: "Triangle" },
      { kind: "rtTriangle", label: "Right triangle" },
      { kind: "diamond", label: "Diamond" },
      { kind: "parallelogram", label: "Parallelogram" },
      { kind: "trapezoid", label: "Trapezoid" },
      { kind: "pentagon", label: "Pentagon" },
      { kind: "hexagon", label: "Hexagon" },
      { kind: "heptagon", label: "Heptagon" },
      { kind: "octagon", label: "Octagon" },
      { kind: "decagon", label: "Decagon" },
      { kind: "dodecagon", label: "Dodecagon" },
      { kind: "plus", label: "Plus" },
      { kind: "donut", label: "Donut" },
      { kind: "can", label: "Can" },
      { kind: "cloud", label: "Cloud" },
      { kind: "pie", label: "Pie" },
      { kind: "chord", label: "Chord" },
      { kind: "arc", label: "Arc" },
      { kind: "blockArc", label: "Block arc" },
      { kind: "frame", label: "Frame" },
      { kind: "halfFrame", label: "Half frame" },
      { kind: "corner", label: "Corner" },
      { kind: "diagStripe", label: "Diagonal stripe" },
      { kind: "plaque", label: "Plaque" },
      { kind: "bevel", label: "Bevel" },
      { kind: "foldedCorner", label: "Folded corner" },
      { kind: "cube", label: "Cube" },
      { kind: "teardrop", label: "Teardrop" },
      { kind: "smileyFace", label: "Smiley face" },
      { kind: "heart", label: "Heart" },
      { kind: "lightningBolt", label: "Lightning bolt" },
      { kind: "sun", label: "Sun" },
      { kind: "moon", label: "Moon" },
      { kind: "noSmoking", label: "No symbol" },
    ],
  },
  {
    id: "block-arrows",
    title: "Block Arrows",
    kinds: [
      { kind: "rightArrow", label: "Right arrow" },
      { kind: "leftArrow", label: "Left arrow" },
      { kind: "upArrow", label: "Up arrow" },
      { kind: "downArrow", label: "Down arrow" },
      { kind: "leftRightArrow", label: "Left-right arrow" },
      { kind: "quadArrow", label: "Quad arrow" },
      { kind: "chevron", label: "Chevron" },
      { kind: "pentagonArrow", label: "Pentagon arrow" },
    ],
  },
  {
    id: "flowchart",
    title: "Flowchart",
    kinds: [
      { kind: "flowChartTerminator", label: "Terminator" },
      { kind: "flowChartPredefinedProcess", label: "Predefined process" },
      { kind: "flowChartInternalStorage", label: "Internal storage" },
      { kind: "flowChartDocument", label: "Document" },
      { kind: "flowChartMultidocument", label: "Multi-document" },
      { kind: "flowChartManualInput", label: "Manual input" },
      { kind: "flowChartManualOperation", label: "Manual operation" },
      { kind: "flowChartOffpageConnector", label: "Off-page connector" },
      { kind: "flowChartPunchedCard", label: "Card" },
      { kind: "flowChartPunchedTape", label: "Punched tape" },
      { kind: "flowChartSummingJunction", label: "Summing junction" },
      { kind: "flowChartOr", label: "Or" },
      { kind: "flowChartDelay", label: "Delay" },
      { kind: "flowChartDisplay", label: "Display" },
    ],
  },
  {
    id: "callouts",
    title: "Callouts",
    kinds: [
      { kind: "wedgeRectCallout", label: "Rectangular callout" },
      { kind: "wedgeRoundRectCallout", label: "Rounded callout" },
      { kind: "wedgeEllipseCallout", label: "Oval callout" },
      { kind: "cloudCallout", label: "Cloud callout" },
    ],
  },
  {
    id: "equation",
    title: "Equation",
    kinds: [
      { kind: "mathPlus", label: "Plus" },
      { kind: "mathMinus", label: "Minus" },
      { kind: "mathMultiply", label: "Multiply" },
      { kind: "mathDivide", label: "Divide" },
      { kind: "mathEqual", label: "Equal" },
      { kind: "mathNotEqual", label: "Not equal" },
    ],
  },
  {
    id: "stars",
    title: "Stars",
    kinds: [
      { kind: "star4", label: "4-point star" },
      { kind: "star5", label: "5-point star" },
      { kind: "star6", label: "6-point star" },
      { kind: "star7", label: "7-point star" },
      { kind: "star8", label: "8-point star" },
      { kind: "star10", label: "10-point star" },
    ],
  },
];
