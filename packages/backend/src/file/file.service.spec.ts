import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PutObjectCommand,
  CopyObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
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
    CopyObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
    CreateBucketCommand: jest.fn(),
    HeadBucketCommand: jest.fn(),
  };
});

function makeService(prefix = ''): FileService {
  const values: Record<string, unknown> = {
    'file.endpoint': 'http://localhost:9000',
    'file.region': 'us-east-1',
    'file.accessKey': 'minioadmin',
    'file.secretKey': 'minioadmin',
    'file.bucket': 'wafflebase-files',
    'file.prefix': prefix,
    'file.maxFileSizeBytes': 50 * 1024 * 1024,
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService;
  return new FileService(config);
}

function lastKey(command: unknown): string {
  const calls = (command as jest.Mock).mock.calls as Array<[{ Key: string }]>;
  return calls[calls.length - 1][0].Key;
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

describe('FileService storage prefix', () => {
  beforeEach(() => jest.clearAllMocks());

  it('leaves the object key bare when no prefix is configured', async () => {
    const svc = makeService();
    const { id } = await svc.upload(Buffer.from('x'), 'text/plain', 'a.txt');
    expect(lastKey(PutObjectCommand)).toBe(id);
    await svc.getObject(id);
    expect(lastKey(GetObjectCommand)).toBe(id);
    await svc.delete(id);
    expect(lastKey(DeleteObjectCommand)).toBe(id);
  });

  it('prepends the configured prefix on upload, get, and delete', async () => {
    const svc = makeService('wafflebase');
    const { id } = await svc.upload(Buffer.from('x'), 'text/plain', 'a.txt');
    // The id returned to callers (and persisted) stays bare...
    expect(id).not.toContain('/');
    // ...while every S3 call re-derives the prefixed storage key.
    expect(lastKey(PutObjectCommand)).toBe(`wafflebase/${id}`);
    await svc.getObject(id);
    expect(lastKey(GetObjectCommand)).toBe(`wafflebase/${id}`);
    await svc.delete(id);
    expect(lastKey(DeleteObjectCommand)).toBe(`wafflebase/${id}`);
  });

  it.each(['wafflebase/', '/wafflebase', '/wafflebase/'])(
    'normalizes surrounding separators in %p to one namespace',
    async (configured) => {
      const svc = makeService(configured);
      const { id } = await svc.upload(Buffer.from('x'), 'text/plain', 'a.txt');
      expect(lastKey(PutObjectCommand)).toBe(`wafflebase/${id}`);
    },
  );

  it('stays bare when the prefix is only separators', async () => {
    const svc = makeService('/');
    const { id } = await svc.upload(Buffer.from('x'), 'text/plain', 'a.txt');
    expect(lastKey(PutObjectCommand)).toBe(id);
  });
});

describe('FileService.copy', () => {
  it('copies to a fresh id that keeps the source extension', async () => {
    const svc = makeService();
    const newId = await svc.copy('aaaaaaaa-1111.pdf');
    expect(newId).toMatch(/\.pdf$/);
    expect(newId).not.toBe('aaaaaaaa-1111.pdf');
    const args = (CopyObjectCommand as unknown as jest.Mock).mock.calls.at(-1)![0];
    expect(args).toMatchObject({
      Bucket: 'wafflebase-files',
      Key: newId,
      CopySource: encodeURIComponent(`wafflebase-files/${'aaaaaaaa-1111.pdf'}`),
    });
  });

  it('copies an extension-less blob', async () => {
    const svc = makeService();
    const newId = await svc.copy('aaaaaaaa-1111');
    expect(newId).not.toContain('.');
  });

  it('applies the storage prefix to both source and destination', async () => {
    const svc = makeService('wafflebase');
    const newId = await svc.copy('aaaaaaaa-1111.png');
    const args = (CopyObjectCommand as unknown as jest.Mock).mock.calls.at(-1)![0];
    expect(args.Key).toBe(`wafflebase/${newId}`);
    expect(args.CopySource).toBe(
      encodeURIComponent('wafflebase-files/wafflebase/aaaaaaaa-1111.png'),
    );
  });
});
