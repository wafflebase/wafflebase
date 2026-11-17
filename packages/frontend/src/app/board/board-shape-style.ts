import type { ShapeInsertStyle, ShapeKind } from "@wafflebase/slides";

/**
 * A new board shape's starting look: a light tint with a darker outline of
 * the same hue, so the default text colour (the deck theme's near-black)
 * reads on it and stickies beneath it stay visible through the contrast.
 * The slides default is a saturated accent block, which on a whiteboard
 * reads as a selection or an error and hides everything it covers.
 *
 * Blue-grey rather than the sticky palette's blue (`#C7E5FF`), so a
 * rectangle does not pass for a sticky at a glance.
 */
export const BOARD_SHAPE_FILL = "#E3ECFA";
export const BOARD_SHAPE_STROKE = "#4F6FA8";
export const BOARD_SHAPE_STROKE_WIDTH = 2;

/**
 * The board's `shapeInsertStyle` host option. Only the slides "filled"
 * category changes — the one whose default fill is the theme accent.
 * Callouts (outlined on the background) and open paths like an arc
 * (stroke only) already read as line art and keep their defaults.
 */
export function boardShapeInsertStyle(
  _kind: ShapeKind,
  defaults: ShapeInsertStyle,
): ShapeInsertStyle {
  const fill = defaults.fill;
  const isAccentFill =
    typeof fill === "object" &&
    fill !== null &&
    "kind" in fill &&
    fill.kind === "role" &&
    fill.role === "accent1";
  if (!isAccentFill) return defaults;
  return {
    fill: { kind: "srgb", value: BOARD_SHAPE_FILL },
    stroke: {
      color: { kind: "srgb", value: BOARD_SHAPE_STROKE },
      width: BOARD_SHAPE_STROKE_WIDTH,
    },
  };
}
