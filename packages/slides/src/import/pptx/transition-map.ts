import type { AnimDirection } from '../../model/element';
import type { SlideTransition } from '../../model/presentation';
import type { ImportReport } from './report';
import { attr } from './xml';

/** OOXML `spd` attribute → milliseconds. Absent defaults to `med` (500 ms). */
const SPD_MAP: Record<string, number> = {
  slow: 1000,
  med: 500,
  fast: 250,
};

/**
 * Maps a recognized OOXML child tag localName → `SlideTransition['type']`.
 * Tags absent from this map are exotic effects that get approximated to `fade`.
 */
const TAG_TO_TYPE: Record<string, SlideTransition['type']> = {
  fade: 'fade',
  dissolve: 'dissolve',
  push: 'push',
  pull: 'push', // approximation — pull is the reverse direction
  cover: 'push', // approximation — cover is directional push-like
  wipe: 'wipe',
  cut: 'none',
  cube: 'cube',
  cube14: 'cube', // p14: namespace variant
  flip: 'flip',
};

/** OOXML `dir` attribute value → our `AnimDirection`. */
const DIR_MAP: Record<string, AnimDirection> = {
  l: 'left',
  r: 'right',
  u: 'up',
  d: 'down',
};

/**
 * Parse a `<p:transition>` element into a `SlideTransition`.
 *
 * Returns `undefined` when `transitionEl` is absent (caller's slide has no
 * explicit transition — treated as a hard cut by the player).
 *
 * Best-effort: exotic OOXML effect tags (blinds, checker, honeycomb, morph,
 * etc.) are approximated to `fade` and counted in `report.transitionsApproximated`.
 */
export function parseTransition(
  transitionEl: Element | undefined,
  report: ImportReport,
): SlideTransition | undefined {
  if (!transitionEl) return undefined;

  // Duration: spd attribute → ms.
  const spd = attr(transitionEl, 'spd') ?? 'med';
  const durationMs = SPD_MAP[spd] ?? 500;

  // Find the first child element — it names the transition effect type.
  let effectChild: Element | undefined;
  for (let i = 0; i < transitionEl.childNodes.length; i++) {
    const n = transitionEl.childNodes[i];
    if (n.nodeType === 1) {
      effectChild = n as Element;
      break;
    }
  }

  // No child element → instant cut (no recognizable effect).
  if (!effectChild) {
    return { type: 'none', durationMs };
  }

  const localName = effectChild.localName;
  const knownType = TAG_TO_TYPE[localName];

  let type: SlideTransition['type'];
  if (knownType !== undefined) {
    type = knownType;
  } else {
    // Exotic / unsupported effect — approximate to fade and count it.
    type = 'fade';
    report.transitionsApproximated += 1;
  }

  // Direction: only meaningful for push/wipe types.
  let direction: AnimDirection | undefined;
  if (type === 'push' || type === 'wipe') {
    const dirAttr = attr(effectChild, 'dir');
    if (dirAttr) {
      direction = DIR_MAP[dirAttr];
    }
  }

  const result: SlideTransition = { type, durationMs };
  if (direction) result.direction = direction;
  return result;
}
