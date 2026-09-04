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

function makeService(
  prefix = '',
  allowedMimeTypes: string[] = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
  ],
): ImageService {
  const values: Record<string, unknown> = {
    'image.endpoint': 'http://localhost:9000',
    'image.region': 'us-east-1',
    'image.accessKey': 'minioadmin',
    'image.secretKey': 'minioadmin',
    'image.bucket': 'wafflebase-images',
    'image.prefix': prefix,
    'image.maxFileSizeBytes': 10 * 1024 * 1024,
    'image.allowedMimeTypes': allowedMimeTypes,
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

/**
 * The other half of the shared-wording property. Both upload routes' specs
 * assert the same literal against a **mocked** `ImageService`, so on their own
 * they pin what the filters say and nothing about what the service they claim
 * to match says. These exercise the real `upload()`.
 *
 * The literal is written out here rather than built from
 * `unsupportedFileTypeMessage`, which would pass whatever that function
 * returned. Together with the two route specs it means a reworded message
 * fails in three places, one per producer.
 */
describe('ImageService.upload — the refusal both routes mirror', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses a MIME type off the allowlist with the shared wording', async () => {
    const svc = makeService();
    await expect(
      svc.upload(Buffer.from('PKnot-an-image'), 'application/zip', 'x.zip'),
    ).rejects.toThrow('Unsupported file type: application/zip');
    // Nothing was written: the refusal precedes the PutObject.
    expect(PutObjectCommand).not.toHaveBeenCalled();
  });

  it('says the same thing for an allowed type with no extension mapping', async () => {
    // The second, deeper refusal in `upload()`. Unreachable unless
    // `image.allowedMimeTypes` names a type `MIME_TO_EXT` does not, which is
    // exactly what this configuration does.
    const svc = makeService('', ['image/png', 'image/avif']);
    await expect(
      svc.upload(Buffer.from('x'), 'image/avif', 'x.avif'),
    ).rejects.toThrow('Unsupported file type: image/avif');
    expect(PutObjectCommand).not.toHaveBeenCalled();
  });
});
