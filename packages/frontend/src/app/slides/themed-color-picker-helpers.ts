import type {
  ColorRole,
  Element,
  ShapeElement,
  SlidesStore,
  ThemeColor,
} from "@wafflebase/slides";

/**
 * Ordered list of `ColorRole` slots the themed picker exposes as the
 * top "Theme" row. Mirrors the OOXML scheme order so the row
 * (text, background, accent1..6, hyperlink) matches what users see in
 * the theme thumbnail and PowerPoint/Slides theme editors.
 *
 * Lives in `.ts` (not the `.tsx` component) so the helper logic can be
 * unit-tested in isolation.
 */
export const THEME_ROLES: ColorRole[] = [
  "text",
  "background",
  "textSecondary",
  "backgroundAlt",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hyperlink",
  "visitedHyperlink",
];

/**
 * True when `value` is a role-bound ThemeColor pointing at `role`.
 * Used by the picker to render the "active" marker on the matching
 * theme swatch — if the value is `kind: 'srgb'` (a concrete color
 * the user picked from the custom input), no theme swatch is marked.
 */
export function isRoleSelected(
  value: ThemeColor | undefined,
  role: ColorRole,
): boolean {
  return value?.kind === "role" && value.role === role;
}

export function makeRoleColor(role: ColorRole): ThemeColor {
  return { kind: "role", role };
}

export function makeSrgbColor(value: string): ThemeColor {
  return { kind: "srgb", value };
}

/**
 * Apply a fill color to a shape element via the store. Wrapped in
 * `store.batch` so undo collapses the change into a single entry,
 * matching the convention used by `applyBuiltInTheme` in
 * `theme-panel-helpers.ts`.
 *
 * No-ops when `element` isn't a shape — text fill is handled at the
 * inline-run level (Task 4 / docs ThemeColor extension), not via
 * `updateElementData`.
 */
export function applyShapeFill(
  store: SlidesStore,
  slideId: string,
  element: Element,
  color: ThemeColor,
): void {
  if (element.type !== "shape") return;
  const shape = element as ShapeElement;
  store.batch(() => {
    store.updateElementData(slideId, shape.id, { fill: color });
  });
}

/**
 * Read the current fill of a shape element. Returns `undefined` for
 * non-shapes (text/image), or for shapes that have no explicit fill
 * (the renderer paints those transparent).
 */
export function readShapeFill(element: Element): ThemeColor | undefined {
  if (element.type !== "shape") return undefined;
  return (element as ShapeElement).data.fill;
}
