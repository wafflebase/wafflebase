import type { CategoryEntry } from "../slides/shape-picker-helpers";

/**
 * The shapes the board's Shape picker opens on (FigJam / Miro offer about
 * a dozen). The full OOXML catalogue the Slides picker shows (70-odd
 * shapes in eight groups) is one "More shapes…" click further in.
 *
 * Labels are whiteboard words, not OOXML ones: a `wedgeRoundRectCallout`
 * is a speech bubble and a `can` a cylinder. Every `kind` is an entry of
 * `SHAPE_PICKER_CATEGORIES` (pinned by `board-shapes.test.ts`), so the
 * curated list can never offer a shape the full picker does not.
 */
export const BOARD_SHAPES: readonly CategoryEntry[] = [
  { kind: "rect", label: "Rectangle" },
  { kind: "roundRect", label: "Rounded rectangle" },
  { kind: "ellipse", label: "Ellipse" },
  { kind: "diamond", label: "Diamond" },
  { kind: "triangle", label: "Triangle" },
  { kind: "parallelogram", label: "Parallelogram" },
  { kind: "rightArrow", label: "Arrow" },
  { kind: "leftRightArrow", label: "Double arrow" },
  { kind: "star5", label: "Star" },
  { kind: "wedgeRoundRectCallout", label: "Speech bubble" },
  { kind: "can", label: "Cylinder" },
  { kind: "hexagon", label: "Hexagon" },
];
