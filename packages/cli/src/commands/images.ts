import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
  forwardUpstreamError,
} from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';
import { seg } from '../client/url.js';
import { writeBinary } from '../output/binary.js';
import { resolveDownloadTarget } from '../files/download.js';
import { extensionOf, mimeTypeFor } from '../files/upload.js';
import { SystemError, UserError } from '../errors.js';

/**
 * Mirrors the `fileFilter` allow-list in
 * `packages/backend/src/api/v1/images.controller.ts`. Checked client-side so a
 * `.svg` or a `.pdf` fails before its bytes go over the wire, and — more to the
 * point — so `--dry-run` refuses to preview a request the server would reject.
 */
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

/**
 * Mirrors the `limits.fileSize` of that same controller's `FileInterceptor`
 * (10 MB). Deliberately *not* `MAX_IMAGE_UPLOAD_BYTES` from `../files/upload.js`
 * — that 25 MB cap belongs to the blob-document endpoint. The workspace image
 * bucket is the tighter one, and quoting the wrong number here would let the
 * CLI promise an upload the server drops.
 */
export const MAX_WORKSPACE_IMAGE_BYTES = 10 * 1024 * 1024;

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * `images` — the workspace image bucket that the slides / board / docs
 * renderers fetch embedded images from. Workspace-scoped, not document-scoped:
 * there is no `--tab` here, and no document id, because an image blob has no
 * link back to the document that embeds it (that reference lives in the CRDT).
 */
export function registerImagesCommand(program: Command) {
  const images = program
    .command('images')
    .alias('image')
    .description('Upload, download, and delete workspace images');

  images
    .command('upload <file>')
    .description('Upload an image (png, jpeg, gif, or webp) to the workspace')
    .action(async function (this: Command, file: string) {
      const opts = getGlobalOpts(this);
      const fileName = basename(file);
      const mimeType = mimeTypeFor(fileName);

      try {
        // Everything below the dry-run branch is validation, and it is
        // deliberately ABOVE it: a dry run that prints a body the server would
        // reject is worse than no dry run at all, since its whole job is to
        // show what would happen.
        if (file === '-') {
          throw new UserError(
            'STDIN_UNSUPPORTED',
            'images upload needs a real path: the multipart part is named after the file and its content type comes from the extension, and stdin has neither.',
          );
        }
        if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
          const ext = extensionOf(fileName);
          throw new UserError(
            'UNSUPPORTED_IMAGE_TYPE',
            `"${fileName}" is not a supported image${ext ? ` (.${ext})` : ''}. The server accepts png, jpeg, gif, and webp.`,
          );
        }

        let size: number;
        try {
          size = statSync(file).size;
        } catch {
          throw new UserError('FILE_NOT_FOUND', `Cannot read "${file}".`);
        }
        if (size > MAX_WORKSPACE_IMAGE_BYTES) {
          throw new UserError(
            'FILE_TOO_LARGE',
            `"${fileName}" is ${mb(size)} MB; the image limit is ${mb(MAX_WORKSPACE_IMAGE_BYTES)} MB.`,
          );
        }

        if (opts.dryRun) {
          // The wire body is multipart, so the preview describes the single
          // `file` part rather than pretending to be JSON. The URL comes from
          // the shared builder, so it is the URL that would be fetched.
          printDryRun(getConfig(opts), 'POST', '/images', {
            file: `<${size} bytes of ${fileName}>`,
          });
          return;
        }

        // Narrowed before the request: a rejected `--format` must not discard
        // the id of an image that is already stored in the bucket — nothing in
        // the response can be asked for a second time.
        const fmt = parseOutputFormat(opts.format);

        // `statSync` succeeding does not mean the bytes are readable: a
        // directory stats fine and then fails with EISDIR.
        let bytes: Uint8Array;
        try {
          bytes = readFileSync(file);
        } catch (err) {
          throw new UserError(
            'FILE_READ_FAILED',
            `Cannot read "${file}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        const res = await getClient(opts).uploadImage(bytes, fileName, mimeType);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  images
    .command('get <image-id> [out]')
    .description(
      'Download an image (out: path, - for stdout; default: the image id)',
    )
    .option('--force', 'Overwrite existing output file', false)
    .action(async function (this: Command, imageId: string, out?: string) {
      const opts = getGlobalOpts(this);
      const { force } = this.opts<{ force: boolean }>();

      try {
        // Inside the try, and there is no `--format` narrowing to sit ahead
        // of: the preview is built from an id, and `seg()` refuses a `.` /
        // `..` one. That refusal has to reach `outputError` as the error
        // envelope rather than escape the handler as a rejected action
        // promise. `--format` is not read at all here — the result is bytes,
        // which `writeBinary` emits verbatim, exactly as `files download`
        // does; there is nothing for `output()` to render.
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'GET', `/images/${seg(imageId)}`);
          return;
        }

        const res = await getClient(opts).downloadImage(imageId);
        if (!res.ok) {
          return forwardUpstreamError(
            { status: res.status, data: res.data },
            this,
          );
        }
        if (!res.bytes) {
          // A response that succeeded but carried no body is still a failure,
          // but not an upstream *error* — reporting it as `HTTP 200` would
          // tell an agent the opposite of what happened. The server said yes
          // and sent nothing, which is a server fault, so it takes the
          // system-error class rather than blaming the caller's arguments.
          throw new SystemError(
            'HTTP_ERROR',
            `HTTP ${res.status} carried no image content for image ${imageId}`,
          );
        }

        // The image read route sends no `Content-Disposition` (see
        // `image-read.controller.ts`), so in practice the name falls through
        // to the id. `resolveDownloadTarget` is still what reduces it to a
        // bare filename: the id comes straight from argv, and one spelled
        // `../../.bashrc` must not decide where the CLI writes.
        const target = resolveDownloadTarget(out, res.fileName, imageId);
        writeBinary(res.bytes, target, { force, quiet: opts.quiet });
      } catch (e) {
        outputError(e, this);
      }
    });

  images
    .command('delete <image-id>')
    .description('Delete an image from the workspace image bucket')
    .action(async function (this: Command, imageId: string) {
      const opts = getGlobalOpts(this);

      try {
        // Inside the try, ahead of `--format` validation: the preview is
        // built from an id, and `seg()` refuses a `.` / `..` one. That
        // refusal has to reach `outputError` as the error envelope rather
        // than escape the handler as a rejected action promise.
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'DELETE', `/images/${seg(imageId)}`);
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).deleteImage(imageId);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}
