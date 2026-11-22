import { Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WebhookService } from './webhook.service';

/**
 * JWT only, never an API key: a leaked `write`-scoped key must not be able to
 * register an exfiltration endpoint. Owner-only except the list, which
 * members read host-only. Another workspace's webhook id answers 404.
 *
 * STUB — routes land separately.
 */
@Controller('workspaces/:workspaceId/webhooks')
@UseGuards(JwtAuthGuard)
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {
    void this.webhookService;
  }
}
