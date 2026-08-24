import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiV1ImageReadController } from './image-read.controller';

const VALID_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png';

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

function makeController(overrides: {
  imageService?: object;
  workspaceService?: object;
  shareLinkService?: object;
}) {
  const imageService = overrides.imageService ?? {
    getObject: jest.fn().mockResolvedValue({
      body: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
    }),
  };
  const workspaceService = overrides.workspaceService ?? {
    resolveId: jest.fn(async (id: string) => id),
    assertMember: jest.fn().mockResolvedValue({}),
  };
  const shareLinkService = overrides.shareLinkService ?? {
    findByToken: jest.fn(),
  };
  return new ApiV1ImageReadController(
    imageService as never,
    workspaceService as never,
    shareLinkService as never,
  );
}

describe('ApiV1ImageReadController.get', () => {
  it('rejects an id that does not match the image id pattern', async () => {
    const getObject = jest.fn();
    const ctrl = makeController({ imageService: { getObject } });
    await expect(
      ctrl.get('w1', 'not-a-valid-id', undefined, {} as never, makeRes() as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(getObject).not.toHaveBeenCalled();
  });

  it('serves the bytes to a workspace member (JWT)', async () => {
    const assertMember = jest.fn().mockResolvedValue({});
    const getObject = jest.fn().mockResolvedValue({
      body: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
    });
    const ctrl = makeController({
      workspaceService: {
        resolveId: jest.fn(async (id: string) => id),
        assertMember,
      },
      imageService: { getObject },
    });
    const res = makeRes();
    await ctrl.get('w1', VALID_ID, undefined, { user: { id: '7' } } as never, res as never);
    expect(assertMember).toHaveBeenCalledWith('w1', 7);
    expect(getObject).toHaveBeenCalledWith(`w1/${VALID_ID}`);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.headers['Cache-Control']).toContain('private');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.end).toHaveBeenCalled();
  });

  it('serves the bytes to an anonymous viewer holding a token for a doc in this workspace', async () => {
    const findByToken = jest
      .fn()
      .mockResolvedValue({ documentId: 'd1', document: { workspaceId: 'w1' } });
    const getObject = jest.fn().mockResolvedValue({
      body: new Uint8Array([9]),
      contentType: 'image/png',
    });
    const ctrl = makeController({
      shareLinkService: { findByToken },
      workspaceService: { resolveId: jest.fn(async (id: string) => id) },
      imageService: { getObject },
    });
    const res = makeRes();
    await ctrl.get('w1', VALID_ID, 'tok', { user: undefined } as never, res as never);
    expect(findByToken).toHaveBeenCalledWith('tok');
    expect(getObject).toHaveBeenCalledWith(`w1/${VALID_ID}`);
    expect(res.end).toHaveBeenCalled();
  });

  it('forbids an anonymous viewer whose token belongs to another workspace', async () => {
    const findByToken = jest
      .fn()
      .mockResolvedValue({ documentId: 'd1', document: { workspaceId: 'OTHER' } });
    const getObject = jest.fn();
    const ctrl = makeController({
      shareLinkService: { findByToken },
      workspaceService: { resolveId: jest.fn(async (id: string) => id) },
      imageService: { getObject },
    });
    await expect(
      ctrl.get('w1', VALID_ID, 'tok', { user: undefined } as never, makeRes() as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(getObject).not.toHaveBeenCalled();
  });

  it('forbids an anonymous viewer with no token', async () => {
    const getObject = jest.fn();
    const ctrl = makeController({
      workspaceService: { resolveId: jest.fn(async (id: string) => id) },
      imageService: { getObject },
    });
    await expect(
      ctrl.get('w1', VALID_ID, undefined, { user: undefined } as never, makeRes() as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(getObject).not.toHaveBeenCalled();
  });

  it('serves the bytes to a workspace-scoped API key', async () => {
    const getObject = jest.fn().mockResolvedValue({
      body: new Uint8Array([1]),
      contentType: 'image/webp',
    });
    const ctrl = makeController({
      workspaceService: { resolveId: jest.fn(async (id: string) => id) },
      imageService: { getObject },
    });
    const res = makeRes();
    await ctrl.get(
      'w1',
      VALID_ID,
      undefined,
      { user: { isApiKey: true, workspaceId: 'w1' } } as never,
      res as never,
    );
    expect(getObject).toHaveBeenCalledWith(`w1/${VALID_ID}`);
    expect(res.end).toHaveBeenCalled();
  });

  it('forbids an API key scoped to a different workspace', async () => {
    const getObject = jest.fn();
    const ctrl = makeController({
      workspaceService: { resolveId: jest.fn(async (id: string) => id) },
      imageService: { getObject },
    });
    await expect(
      ctrl.get(
        'w1',
        VALID_ID,
        undefined,
        { user: { isApiKey: true, workspaceId: 'OTHER' } } as never,
        makeRes() as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(getObject).not.toHaveBeenCalled();
  });

  it('lets a logged-in non-member fall through to a valid share token', async () => {
    const assertMember = jest
      .fn()
      .mockRejectedValue(new ForbiddenException('not a member'));
    const findByToken = jest
      .fn()
      .mockResolvedValue({ documentId: 'd1', document: { workspaceId: 'w1' } });
    const getObject = jest.fn().mockResolvedValue({
      body: new Uint8Array([1]),
      contentType: 'image/png',
    });
    const ctrl = makeController({
      workspaceService: {
        resolveId: jest.fn(async (id: string) => id),
        assertMember,
      },
      shareLinkService: { findByToken },
      imageService: { getObject },
    });
    const res = makeRes();
    await ctrl.get('w1', VALID_ID, 'tok', { user: { id: '7' } } as never, res as never);
    expect(assertMember).toHaveBeenCalled();
    expect(findByToken).toHaveBeenCalledWith('tok');
    expect(res.end).toHaveBeenCalled();
  });

  it('404s when the object is missing', async () => {
    const getObject = jest.fn().mockRejectedValue(new Error('no such key'));
    const ctrl = makeController({
      workspaceService: {
        resolveId: jest.fn(async (id: string) => id),
        assertMember: jest.fn().mockResolvedValue({}),
      },
      imageService: { getObject },
    });
    await expect(
      ctrl.get('w1', VALID_ID, undefined, { user: { id: '7' } } as never, makeRes() as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
