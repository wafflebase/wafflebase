import { Module } from '@nestjs/common';
import { ShareLinkModule } from '../share-link/share-link.module';
import { DemoResetService } from './demo-reset.service';

@Module({
  imports: [ShareLinkModule],
  providers: [DemoResetService],
})
export class DemoResetModule {}
