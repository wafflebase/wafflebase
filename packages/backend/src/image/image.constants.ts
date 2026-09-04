export const VALID_IMAGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|gif|webp)$/i;

/**
 * The one image upload cap, in bytes.
 *
 * It lives here rather than in `image.config.ts` because two different layers
 * need it and only one of them can reach `ConfigService`: `ImageService` reads
 * it as `image.maxFileSizeBytes` at request time, while both upload routes
 * (`POST /images` and `POST /api/v1/workspaces/:wid/images`) need it inside a
 * `FileInterceptor(...)` argument — evaluated when the controller class is
 * decorated, before any injector exists. They take it via
 * {@link IMAGE_UPLOAD_MULTER_LIMIT_BYTES}. `image.config.ts` derives
 * `maxFileSizeBytes` from this constant, so the value Multer stops reading at
 * and the value the service measures against cannot drift apart.
 */
export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * The Multer `fileSize` limit both upload routes pass to `FileInterceptor`.
 *
 * `+ 1` because the two layers count differently: busboy trips its limit at
 * `fileSize === limits.fileSize` (`busboy/lib/types/multipart.js`), so
 * `fileSize: N` accepts at most `N - 1` bytes, while `ImageService.upload`
 * rejects only `length > N`. Passing the cap unadjusted would make an image of
 * exactly 10 MB — accepted by every non-HTTP caller of `upload()` — start
 * failing with a 413 on one route and succeeding on the other.
 *
 * The limit is a bound on how much an uploader can make this process allocate,
 * not the cap itself; `ImageService` remains the one place that decides what
 * "too large" is.
 */
export const IMAGE_UPLOAD_MULTER_LIMIT_BYTES = MAX_IMAGE_UPLOAD_BYTES + 1;

/**
 * The image MIME types the service accepts, and the allowlist a route's
 * multipart `fileFilter` rejects against before any bytes are buffered.
 *
 * Same reason `MAX_IMAGE_UPLOAD_BYTES` lives here: `image.config.ts` derives
 * `allowedMimeTypes` from this array, so the list a `FileInterceptor(...)`
 * argument can reach at class-decoration time and the list `ImageService`
 * reads through `ConfigService` at request time cannot drift apart.
 */
export const ALLOWED_IMAGE_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

/**
 * The one wording for "that MIME type is not an image this service stores".
 *
 * Four call sites produce it: the `fileFilter` on each of the two upload
 * routes, and the two refusals inside `ImageService.upload` (the allowlist
 * check and the extension-map miss behind it). They are the *same* refusal
 * seen at two depths — the filters exist only to stop reading the body before
 * the service would have refused it anyway — so the message they answer with
 * is a contract between them, not four independent strings that happen to
 * match today.
 *
 * It lives here for the same reason {@link ALLOWED_IMAGE_MIME_TYPES} does: a
 * `FileInterceptor(...)` argument is evaluated at class-decoration time and
 * can reach no injector, so a route cannot ask the service what it would have
 * said. Sharing the function is what keeps "moving the check earlier changes
 * nothing a client can observe" true rather than merely true-when-written —
 * `image.constants.spec.ts` asserts this stays the only definition, and the
 * three route/service specs each pin the rendered string independently.
 */
export function unsupportedFileTypeMessage(mimeType: string): string {
  return `Unsupported file type: ${mimeType}`;
}
