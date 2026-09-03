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
