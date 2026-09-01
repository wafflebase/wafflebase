import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ImageController } from './image.controller';

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
