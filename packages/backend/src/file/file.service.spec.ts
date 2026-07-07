import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileService } from './file.service';

function makeService(): FileService {
  const values: Record<string, unknown> = {
    'file.endpoint': 'http://localhost:9000',
    'file.region': 'us-east-1',
    'file.accessKey': 'minioadmin',
    'file.secretKey': 'minioadmin',
    'file.bucket': 'wafflebase-files',
    'file.maxFileSizeBytes': 50 * 1024 * 1024,
    'file.allowedMimeTypes': ['application/pdf'],
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService;
  return new FileService(config);
}

describe('FileService.upload validation', () => {
  it('rejects a non-pdf mime type', async () => {
    const svc = makeService();
    await expect(
      svc.upload(Buffer.from('x'), 'image/png', 'x.png'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a file over the size cap', async () => {
    const svc = makeService();
    const tooBig = Buffer.alloc(50 * 1024 * 1024 + 1);
    await expect(
      svc.upload(tooBig, 'application/pdf', 'big.pdf'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
