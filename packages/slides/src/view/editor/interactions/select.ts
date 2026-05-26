import type { Slide } from '../../../model/presentation';
import {
  hitTestSlide,
  type HitTestSlideOptions,
} from '../hit-test-elements';

export interface SelectModifiers {
  shift?: boolean;
}

export type SelectAtOptions = HitTestSlideOptions;

/**
 * Compute the new selection when the user clicks at logical-slide
 * coordinates `(x, y)`.
 *
 * Hit-testing iterates from last to first so the topmost (front) element
 * wins for overlapping shapes — matches the array-order = z-order
 * convention. Each element is tested against its drawn geometry (not its
 * bbox) via `hitTestSlide` → `hitTestElement`, so clicking the empty
 * corner of an ellipse or off a connector line does NOT select it.
 */
export function selectAt(
  slide: Slide,
  x: number,
  y: number,
  mods: SelectModifiers,
  current: readonly string[],
  options: SelectAtOptions,
): string[] {
  const hit = topmostUnderPoint(slide, x, y, options);

  if (mods.shift) {
    if (hit === null) return [...current]; // shift on empty: no-op
    return toggleId(current, hit);
  }

  if (hit === null) return [];
  // Preserve an existing multi-selection when the user clicks on an
  // element that's already part of it. Without this guard, the no-shift
  // click would collapse the selection to `[hit]` and a follow-up drag
  // would only move the single clicked element instead of the group.
  if (current.includes(hit)) return [...current];
  return [hit];
}

function topmostUnderPoint(
  slide: Slide,
  x: number,
  y: number,
  options: SelectAtOptions,
): string | null {
  return hitTestSlide(slide, x, y, options)?.elementId ?? null;
}

function toggleId(ids: readonly string[], id: string): string[] {
  const i = ids.indexOf(id);
  if (i === -1) return [...ids, id];
  return [...ids.slice(0, i), ...ids.slice(i + 1)];
}
