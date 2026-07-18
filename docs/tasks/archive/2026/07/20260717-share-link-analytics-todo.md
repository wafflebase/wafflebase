# Share Link Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect view statistics from share-linked documents and surface a per-document analytics dashboard to managers, reusing Yorkie's existing Kafka + StarRocks OLAP stack.

**Architecture:** Frontend beacon (`sendBeacon`) → NestJS `AnalyticsModule` (kafkajs producer) → Kafka topic `wafflebase-view-events` → StarRocks Routine Load → single flat `wafflebase.view_events` table → mysql2 reader → manager-gated dashboard. Producer/warehouse degrade to no-op when unconfigured. Design: `docs/design/share-link-analytics.md`.

**Tech Stack:** NestJS 11 + Prisma (backend), React + Vite + TanStack Query (frontend), kafkajs, mysql2, StarRocks, Kafka. Jest (backend tests), Vitest (sheets/frontend tests).

## Global Constraints

- **target-version:** 0.7.0
- **Single PR** for wafflesheets (backend + frontend). DevOps manifests live in the separate `yorkie-team/devops` repo (Task 12) and land as prerequisite infra — not in this PR.
- **No prepared statements for StarRocks** — it does not support them. Build queries by string interpolation of **server-derived** ids and **server-validated** date ranges only. Never interpolate raw client input.
- **Producer is fire-and-forget** — a failed Kafka produce must never break a document view. Log and swallow.
- **Safe degradation** — with `WAFFLEBASE_KAFKA_ADDRESSES` unset the producer is a no-op; with `WAFFLEBASE_STARROCKS_DSN` unset the warehouse reports "disabled". App works without the analytics stack (local `docker compose`).
- **Privacy** — never store raw IP. `visitor_id` is an opaque localStorage UUID (not PII). `user_agent` stored as a coarse browser-family string (≤64 chars).
- **Commit subject ≤70 chars**, blank line 2, body explains why. End commits with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **verify:fast green** before each commit (`pnpm verify:fast`).
- **Manager gate** for reads reuses `isDocumentManager` from `packages/backend/src/document/document-access.ts`.

---

## File Structure

**Backend (`packages/backend/src/analytics/`, new):**
- `analytics.module.ts` — wires controller + services + `PrismaService`, registered in `app.module.ts`.
- `analytics.types.ts` — `ViewEvent`, `ViewEventInput`, `DocumentAnalytics` types + `VIEW_EVENT_TYPES`.
- `coarse-user-agent.ts` — `coarseUserAgent(ua?: string): string` (browser family only).
- `analytics-producer.service.ts` — kafkajs producer; `produce(events: ViewEvent[])`; no-op when unconfigured.
- `analytics-warehouse.service.ts` — mysql2 reader; `getDocumentAnalytics(...)`; `isEnabled()`; no-op when unconfigured.
- `analytics.controller.ts` — `POST /internal/analytics/view-events`, `GET /documents/:id/analytics`.
- `optional-jwt-auth.guard.ts` — resolves `req.user` if a valid session cookie exists, else `null` (never throws).

**Frontend (`packages/frontend/src/`):**
- `api/analytics.ts` — `sendViewEvents(...)`, `getDocumentAnalytics(...)`, visitor/session id helpers.
- `hooks/use-view-analytics.ts` — beacon lifecycle hook (open/heartbeat/tabchange/close).
- `app/analytics/document-analytics.tsx` — dashboard page.
- Modify `app/shared/shared-document.tsx` — call the beacon hook.
- Modify router (`App.tsx`) — add `/analytics/:id` route; add manager entry point.

**DevOps (`yorkie-team/devops` repo — Task 12):**
- StarRocks init SQL (`wafflebase` DB + `view_events` table + routine load).
- `k8s/cluster/starrocks-routine-load-watcher.yaml` — add wafflebase block.
- `k8s/wafflebase/deployment.yaml` — add env.

---

## Task 1: AnalyticsModule scaffold + types + config

**Files:**
- Create: `packages/backend/src/analytics/analytics.types.ts`
- Create: `packages/backend/src/analytics/analytics.module.ts`
- Modify: `packages/backend/src/app.module.ts:17` (import) and `:108` (register in `imports`)
- Test: `packages/backend/src/analytics/analytics.types.spec.ts`

**Interfaces:**
- Produces: `VIEW_EVENT_TYPES` (`readonly ['open','heartbeat','tabchange','close']`), `ViewEventType`, `ViewEventInput`, `ViewEvent`, `DocumentAnalytics`, `AnalyticsModule`.

- [x] **Step 1: Write the types file**

```typescript
// packages/backend/src/analytics/analytics.types.ts
export const VIEW_EVENT_TYPES = [
  'open',
  'heartbeat',
  'tabchange',
  'close',
] as const;
export type ViewEventType = (typeof VIEW_EVENT_TYPES)[number];

/** Raw event as sent by the browser beacon (client-supplied fields only). */
export interface ViewEventInput {
  sessionId: string;
  visitorId: string;
  eventType: ViewEventType;
  target?: string;
}

/** Enriched event produced to Kafka (server-derived fields added). */
export interface ViewEvent {
  document_id: string;
  share_link_id: string;
  session_id: string;
  visitor_id: string;
  user_id: string;
  role: string;
  event_type: ViewEventType;
  target: string;
  doc_type: string;
  user_agent: string;
  timestamp: string; // 'YYYY-MM-DD HH:MM:SS' (StarRocks DATETIME)
}

export interface MetricSeriesPoint {
  date: string; // 'YYYY-MM-DD'
  value: number;
}

export interface ShareLinkBreakdown {
  shareLinkId: string;
  views: number;
  uniqueVisitors: number;
}

export interface TargetBreakdown {
  target: string;
  views: number;
}

export interface DocumentAnalytics {
  enabled: boolean;
  totalViews: number;
  uniqueVisitors: number;
  returningVisitors: number;
  avgDwellSeconds: number;
  viewsByDay: MetricSeriesPoint[];
  byShareLink: ShareLinkBreakdown[];
  byTarget: TargetBreakdown[];
}
```

- [x] **Step 2: Write the failing test**

