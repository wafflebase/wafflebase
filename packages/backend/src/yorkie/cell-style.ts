import { BadRequestException } from '@nestjs/common';
import type { CellStyle } from '@wafflebase/sheets';

// The known CellStyle fields, grouped by how they validate. Mirrors
// `CellStyle` in `@wafflebase/sheets` (packages/sheets/src/model/core/types.ts).
const BOOLEAN_KEYS = ['b', 'i', 'u', 'st', 'bt', 'br', 'bb', 'bl'] as const;
const STRING_KEYS = ['tc', 'bg', 'cu'] as const;
const ENUM_KEYS: Record<string, readonly string[]> = {
  al: ['left', 'center', 'right'],
  va: ['top', 'middle', 'bottom'],
  nf: ['plain', 'number', 'currency', 'percent', 'date'],
};

/**
 * Validate a client-supplied cell style against the known `CellStyle` fields
 * and return a sanitized copy. Rejects unknown keys and wrong types with a 400
 * so arbitrary junk never reaches the worksheet CRDT. Callers pass only the
 * properties they want to set; the controller shallow-merges the result onto
 * the cell's existing style.
 */
export function parseCellStyle(input: unknown): CellStyle {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new BadRequestException('style must be an object');
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== 'boolean') {
        throw new BadRequestException(`style.${key} must be a boolean`);
      }
      out[key] = value;
    } else if ((STRING_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== 'string') {
        throw new BadRequestException(`style.${key} must be a string`);
      }
      out[key] = value;
    } else if (key in ENUM_KEYS) {
      if (typeof value !== 'string' || !ENUM_KEYS[key].includes(value)) {
        throw new BadRequestException(
          `style.${key} must be one of: ${ENUM_KEYS[key].join(', ')}`,
        );
      }
      out[key] = value;
    } else if (key === 'dp') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new BadRequestException('style.dp must be a finite number');
      }
      out[key] = value;
    } else {
      throw new BadRequestException(`Unknown style field '${key}'`);
    }
  }

  return out as CellStyle;
}
