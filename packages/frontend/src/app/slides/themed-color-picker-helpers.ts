import {
  representativeColor,
  type ColorRole,
  type Element,
  type Fill,
  type GradientFill,
  type ShapeElement,
  type SlidesStore,
  type ThemeColor,
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
 * Subset of `THEME_ROLES` shown in the picker UI. The remaining slots
 * (textSecondary, backgroundAlt, hyperlink, visitedHyperlink) still
 * resolve at render time but are rarely picked explicitly — they
 * follow the theme automatically — so we omit them from the picker
 * grid and surface the 8 high-traffic roles in a single row that
 * aligns with the 8-col Standard grid below.
 */
export const PICKER_THEME_ROLES: ColorRole[] = [
  "text",
  "background",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
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
 * Transparency percent (0–100) for the picker's Transparency slider, the
 * inverse of `ThemeColor.alpha` (opacity). A missing `alpha` (or `undefined`
 * color) is fully opaque ⇒ 0% transparent; `alpha: 0` ⇒ 100% transparent.
 * Mirrors the Google Slides "Transparency" convention (0% = solid).
 */
export function colorTransparencyPercent(
  color: ThemeColor | undefined,
): number {
  const alpha = color?.alpha ?? 1;
  return Math.round((1 - alpha) * 100);
}

/**
 * Return `color` with its `alpha` (opacity, 0–1) set, clamping into range.
 * A fully-opaque result drops the field entirely so `resolveColor` keeps
 * taking its no-alpha fast path (and exports stay clean) — opaque is the
 * absence of alpha, not `alpha: 1`.
 */
export function withAlpha(color: ThemeColor, alpha: number): ThemeColor {
  const clamped = Math.max(0, Math.min(1, alpha));
  const next = { ...color };
  if (clamped >= 1) {
    // Opaque is the absence of alpha, not `alpha: 1` — drop the field.
    delete next.alpha;
  } else {
    next.alpha = clamped;
  }
  return next;
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
  const fill = (element as ShapeElement).data.fill;
  // The picker edits a solid color; a gradient-filled shape shows its
  // representative stop (picking a new color replaces the gradient).
  return fill ? representativeColor(fill) : undefined;
}

/**
 * Read the current fill of a shape as a gradient, or undefined if the fill
 * is solid / absent / the element isn't a shape. Powers the Gradient tab.
 */
export function readShapeGradient(element: Element): GradientFill | undefined {
  if (element.type !== "shape") return undefined;
  const fill = (element as ShapeElement).data.fill;
  return fill && fill.kind === "gradient" ? fill : undefined;
}

/**
 * Write a full Fill (solid or gradient) to every shape in `ids` in one
 * batch. `undefined` clears the fill. Non-shapes are skipped.
 */
export function applyShapeFillValue(
  store: SlidesStore,
  slideId: string,
  ids: readonly string[],
  slide: { elements: readonly Element[] },
  fill: Fill | undefined,
): void {
  store.batch(() => {
    for (const id of ids) {
      const el = slide.elements.find((e) => e.id === id);
      if (el?.type === "shape") {
        store.updateElementData(slideId, id, { fill });
      }
    }
  });
}