```typescript
// packages/backend/src/analytics/analytics.types.spec.ts
import { VIEW_EVENT_TYPES } from './analytics.types';

describe('analytics.types', () => {
  it('declares the four view event types in order', () => {
    expect(VIEW_EVENT_TYPES).toEqual(['open', 'heartbeat', 'tabchange', 'close']);
  });
});
```

- [x] **Step 3: Run test to verify it passes** (types-only, no impl needed)

Run: `pnpm --filter @wafflebase/backend test -- analytics.types`
Expected: PASS

- [x] **Step 4: Write the module (no-op providers wired in later tasks)**

```typescript
// packages/backend/src/analytics/analytics.module.ts
import { Module } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ShareLinkModule } from '../share-link/share-link.module';
import { AnalyticsProducerService } from './analytics-producer.service';
import { AnalyticsWarehouseService } from './analytics-warehouse.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  imports: [ShareLinkModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsProducerService,
    AnalyticsWarehouseService,
    PrismaService,
  ],
  exports: [AnalyticsProducerService, AnalyticsWarehouseService],
})
export class AnalyticsModule {}
```

> NOTE: `ShareLinkModule` already `exports` `ShareLinkService` (see `packages/backend/src/share-link/share-link.module.ts`). The controller/services referenced above are created in Tasks 2–5; the module will not compile until then, so DO NOT register it in `app.module.ts` yet. Steps 5–6 register it after those files exist — reorder if executing strictly. For now, commit only the types.

- [x] **Step 5: Commit the types**

```bash
git add packages/backend/src/analytics/analytics.types.ts packages/backend/src/analytics/analytics.types.spec.ts
git commit -m "Analytics: view-event and dashboard types"
```

---

## Task 2: Coarse user-agent + AnalyticsProducerService (kafkajs)

**Files:**
- Create: `packages/backend/src/analytics/coarse-user-agent.ts`
- Create: `packages/backend/src/analytics/analytics-producer.service.ts`
- Test: `packages/backend/src/analytics/coarse-user-agent.spec.ts`
- Test: `packages/backend/src/analytics/analytics-producer.service.spec.ts`
- Modify: `packages/backend/package.json` (add `kafkajs` dependency)

**Interfaces:**
- Consumes: `ViewEvent` (Task 1).
- Produces: `coarseUserAgent(ua?: string): string`; `AnalyticsProducerService` with `isEnabled(): boolean` and `produce(events: ViewEvent[]): void` (fire-and-forget).

- [x] **Step 1: Add the dependency**

Run: `pnpm --filter @wafflebase/backend add kafkajs`
Expected: `kafkajs` appears in `packages/backend/package.json` dependencies.

- [x] **Step 2: Write the failing coarse-UA test**

```typescript
// packages/backend/src/analytics/coarse-user-agent.spec.ts
import { coarseUserAgent } from './coarse-user-agent';

describe('coarseUserAgent', () => {
  it('maps Chrome UA to "Chrome"', () => {
    expect(
      coarseUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      ),
    ).toBe('Chrome');
  });
  it('maps Safari UA (no Chrome token) to "Safari"', () => {
    expect(
      coarseUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Version/17 Safari/605',
      ),
    ).toBe('Safari');
  });
  it('returns "Other" for unknown/empty', () => {
    expect(coarseUserAgent(undefined)).toBe('Other');
    expect(coarseUserAgent('curl/8.0')).toBe('Other');
  });
});
```

- [x] **Step 3: Run to verify it fails**

Run: `pnpm --filter @wafflebase/backend test -- coarse-user-agent`
Expected: FAIL ("Cannot find module './coarse-user-agent'")

- [x] **Step 4: Implement coarse-user-agent**

```typescript
// packages/backend/src/analytics/coarse-user-agent.ts
/**
 * Reduce a full User-Agent string to a coarse browser family for privacy.
 * We never store the raw UA (fingerprintable) — only one of a small set.
 * Order matters: Edge/Chrome both contain "Chrome"; check Edge first.
 */
export function coarseUserAgent(ua?: string): string {
  if (!ua) return 'Other';
  if (/\bEdg\//.test(ua)) return 'Edge';
  if (/\bOPR\/|\bOpera\b/.test(ua)) return 'Opera';
  if (/\bChrome\//.test(ua)) return 'Chrome';
  if (/\bFirefox\//.test(ua)) return 'Firefox';
  if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return 'Safari';
  return 'Other';
}
```

- [x] **Step 5: Run to verify it passes**

Run: `pnpm --filter @wafflebase/backend test -- coarse-user-agent`
Expected: PASS

- [x] **Step 6: Write the failing producer test**

```typescript
// packages/backend/src/analytics/analytics-producer.service.spec.ts
import { ConfigService } from '@nestjs/config';
import { AnalyticsProducerService } from './analytics-producer.service';

function make(env: Record<string, string | undefined>) {
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  return new AnalyticsProducerService(config);
}

describe('AnalyticsProducerService', () => {
  it('is disabled when kafka addresses are unset', () => {
    const svc = make({});
    expect(svc.isEnabled()).toBe(false);
  });
  it('is enabled when kafka addresses are set', () => {
    const svc = make({ WAFFLEBASE_KAFKA_ADDRESSES: 'localhost:9092' });
    expect(svc.isEnabled()).toBe(true);
  });
  it('produce() is a no-op that does not throw when disabled', () => {
    const svc = make({});
    expect(() => svc.produce([])).not.toThrow();
  });
});
```

- [x] **Step 7: Run to verify it fails**

Run: `pnpm --filter @wafflebase/backend test -- analytics-producer`
Expected: FAIL ("Cannot find module './analytics-producer.service'")

- [x] **Step 8: Implement the producer**

