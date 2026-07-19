import { BadRequestException } from '@nestjs/common';

/** Types whose documents may carry a stored-blob `fileId`. */
const FILE_ID_TYPES = new Set(['pdf', 'image']);

/**
 * Contract guard: only pdf/image documents reference a stored blob. Reject a
 * `fileId` on any other type so the coupling can't silently loosen.
 */
export function assertFileIdAllowed(
  type: string | undefined,
  fileId: string | undefined,
): void {
  if (fileId && !FILE_ID_TYPES.has(type ?? 'sheet')) {
    throw new BadRequestException('fileId is only allowed for pdf/image documents');
  }
}
