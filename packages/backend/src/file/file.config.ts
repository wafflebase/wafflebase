import { registerAs } from '@nestjs/config';

// Mirrors image.config.ts. MinIO dev defaults only outside production so
// misconfiguration fails fast in prod instead of using predictable creds.
const isDev = process.env.NODE_ENV !== 'production';

export const fileConfig = registerAs('file', () => ({
  endpoint:
    process.env.FILE_STORAGE_ENDPOINT || (isDev ? 'http://localhost:9000' : ''),
  bucket: process.env.FILE_STORAGE_BUCKET || (isDev ? 'wafflebase-files' : ''),
  region: process.env.FILE_STORAGE_REGION || (isDev ? 'us-east-1' : ''),
  accessKey: process.env.FILE_STORAGE_ACCESS_KEY || (isDev ? 'minioadmin' : ''),
  secretKey: process.env.FILE_STORAGE_SECRET_KEY || (isDev ? 'minioadmin' : ''),
  maxFileSizeBytes: 50 * 1024 * 1024, // 50 MB
  allowedMimeTypes: ['application/pdf'],
}));