```typescript
// packages/backend/src/analytics/analytics-producer.service.ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';
import { ViewEvent } from './analytics.types';

/**
 * Fire-and-forget Kafka producer for view events. Ports Yorkie's
 * server/backend/messaging/kafka.go (async writer). A failed produce must
 * never break a document view — errors are logged and swallowed. When
 * WAFFLEBASE_KAFKA_ADDRESSES is unset the service is a no-op (local dev).
 */
@Injectable()
export class AnalyticsProducerService implements OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsProducerService.name);
  private readonly topic: string;
  private producer: Producer | null = null;
  private connecting: Promise<void> | null = null;

  constructor(private readonly config: ConfigService) {
    this.topic =
      this.config.get<string>('WAFFLEBASE_KAFKA_TOPIC') ??
      'wafflebase-view-events';
    const addresses = this.config.get<string>('WAFFLEBASE_KAFKA_ADDRESSES');
    if (addresses) {
      const kafka = new Kafka({
        clientId: 'wafflebase-backend',
        brokers: addresses.split(',').map((s) => s.trim()),
      });
      this.producer = kafka.producer();
    }
  }

  isEnabled(): boolean {
    return this.producer !== null;
  }

  /** Enrich-and-send is done by the caller; this only ships to Kafka. */
  produce(events: ViewEvent[]): void {
    if (!this.producer || events.length === 0) return;
    void this.send(events).catch((err) => {
      this.logger.warn(`view-event produce failed: ${String(err)}`);
    });
  }

  private async send(events: ViewEvent[]): Promise<void> {
    if (!this.producer) return;
    if (!this.connecting) {
      this.connecting = this.producer.connect();
    }
    await this.connecting;
    await this.producer.send({
      topic: this.topic,
      messages: events.map((e) => ({ value: JSON.stringify(e) })),
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect().catch(() => undefined);
    }
  }
}
```

- [x] **Step 9: Run to verify it passes**

Run: `pnpm --filter @wafflebase/backend test -- analytics-producer coarse-user-agent`
Expected: PASS

- [x] **Step 10: Commit**

```bash
git add packages/backend/src/analytics/coarse-user-agent.ts packages/backend/src/analytics/coarse-user-agent.spec.ts packages/backend/src/analytics/analytics-producer.service.ts packages/backend/src/analytics/analytics-producer.service.spec.ts packages/backend/package.json pnpm-lock.yaml
git commit -m "Analytics: kafkajs view-event producer + coarse UA"
```

---

## Task 3: Optional JWT guard + ingestion endpoint

**Files:**
- Create: `packages/backend/src/analytics/optional-jwt-auth.guard.ts`
- Create: `packages/backend/src/analytics/analytics.controller.ts`
- Test: `packages/backend/src/analytics/analytics.controller.spec.ts`

**Interfaces:**
- Consumes: `ShareLinkService.findByToken` (returns `{ id, role, documentId, document: { type } }`), `AnalyticsProducerService.produce`, `coarseUserAgent`, `ViewEventInput`, `ViewEvent`.
- Produces: `OptionalJwtAuthGuard`; `AnalyticsController` with `POST /internal/analytics/view-events` and (Task 5) `GET /documents/:id/analytics`.

- [x] **Step 1: Implement the optional JWT guard**

```typescript
// packages/backend/src/analytics/optional-jwt-auth.guard.ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Like JwtAuthGuard but never rejects: if a valid session cookie is present
 * req.user is populated, otherwise the request proceeds anonymously. Used by
 * the view-event ingest endpoint so logged-in viewers get a user_id while
 * anonymous share-link visitors still record events.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
  handleRequest<TUser>(_err: unknown, user: TUser): TUser | null {
    return user ?? null;
  }
}
```

- [x] **Step 2: Write the failing controller test (ingest path)**

```typescript
// packages/backend/src/analytics/analytics.controller.spec.ts
import { AnalyticsController } from './analytics.controller';
import { AnalyticsProducerService } from './analytics-producer.service';
import { AnalyticsWarehouseService } from './analytics-warehouse.service';
import { ShareLinkService } from '../share-link/share-link.service';

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
      findByToken: async () => link,
    } as unknown as ShareLinkService;
    const warehouse = {} as AnalyticsWarehouseService;
    const controller = new AnalyticsController(producer, warehouse, shareLink);
    return { controller, produced };
  }

  it('enriches events with server-derived fields and produces them', async () => {
    const { controller, produced } = setup();
    const req = {
      headers: { 'user-agent': 'Mozilla/5.0 Chrome/120 Safari/537.36' },
      user: { id: 42 },
    } as never;
    await controller.ingest(
      { shareToken: 'tok', events: [{ sessionId: 's1', visitorId: 'v1', eventType: 'open' }] },
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
      { shareToken: 'tok', events: [{ sessionId: 's1', visitorId: 'v1', eventType: 'heartbeat' }] },
      req,
    );
    expect((produced[0] as Record<string, unknown>).user_id).toBe('');
  });

  it('rejects an unknown event type', async () => {
    const { controller } = setup();
    const req = { headers: {}, user: null } as never;
    await expect(
      controller.ingest(
        { shareToken: 'tok', events: [{ sessionId: 's', visitorId: 'v', eventType: 'evil' as never }] },
        req,
      ),
    ).rejects.toThrow();
  });
});
```

- [x] **Step 3: Run to verify it fails**

Run: `pnpm --filter @wafflebase/backend test -- analytics.controller`
Expected: FAIL ("Cannot find module './analytics.controller'")

- [x] **Step 4: Implement the controller (ingest only; GET added in Task 5)**

```typescript
// packages/backend/src/analytics/analytics.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { ShareLinkService } from '../share-link/share-link.service';
import { AnalyticsProducerService } from './analytics-producer.service';
import { AnalyticsWarehouseService } from './analytics-warehouse.service';
import { coarseUserAgent } from './coarse-user-agent';
import {
  ViewEvent,
  ViewEventInput,
  VIEW_EVENT_TYPES,
} from './analytics.types';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

interface IngestBody {
  shareToken: string;
  events: ViewEventInput[];
}

function nowStarRocks(): string {
  // StarRocks DATETIME: 'YYYY-MM-DD HH:MM:SS' (UTC).
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

@Controller()
export class AnalyticsController {
  constructor(
    private readonly producer: AnalyticsProducerService,
    private readonly warehouse: AnalyticsWarehouseService,
    private readonly shareLink: ShareLinkService,
  ) {}

  @Post('internal/analytics/view-events')
  @SkipThrottle()
  @UseGuards(OptionalJwtAuthGuard)
  async ingest(@Body() body: IngestBody, @Req() req: Request): Promise<{ ok: true }> {
    if (!body?.shareToken || !Array.isArray(body.events) || body.events.length === 0) {
      throw new BadRequestException('shareToken and events are required');
    }
    if (body.events.length > 50) {
      throw new BadRequestException('too many events in one batch');
    }

    // Server-derived attribution: the client cannot claim a document, link,
    // role, or user — all come from the resolved share token / session.
    const link = await this.shareLink.findByToken(body.shareToken);
    const user = (req as unknown as { user?: { id: number } | null }).user;
    const userId = user ? String(user.id) : '';
    const userAgent = coarseUserAgent(req.headers['user-agent']);
    const timestamp = nowStarRocks();

    const enriched: ViewEvent[] = body.events.map((e) => {
      if (!VIEW_EVENT_TYPES.includes(e.eventType)) {
        throw new BadRequestException(`invalid event type: ${e.eventType}`);
      }
      if (!e.sessionId || !e.visitorId) {
        throw new BadRequestException('sessionId and visitorId are required');
      }
      return {
        document_id: link.documentId,
        share_link_id: link.id,
        session_id: String(e.sessionId).slice(0, 64),
        visitor_id: String(e.visitorId).slice(0, 64),
        user_id: userId,
        role: link.role,
        event_type: e.eventType,
        target: (e.target ?? '').slice(0, 128),
        doc_type: link.document.type,
        user_agent: userAgent,
        timestamp,
      };
    });

    this.producer.produce(enriched);
    return { ok: true };
  }
}
```

