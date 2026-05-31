import { type ConnectorInsertKind } from "@wafflebase/slides";

/**
 * One entry in the `<LinePicker />` dropdown — a single
 * `ConnectorInsertKind` paired with the user-facing label used as
 * both the IconButton's tooltip and `aria-label` for keyboard /
 * screen-reader users.
 */
export type LinePickerEntry = {
  kind: ConnectorInsertKind;
  label: string;
};

/**
 * Connector catalogue surfaced by the toolbar's `Line ▾` picker.
 * Sits next to the `<ShapePicker />` Shape button but is intentionally
 * a separate dropdown — line insertion is endpoint-anchored
 * (snap-to-shape), fundamentally different from shape drag-to-size,
 * so the affordance gets its own affordance.
 *
 * Mirrors Google Slides' top-level "Line" tool. Ordering matches GS:
 * Line, Arrow, Elbow connector, Curved connector.
 */
export const LINE_PICKER_ENTRIES: readonly LinePickerEntry[] = [
  { kind: "connector:line", label: "Line" },
  { kind: "connector:arrow", label: "Arrow" },
  { kind: "connector:elbow", label: "Elbow connector" },
  { kind: "connector:curved", label: "Curved connector" },
];

/**
 * Type guard — true when the given insert mode is one of the line
 * picker's connector kinds. Used by the toolbar to compute `activeKind`
 * for the `<LinePicker />` from the editor's current insert mode (which
 * is the union `InsertKind = ShapeKind | 'text' | ConnectorInsertKind`).
 */
export function isLinePickerKind(kind: unknown): kind is ConnectorInsertKind {
  return (
    kind === "connector:line" ||
    kind === "connector:arrow" ||
    kind === "connector:elbow" ||
    kind === "connector:curved"
  );
}
