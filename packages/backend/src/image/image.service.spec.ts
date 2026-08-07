import { ConfigService } from '@nestjs/config';
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { ImageService } from './image.service';

// Mock the AWS SDK client the same way file.service.spec does: the real
// client relies on a dynamic import() Jest's default CJS env can't satisfy,
// so these stay true unit tests independent of a reachable MinIO.
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

function makeService(prefix = ''): ImageService {
  const values: Record<string, unknown> = {
    'image.endpoint': 'http://localhost:9000',
    'image.region': 'us-east-1',
    'image.accessKey': 'minioadmin',
    'image.secretKey': 'minioadmin',
    'image.bucket': 'wafflebase-images',
    'image.prefix': prefix,
    'image.maxFileSizeBytes': 10 * 1024 * 1024,
    'image.allowedMimeTypes': [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
    ],
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService;
  return new ImageService(config);
}

function lastKey(command: unknown): string {
  const calls = (command as jest.Mock).mock.calls as Array<[{ Key: string }]>;
  return calls[calls.length - 1][0].Key;
}

describe('ImageService storage prefix', () => {
  beforeEach(() => jest.clearAllMocks());

  it('leaves the object key bare when no prefix is configured', async () => {
    const svc = makeService();
    const { id } = await svc.upload(Buffer.from('x'), 'image/png', 'a.png');
    expect(lastKey(PutObjectCommand)).toBe(id);
    await svc.getObject(id);
    expect(lastKey(GetObjectCommand)).toBe(id);
    await svc.delete(id);
    expect(lastKey(DeleteObjectCommand)).toBe(id);
  });

  it('prepends the configured prefix on upload, get, and delete', async () => {
    const svc = makeService('wafflebase');
    const { id } = await svc.upload(Buffer.from('x'), 'image/png', 'a.png');
    expect(id).not.toContain('/');
    expect(lastKey(PutObjectCommand)).toBe(`wafflebase/${id}`);
    await svc.getObject(id);
    expect(lastKey(GetObjectCommand)).toBe(`wafflebase/${id}`);
    await svc.delete(id);
    expect(lastKey(DeleteObjectCommand)).toBe(`wafflebase/${id}`);
  });

  it('composes the config prefix outside the per-call keyPrefix', async () => {
    const svc = makeService('wafflebase');
    const { id, url } = await svc.upload(
      Buffer.from('x'),
      'image/png',
      'a.png',
      'ws-123',
    );
    // Storage key: <configPrefix>/<keyPrefix>/<id>
    expect(lastKey(PutObjectCommand)).toBe(`wafflebase/ws-123/${id}`);
    // The returned url is the logical (unprefixed) path the controller serves;
    // retrieval re-applies the config prefix via getObject.
    expect(url).toBe(`/images/ws-123/${id}`);
  });

  it.each(['wafflebase/', '/wafflebase', '/wafflebase/'])(
    'normalizes surrounding separators in %p to one namespace',
    async (configured) => {
      const svc = makeService(configured);
      const { id } = await svc.upload(Buffer.from('x'), 'image/png', 'a.png');
      expect(lastKey(PutObjectCommand)).toBe(`wafflebase/${id}`);
    },
  );

  it('stays bare when the prefix is only separators', async () => {
    const svc = makeService('/');
    const { id } = await svc.upload(Buffer.from('x'), 'image/png', 'a.png');
    expect(lastKey(PutObjectCommand)).toBe(id);
  });
});
