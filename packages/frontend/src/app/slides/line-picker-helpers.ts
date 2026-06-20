import { type ConnectorInsertKind } from "@wafflebase/slides";

/**
 * Insert kinds owned by the `<LinePicker />` dropdown: the connectors
 * plus the freehand scribble (`'freeform'`). Scribble lives here rather
 * than in the shape picker because, like the connectors, it is drawn by
 * a freehand/endpoint gesture, not a rectangular drag-to-size — and
 * Google Slides groups Scribble under its Line tool.
 */
export type LineToolKind = ConnectorInsertKind | "freeform";

/**
 * One entry in the `<LinePicker />` dropdown — a single
 * `LineToolKind` paired with the user-facing label used as both the
 * IconButton's tooltip and `aria-label` for keyboard / screen-reader
 * users.
 */
export type LinePickerEntry = {
  kind: LineToolKind;
  label: string;
};

/**
 * Catalogue surfaced by the toolbar's `Line ▾` picker. Sits next to the
 * `<ShapePicker />` Shape button but is intentionally a separate
 * dropdown — line / scribble insertion is freehand (endpoint-anchored
 * or drawn), fundamentally different from shape drag-to-size.
 *
 * Mirrors Google Slides' top-level "Line" tool. Ordering matches GS:
 * Line, Arrow, Elbow connector, Curved connector, Scribble.
 */
export const LINE_PICKER_ENTRIES: readonly LinePickerEntry[] = [
  { kind: "connector:line", label: "Line" },
  { kind: "connector:arrow", label: "Arrow" },
  { kind: "connector:elbow", label: "Elbow connector" },
  { kind: "connector:curved", label: "Curved connector" },
  { kind: "freeform", label: "Scribble" },
];

/**
 * Type guard — true when the given insert mode is one of the line
 * picker's connector kinds (excludes scribble). Used to distinguish
 * connector insert modes from shapes elsewhere.
 */
export function isLinePickerKind(kind: unknown): kind is ConnectorInsertKind {
  return (
    kind === "connector:line" ||
    kind === "connector:arrow" ||
    kind === "connector:elbow" ||
    kind === "connector:curved"
  );
}

/**
 * Type guard — true when the given insert mode is owned by the
 * `<LinePicker />` (any connector OR the freeform scribble). Used by the
 * toolbar to compute the picker's `activeKind` from the editor's current
 * `InsertKind = ShapeKind | 'text' | ConnectorInsertKind`.
 */
export function isLineToolKind(kind: unknown): kind is LineToolKind {
  return isLinePickerKind(kind) || kind === "freeform";
}
