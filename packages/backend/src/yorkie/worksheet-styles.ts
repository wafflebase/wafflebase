import { BadRequestException } from '@nestjs/common';
import { normalizeRangeStylePatch } from '@wafflebase/sheets';
import type { CellStyle, RangeStylePatch } from '@wafflebase/sheets';
import { parseCellStyle } from './cell-style';

/**
 * Validate a `{ rangeStyles: RangeStylePatch[] }` body. Each patch is run
 * through the sheets-engine `normalizeRangeStylePatch` (validates the range and
 * the style), which returns `undefined` for an invalid patch; those are
 * rejected with a 400.
 */
export function parseRangeStyles(body: unknown): RangeStylePatch[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('body must be an object { rangeStyles: [...] }');
  }
  const patches = (body as Record<string, unknown>).rangeStyles;
  if (!Array.isArray(patches)) {
    throw new BadRequestException("'rangeStyles' must be an array");
  }
  return patches.map((raw, i) => {
    let normalized: RangeStylePatch | undefined;
    try {
      normalized = normalizeRangeStylePatch(raw as RangeStylePatch);
    } catch {
      // A malformed patch (e.g. a missing `range`) makes the normalizer
      // throw rather than return undefined; treat both as a 400.
      normalized = undefined;
    }
    if (!normalized) {
      throw new BadRequestException(
        `rangeStyles[${i}] is not a valid range style patch`,
      );
    }
    return normalized;
  });
}

/**
 * Validate a `{ style: CellStyle | null }` body for the whole-sheet style.
 * `null` clears it; an object is validated with `parseCellStyle`.
 */
export function parseSheetStyle(body: unknown): CellStyle | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('body must be an object { style: {...} | null }');
  }
  const style = (body as Record<string, unknown>).style;
  if (style === null || style === undefined) return null;
  return parseCellStyle(style);
}
