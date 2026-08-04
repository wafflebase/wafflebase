import { registerAs } from '@nestjs/config';
import { MAX_PDF_UPLOAD_BYTES } from './file.constants';

// Mirrors image.config.ts. MinIO dev defaults apply only outside production;
// in production the fallbacks are empty strings (rather than predictable
// credentials), so a misconfigured deployment surfaces as an explicit S3
// error on first use instead of silently authenticating with dev creds.
const isDev = process.env.NODE_ENV !== 'production';

export const fileConfig = registerAs('file', () => ({
  endpoint:
    process.env.FILE_STORAGE_ENDPOINT || (isDev ? 'http://localhost:9000' : ''),
  bucket: process.env.FILE_STORAGE_BUCKET || (isDev ? 'wafflebase-files' : ''),
  region: process.env.FILE_STORAGE_REGION || (isDev ? 'us-east-1' : ''),
  accessKey: process.env.FILE_STORAGE_ACCESS_KEY || (isDev ? 'minioadmin' : ''),
  secretKey: process.env.FILE_STORAGE_SECRET_KEY || (isDev ? 'minioadmin' : ''),
  maxFileSizeBytes: MAX_PDF_UPLOAD_BYTES,
  allowedMimeTypes: [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    // Data files staged for a backend-parsed sheet import. Unlike the types
    // above these are never served back to a browser — `file-import` reads
    // them server-side and the resulting document holds cells, not a blob.
    'text/csv',
    'text/tab-separated-values',
  ],
}));
