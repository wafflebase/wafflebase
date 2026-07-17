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
import { ViewEvent, ViewEventInput, VIEW_EVENT_TYPES } from './analytics.types';
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
  ) {
    // `warehouse` is unused until the GET /documents/:id/analytics handler
    // lands in a later task; this keeps strict noUnusedLocals happy in the
    // meantime without changing the constructor signature.
    void this.warehouse;
  }

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
}