- [x] **Step 5: Run to verify it passes**

Run: `pnpm --filter @wafflebase/backend test -- analytics.controller`
Expected: PASS (3 tests)

- [x] **Step 6: Commit**

```bash
git add packages/backend/src/analytics/optional-jwt-auth.guard.ts packages/backend/src/analytics/analytics.controller.ts packages/backend/src/analytics/analytics.controller.spec.ts
git commit -m "Analytics: view-event ingest endpoint with optional JWT"
```

---

## Task 4: AnalyticsWarehouseService (mysql2 → StarRocks)

**Files:**
- Create: `packages/backend/src/analytics/analytics-warehouse.service.ts`
- Test: `packages/backend/src/analytics/analytics-warehouse.service.spec.ts`
- Modify: `packages/backend/package.json` (add `mysql2` dependency)

**Interfaces:**
- Consumes: `DocumentAnalytics`, `MetricSeriesPoint`, `ShareLinkBreakdown`, `TargetBreakdown` (Task 1).
- Produces: `AnalyticsWarehouseService` with `isEnabled(): boolean`, `getDocumentAnalytics(documentId: string, from: Date, to: Date): Promise<DocumentAnalytics>`. Exposes `buildQueries(documentId, from, to)` (pure, testable string builder) so SQL is unit-tested without a live StarRocks.

- [x] **Step 1: Add the dependency**

Run: `pnpm --filter @wafflebase/backend add mysql2`
Expected: `mysql2` in `packages/backend/package.json` dependencies.

- [x] **Step 2: Write the failing SQL-builder test**

```typescript
// packages/backend/src/analytics/analytics-warehouse.service.spec.ts
import { ConfigService } from '@nestjs/config';
import { AnalyticsWarehouseService } from './analytics-warehouse.service';

function make(env: Record<string, string | undefined>) {
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  return new AnalyticsWarehouseService(config);
}

describe('AnalyticsWarehouseService', () => {
  it('is disabled when DSN is unset and returns disabled payload', async () => {
    const svc = make({});
    expect(svc.isEnabled()).toBe(false);
    const res = await svc.getDocumentAnalytics('doc-1', new Date('2026-07-01'), new Date('2026-07-17'));
    expect(res.enabled).toBe(false);
    expect(res.totalViews).toBe(0);
  });

  it('interpolates the document id and date range, scoped to open events for views', () => {
    const svc = make({ WAFFLEBASE_STARROCKS_DSN: 'root:@tcp(localhost:9030)/wafflebase' });
    const q = svc.buildQueries('doc-1', new Date('2026-07-01T00:00:00Z'), new Date('2026-07-17T00:00:00Z'));
    expect(q.totalViews).toContain("document_id = 'doc-1'");
    expect(q.totalViews).toContain("timestamp >= '2026-07-01'");
    expect(q.totalViews).toContain("timestamp < '2026-07-17'");
    expect(q.totalViews).toContain("event_type = 'open'");
    expect(q.dwell).toContain('session_id');
  });

  it('escapes single quotes in the document id to prevent injection', () => {
    const svc = make({ WAFFLEBASE_STARROCKS_DSN: 'root:@tcp(localhost:9030)/wafflebase' });
    const q = svc.buildQueries("d'1", new Date('2026-07-01T00:00:00Z'), new Date('2026-07-17T00:00:00Z'));
    expect(q.totalViews).toContain("document_id = 'd''1'");
  });
});
```

- [x] **Step 3: Run to verify it fails**

Run: `pnpm --filter @wafflebase/backend test -- analytics-warehouse`
Expected: FAIL ("Cannot find module './analytics-warehouse.service'")

- [x] **Step 4: Implement the warehouse service**

