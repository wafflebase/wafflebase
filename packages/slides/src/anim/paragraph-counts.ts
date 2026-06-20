import type { Slide } from '../model/presentation';
import { flattenElements } from '../model/group';

/**
 * Map each text-bearing element id to its paragraph (block) count.
 * Flattens group children so nested text elements are included.
 *
 * - TextElement: counts `data.blocks.length`
 * - ShapeElement with `data.text`: counts `data.text.blocks.length`
 * - Other element types: not text-bearing, skipped (not added to map)
 *
 * A max(1, count) guard ensures an empty text box yields at least 1.
 */
export function buildParagraphCounts(slide: Slide): Map<string, number> {
  const result = new Map<string, number>();
  for (const el of flattenElements(slide.elements)) {
    if (el.type === 'text') {
      result.set(el.id, Math.max(1, el.data.blocks.length));
    } else if (el.type === 'shape' && el.data.text) {
      result.set(el.id, Math.max(1, el.data.text.blocks.length));
    }
  }
  return result;
}
