import { Module } from '@nestjs/common';
import { MiroController } from './miro.controller';
import { MiroService } from './miro.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ImageModule } from '../image/image.module';

@Module({
  imports: [WorkspaceModule, ImageModule],
  controllers: [MiroController],
  providers: [MiroService],
})
export class MiroModule {}
