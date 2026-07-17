import { ForbiddenException } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsProducerService } from './analytics-producer.service';
import { AnalyticsWarehouseService } from './analytics-warehouse.service';
import { ShareLinkService } from '../share-link/share-link.service';
import { PrismaService } from '../database/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';

describe('AnalyticsController ingest', () => {
  const link = {
    id: 'link-1',
    role: 'viewer',
    documentId: 'doc-1',
    document: { type: 'sheet' },
  };
  function setup() {
    const produced: unknown[] = [];
    const producer = {
      produce: (e: unknown[]) => produced.push(...e),
      isEnabled: () => true,
    } as unknown as AnalyticsProducerService;
    const shareLink = {
      findByToken: () => Promise.resolve(link),
    } as unknown as ShareLinkService;
    const warehouse = {} as AnalyticsWarehouseService;
    const controller = new AnalyticsController(
      producer,
      warehouse,
      shareLink,
      {} as PrismaService,
      {} as WorkspaceService,
    );
    return { controller, produced };
  }

  it('enriches events with server-derived fields and produces them', async () => {
    const { controller, produced } = setup();
    const req = {
      headers: { 'user-agent': 'Mozilla/5.0 Chrome/120 Safari/537.36' },
      user: { id: 42 },
    } as never;
    await controller.ingest(
      {
        shareToken: 'tok',
        events: [{ sessionId: 's1', visitorId: 'v1', eventType: 'open' }],
      },
      req,
    );
    expect(produced).toHaveLength(1);
    const e = produced[0] as Record<string, unknown>;
    expect(e.document_id).toBe('doc-1');
    expect(e.share_link_id).toBe('link-1');
    expect(e.role).toBe('viewer');
    expect(e.user_id).toBe('42');
    expect(e.doc_type).toBe('sheet');
    expect(e.user_agent).toBe('Chrome');
    expect(e.event_type).toBe('open');
  });

  it('parses a text/plain (string) beacon body', async () => {
    const { controller, produced } = setup();
    const req = { headers: {}, user: null } as never;
    await controller.ingest(
      JSON.stringify({
        shareToken: 'tok',
        events: [{ sessionId: 's1', visitorId: 'v1', eventType: 'open' }],
      }),
      req,
    );
    expect(produced).toHaveLength(1);
    expect((produced[0] as Record<string, unknown>).session_id).toBe('s1');
  });

  it('rejects a malformed (non-object) event with 400, not 500', async () => {
    const { controller } = setup();
    const req = { headers: {}, user: null } as never;
    await expect(
      controller.ingest({ shareToken: 'tok', events: [null] as never }, req),
    ).rejects.toThrow();
  });

  it('rejects an unparsable string body', async () => {
    const { controller } = setup();
    const req = { headers: {}, user: null } as never;
    await expect(controller.ingest('not json', req)).rejects.toThrow();
  });

  it('records anonymous visitor (no user) with empty user_id', async () => {
    const { controller, produced } = setup();
    const req = { headers: {}, user: null } as never;
    await controller.ingest(
      {
        shareToken: 'tok',
        events: [{ sessionId: 's1', visitorId: 'v1', eventType: 'heartbeat' }],
      },
      req,
    );
    expect((produced[0] as Record<string, unknown>).user_id).toBe('');
  });

  it('rejects an unknown event type', async () => {
    const { controller } = setup();
    const req = { headers: {}, user: null } as never;
    await expect(
      controller.ingest(
        {
          shareToken: 'tok',
          events: [
            { sessionId: 's', visitorId: 'v', eventType: 'evil' as never },
          ],
        },
        req,
      ),
    ).rejects.toThrow();
  });

  it('rejects a batch with more than 50 events', async () => {
    const { controller } = setup();
    const req = { headers: {}, user: null } as never;
    const events = Array.from({ length: 51 }, (_, i) => ({
      sessionId: 's',
      visitorId: 'v',
      eventType: 'open' as const,
      target: `t${i}`,
    }));
    await expect(
      controller.ingest({ shareToken: 'tok', events }, req),
    ).rejects.toThrow();
  });

  it('rejects an event missing sessionId', async () => {
    const { controller } = setup();
    const req = { headers: {}, user: null } as never;
    await expect(
      controller.ingest(
        {
          shareToken: 'tok',
          events: [
            { sessionId: '', visitorId: 'v1', eventType: 'open' },
          ] as never,
        },
        req,
      ),
    ).rejects.toThrow();
  });

  it('short-circuits without a share-link lookup when the producer is disabled', async () => {
    const producer = {
      produce: () => {
        throw new Error('should not be called');
      },
      isEnabled: () => false,
    } as unknown as AnalyticsProducerService;
    const shareLink = {
      findByToken: () => {
        throw new Error('should not be called');
      },
    } as unknown as ShareLinkService;
    const controller = new AnalyticsController(
      producer,
      {} as AnalyticsWarehouseService,
      shareLink,
      {} as PrismaService,
      {} as WorkspaceService,
    );
    const req = { headers: {}, user: null } as never;
    const res = await controller.ingest(
      {
        shareToken: 'tok',
        events: [{ sessionId: 's1', visitorId: 'v1', eventType: 'open' }],
      },
      req,
    );
    expect(res).toEqual({ ok: true });
  });
});

