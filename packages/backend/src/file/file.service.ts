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

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
};

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
  }

  async upload(file: Buffer, mimeType: string): Promise<{ id: string }> {
    if (!this.allowedMimeTypes.includes(mimeType)) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }
    if (file.length > this.maxFileSize) {
      throw new BadRequestException(
        `File too large (max ${this.maxFileSize / 1024 / 1024} MB)`,
      );
    }
    const ext = MIME_TO_EXT[mimeType];
    if (!ext) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }
    const id = `${randomUUID()}.${ext}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: id,
        Body: file,
        ContentType: mimeType,
      }),
    );
    return { id };
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
      contentType: response.ContentType || 'application/pdf',
    };
  }

  async delete(id: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: id }),
    );
  }
}
