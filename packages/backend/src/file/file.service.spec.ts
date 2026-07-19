import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileService } from './file.service';
import { MAX_IMAGE_UPLOAD_BYTES } from './file.constants';

function makeService(): FileService {
  const values: Record<string, unknown> = {
    'file.endpoint': 'http://localhost:9000',
    'file.region': 'us-east-1',
    'file.accessKey': 'minioadmin',
    'file.secretKey': 'minioadmin',
    'file.bucket': 'wafflebase-files',
    'file.maxFileSizeBytes': 50 * 1024 * 1024,
    'file.allowedMimeTypes': [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
    ],
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService;
  return new FileService(config);
}

describe('FileService.upload validation', () => {
  it('rejects a disallowed mime type', async () => {
    const svc = makeService();
    await expect(
      svc.upload(Buffer.from('x'), 'application/zip'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a file over the size cap', async () => {
    const svc = makeService();
    const tooBig = Buffer.alloc(50 * 1024 * 1024 + 1);
    await expect(svc.upload(tooBig, 'application/pdf')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('FileService.upload image support', () => {
  it('rejects an image over the 25 MB cap even though Multer allows 50 MB', async () => {
    const svc = makeService();
    const tooBig = Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1);
    await expect(svc.upload(tooBig, 'image/png')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an unknown mime type not in the allow-list', async () => {
    const svc = makeService();
    await expect(
      svc.upload(Buffer.from('x'), 'image/svg+xml'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