describe('AnalyticsController dashboard', () => {
  function setup(opts: { memberRole?: string; authorID: number | null }) {
    const warehouse = {
      getDocumentAnalytics: () =>
        Promise.resolve({ enabled: true, totalViews: 5 }),
    } as unknown as AnalyticsWarehouseService;
    const prisma = {
      document: {
        findUnique: () =>
          Promise.resolve({
            id: 'doc-1',
            workspaceId: 'ws-1',
            authorID: opts.authorID,
          }),
      },
      workspaceMember: {
        findUnique: () =>
          Promise.resolve(opts.memberRole ? { role: opts.memberRole } : null),
      },
    } as unknown as PrismaService;
    const controller = new AnalyticsController(
      {} as AnalyticsProducerService,
      warehouse,
      {} as ShareLinkService,
      prisma,
      {} as WorkspaceService,
    );
    return controller;
  }

  it('allows a workspace owner and returns analytics', async () => {
    const c = setup({ memberRole: 'owner', authorID: null });
    const req = { user: { id: 7 } } as never;
    const res = await c.dashboard('doc-1', req, undefined, undefined);
    expect((res as { totalViews: number }).totalViews).toBe(5);
  });

  it('forbids a non-manager member', async () => {
    const c = setup({ memberRole: 'member', authorID: 999 });
    const req = { user: { id: 7 } } as never;
    await expect(
      c.dashboard('doc-1', req, undefined, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('falls back to default window on an unparsable `to` param', async () => {
    const c = setup({ memberRole: 'owner', authorID: null });
    const req = { user: { id: 7 } } as never;
    const res = await c.dashboard('doc-1', req, undefined, 'garbage');
    expect((res as { totalViews: number }).totalViews).toBe(5);
  });

  it('falls back to default window on an unparsable `from` param', async () => {
    const c = setup({ memberRole: 'owner', authorID: null });
    const req = { user: { id: 7 } } as never;
    const res = await c.dashboard('doc-1', req, 'garbage', undefined);
    expect((res as { totalViews: number }).totalViews).toBe(5);
  });
});

describe('AnalyticsController workspaceDashboard', () => {
  function setup(opts: { isMember: boolean }) {
    const warehouse = {
      getWorkspaceAnalytics: (ids: string[]) =>
        Promise.resolve({
          enabled: true,
          totalViews: 9,
          uniqueVisitors: 4,
          viewsByDay: [],
          byDocument: [
            { documentId: 'd1', title: '', views: 7, uniqueVisitors: 3 },
          ],
          _ids: ids,
        }),
    } as unknown as AnalyticsWarehouseService;
    const prisma = {
      document: {
        findMany: () =>
          Promise.resolve([
            { id: 'd1', title: 'Budget' },
            { id: 'd2', title: 'Deck' },
          ]),
      },
    } as unknown as PrismaService;
    const workspace = {
      resolveId: (idOrSlug: string) => Promise.resolve(idOrSlug),
      assertMember: () => {
        if (!opts.isMember) {
          throw new ForbiddenException('Not a member of this workspace');
        }
        return Promise.resolve({ role: 'member' });
      },
    } as unknown as WorkspaceService;
    const controller = new AnalyticsController(
      {} as AnalyticsProducerService,
      warehouse,
      {} as ShareLinkService,
      prisma,
      workspace,
    );
    return controller;
  }

  it('aggregates a workspace and fills document titles from Postgres', async () => {
    const c = setup({ isMember: true });
    const req = { user: { id: 7 } } as never;
    const res = await c.workspaceDashboard('ws-1', req, undefined, undefined);
    expect(res.totalViews).toBe(9);
    expect(res.byDocument[0].title).toBe('Budget');
  });

  it('forbids a non-member', async () => {
    const c = setup({ isMember: false });
    const req = { user: { id: 7 } } as never;
    await expect(
      c.workspaceDashboard('ws-1', req, undefined, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
