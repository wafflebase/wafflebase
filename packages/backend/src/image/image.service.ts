import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

/**
 * Map from validated MIME type → canonical storage extension. Deriving the
 * extension from the MIME type (rather than the client-provided filename)
 * ensures that the object key matches its true content, so retrieval
 * validation (`VALID_ID_PATTERN`) does not reject correctly uploaded files
 * when the client sent a mismatched filename (e.g. `foo.bmp` for a PNG).
 */
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Extensions that can appear in a *stored* id, which is a superset of the ones
 * `upload` writes: `VALID_IMAGE_ID_PATTERN` accepts `jpeg` as well as `jpg`.
 */
const SERVABLE_EXTS = new Set([...Object.values(MIME_TO_EXT), 'jpeg']);

@Injectable()
export class ImageService implements OnModuleInit {
  private s3: S3Client;
  private bucket: string;
  private prefix: string;
  private maxFileSize: number;
  private allowedMimeTypes: string[];

  constructor(private config: ConfigService) {
    const endpoint = this.config.get<string>('image.endpoint')!;
    const region = this.config.get<string>('image.region')!;
    const accessKey = this.config.get<string>('image.accessKey')!;
    const secretKey = this.config.get<string>('image.secretKey')!;
    this.bucket = this.config.get<string>('image.bucket')!;
    // Trim surrounding separators so `wafflebase`, `wafflebase/` and
    // `/wafflebase/` all name the same namespace instead of producing keys
    // with an empty segment (`wafflebase//<id>`).
    this.prefix = (this.config.get<string>('image.prefix') ?? '').replace(
      /^\/+|\/+$/g,
      '',
    );
    this.maxFileSize = this.config.get<number>('image.maxFileSizeBytes')!;
    this.allowedMimeTypes = this.config.get<string[]>(
      'image.allowedMimeTypes',
    )!;

    this.s3 = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      forcePathStyle: true, // Required for MinIO
    });
  }

  /**
   * Prepend the configured storage prefix so a deployment can namespace its
   * objects inside a shared bucket. Applied to every S3 call (composing on the
   * outside of the caller's own `keyPrefix`), while the id returned to callers
   * stays bare — the prefix is purely a storage-layout concern.
   *
   * Like the bucket and endpoint it sits beside, the prefix describes where a
   * deployment's objects live and is fixed for that deployment's lifetime:
   * changing it after uploads orphans the objects written under the old one.
   */
  private storageKey(key: string): string {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch (err) {
        // Bucket creation may fail during tests or when storage is unreachable.
        // Log and continue so the module can still boot.

        console.warn(
          `[ImageService] Failed to ensure bucket "${this.bucket}":`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  async upload(
    file: Buffer,
    mimeType: string,
    _originalName: string,
    keyPrefix?: string,
  ): Promise<{ id: string; url: string }> {
    if (!this.allowedMimeTypes.includes(mimeType)) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }
    if (file.length > this.maxFileSize) {
      throw new BadRequestException(
        `File too large (max ${this.maxFileSize / 1024 / 1024} MB)`,
      );
    }

    // Derive the stored extension from the validated MIME type rather than
    // the client-provided filename. A PNG sent as `foo.bmp` would otherwise
    // be stored with a `.bmp` suffix and later fail ID-pattern validation
    // on retrieval.
    const ext = MIME_TO_EXT[mimeType];
    if (!ext) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }
    const id = `${randomUUID()}.${ext}`;
    const key = keyPrefix ? `${keyPrefix}/${id}` : id;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.storageKey(key),
        Body: file,
        ContentType: mimeType,
      }),
    );

    return { id, url: `/images/${key}` };
  }

  /**
   * Server-side copy of a stored object into a new id, optionally under a
   * different key prefix — how an image follows a document across a workspace
   * boundary (docs/design/template-gallery.md).
   *
   * `sourceId` is the *stored key* as it appears after the prefix, so it
   * carries the source's own `{workspaceId}/` segment when there is one; the
   * copy is written under `keyPrefix` instead, or at the bucket root without
   * one. Both go through `storageKey`, so a deployment's configured prefix
   * applies to each exactly as it does everywhere else.
   *
   * `CopyObject` rather than get-then-put: the bytes never enter this process,
   * so a 25 MB image costs no heap and no second transfer.
   */
  async copy(sourceId: string, keyPrefix?: string): Promise<string> {
    const ext = sourceId.split('.').pop()?.toLowerCase();
    // `SERVABLE_EXTS`, not `MIME_TO_EXT`'s values: `.jpeg` is stored by nobody
    // but is *served* (`VALID_IMAGE_ID_PATTERN` admits it), so refusing it here
    // would make an image that renders perfectly a permanent "could not be
    // copied" — and, under the `fail` policy, a permanent abort.
    if (!ext || !SERVABLE_EXTS.has(ext)) {
      throw new BadRequestException(`Unsupported image reference: ${sourceId}`);
    }
    const id = `${randomUUID()}.${ext}`;
    const key = keyPrefix ? `${keyPrefix}/${id}` : id;
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: this.storageKey(key),
        // Each segment is encoded separately: `CopySource` is a path, so an
        // encoded `/` would stop naming the same object.
        CopySource: `${this.bucket}/${this.storageKey(sourceId)}`
          .split('/')
          .map(encodeURIComponent)
          .join('/'),
      }),
    );
    return id;
  }

  /**
   * The stored size of an object, in bytes.
   *
   * Exists for the re-hosting budget: `CopyObject` never brings the bytes into
   * this process, so a byte ceiling cannot be measured from the copy itself —
   * a `HeadObject` first is the only way to bound what one request may write.
   */
  async size(id: string): Promise<number> {
    const response = await this.s3.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.storageKey(id),
      }),
    );
    return response.ContentLength ?? 0;
  }

  async getObject(
    id: string,
  ): Promise<{ body: Uint8Array; contentType: string }> {
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.storageKey(id),
      }),
    );
    const body = response.Body
      ? await (
          response.Body as { transformToByteArray: () => Promise<Uint8Array> }
        ).transformToByteArray()
      : new Uint8Array();
    return {
      body,
      contentType: response.ContentType || 'application/octet-stream',
    };
  }

  async delete(id: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.storageKey(id),
      }),
    );
  }
}
