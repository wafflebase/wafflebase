import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID } from 'crypto';
import { Readable } from 'stream';

const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEFAULT_BUCKET_NAME = 'wafflebase-assets';
const DEFAULT_REGION = 'us-east-1';
const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const ASSET_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const IMAGE_MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
};
const EMPTY_PAYLOAD_HASH = sha256Hex('');

type RequestTarget = {
  url: URL;
  host: string;
  canonicalUri: string;
};

export type UploadedImageAsset = {
  key: string;
  contentType: string;
  size: number;
};

export type ImageUploadFile = {
  mimetype: string;
  size: number;
  buffer: Buffer;
  originalname?: string;
};

export type StoredImageObject = {
  body: Readable;
  contentType: string;
  cacheControl: string;
  contentLength?: number;
};

@Injectable()
export class AssetService implements OnModuleInit {
  private readonly logger = new Logger(AssetService.name);
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint: URL | null;
  private readonly forcePathStyle: boolean;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly sessionToken?: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket =
      this.configService.get<string>('ASSET_STORAGE_BUCKET') ||
      DEFAULT_BUCKET_NAME;
    this.region =
      this.configService.get<string>('ASSET_STORAGE_REGION') || DEFAULT_REGION;

    const endpoint = this.configService.get<string>('ASSET_STORAGE_ENDPOINT');
    this.endpoint = endpoint ? new URL(endpoint) : null;

    const forcePathStyleFromEnv = this.getBooleanEnv(
      'ASSET_STORAGE_FORCE_PATH_STYLE',
    );
    this.forcePathStyle =
      forcePathStyleFromEnv !== undefined
        ? forcePathStyleFromEnv
        : this.endpoint !== null;

