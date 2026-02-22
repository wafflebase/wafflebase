import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetService, ImageUploadFile } from './asset.service';

describe('AssetService', () => {
  let fetchMock: jest.Mock;

  const config = new ConfigService({
    ASSET_STORAGE_BUCKET: 'wafflebase-assets-test',
    ASSET_STORAGE_REGION: 'us-east-1',
    ASSET_STORAGE_ENDPOINT: 'http://localhost:9000',
    ASSET_STORAGE_FORCE_PATH_STYLE: 'true',
    ASSET_STORAGE_ACCESS_KEY: 'minioadmin',
    ASSET_STORAGE_SECRET_KEY: 'minioadmin',
  });

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects unsupported image mime types', async () => {
    const service = new AssetService(config);

    await expect(
      service.uploadImage({
        mimetype: 'application/pdf',
        size: 12,
        buffer: Buffer.from('test'),
      } as ImageUploadFile),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uploads allowed image types to object storage', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));
    const service = new AssetService(config);

    const uploaded = await service.uploadImage({
      mimetype: 'image/png',
      size: 128,
      buffer: Buffer.from('png-data'),
    } as ImageUploadFile);

    expect(uploaded.contentType).toBe('image/png');
    expect(uploaded.size).toBe(128);
    expect(uploaded.key).toMatch(/^[0-9a-f-]+\.png$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [
      URL | string,
      RequestInit,
    ];
    expect(String(requestUrl)).toContain('wafflebase-assets-test');
    expect(requestInit.method).toBe('PUT');
  });

  it('throws not found when object does not exist', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }));
    const service = new AssetService(config);

    await expect(service.getImage('missing.png')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns object stream metadata', async () => {
    fetchMock.mockResolvedValue(
      new Response('hello', {
        status: 200,
        headers: {
          'content-type': 'image/webp',
          'cache-control': 'public, max-age=60',
          'content-length': '5',
        },
      }),
    );

    const service = new AssetService(config);
    const result = await service.getImage('demo.webp');
    const chunks: Buffer[] = [];
    for await (const chunk of result.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    expect(result.contentType).toBe('image/webp');
    expect(result.cacheControl).toBe('public, max-age=60');
    expect(result.contentLength).toBe(5);
    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello');
  });

  it('rejects invalid object keys', async () => {
    const service = new AssetService(config);

    await expect(service.getImage('../invalid-key')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
