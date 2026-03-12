import { Global, Module } from '@nestjs/common';
import { YorkieService } from './yorkie.service';

@Global()
@Module({
  providers: [YorkieService],
  exports: [YorkieService],
})
export class YorkieModule {}
