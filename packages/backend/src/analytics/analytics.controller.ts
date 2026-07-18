import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../database/prisma.service';
import { isDocumentManager } from '../document/document-access';
import { ShareLinkService } from '../share-link/share-link.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { AnalyticsProducerService } from './analytics-producer.service';
import { AnalyticsWarehouseService } from './analytics-warehouse.service';
import { coarseUserAgent } from './coarse-user-agent';
import {
  DocumentAnalytics,
  ViewEvent,
  ViewEventInput,
  VIEW_EVENT_TYPES,
  WorkspaceAnalytics,
} from './analytics.types';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';

interface IngestBody {
  shareToken: string;
  events: ViewEventInput[];
}

function nowStarRocks(): string {
  // StarRocks DATETIME: 'YYYY-MM-DD HH:MM:SS' (UTC).
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// Default window: last 30 days. Fall back to defaults on unparsable from/to
// (Invalid Date would otherwise blow up downstream); swap a reversed range.
function resolveWindow(from?: string, to?: string): [Date, Date] {
  const toDate =
    to && !Number.isNaN(Date.parse(to)) ? new Date(to) : new Date();
  const fromDate =
    from && !Number.isNaN(Date.parse(from))
      ? new Date(from)
      : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  return fromDate <= toDate ? [fromDate, toDate] : [toDate, fromDate];
}

@Controller()
export class AnalyticsController {
  constructor(
    private readonly producer: AnalyticsProducerService,
    private readonly warehouse: AnalyticsWarehouseService,
    private readonly shareLink: ShareLinkService,
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}

  @Post('internal/analytics/view-events')
  @UseGuards(OptionalJwtAuthGuard)
  async ingest(
    @Body() rawBody: IngestBody | string,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    // Beacons are sent as text/plain — a CORS-safelisted content type — so
    // navigator.sendBeacon and keepalive fetch avoid a cross-origin preflight
    // that the beacon transport cannot perform. Parse the JSON payload here.
    let parsed: unknown;
    try {
      parsed = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    } catch {
      throw new BadRequestException('invalid JSON body');
    }
    const body = parsed as IngestBody;

    if (
      !body?.shareToken ||
      !Array.isArray(body.events) ||
      body.events.length === 0
    ) {
      throw new BadRequestException('shareToken and events are required');
    }
    if (body.events.length > 50) {
      throw new BadRequestException('too many events in one batch');
    }
    if (!this.producer.isEnabled()) {
      return { ok: true };
    }

    // Server-derived attribution: the client cannot claim a document, link,
    // role, or user — all come from the resolved share token / session.
    const link = await this.shareLink.findByToken(body.shareToken);
    const user = (req as unknown as { user?: { id: number } | null }).user;
    const userId = user ? String(user.id) : '';
    const userAgent = coarseUserAgent(req.headers['user-agent']);
    const timestamp = nowStarRocks();

    const enriched: ViewEvent[] = body.events.map((e) => {
      // Client-supplied events are unvalidated JSON — guard every field's
      // runtime shape so a malformed event returns 400, not 500.
      if (!e || typeof e !== 'object') {
        throw new BadRequestException('invalid event');
      }
      if (!VIEW_EVENT_TYPES.includes(e.eventType)) {
        throw new BadRequestException(`invalid event type: ${e.eventType}`);
      }
      if (
        typeof e.sessionId !== 'string' ||
        typeof e.visitorId !== 'string' ||
        !e.sessionId ||
        !e.visitorId
      ) {
        throw new BadRequestException('sessionId and visitorId are required');
      }
      if (e.target != null && typeof e.target !== 'string') {
        throw new BadRequestException('invalid target');
      }
      return {
        document_id: link.documentId,
        share_link_id: link.id,
        session_id: e.sessionId.slice(0, 64),
        visitor_id: e.visitorId.slice(0, 64),
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

  /** Whether the analytics dashboards have a warehouse to read from. The
   * frontend uses this to hide the Analytics nav entry when the deployment
   * has no StarRocks configured. */
  @Get('analytics/enabled')
  @UseGuards(JwtAuthGuard)
  analyticsEnabled(): { enabled: boolean } {
    return { enabled: this.warehouse.isEnabled() };
  }

  @Get('documents/:id/analytics')
  @UseGuards(JwtAuthGuard)
  async dashboard(
    @Param('id') documentId: string,
    @Req() req: Request,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ): Promise<DocumentAnalytics> {
    const userId = Number((req as unknown as { user: { id: number } }).user.id);
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: doc.workspaceId, userId } },
    });
    if (!isDocumentManager(membership?.role, doc.authorID, userId)) {
      throw new ForbiddenException(
        'Only a document manager can view analytics',
      );
    }

    const [lo, hi] = resolveWindow(from, to);
    return this.warehouse.getDocumentAnalytics(documentId, lo, hi);
  }

  @Get('workspaces/:workspaceId/analytics')
  @UseGuards(JwtAuthGuard)
  async workspaceDashboard(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() req: Request,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ): Promise<WorkspaceAnalytics> {
    const userId = Number((req as unknown as { user: { id: number } }).user.id);
    // Gate on plain workspace membership (any member sees workspace analytics).
    const workspaceId = await this.workspace.resolveId(workspaceIdOrSlug);
    await this.workspace.assertMember(workspaceId, userId);

    // Postgres owns the doc set + titles; StarRocks only knows document_id.
    const docs = await this.prisma.document.findMany({
      where: { workspaceId },
      select: { id: true, title: true },
    });
    const titles = new Map(docs.map((d) => [d.id, d.title]));
    const [lo, hi] = resolveWindow(from, to);
    const result = await this.warehouse.getWorkspaceAnalytics(
      docs.map((d) => d.id),
      lo,
      hi,
    );
    return {
      ...result,
      byDocument: result.byDocument.map((r) => ({
        ...r,
        title: titles.get(r.documentId) ?? r.documentId,
      })),
    };
  }
}
