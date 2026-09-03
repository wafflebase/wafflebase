export const VALID_IMAGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|gif|webp)$/i;

/**
 * The one image upload cap, in bytes.
 *
 * It lives here rather than in `image.config.ts` because two different layers
 * need it and only one of them can reach `ConfigService`: `ImageService` reads
 * it as `image.maxFileSizeBytes` at request time, while the upload routes need
 * it inside a `FileInterceptor(...)` argument — evaluated when the controller
 * class is decorated, before any injector exists. `image.config.ts` derives
 * `maxFileSizeBytes` from this constant, so the value Multer stops reading at
 * and the value the service measures against cannot drift apart.
 */
export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