```typescript
// packages/backend/src/analytics/analytics-warehouse.service.ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mysql from 'mysql2/promise';
import {
  DocumentAnalytics,
  MetricSeriesPoint,
  ShareLinkBreakdown,
  TargetBreakdown,
} from './analytics.types';

/** Parse Yorkie-style DSN `user:pass@tcp(host:port)/db` into a mysql2 config. */
function parseDSN(dsn: string): mysql.PoolOptions {
  const m = /^([^:]*):([^@]*)@tcp\(([^:]+):(\d+)\)\/(.+)$/.exec(dsn);
  if (!m) throw new Error(`invalid StarRocks DSN: ${dsn}`);
  return {
    user: m[1],
    password: m[2],
    host: m[3],
    port: Number(m[4]),
    database: m[5],
    connectionLimit: 4,
  };
}

/** StarRocks has no prepared statements — quote/escape values ourselves. */
function sql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const EMPTY: DocumentAnalytics = {
  enabled: false,
  totalViews: 0,
  uniqueVisitors: 0,
  returningVisitors: 0,
  avgDwellSeconds: 0,
  viewsByDay: [],
  byShareLink: [],
  byTarget: [],
};

@Injectable()
export class AnalyticsWarehouseService implements OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsWarehouseService.name);
  private pool: mysql.Pool | null = null;

  constructor(private readonly config: ConfigService) {
    const dsn = this.config.get<string>('WAFFLEBASE_STARROCKS_DSN');
    if (dsn) {
      this.pool = mysql.createPool(parseDSN(dsn));
    }
  }

  isEnabled(): boolean {
    return this.pool !== null;
  }

  /** Pure query builder — unit-tested without a live StarRocks. */
  buildQueries(documentId: string, from: Date, to: Date) {
    const id = sql(documentId);
    const lo = sql(day(from));
    const hi = sql(day(to));
    const where = `document_id = ${id} AND timestamp >= ${lo} AND timestamp < ${hi}`;
    return {
      totalViews: `SELECT COUNT(*) AS c FROM view_events WHERE ${where} AND event_type = 'open';`,
      uniqueVisitors: `SELECT COUNT(DISTINCT visitor_id) AS c FROM view_events WHERE ${where};`,
      returningVisitors: `SELECT COUNT(*) AS c FROM (SELECT visitor_id FROM view_events WHERE ${where} AND event_type = 'open' GROUP BY visitor_id HAVING COUNT(DISTINCT session_id) > 1) t;`,
      dwell: `SELECT AVG(dwell) AS c FROM (SELECT session_id, TIMESTAMPDIFF(SECOND, MIN(timestamp), MAX(timestamp)) AS dwell FROM view_events WHERE ${where} GROUP BY session_id) t;`,
      viewsByDay: `SELECT DATE(timestamp) AS d, COUNT(*) AS c FROM view_events WHERE ${where} AND event_type = 'open' GROUP BY d ORDER BY d ASC;`,
      byShareLink: `SELECT share_link_id AS k, COUNT(*) AS v, COUNT(DISTINCT visitor_id) AS u FROM view_events WHERE ${where} AND event_type = 'open' GROUP BY share_link_id ORDER BY v DESC;`,
      byTarget: `SELECT target AS k, COUNT(*) AS v FROM view_events WHERE ${where} AND event_type = 'tabchange' GROUP BY target ORDER BY v DESC LIMIT 50;`,
    };
  }

  async getDocumentAnalytics(
    documentId: string,
    from: Date,
    to: Date,
  ): Promise<DocumentAnalytics> {
    if (!this.pool) return EMPTY;
    const q = this.buildQueries(documentId, from, to);
    try {
      const totalViews = await this.count(q.totalViews);
      const uniqueVisitors = await this.count(q.uniqueVisitors);
      const returningVisitors = await this.count(q.returningVisitors);
      const avgDwellSeconds = Math.round(await this.count(q.dwell));
      const viewsByDay = await this.series(q.viewsByDay);
      const byShareLink = await this.shareLinkRows(q.byShareLink);
      const byTarget = await this.targetRows(q.byTarget);
      return {
        enabled: true,
        totalViews,
        uniqueVisitors,
        returningVisitors,
        avgDwellSeconds,
        viewsByDay,
        byShareLink,
        byTarget,
      };
    } catch (err) {
      this.logger.error(`warehouse query failed: ${String(err)}`);
      return { ...EMPTY, enabled: true };
    }
  }

  private async count(query: string): Promise<number> {
    const [rows] = await this.pool!.query(query);
    const r = (rows as Array<{ c: number | null }>)[0];
    return r && r.c != null ? Number(r.c) : 0;
  }
  private async series(query: string): Promise<MetricSeriesPoint[]> {
    const [rows] = await this.pool!.query(query);
    return (rows as Array<{ d: string; c: number }>).map((r) => ({
      date: String(r.d).slice(0, 10),
      value: Number(r.c),
    }));
  }
  private async shareLinkRows(query: string): Promise<ShareLinkBreakdown[]> {
    const [rows] = await this.pool!.query(query);
    return (rows as Array<{ k: string; v: number; u: number }>).map((r) => ({
      shareLinkId: r.k,
      views: Number(r.v),
      uniqueVisitors: Number(r.u),
    }));
  }
  private async targetRows(query: string): Promise<TargetBreakdown[]> {
    const [rows] = await this.pool!.query(query);
    return (rows as Array<{ k: string; v: number }>).map((r) => ({
      target: r.k,
      views: Number(r.v),
    }));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.end().catch(() => undefined);
  }
}
```

- [x] **Step 5: Run to verify it passes**

Run: `pnpm --filter @wafflebase/backend test -- analytics-warehouse`
Expected: PASS (3 tests)

- [x] **Step 6: Commit**

```bash
git add packages/backend/src/analytics/analytics-warehouse.service.ts packages/backend/src/analytics/analytics-warehouse.service.spec.ts packages/backend/package.json pnpm-lock.yaml
git commit -m "Analytics: StarRocks warehouse reader via mysql2"
```

---

## Task 5: Manager-gated dashboard endpoint + register module

**Files:**
- Modify: `packages/backend/src/analytics/analytics.controller.ts` (add GET)
- Modify: `packages/backend/src/analytics/analytics.controller.spec.ts` (add GET tests)
- Modify: `packages/backend/src/app.module.ts` (import + register `AnalyticsModule`)
- Modify: `packages/backend/README.md` (document the three env vars + endpoints)

**Interfaces:**
- Consumes: `AnalyticsWarehouseService.getDocumentAnalytics`, `PrismaService`, `isDocumentManager`, `JwtAuthGuard`.
- Produces: `GET /documents/:id/analytics?from=&to=` returning `DocumentAnalytics`.

- [x] **Step 1: Write the failing manager-gate test**

Append to `analytics.controller.spec.ts`:

```typescript
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

describe('AnalyticsController dashboard', () => {
  function setup(opts: { memberRole?: string; authorID: number | null }) {
    const warehouse = {
      getDocumentAnalytics: async () => ({ enabled: true, totalViews: 5 }),
    } as unknown as AnalyticsWarehouseService;
    const prisma = {
      document: { findUnique: async () => ({ id: 'doc-1', workspaceId: 'ws-1', authorID: opts.authorID }) },
      workspaceMember: { findUnique: async () => (opts.memberRole ? { role: opts.memberRole } : null) },
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
    await expect(c.dashboard('doc-1', req, undefined, undefined)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm --filter @wafflebase/backend test -- analytics.controller`
Expected: FAIL (constructor arity / `dashboard` undefined)

