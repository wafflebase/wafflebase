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
      { kind: "octagon", label: "Octagon" },
      { kind: "plus", label: "Plus" },
      { kind: "donut", label: "Donut" },
      { kind: "can", label: "Can" },
      { kind: "cloud", label: "Cloud" },
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
];
