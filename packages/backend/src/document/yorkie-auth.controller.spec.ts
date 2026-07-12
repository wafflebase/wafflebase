import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { YorkieAuthController } from './yorkie-auth.controller';
import { AuthService, YorkieTokenPayload } from '../auth/auth.service';
import { DocumentService } from './document.service';
import { ShareLinkService } from '../share-link/share-link.service';
import { WorkspaceService } from '../workspace/workspace.service';

/**
 * Builds a controller with configurable stubs. `token` is decoded straight to
 * the given identity (or throws for the token `'bad'`); the DB is a couple of
 * in-memory maps.
 */
function makeController(opts: {
  enforce?: boolean;
  identity?: YorkieTokenPayload | 'throw';
  doc?: { id: string; workspaceId: string } | null;
  members?: Set<number>;
  share?: { documentId: string; role: string } | 'throw';
}) {
  const authService = {
    verifyYorkieToken: jest.fn((): YorkieTokenPayload => {
      if (!opts.identity || opts.identity === 'throw') {
        throw new Error('invalid');
      }
      return opts.identity;
    }),
  } as unknown as AuthService;

  const documentService = {
    document: jest.fn().mockResolvedValue(opts.doc ?? null),
  } as unknown as DocumentService;

  const workspaceService = {
    assertMember: jest.fn(async (_ws: string, userId: number) => {
      if (!opts.members?.has(userId)) {
        throw new ForbiddenException('not a member');
      }
      return {} as never;
    }),
  } as unknown as WorkspaceService;

  const shareLinkService = {
    findByToken: jest.fn(async () => {
      if (!opts.share || opts.share === 'throw') {
        throw new Error('not found');
      }
      return opts.share as never;
    }),
  } as unknown as ShareLinkService;

  const configService = {
    get: jest.fn((k: string) =>
      k === 'YORKIE_AUTH_WEBHOOK_ENFORCE' && opts.enforce ? 'true' : undefined,
    ),
  } as unknown as ConfigService;

  return new YorkieAuthController(
    authService,
    documentService,
    workspaceService,
    shareLinkService,
    configService,
  );
}

describe('YorkieAuthController.decide', () => {
  it('always allows DetachDocument, even with a bad token', async () => {
    const c = makeController({ identity: 'throw' });
    expect(await c.decide({ method: 'DetachDocument', token: 'bad' })).toEqual({
      status: 200,
      allowed: true,
      reason: 'ok',
    });
  });

  it('401s on an invalid/expired token for a doc method', async () => {
    const c = makeController({ identity: 'throw' });
    const d = await c.decide({
      method: 'PushPull',
      token: 'bad',
      attributes: [{ key: 'sheet-1', verb: 'r' }],
    });
    expect(d).toMatchObject({ status: 401, allowed: false });
  });

  it('allows ActivateClient with only a valid token', async () => {
    const c = makeController({ identity: { typ: 'yorkie', sub: 1 } });
    expect(await c.decide({ method: 'ActivateClient', token: 't' })).toMatchObject({
      status: 200,
      allowed: true,
    });
  });

  it('grants a workspace member read+write', async () => {
    const c = makeController({
      identity: { typ: 'yorkie', sub: 7 },
      doc: { id: '1', workspaceId: 'ws' },
      members: new Set([7]),
    });
    expect(
      await c.decide({
        method: 'PushPull',
        token: 't',
        attributes: [{ key: 'sheet-1', verb: 'rw' }],
      }),
    ).toMatchObject({ status: 200, allowed: true });
  });

  it('403s a non-member', async () => {
    const c = makeController({
      identity: { typ: 'yorkie', sub: 9 },
      doc: { id: '1', workspaceId: 'ws' },
      members: new Set([7]),
    });
    expect(
      await c.decide({
        method: 'PushPull',
        token: 't',
        attributes: [{ key: 'sheet-1', verb: 'r' }],
      }),
    ).toMatchObject({ status: 403, allowed: false });
  });

  it('lets a share viewer read but not write', async () => {
    const base = {
      identity: { typ: 'yorkie-share', shareToken: 's' } as YorkieTokenPayload,
      doc: { id: '1', workspaceId: 'ws' },
      share: { documentId: '1', role: 'viewer' },
    };
    const read = await makeController(base).decide({
      method: 'PushPull',
      token: 't',
      attributes: [{ key: 'sheet-1', verb: 'r' }],
    });
    const write = await makeController(base).decide({
      method: 'PushPull',
      token: 't',
      attributes: [{ key: 'sheet-1', verb: 'rw' }],
    });
    expect(read).toMatchObject({ status: 200, allowed: true });
    expect(write).toMatchObject({ status: 403, allowed: false });
  });

  it('lets a share editor write', async () => {
    const c = makeController({
      identity: { typ: 'yorkie-share', shareToken: 's' },
      doc: { id: '1', workspaceId: 'ws' },
      share: { documentId: '1', role: 'editor' },
    });
    expect(
      await c.decide({
        method: 'PushPull',
        token: 't',
        attributes: [{ key: 'sheet-1', verb: 'rw' }],
      }),
    ).toMatchObject({ status: 200, allowed: true });
  });

  it('403s a share token bound to a different document', async () => {
    const c = makeController({
      identity: { typ: 'yorkie-share', shareToken: 's' },
      doc: { id: '1', workspaceId: 'ws' },
      share: { documentId: 'other', role: 'editor' },
    });
    expect(
      await c.decide({
        method: 'PushPull',
        token: 't',
        attributes: [{ key: 'sheet-1', verb: 'r' }],
      }),
    ).toMatchObject({ status: 403, allowed: false });
  });

  it('403s an unknown document-key prefix', async () => {
    const c = makeController({ identity: { typ: 'yorkie', sub: 1 } });
    expect(
      await c.decide({
        method: 'PushPull',
        token: 't',
        attributes: [{ key: 'bogus-1', verb: 'r' }],
      }),
    ).toMatchObject({ status: 403, allowed: false, reason: 'unknown document key' });
  });

  it('fails closed (403) on a document method with no attributes', async () => {
    const c = makeController({ identity: { typ: 'yorkie', sub: 1 } });
    expect(
      await c.decide({ method: 'PushPull', token: 't', attributes: [] }),
    ).toMatchObject({ status: 403, allowed: false });
  });

  it('403s when the document does not exist', async () => {
    const c = makeController({
      identity: { typ: 'yorkie', sub: 1 },
      doc: null,
      members: new Set([1]),
    });
    expect(
      await c.decide({
        method: 'PushPull',
        token: 't',
        attributes: [{ key: 'sheet-missing', verb: 'r' }],
      }),
    ).toMatchObject({ status: 403, allowed: false });
  });
});

describe('YorkieAuthController.handleAuth (shadow vs enforce)', () => {
  function mockRes() {
    const res = { status: jest.fn() } as unknown as Response;
    return res;
  }

  it('returns the real deny status when enforcing', async () => {
    const c = makeController({ enforce: true, identity: 'throw' });
    const res = mockRes();
    const body = await c.handleAuth(
      { method: 'PushPull', token: 'bad', attributes: [{ key: 'sheet-1', verb: 'r' }] },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(body.allowed).toBe(false);
  });

  it('lets denied traffic through (200) in shadow mode', async () => {
    const c = makeController({ enforce: false, identity: 'throw' });
    const res = mockRes();
    const body = await c.handleAuth(
      { method: 'PushPull', token: 'bad', attributes: [{ key: 'sheet-1', verb: 'r' }] },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(body.allowed).toBe(true);
  });
});
