import { BadRequestException } from '@nestjs/common';

/**
 * Extension rule per blob-backed document type. `null` means "any extension,
 * or none" — that is the whole point of the `file` type.
 *
 * This is the first of the two controls that keep uploaded active content from
 * ever being served inline: it prevents an `.html` blob from being attached to
 * a `pdf`/`image` document in the first place. The second is the derived
 * response Content-Type in `file-response.util.ts` — see
 * docs/design/generic-file-upload.md.
 */
const FILE_ID_EXT: Record<string, RegExp | null> = {
  pdf: /\.pdf$/i,
  image: /\.(png|jpe?g|gif|webp)$/i,
  file: null,
};

/** Whether documents of this type reference a stored blob via `fileId`. */
export function isBlobBacked(type: string | undefined): boolean {
  return type !== undefined && type in FILE_ID_EXT;
}

/**
 * Contract guard: only blob-backed documents carry a `fileId`, and the blob's
 * extension must agree with the declared type.
 */
export function assertFileIdAllowed(
  type: string | undefined,
  fileId: string | undefined,
): void {
  if (!fileId) return;
  const resolved = type ?? 'sheet';
  if (!isBlobBacked(resolved)) {
    throw new BadRequestException(
      'fileId is only allowed for pdf/image/file documents',
    );
  }
  const pattern = FILE_ID_EXT[resolved];
  if (pattern && !pattern.test(fileId)) {
    throw new BadRequestException(
      `fileId extension does not match a ${resolved} document`,
    );
  }
}
