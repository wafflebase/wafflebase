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
 * Which blob-backed document type a stored blob should become, decided by the
 * same extension table that then validates the pairing — so the two can never
 * disagree. Mirrors the browser's `EXT_TO_KIND`
 * (`packages/frontend/src/app/documents/upload-kind.ts`) for the blob-native
 * formats; the parseable ones (`.xlsx`/`.docx`/`.pptx`) are deliberately absent
 * because nothing here parses — an uploaded `.xlsx` is stored as bytes.
 *
 * Pass the **stored** `fileId`, not the client's filename: its extension has
 * already been through `safeExtension`, so the returned type is guaranteed to
 * satisfy `assertFileIdAllowed`.
 */
export function blobDocumentTypeFor(fileId: string): 'pdf' | 'image' | 'file' {
  for (const type of ['pdf', 'image'] as const) {
    if (FILE_ID_EXT[type]!.test(fileId)) return type;
  }
  return 'file';
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
