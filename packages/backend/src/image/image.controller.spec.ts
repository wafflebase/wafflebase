import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { ImageController } from './image.controller';
import { ImageService } from './image.service';
import { imageConfig } from './image.config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

function makeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    end: jest.fn(),
  };
}

function makeController(getObject: jest.Mock) {
  const imageService = { getObject } as never;
  return new ImageController(imageService);
}

describe('ImageController.get', () => {
  it('rejects an id that does not match the valid image id pattern', async () => {
    const getObject = jest.fn();
    const ctrl = makeController(getObject);
    await expect(
      ctrl.get('not-a-valid-id.png', makeRes() as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(getObject).not.toHaveBeenCalled();
  });

  it('derives Content-Type from the id extension, never from stored content', async () => {
    // The regression this guards: a shared-bucket misconfiguration (or any
    // other path) could leave `text/html` bytes stored under a
    // `uuid.png`-shaped key. This route is unauthenticated with a long-lived
    // public cache, so echoing that stored type would be live unauthenticated
    // stored XSS on the backend origin. The response must reflect the id's
    // own extension regardless of what storage claims.
    const getObject = jest.fn().mockResolvedValue({
      body: new Uint8Array([1, 2, 3]),
      contentType: 'text/html',
    });
    const ctrl = makeController(getObject);
    const res = makeRes();
    await ctrl.get('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png', res as never);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.headers['Cache-Control']).toContain('public');
    expect(res.end).toHaveBeenCalled();
  });

  it('answers 404 for an object that is not in the bucket', async () => {
    // An id outlives the object it names — a template listing stores one and
    // the bucket can be swept underneath it. An unhandled S3 `NoSuchKey`
    // surfaced as a 500 with a stack trace per stale card painted.
    const getObject = jest.fn().mockRejectedValue(
      Object.assign(new Error('The specified key does not exist.'), {
        name: 'NoSuchKey',
      }),
    );
    const ctrl = makeController(getObject);
    await expect(
      ctrl.get('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp', makeRes() as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets a storage failure stay a 500 rather than reporting it as 404', async () => {
    // Reporting an outage as "not found" is precisely the signal you need
    // during one.
    const getObject = jest
      .fn()
      .mockRejectedValue(new Error('connection reset by peer'));
    const ctrl = makeController(getObject);
    await expect(
      ctrl.get('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp', makeRes() as never),
    ).rejects.toThrow('connection reset by peer');
  });

  it('maps every accepted extension to its own image MIME type', async () => {
    const cases: Array<[string, string]> = [
      ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png', 'image/png'],
      ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg', 'image/jpeg'],
      ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpeg', 'image/jpeg'],
      ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.gif', 'image/gif'],
      ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp', 'image/webp'],
    ];
    for (const [id, expected] of cases) {
      const getObject = jest.fn().mockResolvedValue({
        body: new Uint8Array([1]),
        contentType: 'application/octet-stream',
      });
      const ctrl = makeController(getObject);
      const res = makeRes();
      await ctrl.get(id, res as never);
      expect(res.headers['Content-Type']).toBe(expected);
    }
  });
});

describe('ImageController.upload', () => {
  // The cap the *service* enforces. The route's Multer limit has to be this
  // same number, or the two disagree about what "too large" means.
  const cap = imageConfig().maxFileSizeBytes;
  const upload = jest.fn();
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ImageController],
      providers: [{ provide: ImageService, useValue: { upload } }],
    })
      .overrideGuard(JwtAuthGuard)
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

  it('refuses an over-cap body instead of buffering all of it first', async () => {
    // The route used a bare FileInterceptor with no `limits`, so the whole
    // body was read into memory and only then measured by the service. An
    // unauthenticated-adjacent multipart route must stop reading at the cap,
    // not after it — otherwise the cap bounds what is *stored*, not what an
    // uploader can make this process allocate.
    const res = await request(server())
      .post('/images')
      .attach('file', Buffer.alloc(cap + 1024), {
        filename: 'big.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(413);
    // Pinned because this is a client-visible change: the oversized upload used
    // to come back as `400 File too large (max 10 MB)` from the service. Multer
    // aborts first now, and Nest maps `LIMIT_FILE_SIZE` to this. 413 is the
    // more accurate status, and no user loses the dropped "(max 10 MB)" detail.
    // Two frontend callers reach this route: `docsImageUploader`
    // (`app/docs/export-utils.ts`), which throws `status statusText` and never
    // reads the body at all; and `postSharedImage` (`api/images.ts`), whose
    // shared `post()` helper *does* put `await res.text()` in its error — but
    // its one caller is the template thumbnail capture, which swallows every
    // non-auth error by design so a failed thumbnail cannot fail the publish
    // it rides along with. Neither path shows the body to anybody.
    expect(res.body).toMatchObject({
      statusCode: 413,
      message: 'File too large',
    });
    // The strongest available proof that the body was cut short: the handler
    // never ran, so nothing downstream ever held the oversized buffer.
    expect(upload).not.toHaveBeenCalled();
  });

  it('accepts a body at exactly the cap, so the limit is the service cap', async () => {
    // Pins the Multer limit to `image.maxFileSizeBytes` from both sides: the
    // test above fails if the route accepts more, this one if it accepts less.
    // Busboy trips at `fileSize === limits.fileSize`, so a limit set to the cap
    // unadjusted would reject exactly-10 MB — which `ImageService.upload`
    // (`length > cap`) accepts, and which every non-HTTP caller still accepts.
    const res = await request(server())
      .post('/images')
      .attach('file', Buffer.alloc(cap), {
        filename: 'exact.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);
    expect(upload).toHaveBeenCalled();
  });

  it('still answers 400 when no file part is present', async () => {
    const res = await request(server()).post('/images');
    expect(res.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });
});
