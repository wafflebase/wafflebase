import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  type LifecycleRule,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import {
  IMPORT_EXPIRY_DAYS,
  IMPORT_EXTENSIONS,
  IMPORT_KEY_PREFIX,
  MAX_DATA_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
} from './file.constants';

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'text/tab-separated-values': 'tsv',
};

/**
 * Extensions whose declared MIME type cannot be trusted. Browsers disagree on
 * `.csv`: some send `text/csv`, some `application/vnd.ms-excel`, and a file
 * dragged from certain sources arrives with an empty type — so a perfectly
 * valid upload gets rejected by the allowlist.
 *
 * Only the extension is honored, never the browser's claim:
 * `application/vnd.ms-excel` is also the type of a *binary* `.xls`, so trusting
 * it would admit a format nothing here can read. This map is deliberately
 * text-table-only for that reason.
 */
const EXT_TO_MIME: Record<string, string> = {
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
};

/** Lowercased extension of a file name, or `''` when it has none. */
export function extensionOf(fileName?: string): string {
  const dot = fileName ? fileName.lastIndexOf('.') : -1;
  return dot < 0 ? '' : fileName!.slice(dot + 1).toLowerCase();
}

/** The browser's type, unless it is unrecognized and the extension is known. */
function resolveMimeType(mimeType: string, fileName?: string): string {
  if (MIME_TO_EXT[mimeType]) return mimeType;
  return EXT_TO_MIME[extensionOf(fileName)] ?? mimeType;
}

/**
 * What an upload route is willing to store, stated by the route rather than
 * inferred from the payload.
 *
 * The distinction is load-bearing because the two differ in more than taste:
 * data blobs get a 200 MB ceiling and land under the expiring `imports/`
 * prefix, documents get 50/25 MB and sit at the bucket root where a document
 * can serve them. Reading the category off the declared MIME type let a caller
 * pick which set of rules applied to it — `x.csv` announced as `image/png`
 * cleared the import route's name filter, was buffered against the 200 MB
 * limit, and only then met the 25 MB image cap; and `POST /files`, which has
 * no workspace check, could put a blob into `imports/` simply by naming it
 * `.csv`.
 */
export type UploadCategory = 'document' | 'data';

/** Extensions each category may store. The category is the narrower gate; the
 *  configured `allowedMimeTypes` remains the outer one. */
const CATEGORY_EXTENSIONS: Record<UploadCategory, ReadonlySet<string>> = {
  document: new Set(['pdf', 'png', 'jpg', 'gif', 'webp']),
  data: new Set(IMPORT_EXTENSIONS),
};

/** Identifies this service's own lifecycle rule among the bucket's others. */
const IMPORT_EXPIRY_RULE_ID = 'expire-staged-imports';

/**
 * Whether a "data" upload looks like binary rather than text. A null byte is
 * a cheap, reliable binary signal *except* for UTF-16, which pairs every
 * ASCII byte with a 0x00 one — Excel's own "Unicode Text" export, common for
 * CJK locales. Its BOM is checked first so that legitimate case is not
 * rejected as binary.
 *
 * ponytail: only the BOM'd UTF-16 case is exempted, not UTF-16 without a BOM.
 * Widen if a real upload without a BOM turns up.
 */
function looksBinary(file: Buffer): boolean {
  const hasUtf16Bom =
    (file[0] === 0xff && file[1] === 0xfe) ||
    (file[0] === 0xfe && file[1] === 0xff);
  if (hasUtf16Bom) return false;
  return file.includes(0);
}

