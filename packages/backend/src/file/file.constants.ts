/**
 * A stored blob id: a uuid plus an optional sanitized extension (see
 * file-extension.util.ts). Any extension is allowed — the type↔extension
 * agreement is enforced per document type in document-file-id.util.ts.
 */
export const VALID_FILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,12})?$/i;

/** Max upload size for any file (50 MB). Shared by Multer and FileService. */
export const MAX_FILE_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Max image upload size (25 MB). Enforced per-category in FileService. */
export const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;
