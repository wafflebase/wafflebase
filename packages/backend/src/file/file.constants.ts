export const VALID_FILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpe?g|gif|webp)$/i;

/** Max PDF upload size (50 MB). Shared by the Multer limit and FileService. */
export const MAX_PDF_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Max image upload size (25 MB). Enforced per-category in FileService. */
export const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;