/** Whether a blob is import staging rather than something a document serves. */
export function isDataExtension(ext: string): boolean {
  return (IMPORT_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Storage key for a blob id. Data blobs live under `imports/` so a lifecycle
 * rule can expire them; the id itself never carries the prefix, because
 * `VALID_FILE_ID_PATTERN` and the document DTOs validate its bare shape.
 */
function keyFor(id: string, workspaceId?: string): string {
  if (!isDataExtension(extensionOf(id))) return id;
  // A staged blob has no owner record anywhere — no column, no table — so the
  // key is where it gets one. Reading it back requires naming the same
  // workspace it was written under, which means a leaked id (it reaches the
  // logs on a parse failure) cannot be opened from another workspace the
  // caller happens to belong to. Wrong workspace, wrong key, `NoSuchKey` — the
  // 410 path that already exists, and no comparison to forget.
  if (!workspaceId) {
    throw new BadRequestException(
      `A data blob needs a workspace to be keyed under: ${id}`,
    );
  }
  return `${IMPORT_KEY_PREFIX}${workspaceId}/${id}`;
}


@Injectable()
export class FileService implements OnModuleInit {
  private s3: S3Client;
  private bucket: string;
  private maxFileSize: number;
  private allowedMimeTypes: string[];

  constructor(private config: ConfigService) {
    const endpoint = this.config.get<string>('file.endpoint')!;
    const region = this.config.get<string>('file.region')!;
    const accessKey = this.config.get<string>('file.accessKey')!;
    const secretKey = this.config.get<string>('file.secretKey')!;
    this.bucket = this.config.get<string>('file.bucket')!;
    this.maxFileSize = this.config.get<number>('file.maxFileSizeBytes')!;
    this.allowedMimeTypes = this.config.get<string[]>('file.allowedMimeTypes')!;

    this.s3 = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      forcePathStyle: true, // Required for MinIO
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch (err) {
        console.warn(
          `[FileService] Failed to ensure bucket "${this.bucket}":`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    await this.ensureImportExpiry();
  }

  /**
   * Expire staged import blobs.
   *
   * They are read once, server-side, and nothing keeps a reference afterwards:
   * a sheet built from a CSV stores cells, not a `fileId`, so neither the
   * document nor `dismissItem` can ever release one. Declaring the rule here
   * rather than in deployment config keeps it true for local MinIO too, where
   * the bucket is also created on boot.
   *
   * Best-effort, like the bucket creation above: a storage backend without
   * lifecycle support must not stop the server from starting. The prefix keeps
   * the rule off the pdf/image blobs documents serve for their whole lifetime.
   *
   * `PutBucketLifecycleConfiguration` *replaces* the whole configuration, so
   * this reads first and merges by rule ID. Writing the rule on its own would
   * delete every operator-managed rule on the bucket (transitions, incomplete
   * multipart cleanup, pdf/image retention) on each boot, and silently — the
   * `catch` below only warns.
   */
  private async ensureImportExpiry(): Promise<void> {
    let others: LifecycleRule[];
    let existing: LifecycleRule | undefined;
    try {
      const current = await this.s3.send(
        new GetBucketLifecycleConfigurationCommand({ Bucket: this.bucket }),
      );
      existing = (current.Rules ?? []).find(
        (rule) => rule.ID === IMPORT_EXPIRY_RULE_ID,
      );
      others = (current.Rules ?? []).filter(
        (rule) => rule.ID !== IMPORT_EXPIRY_RULE_ID,
      );
    } catch (err) {
      // A bucket with no configuration at all is the normal first-boot case,
      // and the only failure safe to read as "no rules". Anything else — a
      // network blip, a backend without lifecycle support, a permissions gap —
      // must skip the write rather than fall through with an empty base: that
      // fall-through is precisely the wipe this method exists to avoid.
      if ((err as { name?: string }).name !== 'NoSuchLifecycleConfiguration') {
        console.warn(
          `[FileService] Could not read the lifecycle configuration of ` +
            `"${this.bucket}"; leaving it untouched, so staged import blobs ` +
            'will not be reclaimed automatically:',
          err instanceof Error ? err.message : err,
        );
        return;
      }
      others = [];
    }

    // Skip the write once the rule already matches: `Put` replaces the whole
    // configuration, so paying for it on every boot/replica when nothing
    // changed is a pure round trip.
    if (
      existing?.Status === 'Enabled' &&
      existing.Filter?.Prefix === IMPORT_KEY_PREFIX &&
      existing.Expiration?.Days === IMPORT_EXPIRY_DAYS
    ) {
      return;
    }

    try {
      await this.s3.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: this.bucket,
          LifecycleConfiguration: {
            Rules: [
              ...others,
              {
                ID: IMPORT_EXPIRY_RULE_ID,
                Status: 'Enabled',
                Filter: { Prefix: IMPORT_KEY_PREFIX },
                Expiration: { Days: IMPORT_EXPIRY_DAYS },
              },
            ],
          },
        }),
      );
    } catch (err) {
      console.warn(
        `[FileService] Failed to set the "${IMPORT_KEY_PREFIX}" expiry rule; ` +
          'staged import blobs will not be reclaimed automatically:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  async upload(
    file: Buffer,
    mimeType: string,
    fileName?: string,
    options: { category?: UploadCategory; workspaceId?: string } = {},
  ): Promise<{ id: string }> {
    const category = options.category ?? 'document';
    // For data the extension decides outright. The route that asks for this
    // category has already filtered the name to csv/tsv, and honouring the
    // declared type here is what let a lying `Content-Type` move the upload
    // into another category's rules.
    const resolved =
      category === 'data'
        ? (EXT_TO_MIME[extensionOf(fileName)] ?? mimeType)
        : resolveMimeType(mimeType, fileName);
    if (!this.allowedMimeTypes.includes(resolved)) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }
    const ext = MIME_TO_EXT[resolved];
    if (!ext) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }
    if (!CATEGORY_EXTENSIONS[category].has(ext)) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }
    // The extension decides the category outright (see above), so this is the
    // only content check a data upload gets. A null byte is not valid in
    // text/CSV, so it is a cheap, reliable "this is binary, not text" signal —
    // catching a renamed non-CSV file here instead of deep inside DuckDB.
    if (category === 'data' && looksBinary(file)) {
      throw new BadRequestException(
        `File does not look like a ${resolved} file.`,
      );
    }
    // Each category gets its own cap; Multer's limit is only the outermost
    // ceiling. Data files are allowed to be the largest — they are staged for
    // the server to parse precisely because the browser cannot.
    const cap = resolved.startsWith('image/')
      ? MAX_IMAGE_UPLOAD_BYTES
      : isDataExtension(ext)
        ? MAX_DATA_UPLOAD_BYTES
        : this.maxFileSize;
    if (file.length > cap) {
      throw new BadRequestException(
        `File too large (max ${cap / 1024 / 1024} MB)`,
      );
    }
    const id = `${randomUUID()}.${ext}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: keyFor(id, options.workspaceId),
        Body: file,
        ContentType: resolved,
      }),
    );
    return { id };
  }

  /**
   * The stored object as a stream, for a reader that writes it straight to
   * disk instead of holding it.
   *
   * Separate from `getObject` rather than replacing it: that one serves pdf and
   * image bytes into an HTTP response, where the whole body is wanted anyway
   * and the caps are 50/25 MB. A staged import is up to 200 MB, and buffering
   * it only to copy it into a temp file costs that twice.
   */
  async getObjectStream(id: string, workspaceId?: string): Promise<Readable> {
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: keyFor(id, workspaceId),
      }),
    );
    if (!response.Body) {
      throw new Error(`Empty response body for ${id}`);
    }
    return response.Body as Readable;
  }

  async getObject(
    id: string,
    workspaceId?: string,
  ): Promise<{ body: Uint8Array; contentType: string }> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: keyFor(id, workspaceId) }),
    );
    const body = response.Body
      ? await (
          response.Body as { transformToByteArray: () => Promise<Uint8Array> }
        ).transformToByteArray()
      : new Uint8Array();
    return {
      body,
      contentType: response.ContentType || 'application/pdf',
    };
  }

  async delete(id: string, workspaceId?: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: keyFor(id, workspaceId),
      }),
    );
  }
}
