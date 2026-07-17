import { ForbiddenException } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsProducerService } from './analytics-producer.service';
import { AnalyticsWarehouseService } from './analytics-warehouse.service';
import { ShareLinkService } from '../share-link/share-link.service';
import { PrismaService } from '../database/prisma.service';

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
});
