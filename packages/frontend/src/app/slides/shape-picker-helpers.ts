import { type ConnectorInsertKind, type ShapeKind } from "@wafflebase/slides";

/**
 * Insert-mode keys surfaced by the shape picker. Combines the static
 * `ShapeKind` registry (rect, ellipse, …) with the connector
 * insert-mode keys (`'connector:line'`, `'connector:arrow'`) — both
 * are accepted by `editor.setInsertMode`. Connectors are NOT shape
 * registry entries (they live outside `PATH_BUILDERS`), so the
 * picker's icon renderer special-cases them.
 */
export type PickerInsertKind = ShapeKind | ConnectorInsertKind;

/**
 * One entry in a `Category.kinds` list — a single insert-mode key
 * paired with the user-facing label used as both the IconButton's
 * tooltip and `aria-label` for keyboard / screen-reader users.
 */
export type CategoryEntry = {
  kind: PickerInsertKind;
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
 * Shape catalogue surfaced by the toolbar's `Shape ▾` picker. Grows
 * with each shape-library phase; entry count + section order are
 * pinned via `shape-picker.test.ts` invariants.
 *
 * Categories mirror the OOXML / Google Slides shape menu groups —
 * Lines, Shapes, Block Arrows, Banners, Flowchart, Callouts,
 * Equation, Stars, Action Buttons — and the ordering inside each
 * category matches Google Slides so habits transfer. Each `kind`
 * MUST be either a ShapeKind that has a registered `PATH_BUILDERS`
 * builder (or, for action buttons, an `ACTION_BUTTON_GLYPHS` entry),
 * or one of the `ConnectorInsertKind` values (`'connector:line'`,
 * `'connector:arrow'`) for the Lines category. Every entry needs a
 * label > 0 chars.
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
      { kind: "connector:line", label: "Line" },
      { kind: "connector:arrow", label: "Arrow" },
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
      { kind: "snip1Rect", label: "Snip single corner" },
      { kind: "snip2SameRect", label: "Snip same side corners" },
      { kind: "snip2DiagRect", label: "Snip diagonal corners" },
      { kind: "snipRoundRect", label: "Snip + round corner" },
      { kind: "round1Rect", label: "Round single corner" },
      { kind: "round2SameRect", label: "Round same side corners" },
      { kind: "round2DiagRect", label: "Round diagonal corners" },
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
      { kind: "upDownArrow", label: "Up-down arrow" },
      { kind: "leftRightUpArrow", label: "Left-right-up arrow" },
      { kind: "notchedRightArrow", label: "Notched right arrow" },
      { kind: "stripedRightArrow", label: "Striped right arrow" },
      { kind: "bentArrow", label: "Bent arrow" },
      { kind: "bentUpArrow", label: "Bent-up arrow" },
      { kind: "uturnArrow", label: "U-turn arrow" },
      { kind: "swooshArrow", label: "Swoosh arrow" },
      { kind: "circularArrow", label: "Circular arrow" },
      { kind: "curvedRightArrow", label: "Curved right arrow" },
      { kind: "curvedLeftArrow", label: "Curved left arrow" },
      { kind: "curvedUpArrow", label: "Curved up arrow" },
      { kind: "curvedDownArrow", label: "Curved down arrow" },
    ],
  },
  {
    id: "banners",
    title: "Banners",
    kinds: [
      { kind: "ribbon", label: "Ribbon" },
      { kind: "ribbon2", label: "Ribbon (notched)" },
      { kind: "horizontalScroll", label: "Horizontal scroll" },
      { kind: "verticalScroll", label: "Vertical scroll" },
      { kind: "leftRightRibbon", label: "Left-right ribbon" },
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
      { kind: "borderCallout1", label: "Line callout 1" },
      { kind: "borderCallout2", label: "Line callout 2" },
      { kind: "borderCallout3", label: "Line callout 3" },
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
  {
    id: "action-buttons",
    title: "Action Buttons",
    kinds: [
      { kind: "actionButtonBlank", label: "Blank action button" },
      { kind: "actionButtonBackPrevious", label: "Back action button" },
      { kind: "actionButtonForwardNext", label: "Forward action button" },
      { kind: "actionButtonBeginning", label: "Beginning action button" },
      { kind: "actionButtonEnd", label: "End action button" },
      { kind: "actionButtonHome", label: "Home action button" },
      { kind: "actionButtonInformation", label: "Information action button" },
      { kind: "actionButtonReturn", label: "Return action button" },
      { kind: "actionButtonMovie", label: "Movie action button" },
      { kind: "actionButtonSound", label: "Sound action button" },
      { kind: "actionButtonDocument", label: "Document action button" },
      { kind: "actionButtonHelp", label: "Help action button" },
    ],
  },
];
