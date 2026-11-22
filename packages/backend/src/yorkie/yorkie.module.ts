import { Global, Module } from '@nestjs/common';
import { YorkieAdminService } from './yorkie-admin.service';
import { YorkieService } from './yorkie.service';
import { WebhookEventModule } from '../webhook/webhook-event.module';

@Global()
@Module({
  // `/api/v1` content writes record their API key for `content_updated`.
  imports: [WebhookEventModule],
  providers: [YorkieService, YorkieAdminService],
  exports: [YorkieService, YorkieAdminService],
})
export class YorkieModule {}