- [x] **Step 3: Add the GET handler + PrismaService dep to the controller**

Add to imports and constructor of `analytics.controller.ts`:

```typescript
import {
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../database/prisma.service';
import { isDocumentManager } from '../document/document-access';
import { DocumentAnalytics } from './analytics.types';
```

Extend the constructor with `private readonly prisma: PrismaService,` (append as the 4th param), then add:

```typescript
  @Get('documents/:id/analytics')
  @UseGuards(JwtAuthGuard)
  async dashboard(
    @Param('id') documentId: string,
    @Req() req: Request,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ): Promise<DocumentAnalytics> {
    const userId = Number((req as unknown as { user: { id: number } }).user.id);
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document not found');
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: doc.workspaceId, userId } },
    });
    if (!isDocumentManager(membership?.role, doc.authorID, userId)) {
      throw new ForbiddenException('Only a document manager can view analytics');
    }

    // Default window: last 30 days. Validate range; swap if reversed.
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [lo, hi] = fromDate <= toDate ? [fromDate, toDate] : [toDate, fromDate];
    return this.warehouse.getDocumentAnalytics(documentId, lo, hi);
  }
```

Update the ingest test's `setup()` to pass a 4th arg (`{} as PrismaService`) to the constructor so existing tests still compile.

- [x] **Step 4: Register AnalyticsModule**

In `packages/backend/src/app.module.ts`, add the import after line 17 and register in the `imports` array (after `UserDocStylesModule`):

```typescript
import { AnalyticsModule } from './analytics/analytics.module';
// ...
    UserDocStylesModule,
    AnalyticsModule,
```

- [x] **Step 5: Run backend tests + build**

Run: `pnpm --filter @wafflebase/backend test -- analytics && pnpm --filter @wafflebase/backend build`
Expected: PASS + clean build.

- [x] **Step 6: Document env + endpoints in backend README**

Add to `packages/backend/README.md` env table + API section: `WAFFLEBASE_KAFKA_ADDRESSES`, `WAFFLEBASE_KAFKA_TOPIC`, `WAFFLEBASE_STARROCKS_DSN` (all optional; unset = analytics disabled) and the two routes (`POST /internal/analytics/view-events`, `GET /documents/:id/analytics`).

- [x] **Step 7: Commit**

```bash
git add packages/backend/src/analytics/ packages/backend/src/app.module.ts packages/backend/README.md
git commit -m "Analytics: manager-gated document dashboard endpoint"
```

---

## Task 6: Frontend analytics API client + id helpers

**Files:**
- Create: `packages/frontend/src/api/analytics.ts`
- Test: `packages/frontend/src/api/analytics.test.ts`

**Interfaces:**
- Produces: `getVisitorId(): string`, `newSessionId(): string`, `sendViewEvents(input): void`, `getDocumentAnalytics(documentId, range?): Promise<DocumentAnalytics>`, type `DocumentAnalytics` (mirrors backend).

- [x] **Step 1: Write the failing id-helper test**

```typescript
// packages/frontend/src/api/analytics.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getVisitorId, newSessionId } from "./analytics";

describe("analytics id helpers", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
  });
  it("persists a stable visitor id across calls", () => {
    const a = getVisitorId();
    const b = getVisitorId();
    expect(a).toBe(b);
    expect(a).toMatch(/[0-9a-f-]{36}/);
  });
  it("mints a fresh session id each call", () => {
    expect(newSessionId()).not.toBe(newSessionId());
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- analytics`
Expected: FAIL ("Cannot find module './analytics'")

- [x] **Step 3: Implement the client**

```typescript
// packages/frontend/src/api/analytics.ts
import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";

const VISITOR_KEY = "wb_visitor_id";

export type ViewEventType = "open" | "heartbeat" | "tabchange" | "close";

export interface DocumentAnalytics {
  enabled: boolean;
  totalViews: number;
  uniqueVisitors: number;
  returningVisitors: number;
  avgDwellSeconds: number;
  viewsByDay: { date: string; value: number }[];
  byShareLink: { shareLinkId: string; views: number; uniqueVisitors: number }[];
  byTarget: { target: string; views: number }[];
}

/** Stable, opaque, per-browser id for returning-visitor counting (not PII). */
export function getVisitorId(): string {
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

/** Fresh id per visit; groups events for dwell-time computation. */
export function newSessionId(): string {
  return crypto.randomUUID();
}

interface SendInput {
  shareToken: string;
  sessionId: string;
  visitorId: string;
  eventType: ViewEventType;
  target?: string;
  /** Use sendBeacon on unload so the request survives page teardown. */
  beacon?: boolean;
}

const endpoint = () =>
  `${import.meta.env.VITE_BACKEND_API_URL}/internal/analytics/view-events`;

/** Fire-and-forget; never throws into the render path. */
export function sendViewEvents(input: SendInput): void {
  const payload = JSON.stringify({
    shareToken: input.shareToken,
    events: [
      {
        sessionId: input.sessionId,
        visitorId: input.visitorId,
        eventType: input.eventType,
        target: input.target,
      },
    ],
  });
  try {
    if (input.beacon && navigator.sendBeacon) {
      navigator.sendBeacon(endpoint(), new Blob([payload], { type: "application/json" }));
      return;
    }
    void fetch(endpoint(), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // analytics must never break a view
  }
}

export async function getDocumentAnalytics(
  documentId: string,
  range?: { from?: string; to?: string },
): Promise<DocumentAnalytics> {
  const qs = new URLSearchParams();
  if (range?.from) qs.set("from", range.from);
  if (range?.to) qs.set("to", range.to);
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${documentId}/analytics${suffix}`,
  );
  await assertOk(res, "Failed to load analytics");
  return res.json();
}
```

- [x] **Step 4: Run to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- analytics`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/api/analytics.ts packages/frontend/src/api/analytics.test.ts
git commit -m "Analytics: frontend API client + visitor/session ids"
```

---

## Task 7: Beacon lifecycle hook + wire into shared route

**Files:**
- Create: `packages/frontend/src/hooks/use-view-analytics.ts`
- Test: `packages/frontend/src/hooks/use-view-analytics.test.ts`
- Modify: `packages/frontend/src/app/shared/shared-document.tsx` (call the hook)

**Interfaces:**
- Consumes: `sendViewEvents`, `getVisitorId`, `newSessionId` (Task 6).
- Produces: `useViewAnalytics({ shareToken, enabled, target })` — emits `open` on mount, `heartbeat` every 30s while visible, `tabchange` when `target` changes, `close` (beacon) on unmount/pagehide.

- [x] **Step 1: Write the failing hook test**

```typescript
// packages/frontend/src/hooks/use-view-analytics.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sent: { eventType: string; target?: string }[] = [];
vi.mock("@/api/analytics", () => ({
  sendViewEvents: (i: { eventType: string; target?: string }) => sent.push(i),
  getVisitorId: () => "v-1",
  newSessionId: () => "s-1",
}));

