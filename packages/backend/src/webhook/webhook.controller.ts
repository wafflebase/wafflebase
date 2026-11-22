import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/auth.types';
import {
  CreateWebhookDto,
  EnableWebhookDto,
  ListDeliveriesQueryDto,
  RotateSecretDto,
  UpdateWebhookDto,
} from './webhook.dto';
import { WebhookService } from './webhook.service';

/**
 * JWT only, never an API key: a leaked `write`-scoped key must not be able to
 * register an exfiltration endpoint. Owner-only except the list, which
 * members read host-only. Another workspace's webhook id answers 404.
 * Authorization lives in `WebhookService`, so every route gets it the same way.
 */
@Controller('workspaces/:workspaceId/webhooks')
@UseGuards(JwtAuthGuard)
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Get()
  list(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhookService.list(workspaceId, Number(req.user.id));
  }

  @Post()
  create(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateWebhookDto,
  ) {
    return this.webhookService.create(workspaceId, Number(req.user.id), body);
  }

  @Get(':id')
  get(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhookService.get(workspaceId, Number(req.user.id), id);
  }

  @Patch(':id')
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateWebhookDto,
  ) {
    return this.webhookService.update(
      workspaceId,
      Number(req.user.id),
      id,
      body,
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.webhookService.remove(workspaceId, Number(req.user.id), id);
  }

  @Post(':id/test')
  @HttpCode(200)
  test(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhookService.test(workspaceId, Number(req.user.id), id);
  }

  @Post(':id/reveal-secret')
  @HttpCode(200)
  revealSecret(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhookService.revealSecret(
      workspaceId,
      Number(req.user.id),
      id,
    );
  }

  @Post(':id/rotate-secret')
  @HttpCode(200)
  rotateSecret(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: RotateSecretDto,
  ) {
    return this.webhookService.rotateSecret(
      workspaceId,
      Number(req.user.id),
      id,
      body?.overlapHours,
    );
  }

  @Post(':id/enable')
  @HttpCode(200)
  enable(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: EnableWebhookDto,
  ) {
    return this.webhookService.enable(
      workspaceId,
      Number(req.user.id),
      id,
      body?.recoverSince,
    );
  }

  @Post(':id/disable')
  @HttpCode(200)
  disable(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhookService.disable(workspaceId, Number(req.user.id), id);
  }

  @Get(':id/deliveries')
  listDeliveries(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Query() query: ListDeliveriesQueryDto,
  ) {
    return this.webhookService.listDeliveries(
      workspaceId,
      Number(req.user.id),
      id,
      query,
    );
  }

  @Get(':id/deliveries/:deliveryId')
  getDelivery(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhookService.getDelivery(
      workspaceId,
      Number(req.user.id),
      id,
      deliveryId,
    );
  }

  @Post(':id/deliveries/:deliveryId/redeliver')
  @HttpCode(200)
  redeliver(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhookService.redeliver(
      workspaceId,
      Number(req.user.id),
      id,
      deliveryId,
    );
  }
}
