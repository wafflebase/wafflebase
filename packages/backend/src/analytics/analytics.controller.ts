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
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../database/prisma.service';
import { isDocumentManager } from '../document/document-access';
import { ShareLinkService } from '../share-link/share-link.service';
import { AnalyticsProducerService } from './analytics-producer.service';
import { AnalyticsWarehouseService } from './analytics-warehouse.service';
import { coarseUserAgent } from './coarse-user-agent';
import {
  DocumentAnalytics,
  ViewEvent,
  ViewEventInput,
  VIEW_EVENT_TYPES,
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

@Controller()
export class AnalyticsController {
  constructor(
    private readonly producer: AnalyticsProducerService,
    private readonly warehouse: AnalyticsWarehouseService,
    private readonly shareLink: ShareLinkService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('internal/analytics/view-events')
  @SkipThrottle()
  @UseGuards(OptionalJwtAuthGuard)
  async ingest(
    @Body() body: IngestBody,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
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

    // Default window: last 30 days. Validate range; swap if reversed.
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [lo, hi] =
      fromDate <= toDate ? [fromDate, toDate] : [toDate, fromDate];
    return this.warehouse.getDocumentAnalytics(documentId, lo, hi);
  }
}
