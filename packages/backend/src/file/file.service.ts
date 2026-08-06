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

@Injectable()
export class FileService implements OnModuleInit {
  private s3: S3Client;
  private bucket: string;
  private maxFileSize: number;

  constructor(private config: ConfigService) {
    const endpoint = this.config.get<string>('file.endpoint')!;
    const region = this.config.get<string>('file.region')!;
    const accessKey = this.config.get<string>('file.accessKey')!;
    const secretKey = this.config.get<string>('file.secretKey')!;
    this.bucket = this.config.get<string>('file.bucket')!;
    this.maxFileSize = this.config.get<number>('file.maxFileSizeBytes')!;

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
  }

  /**
   * Store a blob. Accepts any content — the safety rule lives on the serving
   * side (see document/file-response.util.ts), not here, because an upload-time
   * extension blacklist is defeated by renaming.
   *
   * `mimeType` is client-supplied and untrusted. It is stored as data and used
   * only to pick which size cap applies; lying can at most widen the cap to
   * MAX_FILE_UPLOAD_BYTES, which Multer already enforces.
   */
  async upload(
    file: Buffer,
    mimeType: string,
    originalName: string,
  ): Promise<{ id: string; size: number; mimeType: string }> {
    const cap = mimeType.startsWith('image/')
      ? MAX_IMAGE_UPLOAD_BYTES
      : this.maxFileSize;
    if (file.length > cap) {
      throw new BadRequestException(
        `File too large (max ${cap / 1024 / 1024} MB)`,
      );
    }
    const contentType = mimeType || 'application/octet-stream';
    const ext = safeExtension(originalName);
    const id = ext ? `${randomUUID()}.${ext}` : randomUUID();
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: id,
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
      new GetObjectCommand({ Bucket: this.bucket, Key: id }),
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
      new DeleteObjectCommand({ Bucket: this.bucket, Key: id }),
    );
  }
}
