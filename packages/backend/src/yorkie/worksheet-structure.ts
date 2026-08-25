import { BadRequestException } from '@nestjs/common';
import { parseRange, parseRef } from '@wafflebase/sheets';
import type { Range } from '@wafflebase/sheets';

/**
 * Validate a `{ range: "A1:C10" }` body for a clear-range action and return the
 * parsed `Range`. A single-cell reference (`"A1"`) is accepted and treated as a
 * 1x1 range. A malformed reference is rejected with a 400 (the engine parser
 * throws a plain Error, which is wrapped here).
 */
export function parseClearRange(body: unknown): Range {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('body must be an object { range: "A1:C10" }');
  }
  const ref = (body as Record<string, unknown>).range;
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new BadRequestException("'range' must be a non-empty A1 range string");
  }
  try {
    if (ref.includes(':')) return parseRange(ref);
    const single = parseRef(ref);
    return [single, { ...single }];
  } catch {
    throw new BadRequestException(`'range' is not a valid A1 range; got "${ref}"`);
  }
}
