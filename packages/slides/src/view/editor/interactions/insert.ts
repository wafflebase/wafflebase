import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';
import type { ElementInit } from '../../../model/element';
import type { ThemeColor } from '../../../model/theme';
import type { InsertKind } from '../editor';

// Insert defaults bind to theme roles so new shapes follow the active
// theme — switching the deck's theme repaints them in the new palette.
// Users can override per-shape via the Fill picker (which writes
// concrete `{ kind: 'srgb' }` values).
const DEFAULT_FILL: ThemeColor = { kind: 'role', role: 'accent1' };
const DEFAULT_STROKE_COLOR: ThemeColor = { kind: 'role', role: 'text' };
const DEFAULT_STROKE_WIDTH = 2;
const TEXT_DEFAULT_W = 400;
const TEXT_DEFAULT_H = 80;

export interface Point { x: number; y: number; }

/**
 * Build the ElementInit for a freshly-inserted element given the
 * pointer's drag start and end. Shapes use the drag rectangle as the
 * frame; text uses a default-sized box anchored at the start point
 * (insert text is a single-click operation, not a drag).
 */
export function buildInsertElement(
  kind: InsertKind,
  start: Point, end: Point,
): ElementInit {
  if (kind === 'text') {
    return {
      type: 'text',
      frame: { x: start.x, y: start.y, w: TEXT_DEFAULT_W, h: TEXT_DEFAULT_H, rotation: 0 },
      data: {
        blocks: [{
          id: 'placeholder',
          type: 'paragraph',
          // Bind the inline color to the deck's `text` role so the box
          // renders in the active theme. The text-renderer's color
          // resolver also remaps the docs default `'#000000'` to the
          // `text` role (covers freshly typed runs that inherit
          // `DEFAULT_INLINE_STYLE` instead of this explicit role).
          inlines: [{ text: '', style: { color: { kind: 'role', role: 'text' } } }],
          // Fully-defaulted style — `computeLayout` reads `marginTop`
          // and `marginBottom` without a fallback, so a sparse style
          // would NaN the cumulative y and the slide canvas would
          // paint at a different offset than the text-box editor
          // (which seeds through `MemDocStore.setDocument`, which
          // normalises). See `text-renderer.ts:drawText`.
          style: { ...DEFAULT_BLOCK_STYLE },
        } as Block],
      },
    };
  }

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  const frame = { x, y, w, h, rotation: 0 };

  switch (kind) {
    case 'rect':    return { type: 'shape', frame, data: { kind: 'rect', fill: DEFAULT_FILL } };
    case 'ellipse': return { type: 'shape', frame, data: { kind: 'ellipse', fill: DEFAULT_FILL } };
    case 'line':    return { type: 'shape', frame, data: { kind: 'line',  stroke: { color: DEFAULT_STROKE_COLOR, width: DEFAULT_STROKE_WIDTH } } };
    case 'arrow':   return { type: 'shape', frame, data: { kind: 'arrow', stroke: { color: DEFAULT_STROKE_COLOR, width: DEFAULT_STROKE_WIDTH }, fill: DEFAULT_STROKE_COLOR } };
  }
}
