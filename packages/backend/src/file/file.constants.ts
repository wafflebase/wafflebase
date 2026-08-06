/** The UUID half of a blob id, shared by both id patterns below. */
const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * A blob id a *document* may reference: a UUID plus a servable extension.
 *
 * `document.dto.ts` reuses this to validate `fileId`, and
 * `document-file.controller.ts` gates `GET /documents/:id/file` on it — so
 * anything listed here becomes retrievable through a document, share links
 * included. Import staging blobs are deliberately absent (see
 * `VALID_IMPORT_FILE_ID_PATTERN`): they are read server-side only and must not
 * be reachable by attaching one to a document.
 */
export const VALID_FILE_ID_PATTERN = new RegExp(
  `^${UUID_PATTERN}\\.(pdf|png|jpe?g|gif|webp)$`,
  'i',
);

/**
 * Extensions a backend-parsed import can stage and read. The single source of
 * truth for the set — the id pattern, the upload name filter, and
 * `FileService`'s category gate below all derive from it, so landing a new
 * format (Parquet/JSON, #554/#555) only means adding one entry here.
 */
export const IMPORT_EXTENSIONS = ['csv', 'tsv'] as const;
export type ImportExtension = (typeof IMPORT_EXTENSIONS)[number];

/**
 * A blob id staged for a backend-parsed import. Separate from
 * `VALID_FILE_ID_PATTERN` precisely so these never become document-servable —
 * the file-import endpoints are the only readers.
 */
export const VALID_IMPORT_FILE_ID_PATTERN = new RegExp(
  `^${UUID_PATTERN}\\.(${IMPORT_EXTENSIONS.join('|')})$`,
  'i',
);

/**
 * Upload file *names* the import-staging route accepts, applied as a Multer
 * `fileFilter` so a body of the wrong type is rejected mid-parse instead of
 * being buffered whole against `MAX_DATA_UPLOAD_BYTES` below.
 */
export const IMPORT_FILE_NAME_PATTERN = new RegExp(
  `\\.(${IMPORT_EXTENSIONS.join('|')})$`,
  'i',
);

/** Max PDF upload size (50 MB). Shared by the Multer limit and FileService. */
export const MAX_PDF_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Max image upload size (25 MB). Enforced per-category in FileService. */
export const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Max data-file upload size (200 MB), for the csv/tsv blobs a backend-parsed
 * sheet import stages.
 *
 * Larger than the PDF cap because these are exactly the files the browser
 * cannot parse — a CSV costs roughly 7x its size in tab memory, so the client
 * hands over at 25 MB and everything above that has nowhere else to go. Sharing
 * the 50 MB PDF cap would reject uploads at sizes the routing had just decided
 * the server must handle.
 *
 * ⚠️ Multer buffers the whole upload in server memory, so this times the
 * concurrent-upload count is a real RSS ceiling. Raising it further needs
 * streaming upload first.
 */
export const MAX_DATA_UPLOAD_BYTES = 200 * 1024 * 1024;

/**
 * Key prefix for import staging blobs. Isolated from the bucket root so a
 * lifecycle/TTL rule can expire them without touching the pdf/image blobs that
 * documents serve for their whole lifetime. The blob *id* stays unprefixed —
 * `VALID_FILE_ID_PATTERN` and `document.dto.ts` both bind to its shape.
 */
export const IMPORT_KEY_PREFIX = 'imports/';

/**
 * Days after which a staged import blob expires.
 *
 * These are read once, server-side, minutes after upload; nothing references
 * them afterwards and no document can (`VALID_FILE_ID_PATTERN` excludes them),
 * so without an expiry every import would leak up to `MAX_DATA_UPLOAD_BYTES`
 * permanently. A day of slack covers a retry the user comes back to.
 */
export const IMPORT_EXPIRY_DAYS = 1;
