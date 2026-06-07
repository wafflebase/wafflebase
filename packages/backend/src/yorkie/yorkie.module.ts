import { Global, Module } from '@nestjs/common';
import { YorkieAdminService } from './yorkie-admin.service';
import { YorkieService } from './yorkie.service';

@Global()
@Module({
  providers: [YorkieService, YorkieAdminService],
  exports: [YorkieService, YorkieAdminService],
})
export class YorkieModule {}
