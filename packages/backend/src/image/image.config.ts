import { registerAs } from '@nestjs/config';

export const imageConfig = registerAs('image', () => ({
  endpoint: process.env.IMAGE_STORAGE_ENDPOINT || 'http://localhost:9000',
  bucket: process.env.IMAGE_STORAGE_BUCKET || 'wafflebase-images',
  region: process.env.IMAGE_STORAGE_REGION || 'us-east-1',
  accessKey: process.env.IMAGE_STORAGE_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.IMAGE_STORAGE_SECRET_KEY || 'minioadmin',
  maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
}));
