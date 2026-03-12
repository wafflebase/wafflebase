import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { DocumentModule } from './document/document.module';
import { ShareLinkModule } from './share-link/share-link.module';
import { DataSourceModule } from './datasource/datasource.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { ApiKeyModule } from './api-key/api-key.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    DocumentModule,
    ShareLinkModule,
    DataSourceModule,
    WorkspaceModule,
    ApiKeyModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
