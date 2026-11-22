import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/auth.types';
import { WebhookService } from './webhook.service';

/**
 * What removing a member would delete or turn off, for the confirm dialog in
 * Settings → Members. It sits under the members path rather than the webhook
 * prefix because it also counts the private chat channels the removal would
 * delete; it lives here because `WebhookModule` already depends on
 * `WorkspaceModule`, and the reverse would be a cycle.
 */
@Controller('workspaces/:workspaceId/members')
@UseGuards(JwtAuthGuard)
export class MemberRemovalImpactController {
  constructor(private readonly webhookService: WebhookService) {}

  @Get(':userId/removal-impact')
  removalImpact(
    @Param('workspaceId') workspaceId: string,
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhookService.removalImpact(
      workspaceId,
      Number(req.user.id),
      userId,
    );
  }
}
