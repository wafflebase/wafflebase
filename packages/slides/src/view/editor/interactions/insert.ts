import type { Block } from '@wafflebase/docs';
import type { ElementInit } from '../../../model/element';
import type { InsertKind } from '../editor';

const DEFAULT_FILL = '#cccccc';
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
          inlines: [{ text: '', style: {} }],
          style: {},
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
    case 'line':    return { type: 'shape', frame, data: { kind: 'line',  stroke: { color: '#222', width: DEFAULT_STROKE_WIDTH } } };
    case 'arrow':   return { type: 'shape', frame, data: { kind: 'arrow', stroke: { color: '#222', width: DEFAULT_STROKE_WIDTH }, fill: '#222' } };
  }
}
