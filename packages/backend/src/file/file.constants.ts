export const VALID_FILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i;

/** Max PDF upload size (50 MB). Shared by the Multer limit and FileService. */
export const MAX_PDF_UPLOAD_BYTES = 50 * 1024 * 1024;
