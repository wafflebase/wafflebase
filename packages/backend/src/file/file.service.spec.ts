import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileService } from './file.service';
import { MAX_IMAGE_UPLOAD_BYTES } from './file.constants';

// FileService talks to S3 via the AWS SDK, which relies on a dynamic
// import() internally (checksum middleware) that Jest's default CJS
// environment can't satisfy without --experimental-vm-modules. Mock the
// client so these stay true unit tests, independent of both that Jest/SDK
// interop quirk and whether a real MinIO is reachable.
jest.mock('@aws-sdk/client-s3', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    PutObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
    CreateBucketCommand: jest.fn(),
    HeadBucketCommand: jest.fn(),
  };
});

function makeService(): FileService {
  const values: Record<string, unknown> = {
    'file.endpoint': 'http://localhost:9000',
    'file.region': 'us-east-1',
    'file.accessKey': 'minioadmin',
    'file.secretKey': 'minioadmin',
    'file.bucket': 'wafflebase-files',
    'file.maxFileSizeBytes': 50 * 1024 * 1024,
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService;
  return new FileService(config);
}

describe('FileService.upload validation', () => {
  it('stores an arbitrary file type', async () => {
    const svc = makeService();
    const result = await svc.upload(
      Buffer.from('PK'),
      'application/zip',
      'archive.zip',
    );
    expect(result.id).toMatch(/\.zip$/);
    expect(result.size).toBe(2);
    expect(result.mimeType).toBe('application/zip');
  });

  it('stores a file with no usable extension without one', async () => {
    const svc = makeService();
    const result = await svc.upload(
      Buffer.from('all:'),
      'text/plain',
      'Makefile',
    );
    expect(result.id).not.toContain('.');
  });

  it('rejects a file over the size cap', async () => {
    const svc = makeService();
    const tooBig = Buffer.alloc(50 * 1024 * 1024 + 1);
    await expect(
      svc.upload(tooBig, 'application/pdf', 'report.pdf'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('FileService.upload image support', () => {
  it('rejects an image over the 25 MB cap even though Multer allows 50 MB', async () => {
    const svc = makeService();
    const tooBig = Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1);
    await expect(
      svc.upload(tooBig, 'image/png', 'photo.png'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('applies the image cap from the extension when the MIME lies', async () => {
    // Keying the cap off the MIME alone let a client declare
    // `application/octet-stream`, collect the 50 MB cap, then attach the
    // `.png` blob to an `image` document — assertFileIdAllowed only checks
    // the extension — so a 50 MB image slipped past the 25 MB limit.
    const svc = makeService();
    const tooBig = Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1);
    await expect(
      svc.upload(tooBig, 'application/octet-stream', 'photo.png'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still gives a non-image the full cap', async () => {
    const svc = makeService();
    const big = Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1);
    const result = await svc.upload(
      big,
      'application/octet-stream',
      'archive.zip',
    );
    expect(result.id).toMatch(/\.zip$/);
  });
});
