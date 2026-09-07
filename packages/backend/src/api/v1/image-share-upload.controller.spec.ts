import {
  BadRequestException,
  ForbiddenException,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { ApiV1ShareImageUploadController } from './image-share-upload.controller';
import { ImageService } from '../../image/image.service';
import { ShareLinkService } from '../../share-link/share-link.service';
import { imageConfig } from '../../image/image.config';

const IMAGE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png';

function pngFile(): Express.Multer.File {
  return {
    buffer: Buffer.from([1, 2, 3]),
    mimetype: 'image/png',
    originalname: 'shot.png',
  } as Express.Multer.File;
}

function makeController(link?: unknown) {
  const upload = jest.fn().mockResolvedValue({ id: IMAGE_ID, url: '/unused' });
  const findByToken = jest.fn().mockResolvedValue(link);
  const ctrl = new ApiV1ShareImageUploadController(
    { upload } as never,
    { findByToken } as never,
  );
  return { ctrl, upload, findByToken };
}

const editorLink = {
  role: 'editor',
  document: { workspaceId: 'ws-from-token' },
};

describe('ApiV1ShareImageUploadController.upload', () => {
  it('stores the image under the workspace the token resolves to', async () => {
    const { ctrl, upload } = makeController(editorLink);

    const res = await ctrl.upload(pngFile(), 'tok');

    expect(upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/png',
      'shot.png',
      'ws-from-token',
    );
    expect(res).toEqual({
      id: IMAGE_ID,
      url: `/api/v1/workspaces/ws-from-token/images/${IMAGE_ID}`,
    });
  });

  it('does not bake the token into the returned URL', async () => {
    // The URL is stored in the CRDT and read by every other viewer plus the
    // author; the token is appended per-viewer at render time instead.
    const { ctrl } = makeController(editorLink);
    const { url } = await ctrl.upload(pngFile(), 'sh4re-secret');
    expect(url).not.toContain('sh4re-secret');
  });

  it('refuses a viewer-role link', async () => {
    const { ctrl, upload } = makeController({
      role: 'viewer',
      document: { workspaceId: 'ws-from-token' },
    });

    await expect(ctrl.upload(pngFile(), 'tok')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses a request with no token', async () => {
    const { ctrl, upload, findByToken } = makeController(editorLink);

    await expect(ctrl.upload(pngFile(), undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(findByToken).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses an editor link whose document is gone', async () => {
    const { ctrl, upload } = makeController({ role: 'editor', document: null });

    await expect(ctrl.upload(pngFile(), 'tok')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects a request with no file before resolving the token', async () => {
    const { ctrl, findByToken } = makeController(editorLink);

    await expect(
      ctrl.upload(undefined as unknown as Express.Multer.File, 'tok'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findByToken).not.toHaveBeenCalled();
  });

  it('propagates what findByToken throws for an expired or unknown token', async () => {
    const upload = jest.fn();
    const gone = new Error('Share link has expired');
    const ctrl = new ApiV1ShareImageUploadController(
      { upload } as never,
      { findByToken: jest.fn().mockRejectedValue(gone) } as never,
    );

    await expect(ctrl.upload(pngFile(), 'tok')).rejects.toBe(gone);
    expect(upload).not.toHaveBeenCalled();
  });
});

/**
 * The blob bounds live in the `@UseInterceptors(FileInterceptor(...))`
 * decorator, so calling `upload()` directly never runs them — the cases above
 * hand the handler a file Multer would already have refused. These go over
 * HTTP, which is the only way this route's `fileSize` limit and MIME
 * `fileFilter` are exercised at all, and mirror what
 * `images.controller.spec.ts` pins for the authenticated sibling: the two
 * routes share `IMAGE_UPLOAD_MULTER_LIMIT_BYTES` and
 * `ALLOWED_IMAGE_MIME_TYPES`, so they must refuse the same bodies with the
 * same wording.
 */
describe('POST /api/v1/shared/images (multipart bounds)', () => {
  const cap = imageConfig().maxFileSizeBytes;
  const base = '/api/v1/shared/images';
  const upload = jest.fn();
  const findByToken = jest.fn();
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ApiV1ShareImageUploadController],
      providers: [
        { provide: ImageService, useValue: { upload } },
        { provide: ShareLinkService, useValue: { findByToken } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer() as App;

  beforeEach(() => {
    upload.mockReset();
    upload.mockResolvedValue({ id: IMAGE_ID, url: '/unused' });
    findByToken.mockReset();
    findByToken.mockResolvedValue(editorLink);
  });

  it('accepts a body at exactly the cap, matching the authenticated route', async () => {
    // Busboy trips at `fileSize === limits.fileSize`, so the shared
    // `IMAGE_UPLOAD_MULTER_LIMIT_BYTES` is the cap `+ 1`; an image of exactly
    // the cap must still get through here.
    const res = await request(server())
      .post(base)
      .query({ token: 'tok' })
      .attach('file', Buffer.alloc(cap), {
        filename: 'exact.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);
    expect(upload).toHaveBeenCalled();
  });

  it('refuses an over-cap body instead of buffering all of it first', async () => {
    const res = await request(server())
      .post(base)
      .query({ token: 'tok' })
      .attach('file', Buffer.alloc(cap + 1024), {
        filename: 'big.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      statusCode: 413,
      message: 'File too large',
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects a MIME type outside the shared allowlist', async () => {
    const res = await request(server())
      .post(base)
      .query({ token: 'tok' })
      .attach('file', Buffer.from('<svg/>'), {
        filename: 'x.svg',
        contentType: 'image/svg+xml',
      });

    expect(res.status).toBe(400);
    // Written out rather than built from `unsupportedFileTypeMessage`, which
    // would pass whatever that function returned.
    expect(res.body).toMatchObject({
      statusCode: 400,
      message: 'Unsupported file type: image/svg+xml',
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('accepts every MIME type on the allowlist', async () => {
    for (const [contentType, filename] of [
      ['image/png', 'a.png'],
      ['image/jpeg', 'a.jpg'],
      ['image/gif', 'a.gif'],
      ['image/webp', 'a.webp'],
    ]) {
      upload.mockClear();
      const res = await request(server())
        .post(base)
        .query({ token: 'tok' })
        .attach('file', Buffer.alloc(8), { filename, contentType });
      expect(res.status).toBe(201);
      expect(upload).toHaveBeenCalled();
    }
  });

  it('applies the blob bounds even without a usable token', async () => {
    // Interceptors run before the handler, so a refused MIME type never
    // reaches `assertCanWrite` — the refusal is the multipart one, not 403,
    // and nothing resolves the token.
    const res = await request(server())
      .post(base)
      .attach('file', Buffer.from('<svg/>'), {
        filename: 'x.svg',
        contentType: 'image/svg+xml',
      });

    expect(res.status).toBe(400);
    expect(findByToken).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});