    const accessKeyId = this.configService.get<string>('ASSET_STORAGE_ACCESS_KEY');
    const secretAccessKey = this.configService.get<string>(
      'ASSET_STORAGE_SECRET_KEY',
    );
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        'ASSET_STORAGE_ACCESS_KEY and ASSET_STORAGE_SECRET_KEY are required',
      );
    }

    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken =
      this.configService.get<string>('ASSET_STORAGE_SESSION_TOKEN') || undefined;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBucketExists();
    } catch (error) {
      this.logger.warn(
        'Skipping asset bucket verification during startup. Upload attempts may fail until storage is reachable.',
      );
      this.logger.debug((error as Error).message);
    }
  }

  async uploadImage(file: ImageUploadFile): Promise<UploadedImageAsset> {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    if (!this.isAllowedImageMimeType(file.mimetype)) {
      throw new BadRequestException(
        'Only JPEG, PNG, GIF, WEBP, and AVIF images are supported',
      );
    }

    if (file.size <= 0) {
      throw new BadRequestException('Image file is empty');
    }

    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      throw new BadRequestException('Image must be 10MB or smaller');
    }

    if (!file.buffer) {
      throw new InternalServerErrorException('Image buffer was not provided');
    }

    const key = this.buildImageKey(file.mimetype);

    const response = await this.sendSignedRequest({
      method: 'PUT',
      key,
      body: file.buffer,
      contentType: file.mimetype,
      cacheControl: IMAGE_CACHE_CONTROL,
    });

    if (response.status !== 200) {
      const detail = await safeReadText(response);
      this.logger.error(`Failed to upload image: ${response.status} ${detail}`);
      throw new InternalServerErrorException('Failed to upload image');
    }

    return {
      key,
      contentType: file.mimetype,
      size: file.size,
    };
  }

  async getImage(key: string): Promise<StoredImageObject> {
    if (!ASSET_KEY_PATTERN.test(key)) {
      throw new BadRequestException('Invalid asset key');
    }

    const response = await this.sendSignedRequest({
      method: 'GET',
      key,
    });

    if (response.status === 404) {
      throw new NotFoundException('Image not found');
    }

    if (response.status !== 200) {
      const detail = await safeReadText(response);
      this.logger.error(`Failed to fetch image: ${response.status} ${detail}`);
      throw new InternalServerErrorException('Failed to fetch image');
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const contentLengthHeader = response.headers.get('content-length');
    const parsedLength = contentLengthHeader
      ? Number(contentLengthHeader)
      : undefined;

    return {
      body: Readable.from(bytes),
      contentType:
        response.headers.get('content-type') || 'application/octet-stream',
      cacheControl:
        response.headers.get('cache-control') || IMAGE_CACHE_CONTROL,
      contentLength:
        parsedLength !== undefined && Number.isFinite(parsedLength)
          ? parsedLength
          : undefined,
    };
  }

  private async ensureBucketExists(): Promise<void> {
    const headResponse = await this.sendSignedRequest({
      method: 'HEAD',
      key: null,
    });

    if (headResponse.status === 200) {
      return;
    }

    if (headResponse.status !== 404) {
      const detail = await safeReadText(headResponse);
      this.logger.warn(
        `Could not verify bucket "${this.bucket}" (${headResponse.status} ${detail}). Upload attempts may fail.`,
      );
      return;
    }

    const createResponse = await this.sendSignedRequest({
      method: 'PUT',
      key: null,
      body:
        this.region === DEFAULT_REGION
          ? undefined
          : buildCreateBucketXml(this.region),
      contentType: 'application/xml',
    });

    if (createResponse.status >= 200 && createResponse.status < 300) {
      this.logger.log(`Created asset bucket "${this.bucket}"`);
      return;
    }

    if (createResponse.status === 409) {
      return;
    }

    const detail = await safeReadText(createResponse);
    this.logger.warn(
      `Failed to create asset bucket "${this.bucket}" (${createResponse.status} ${detail}). Upload attempts may fail.`,
    );
  }

  private async sendSignedRequest({
    method,
    key,
    body,
    contentType,
    cacheControl,
  }: {
    method: 'GET' | 'PUT' | 'HEAD';
    key: string | null;
    body?: Buffer | string;
    contentType?: string;
    cacheControl?: string;
  }): Promise<Response> {
    const target = this.buildRequestTarget(key);
    const payloadHash = body === undefined ? EMPTY_PAYLOAD_HASH : sha256Hex(body);

    const signed = this.buildSignedHeaders({
      method,
      target,
      payloadHash,
      contentType,
      cacheControl,
    });

    try {
      return await fetch(target.url, {
        method,
        headers: signed,
        body,
      });
    } catch (error) {
      this.logger.error('Asset storage request failed', error as Error);
      throw new InternalServerErrorException('Asset storage request failed');
    }
  }

  private buildRequestTarget(key: string | null): RequestTarget {
    if (this.endpoint) {
      const baseHost = this.endpoint.host;
      const host = this.forcePathStyle
        ? baseHost
        : `${this.bucket}.${baseHost}`;
      const pathParts = this.forcePathStyle ? [this.bucket] : [];
      if (key) {
        pathParts.push(key);
      }
      const canonicalUri = buildCanonicalUri(pathParts);
      const url = new URL(canonicalUri, `${this.endpoint.protocol}//${host}`);
      return { url, host, canonicalUri };
    }

    const baseHost =
      this.region === DEFAULT_REGION
        ? 's3.amazonaws.com'
        : `s3.${this.region}.amazonaws.com`;
    const host = this.forcePathStyle ? baseHost : `${this.bucket}.${baseHost}`;
    const pathParts = this.forcePathStyle ? [this.bucket] : [];
    if (key) {
      pathParts.push(key);
    }
    const canonicalUri = buildCanonicalUri(pathParts);
    const url = new URL(`https://${host}${canonicalUri}`);
    return { url, host, canonicalUri };
  }

  private buildSignedHeaders({
    method,
    target,
    payloadHash,
    contentType,
    cacheControl,
  }: {
    method: 'GET' | 'PUT' | 'HEAD';
    target: RequestTarget;
    payloadHash: string;
    contentType?: string;
    cacheControl?: string;
  }): Record<string, string> {
    const now = new Date();
    const amzDate = formatAmzDate(now);
    const dateStamp = formatDateStamp(now);
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;

    const canonicalHeaders: Record<string, string> = {
      host: target.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };

    if (contentType) {
      canonicalHeaders['content-type'] = contentType;
    }

    if (cacheControl) {
      canonicalHeaders['cache-control'] = cacheControl;
    }

    if (this.sessionToken) {
      canonicalHeaders['x-amz-security-token'] = this.sessionToken;
    }

    const sortedHeaderNames = Object.keys(canonicalHeaders).sort();
    const canonicalHeaderString = sortedHeaderNames
      .map((name) => `${name}:${canonicalHeaders[name].trim()}\n`)
      .join('');
    const signedHeaders = sortedHeaderNames.join(';');

    const canonicalRequest = [
      method,
      target.canonicalUri,
      '',
      canonicalHeaderString,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = this.getSigningKey(dateStamp);
    const signature = hmacHex(signingKey, stringToSign);

    return {
      ...canonicalHeaders,
      Authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  private getSigningKey(dateStamp: string): Buffer {
    const kDate = hmacBuffer(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmacBuffer(kDate, this.region);
    const kService = hmacBuffer(kRegion, 's3');
    return hmacBuffer(kService, 'aws4_request');
  }

  private buildImageKey(mimeType: string): string {
    const extension = IMAGE_MIME_TO_EXTENSION[mimeType] || '.bin';
    return `${randomUUID()}${extension}`;
  }

  private isAllowedImageMimeType(mimeType: string): boolean {
    return IMAGE_MIME_TO_EXTENSION[mimeType] !== undefined;
  }

  private getBooleanEnv(name: string): boolean | undefined {
    const raw = this.configService.get<string>(name);
    if (raw === undefined || raw === '') {
      return undefined;
    }
    return raw.trim().toLowerCase() === 'true';
  }
}

function buildCanonicalUri(parts: string[]): string {
  const encoded = parts.map((part) =>
    part
      .split('/')
      .map((segment) => encodeRfc3986(segment))
      .join('/'),
  );
  return `/${encoded.join('/')}`;
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function formatAmzDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function formatDateStamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmacBuffer(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function hmacHex(key: string | Buffer, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

function buildCreateBucketXml(region: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>${region}</LocationConstraint></CreateBucketConfiguration>`;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
