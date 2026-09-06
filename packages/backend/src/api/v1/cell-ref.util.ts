import { BadRequestException } from '@nestjs/common';
import { parseRef, type Ref } from '@wafflebase/sheets';

/**
 * Parse a client-supplied A1 reference, answering `400` instead of letting
 * `parseRef`'s bare `Error` reach Nest's default filter as a 500 (#1030). The
 * blanket catch holds only while every caller passes a string: `parseRef`'s
 * other throw is a `TypeError` from `.replace` on a non-string, which this
 * would misreport as a bad reference.
 */
export function parseCellRef(sref: string): Ref {
  try {
    return parseRef(sref);
  } catch {
    throw new BadRequestException(`Invalid cell reference "${sref}"`);
  }
}
