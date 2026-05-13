// packages/slides/src/view/canvas/shapes/action-buttons/index.ts
//
// Action buttons (12 in P3-B) are special-cased — they paint a body
// + inner glyph in two passes with distinct fills, which doesn't
// fit the pure `(size, adj) => Path2D` contract every other shape
// uses. The dispatcher branches on `isActionButton(kind)` to route
// them through `drawActionButton` in `shape-special.ts`.
//
// In V0, body geometry is shared (rectangle + 4 px inset bevel
// outline) across all 12 buttons; only the glyph differs. The
// glyph builder for each kind is registered in
// `ACTION_BUTTON_GLYPHS` below.

import type { ShapeKind } from '../../../../model/element';
import type { FrameSize } from '../builder';
import { ACTION_BUTTON_BLANK_GLYPH } from './blank';

/**
 * Per-button inner-glyph builder. Receives the action button's
 * frame size and returns a Path2D in element-local coords; the
 * dispatcher fills the result with `role: 'text'`.
 *
 * `null` indicates "no glyph" (e.g. `actionButtonBlank`).
 */
export type GlyphBuilder = ((size: FrameSize) => Path2D) | null;

export const ACTION_BUTTON_GLYPHS = new Map<ShapeKind, GlyphBuilder>();

ACTION_BUTTON_GLYPHS.set('actionButtonBlank', ACTION_BUTTON_BLANK_GLYPH);

/** Predicate matching every `ShapeKind` whose name starts with
 * `actionButton`. Used by the dispatcher to route paint to
 * `drawActionButton`. */
export function isActionButton(kind: ShapeKind): boolean {
  return kind.startsWith('actionButton');
}