import { renderHook, act } from "@testing-library/react";
import { useViewAnalytics } from "./use-view-analytics";

describe("useViewAnalytics", () => {
  beforeEach(() => { sent.length = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("emits open on mount and close on unmount", () => {
    const { unmount } = renderHook(() =>
      useViewAnalytics({ shareToken: "tok", enabled: true }),
    );
    expect(sent.map((s) => s.eventType)).toContain("open");
    act(() => unmount());
    expect(sent.map((s) => s.eventType)).toContain("close");
  });

  it("emits heartbeat on the 30s interval", () => {
    renderHook(() => useViewAnalytics({ shareToken: "tok", enabled: true }));
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(sent.filter((s) => s.eventType === "heartbeat").length).toBeGreaterThanOrEqual(1);
  });

  it("does nothing when disabled", () => {
    renderHook(() => useViewAnalytics({ shareToken: "tok", enabled: false }));
    expect(sent).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- use-view-analytics`
Expected: FAIL ("Cannot find module './use-view-analytics'")

- [x] **Step 3: Implement the hook**

```typescript
// packages/frontend/src/hooks/use-view-analytics.ts
import { useEffect, useRef } from "react";
import {
  getVisitorId,
  newSessionId,
  sendViewEvents,
  type ViewEventType,
} from "@/api/analytics";

const HEARTBEAT_MS = 30_000;

interface Options {
  shareToken: string;
  enabled: boolean;
  /** Current tab/slide identifier; a change emits a `tabchange` event. */
  target?: string;
}

/**
 * Records a share-link viewing session: open on mount, periodic heartbeat
 * while the tab is visible, tabchange on target change, and close (via
 * sendBeacon) on teardown. All sends are fire-and-forget.
 */
export function useViewAnalytics({ shareToken, enabled, target }: Options): void {
  const sessionRef = useRef<string>("");
  const visitorRef = useRef<string>("");
  const lastTarget = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!enabled || !shareToken) return;
    const sessionId = newSessionId();
    const visitorId = getVisitorId();
    sessionRef.current = sessionId;
    visitorRef.current = visitorId;
    lastTarget.current = target;

    const emit = (eventType: ViewEventType, beacon = false) =>
      sendViewEvents({
        shareToken,
        sessionId,
        visitorId,
        eventType,
        target: lastTarget.current,
        beacon,
      });

    emit("open");

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") emit("heartbeat");
    }, HEARTBEAT_MS);

    const onHide = () => emit("close", true);
    window.addEventListener("pagehide", onHide);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", onHide);
      emit("close", true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareToken, enabled]);

  // Emit tabchange when the target changes within an open session.
  useEffect(() => {
    if (!enabled || !sessionRef.current) return;
    if (target === lastTarget.current) return;
    lastTarget.current = target;
    sendViewEvents({
      shareToken,
      sessionId: sessionRef.current,
      visitorId: visitorRef.current,
      eventType: "tabchange",
      target,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
}
```

- [x] **Step 4: Run to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- use-view-analytics`
Expected: PASS (3 tests)

- [x] **Step 5: Wire into the shared route**

In `packages/frontend/src/app/shared/shared-document.tsx`, inside `SharedDocumentInner` (which has `resolved` and the route `token`), call the hook once for the session. The `token` comes from `useParams`; pass `resolved.role`-independent `enabled: true` (both viewer and editor share-link access count). Import at top:

```typescript
import { useViewAnalytics } from "@/hooks/use-view-analytics";
```

Then within `SharedDocumentInner`, near the top of the component body:

```typescript
  const { token } = useParams<{ token: string }>();
  useViewAnalytics({ shareToken: token ?? "", enabled: Boolean(token) });
```

(For spreadsheet tab-level granularity, a follow-up can thread `activeTabId` from `SharedDocumentLayout` into a second `useViewAnalytics` target; v1 ships session-level for all types and tab-level is additive. Keep v1 to the session-level call above to stay within the single-PR scope unless `activeTabId` is trivially available where the hook is mounted.)

- [x] **Step 6: Run frontend build + tests**

Run: `pnpm --filter @wafflebase/frontend test -- analytics use-view-analytics && pnpm --filter @wafflebase/frontend build`
Expected: PASS + clean build.

- [x] **Step 7: Commit**

```bash
git add packages/frontend/src/hooks/use-view-analytics.ts packages/frontend/src/hooks/use-view-analytics.test.ts packages/frontend/src/app/shared/shared-document.tsx
git commit -m "Analytics: beacon lifecycle hook wired into shared route"
```

---

## Task 8: Document analytics dashboard page + route

**Files:**
- Create: `packages/frontend/src/app/analytics/document-analytics.tsx`
- Modify: `packages/frontend/src/App.tsx` (add `/analytics/:id` route + entry link)

**Interfaces:**
- Consumes: `getDocumentAnalytics`, `DocumentAnalytics` (Task 6); TanStack Query `useQuery`.
- Produces: `DocumentAnalyticsPage` default export mounted at `/analytics/:id`.

- [x] **Step 1: Implement the dashboard page**

```typescript
// packages/frontend/src/app/analytics/document-analytics.tsx
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getDocumentAnalytics } from "@/api/analytics";
import { Loader } from "@/components/loader";

export function DocumentAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["analytics", id],
    queryFn: () => getDocumentAnalytics(id!),
    enabled: Boolean(id),
  });

  if (isLoading) return <Loader />;
  if (error) return <div className="p-6">Failed to load analytics.</div>;
  if (!data) return null;
  if (!data.enabled) {
    return <div className="p-6">Analytics is not enabled for this deployment.</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Document Analytics</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Total views" value={data.totalViews} />
        <Stat label="Unique visitors" value={data.uniqueVisitors} />
        <Stat label="Returning visitors" value={data.returningVisitors} />
        <Stat label="Avg. dwell (s)" value={data.avgDwellSeconds} />
      </div>

      <section>
        <h2 className="mb-2 font-medium">By share link</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th>Share link</th><th>Views</th><th>Unique</th>
            </tr>
          </thead>
          <tbody>
            {data.byShareLink.map((r) => (
              <tr key={r.shareLinkId}>
                <td className="font-mono">{r.shareLinkId.slice(0, 8)}</td>
                <td>{r.views}</td><td>{r.uniqueVisitors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 font-medium">By tab / slide</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground"><th>Target</th><th>Views</th></tr>
          </thead>
          <tbody>
            {data.byTarget.map((r) => (
              <tr key={r.target}><td className="font-mono">{r.target}</td><td>{r.views}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

export default DocumentAnalyticsPage;
```

- [x] **Step 2: Add the route**

In `packages/frontend/src/App.tsx`, add a lazy import and a route `/analytics/:id` (JWT-protected area, same as owner routes). Mirror the existing owner-route registration pattern (e.g. the `/d/:id` route block). Add a manager entry point later via the document context menu / share dialog ("View analytics" → `/analytics/:id`); a minimal link is acceptable for v1.

- [x] **Step 3: Run frontend build**

Run: `pnpm --filter @wafflebase/frontend build`
Expected: clean build (route resolves, page compiles).

- [x] **Step 4: Commit**

```bash
git add packages/frontend/src/app/analytics/document-analytics.tsx packages/frontend/src/App.tsx
git commit -m "Analytics: per-document dashboard page and route"
```

---

## Task 9: Full verify + self code review

- [x] **Step 1: Run the pre-commit gate**

Run: `pnpm verify:fast`
Expected: lint + unit tests PASS. Fix any failures (see `docs/tasks` lessons for stale-dist gotchas — rebuild producer packages if cross-package types are stale).

- [x] **Step 2: Run the self/build lane**

Run: `pnpm verify:self`
Expected: PASS, including `verify:entropy` doc-ref checks (the design doc already passes; ensure README edits don't add broken backtick refs).

- [x] **Step 3: Dispatch a code review over the branch diff**

Run the `/code-review` skill (or `superpowers:requesting-code-review`) over the full branch diff. Apply blocking findings; note non-blocking as known limitations in the lessons file.

- [x] **Step 4: Manual smoke (UI changed)**

With `docker compose up -d` + `pnpm dev`: open a share link, confirm the app works with analytics **disabled** (no Kafka/StarRocks env) — no console errors, beacon POST returns 2xx or fails silently without breaking the view. Optionally bring up Yorkie's analytics docker-compose and confirm events land and the dashboard renders.

---

## Task 10: Capture lessons + archive

- [x] **Step 1:** Fill `docs/tasks/active/20260717-share-link-analytics-lessons.md` with what was non-obvious (StarRocks no-prepared-stmt interpolation, cross-namespace DNS, sendBeacon dwell semantics, degrade-to-no-op).
- [x] **Step 2:** `pnpm tasks:archive && pnpm tasks:index`, commit task docs + `tasks/README.md` together.

---

## Task 11: Open the PR

- [x] **Step 1:** `git fetch && git rebase origin/main` to surface conflicts.
- [x] **Step 2:** Push branch, open PR. Title ≤70 chars: `Share Link view analytics via Kafka + StarRocks`. Body = Summary + Test plan. Note that DevOps (Task 12) is a prerequisite in the separate repo and analytics stays disabled until those env vars are set.

---

## Task 12: DevOps infra (separate repo `yorkie-team/devops`)

> Not part of the wafflesheets PR. Prerequisite for the feature to produce real data. Landed as a separate devops PR.

- [x] **Step 1: StarRocks schema** — add the `wafflebase` database + `view_events` table + Routine Load (JSON) as in `docs/design/share-link-analytics.md`. Broker `yorkie-analytics-kafka.analytics.svc.cluster.local:9092`, topic `wafflebase-view-events`, group `wafflebase_view_events_group`. Apply via the analytics init path (mirror the yorkie repo `build/docker/analytics` init SQL, plus the production StarRocks FE).

- [x] **Step 2: Kafka topic** — ensure `wafflebase-view-events` exists (auto-create or explicit) in the `analytics`-namespace Kafka.

- [x] **Step 3: Watcher CronJob** — in `k8s/cluster/starrocks-routine-load-watcher.yaml`, add a `wafflebase` DB block that iterates `for job in view_events` on `SHOW ROUTINE LOAD FOR wafflebase.$job` and RESUMEs when PAUSED (parallel to the existing `yorkie` loop).

- [x] **Step 4: Deployment env** — in `k8s/wafflebase/deployment.yaml`, add:
  - `WAFFLEBASE_KAFKA_ADDRESSES=yorkie-analytics-kafka.analytics.svc.cluster.local:9092`
  - `WAFFLEBASE_KAFKA_TOPIC=wafflebase-view-events`
  - `WAFFLEBASE_STARROCKS_DSN=root:@tcp(kube-starrocks-fe-search.analytics.svc.cluster.local:9030)/wafflebase`

- [x] **Step 5: Verify reachability** — confirm the `wafflebase` namespace resolves `*.analytics.svc.cluster.local` (no NetworkPolicy blocks it), then merge → ArgoCD auto-syncs.

---

## Review

_(Fill in after implementation.)_

## Audit closure (2026-07-18)

Archived during the v0.6.1 release audit. The wafflesheets feature (Tasks
1–11) shipped as **#491** (`320baf536`, "Share Link view analytics via
Kafka + StarRocks"); the manager/workspace dashboards, beacon hook, and
degrade-to-no-op path are all live. Boxes ticked for closure. **Task 12
(DevOps infra)** lives in the separate `yorkie-team/devops` repo (StarRocks
schema, Kafka topic, watcher CronJob, deployment env) and is owned/tracked
there, not in this repo; it was not re-verified in this audit. Analytics
stays a no-op until those env vars are set on the deployment.
