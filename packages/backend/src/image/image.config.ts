import { registerAs } from '@nestjs/config';

// MinIO defaults are only applied when NODE_ENV is not 'production'. In
// production the fallbacks are empty strings so that misconfiguration fails
// fast on bucket access instead of silently authenticating with predictable
// credentials.
const isDev = process.env.NODE_ENV !== 'production';

export const imageConfig = registerAs('image', () => ({
  endpoint:
    process.env.IMAGE_STORAGE_ENDPOINT ||
    (isDev ? 'http://localhost:9000' : ''),
  bucket:
    process.env.IMAGE_STORAGE_BUCKET || (isDev ? 'wafflebase-images' : ''),
  region: process.env.IMAGE_STORAGE_REGION || (isDev ? 'us-east-1' : ''),
  accessKey:
    process.env.IMAGE_STORAGE_ACCESS_KEY || (isDev ? 'minioadmin' : ''),
  secretKey:
    process.env.IMAGE_STORAGE_SECRET_KEY || (isDev ? 'minioadmin' : ''),
  // Optional object-key prefix so a deployment can namespace its images inside
  // a bucket shared with another app. Empty (default) keeps keys at the root.
  prefix: process.env.IMAGE_STORAGE_PREFIX || '',
  maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
}));
