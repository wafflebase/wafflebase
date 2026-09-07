import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApiV1ShareImageUploadController } from './image-share-upload.controller';

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
