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

@Injectable()
export class ImageService implements OnModuleInit {
  private s3: S3Client;
  private bucket: string;
  private maxFileSize: number;
  private allowedMimeTypes: string[];

  constructor(private config: ConfigService) {
    const endpoint = this.config.get<string>('image.endpoint')!;
    const region = this.config.get<string>('image.region')!;
    const accessKey = this.config.get<string>('image.accessKey')!;
    const secretKey = this.config.get<string>('image.secretKey')!;
    this.bucket = this.config.get<string>('image.bucket')!;
    this.maxFileSize = this.config.get<number>('image.maxFileSizeBytes')!;
    this.allowedMimeTypes = this.config.get<string[]>('image.allowedMimeTypes')!;

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
        // Bucket creation may fail during tests or when storage is unreachable.
        // Log and continue so the module can still boot.
        // eslint-disable-next-line no-console
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
    originalName: string,
  ): Promise<{ id: string; url: string }> {
    if (!this.allowedMimeTypes.includes(mimeType)) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }
    if (file.length > this.maxFileSize) {
      throw new BadRequestException(
        `File too large (max ${this.maxFileSize / 1024 / 1024} MB)`,
      );
    }

    const ext = originalName.split('.').pop() || 'bin';
    const id = randomUUID();
    const key = `${id}.${ext}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file,
        ContentType: mimeType,
      }),
    );

    return { id: key, url: `/images/${key}` };
  }

  async getObject(
    id: string,
  ): Promise<{ body: Uint8Array; contentType: string }> {
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: id,
      }),
    );
    const body = response.Body
      ? await (response.Body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray()
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
        Key: id,
      }),
    );
  }
}
