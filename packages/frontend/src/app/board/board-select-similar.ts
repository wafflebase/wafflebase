import type { ContextMenuItem, Element } from "@wafflebase/slides";
import { isStickyElement } from "./sticky";

/**
 * What "this type" means on a board: stickies are their own kind (a sticky
 * is a preset `roundRect`, so the element type alone would lump it in with
 * every rounded rectangle), a shape is its shape kind (all ellipses, not
 * all shapes), and anything else is its element type.
 */
export function similarityType(el: Element): string {
  if (isStickyElement(el)) return "sticky";
  if (el.type === "shape") return `shape:${el.data.kind}`;
  return el.type;
}

/**
 * The colour an element is "the same colour" by, as a comparable key: a
 * shape's (and a sticky's) solid fill, a connector's stroke, a text box's
 * background. `null` when the element has no single colour to match — a
 * gradient fill, an image, a bare text box.
 */
export function colorKey(el: Element): string | null {
  const solid = (c: unknown): string | null => {
    if (!c) return null;
    if (typeof c === "string") return `srgb:${c.toLowerCase()}`;
    if (typeof c !== "object") return null;
    const color = c as { kind?: string; value?: string; role?: string; type?: string };
    if (color.kind === "srgb" && color.value) return `srgb:${color.value.toLowerCase()}`;
    if (color.kind === "role" && color.role) return `role:${color.role}`;
    return null; // a gradient carries `type`, not `kind`
  };
  if (el.type === "shape") return solid(el.data.fill) ?? solid(el.data.stroke?.color);
  if (el.type === "connector") return solid(el.stroke?.color);
  if (el.type === "text") return solid(el.data.fill);
  return null;
}

/** Ids of every top-level element sharing `target`'s {@link similarityType}. */
export function idsOfSameType(elements: readonly Element[], target: Element): string[] {
  const t = similarityType(target);
  return elements.filter((e) => similarityType(e) === t).map((e) => e.id);
}

/** Ids of every top-level element whose {@link colorKey} matches `target`'s. */
export function idsOfSameColor(elements: readonly Element[], target: Element): string[] {
  const key = colorKey(target);
  if (key === null) return [];
  return elements.filter((e) => colorKey(e) === key).map((e) => e.id);
}

/**
 * The board's "select similar" entries for an element's context menu.
 *
 * The target is the right-clicked element, or — when that is a member of a
 * group, which has no top-level frame — the first selected top-level
 * element. Matching runs over top-level elements only: selecting a group
 * member alongside top-level elements would mix two coordinate spaces.
 */
export function selectSimilarMenuItems(
  elements: readonly Element[],
  ctx: { elementId: string; selectedIds: readonly string[] },
  select: (ids: string[]) => void,
): ContextMenuItem[] {
  const target =
    elements.find((e) => e.id === ctx.elementId) ??
    elements.find((e) => ctx.selectedIds.includes(e.id));
  if (!target) return [];
  const sameColor = idsOfSameColor(elements, target);
  const items: ContextMenuItem[] = [
    { label: "---", run: () => undefined },
    {
      label: "Select all with same colour",
      disabled: sameColor.length === 0,
      run: () => select(sameColor),
    },
  ];
  const stickies = elements.filter((e) => isStickyElement(e)).map((e) => e.id);
  items.push({
    label: "Select all stickies",
    disabled: stickies.length === 0,
    run: () => select(stickies),
  });
  // On a sticky, "this type" IS the stickies entry above.
  if (!isStickyElement(target)) {
    items.push({
      label: "Select all of this type",
      run: () => select(idsOfSameType(elements, target)),
    });
  }
  return items;
}
