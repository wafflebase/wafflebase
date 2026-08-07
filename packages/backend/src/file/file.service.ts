import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { MAX_IMAGE_UPLOAD_BYTES } from './file.constants';
import { safeExtension } from './file-extension.util';

/**
 * Extensions that make a blob an image for cap purposes, mirroring
 * `FILE_ID_EXT.image` in document/document-file-id.util.ts — the guard that
 * decides whether the blob may back an `image` document.
 */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

@Injectable()
export class FileService implements OnModuleInit {
  private s3: S3Client;
  private bucket: string;
  private prefix: string;
  private maxFileSize: number;

  constructor(private config: ConfigService) {
    const endpoint = this.config.get<string>('file.endpoint')!;
    const region = this.config.get<string>('file.region')!;
    const accessKey = this.config.get<string>('file.accessKey')!;
    const secretKey = this.config.get<string>('file.secretKey')!;
    this.bucket = this.config.get<string>('file.bucket')!;
    // Trim surrounding separators so `wafflebase`, `wafflebase/` and
    // `/wafflebase/` all name the same namespace instead of producing keys
    // with an empty segment (`wafflebase//<id>`).
    this.prefix = (this.config.get<string>('file.prefix') ?? '').replace(
      /^\/+|\/+$/g,
      '',
    );
    this.maxFileSize = this.config.get<number>('file.maxFileSizeBytes')!;

    this.s3 = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      forcePathStyle: true, // Required for MinIO
    });
  }

  /**
   * Prepend the configured storage prefix so a deployment can namespace its
   * objects inside a shared bucket. The prefix is a storage-layout concern:
   * the id persisted in the DB stays bare, and every S3 call re-derives the
   * key through here, so retrieval and deletion stay symmetric with upload.
   *
   * Like the bucket and endpoint it sits beside, the prefix describes where a
   * deployment's objects live and is fixed for that deployment's lifetime:
   * changing it after uploads orphans the objects written under the old one.
   */
  private storageKey(id: string): string {
    return this.prefix ? `${this.prefix}/${id}` : id;
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
  }

  /**
   * Store a blob. Accepts any content — the safety rule lives on the serving
   * side (see document/file-response.util.ts), not here, because an upload-time
   * extension blacklist is defeated by renaming.
   *
   * Both `mimeType` and `originalName` are client-supplied and untrusted.
   * Neither is a security decision: the MIME is stored as data, and the
   * extension only reaches the object key through `safeExtension`.
   */
  async upload(
    file: Buffer,
    mimeType: string,
    originalName: string,
  ): Promise<{ id: string; size: number; mimeType: string }> {
    const ext = safeExtension(originalName);
    // The image cap keys off BOTH signals on purpose. Keying off the MIME
    // alone let a client upload `photo.png` as `application/octet-stream`,
    // collect the 50 MB cap, and then attach that blob to an `image` document
    // — `assertFileIdAllowed` only checks the extension — landing a 50 MB
    // image and bypassing the 25 MB limit entirely.
    const isImage =
      mimeType.startsWith('image/') ||
      (ext !== null && IMAGE_EXTENSIONS.has(ext));
    const cap = isImage ? MAX_IMAGE_UPLOAD_BYTES : this.maxFileSize;
    if (file.length > cap) {
      throw new BadRequestException(
        `File too large (max ${cap / 1024 / 1024} MB)`,
      );
    }
    const contentType = mimeType || 'application/octet-stream';
    const id = ext ? `${randomUUID()}.${ext}` : randomUUID();
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.storageKey(id),
        Body: file,
        ContentType: contentType,
      }),
    );
    return { id, size: file.length, mimeType: contentType };
  }

  async getObject(
    id: string,
  ): Promise<{ body: Uint8Array; contentType: string }> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.storageKey(id) }),
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
