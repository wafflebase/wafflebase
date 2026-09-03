import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { ApiV1ImagesController } from './images.controller';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { ImageService } from '../../image/image.service';
import { imageConfig } from '../../image/image.config';

describe('ApiV1ImagesController.upload', () => {
  // The cap the *service* enforces. This route's Multer limit has to be the
  // same number, or the two v1/non-v1 upload routes disagree about what "too
  // large" means while ending in the same `ImageService.upload` call. That is
  // exactly what happened: this route hardcoded the un-adjusted 10 MB, so an
  // image of exactly 10 MB succeeded through `POST /images` and 413'd here.
  const cap = imageConfig().maxFileSizeBytes;
  const base = '/api/v1/workspaces/ws-1/images';
  const upload = jest.fn();
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ApiV1ImagesController],
      providers: [{ provide: ImageService, useValue: { upload } }],
    })
      .overrideGuard(CombinedAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceScopeGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ApiKeyWriteScopeGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer() as App;

  beforeEach(() => {
    upload.mockReset();
    upload.mockResolvedValue({ id: 'x.png', url: '/images/x.png' });
  });

  it('accepts a body at exactly the cap, matching POST /images', async () => {
    // Busboy trips at `fileSize === limits.fileSize`, so a limit set to the cap
    // unadjusted rejects exactly-`cap` bytes — which `ImageService.upload`
    // (`length > cap`) accepts, and which the sibling route accepts.
    const res = await request(server())
      .post(base)
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
      .attach('file', Buffer.alloc(cap + 1024), {
        filename: 'big.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      statusCode: 413,
      message: 'File too large',
    });
    // The strongest available proof the body was cut short: the handler never
    // ran, so nothing downstream ever held the oversized buffer.
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects a MIME type outside the shared allowlist', async () => {
    // The `fileFilter` reads `ALLOWED_IMAGE_MIME_TYPES`, the same array
    // `image.config.ts` derives `image.allowedMimeTypes` from — so this route
    // and the service cannot disagree about which types exist.
    const res = await request(server())
      .post(base)
      .attach('file', Buffer.from('<svg/>'), {
        filename: 'x.svg',
        contentType: 'image/svg+xml',
      });

    expect(res.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it('still accepts every MIME type on the allowlist', async () => {
    for (const [contentType, filename] of [
      ['image/png', 'a.png'],
      ['image/jpeg', 'a.jpg'],
      ['image/gif', 'a.gif'],
      ['image/webp', 'a.webp'],
    ]) {
      upload.mockClear();
      const res = await request(server())
        .post(base)
        .attach('file', Buffer.alloc(8), { filename, contentType });
      expect(res.status).toBe(201);
      expect(upload).toHaveBeenCalled();
    }
  });

  it('still answers 400 when no file part is present', async () => {
    const res = await request(server()).post(base);
    expect(res.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });
});
