import { ForbiddenException, Logger } from '@nestjs/common';
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
    assertMember: jest.fn((_ws: string, userId: number) => {
      if (!opts.members?.has(userId)) {
        throw new ForbiddenException('not a member');
      }
      return {} as never;
    }),
  } as unknown as WorkspaceService;

  const shareLinkService = {
    findByToken: jest.fn(() => {
      if (!opts.share || opts.share === 'throw') {
        throw new Error('not found');
      }
      return opts.share as never;
    }),
  } as unknown as ShareLinkService;

  // Enforcing is the default, so "shadow" is the case that has to say so:
  // `enforce: false` sets the variable to the literal `'false'`, and leaving
  // it out leaves the variable unset — which enforces.
  const configService = {
    get: jest.fn((k: string) =>
      k === 'YORKIE_AUTH_WEBHOOK_ENFORCE' && opts.enforce === false
        ? 'false'
        : undefined,
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

// The controller states its enforcement posture at construction, so every
// `makeController` below would print it. Silence both levels by default; the
// posture tests read the spies instead.
let logSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

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
    expect(
      await c.decide({ method: 'ActivateClient', token: 't' }),
    ).toMatchObject({
      status: 200,
      allowed: true,
    });
  });

  // The backend's own client (`YorkieService`) carries a `yorkie-service`
  // token. Without this branch, enforcement denies every server-side attach —
  // the v1 content endpoints, document copy, template seeding — because there
  // is no user or share link behind them to resolve.
  // An *unscoped* service token — no `key` — is the operator credential the
  // ops scripts mint: they walk many documents through one long-lived client,
  // so there is no single key to pin.
  it('allows an unscoped backend service token on any document, read or write', async () => {
    const c = makeController({ identity: { typ: 'yorkie-service' } });
    expect(
      await c.decide({
        method: 'PushPull',
        token: 'service',
        attributes: [{ key: 'sheet-anything', verb: 'rw' }],
      }),
    ).toMatchObject({ status: 200, allowed: true });
  });

  // Every request path (`YorkieService.withDocument`) mints a token bound to
  // the one document its client attaches to, so the credential the SDK puts
  // on the wire is worth that document and nothing else.
  it('allows a scoped service token on its own document', async () => {
    const c = makeController({
      identity: { typ: 'yorkie-service', key: 'sheet-1' },
    });
    expect(
      await c.decide({
        method: 'PushPull',
        token: 'service',
        attributes: [{ key: 'sheet-1', verb: 'rw' }],
      }),
    ).toMatchObject({ status: 200, allowed: true });
  });

  it('403s a scoped service token on another document', async () => {
    const c = makeController({
      identity: { typ: 'yorkie-service', key: 'sheet-1' },
    });
    expect(
      await c.decide({
        method: 'PushPull',
        token: 'service',
        attributes: [{ key: 'sheet-2', verb: 'rw' }],
      }),
    ).toMatchObject({ status: 403, allowed: false });
  });

  it('403s a scoped service token when one of several keys is foreign', async () => {
    const c = makeController({
      identity: { typ: 'yorkie-service', key: 'sheet-1' },
    });
    expect(
      await c.decide({
        method: 'PushPull',
        token: 'service',
        attributes: [
          { key: 'sheet-1', verb: 'r' },
          { key: 'sheet-2', verb: 'r' },
        ],
      }),
    ).toMatchObject({ status: 403, allowed: false });
  });

  it('403s a scoped service token on a doc method with no attributes', async () => {
    const c = makeController({
      identity: { typ: 'yorkie-service', key: 'sheet-1' },
    });
    expect(
      await c.decide({ method: 'PushPull', token: 'service' }),
    ).toMatchObject({ status: 403, allowed: false });
  });

  it('allows a scoped service token to activate its client', async () => {
    const c = makeController({
      identity: { typ: 'yorkie-service', key: 'sheet-1' },
    });
    expect(
      await c.decide({ method: 'ActivateClient', token: 'service' }),
    ).toMatchObject({ status: 200, allowed: true });
  });

  it('still refuses a service token that does not verify', async () => {
    const c = makeController({ identity: 'throw' });
    expect(
      await c.decide({
        method: 'PushPull',
        token: 'forged',
        attributes: [{ key: 'sheet-1', verb: 'rw' }],
      }),
    ).toMatchObject({ status: 401, allowed: false });
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

  // Yorkie sends `AttachDocument` with verb `rw` unconditionally (see
  // READ_GATED_METHODS and test/revision-history.e2e-spec.ts), so honoring
  // that verb under enforcement would deny a viewer share link its very first
  // attach — breaking viewer links outright on any deployment that registered
  // the method. Attach is therefore gated on read.
  it('lets a share viewer attach even though attach claims rw', async () => {
    const c = makeController({
      identity: { typ: 'yorkie-share', shareToken: 's' },
      doc: { id: '1', workspaceId: 'ws' },
      share: { documentId: '1', role: 'viewer' },
    });
    expect(
      await c.decide({
        method: 'AttachDocument',
        token: 't',
        attributes: [{ key: 'note-1', verb: 'rw' }],
      }),
    ).toMatchObject({ status: 200, allowed: true });
  });

  // Read-gating attach must not turn it into a blanket allow: somebody with no
  // access at all is still refused, and PushPull still refuses the viewer's
  // writes.
  it('still 403s an attach by a share token bound to another document', async () => {
    const c = makeController({
      identity: { typ: 'yorkie-share', shareToken: 's' },
      doc: { id: '1', workspaceId: 'ws' },
      share: { documentId: 'other', role: 'viewer' },
    });
    expect(
      await c.decide({
        method: 'AttachDocument',
        token: 't',
        attributes: [{ key: 'note-1', verb: 'rw' }],
      }),
    ).toMatchObject({ status: 403, allowed: false });
  });

  it('keeps refusing a viewer PushPull write after a permitted attach', async () => {
    const base = {
      identity: { typ: 'yorkie-share', shareToken: 's' } as YorkieTokenPayload,
      doc: { id: '1', workspaceId: 'ws' },
      share: { documentId: '1', role: 'viewer' },
    };
    expect(
      await makeController(base).decide({
        method: 'PushPull',
        token: 't',
        attributes: [{ key: 'note-1', verb: 'rw' }],
      }),
    ).toMatchObject({ status: 403, allowed: false });
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
    ).toMatchObject({
      status: 403,
      allowed: false,
      reason: 'unknown document key',
    });
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
    // Return the status spy separately so assertions reference the bound spy,
    // not `res.status` as an unbound method.
    const status = jest.fn();
    const res = { status } as unknown as Response;
    return { res, status };
  }

  it('returns the real deny status when enforcing', async () => {
    const c = makeController({ enforce: true, identity: 'throw' });
    const { res, status } = mockRes();
    const body = await c.handleAuth(
      {
        method: 'PushPull',
        token: 'bad',
        attributes: [{ key: 'sheet-1', verb: 'r' }],
      },
      res,
    );
    expect(status).toHaveBeenCalledWith(401);
    expect(body.allowed).toBe(false);
  });

  // The default decides whether a share-link viewer's write is refused on a
  // deployment that registered the webhook methods and configured nothing
  // else. It is the only place that write is refused at all, so the default
  // has to be the one that refuses it: shadow mode is opt-in, not the floor.
  it('enforces when YORKIE_AUTH_WEBHOOK_ENFORCE is unset', async () => {
    const c = new YorkieAuthController(
      { verifyYorkieToken: () => ({ typ: 'yorkie-share', shareToken: 's' }) } as unknown as AuthService,
      { document: jest.fn() } as unknown as DocumentService,
      {} as unknown as WorkspaceService,
      {
        findByToken: () => ({ documentId: '1', role: 'viewer' }),
      } as unknown as ShareLinkService,
      { get: () => undefined } as unknown as ConfigService,
    );
    const { res, status } = mockRes();
    const body = await c.handleAuth(
      {
        method: 'PushPull',
        token: 't',
        attributes: [{ key: 'note-1', verb: 'rw' }],
      },
      res,
    );
    expect(status).toHaveBeenCalledWith(403);
    expect(body.allowed).toBe(false);
  });

  // A mistyped opt-out must land on the side that denies: a denial gets
  // noticed, an accidental bypass does not.
  it.each([
    ['FALSE', false],
    [' false ', false],
    ['0', true],
    ['flase', true],
    ['', true],
    ['true', true],
  ])('reads %p as enforcing=%p', async (raw, enforcing) => {
    const c = new YorkieAuthController(
      { verifyYorkieToken: () => { throw new Error('invalid'); } } as unknown as AuthService,
      {} as unknown as DocumentService,
      {} as unknown as WorkspaceService,
      {} as unknown as ShareLinkService,
      { get: () => raw } as unknown as ConfigService,
    );
    const { res, status } = mockRes();
    await c.handleAuth(
      {
        method: 'PushPull',
        token: 'bad',
        attributes: [{ key: 'note-1', verb: 'rw' }],
      },
      res,
    );
    expect(status).toHaveBeenCalledWith(enforcing ? 401 : 200);
  });

  it('lets denied traffic through (200) in shadow mode', async () => {
    const c = makeController({ enforce: false, identity: 'throw' });
    const { res, status } = mockRes();
    const body = await c.handleAuth(
      {
        method: 'PushPull',
        token: 'bad',
        attributes: [{ key: 'sheet-1', verb: 'r' }],
      },
      res,
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(body.allowed).toBe(true);
  });

  // A shadow-mode install enforces nothing, and the write it lets through is
  // the one nothing else refuses: a share-link viewer's. Both of these pin the
  // *signal*, not the policy — a deployment must be able to tell from its own
  // logs that it is unprotected, rather than inferring it from an absence of
  // denials. See docs/design/yorkie-auth-webhook.md § Risks.
  it('says at construction that shadow mode enforces nothing', () => {
    makeController({ enforce: false });
    const said = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(said).toContain('SHADOW mode');
    expect(said).toContain('NOT enforced');
  });

  it('says at construction when it is enforcing, and does not warn', () => {
    makeController({ enforce: true });
    expect(logSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
      'enforcing per-document access',
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('names the document and verb it would have denied', async () => {
    const c = makeController({
      enforce: false,
      identity: { typ: 'yorkie-share', shareToken: 's' },
      share: { documentId: '1', role: 'viewer' },
    });
    const { res } = mockRes();
    await c.handleAuth(
      {
        method: 'PushPull',
        token: 't',
        attributes: [{ key: 'note-1', verb: 'rw' }],
      },
      res,
    );
    const said = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(said).toContain('[shadow] would deny');
    expect(said).toContain('target=note-1:rw');
    // The token is a bearer credential and must never join the target in a log.
    expect(said).not.toContain('token=');
  });
});

describe('YorkieAuthController.decide (revision methods)', () => {
  // Yorkie validates webhook registration against a method enum that does
  // contain all four `*Revision` names, so a deployment can register them —
  // and must, along with `YORKIE_AUTH_WEBHOOK_ENFORCE=true`, before version
  // history is safe to enable. Once registered they reach `decide()` exactly
  // like any other document-scoped method and are authorized by the same
  // fall-through `checkAttribute` path PushPull uses above — with one
  // deliberate exception, `REVISION_READ_METHODS`, which
  // requires editor-or-member authority despite carrying verb `r`. These
  // tests pin both, so a future refactor can't silently reopen the hole they
  // close today: see docs/design/revision-history.md §2.
  const documentId = '1';
  const key = `doc-${documentId}`;

  function memberController() {
    return makeController({
      identity: { typ: 'yorkie', sub: 7 },
      doc: { id: documentId, workspaceId: 'ws' },
      members: new Set([7]),
    });
  }

  function viewerShareController() {
    return makeController({
      identity: { typ: 'yorkie-share', shareToken: 's' },
      doc: { id: documentId, workspaceId: 'ws' },
      share: { documentId, role: 'viewer' },
    });
  }

  function editorShareController() {
    return makeController({
      identity: { typ: 'yorkie-share', shareToken: 's' },
      doc: { id: documentId, workspaceId: 'ws' },
      share: { documentId, role: 'editor' },
    });
  }

  it.each([
    ['ListRevisions', 'r'],
    ['GetRevision', 'r'],
    ['CreateRevision', 'rw'],
    ['RestoreRevision', 'rw'],
  ])('allows a workspace member on %s (%s)', async (method, verb) => {
    const decision = await memberController().decide({
      token: 't',
      method,
      attributes: [{ key, verb: verb as 'r' | 'rw' }],
    });
    expect(decision).toMatchObject({ status: 200, allowed: true });
  });

  // The regression this whole feature exists behind: a viewer share link
  // must never be able to roll a document back or read its history.
  it.each(['CreateRevision', 'RestoreRevision'])(
    'denies a viewer share link on %s',
    async (method) => {
      const decision = await viewerShareController().decide({
        token: 't',
        method,
        attributes: [{ key, verb: 'rw' }],
      });
      expect(decision).toMatchObject({ allowed: false, status: 403 });
    },
  );

  // The other half of that sentence, and the half a plain verb check gets
  // wrong: `getRevision` hands back a full snapshot of every past state,
  // including content deleted before the link was shared. Verb `r` alone
  // would let a viewer through.
  it.each(['ListRevisions', 'GetRevision'])(
    'denies a viewer share link on %s even though its verb is read',
    async (method) => {
      const decision = await viewerShareController().decide({
        token: 't',
        method,
        attributes: [{ key, verb: 'r' }],
      });
      expect(decision).toMatchObject({ allowed: false, status: 403 });
    },
  );

  // ...and the people who must keep it. Denying a viewer is only correct if
  // it does not also deny the users the panel is built for.
  it.each(['ListRevisions', 'GetRevision'])(
    'still allows a share-link editor on %s',
    async (method) => {
      const decision = await editorShareController().decide({
        token: 't',
        method,
        attributes: [{ key, verb: 'r' }],
      });
      expect(decision).toMatchObject({ allowed: true, status: 200 });
    },
  );

  // (A workspace member is already covered for all four methods by the
  // `allows a workspace member on %s (%s)` case above, which passes
  // `ListRevisions`/`GetRevision` with verb `r`.)

  // The rule is scoped to the revision reads, not to verb `r` at large: an
  // ordinary read (PushPull/Watch) must still work for a viewer, which is
  // the whole point of a viewer share link.
  it('leaves an ordinary read open to a viewer share link', async () => {
    const decision = await viewerShareController().decide({
      token: 't',
      method: 'PushPull',
      attributes: [{ key, verb: 'r' }],
    });
    expect(decision).toMatchObject({ allowed: true, status: 200 });
  });

  it('denies an unknown document key on ListRevisions', async () => {
    const decision = await memberController().decide({
      token: 't',
      method: 'ListRevisions',
      attributes: [{ key: 'not-a-doc-key', verb: 'r' }],
    });
    expect(decision).toMatchObject({
      status: 403,
      allowed: false,
      reason: 'unknown document key',
    });
  });

  it('denies a revision method carrying no document attributes', async () => {
    const decision = await memberController().decide({
      token: 't',
      method: 'RestoreRevision',
      attributes: [],
    });
    expect(decision).toMatchObject({ allowed: false, status: 403 });
  });
});
