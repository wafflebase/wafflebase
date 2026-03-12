import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import yorkie, { Client, Document, SyncMode } from '@yorkie-js/sdk';
import { SpreadsheetDocument } from './yorkie.types';

@Injectable()
export class YorkieService implements OnModuleInit, OnModuleDestroy {
  private client: Client;
  private readonly logger = new Logger(YorkieService.name);

  constructor(private configService: ConfigService) {
    const rpcAddr =
      this.configService.get<string>('YORKIE_RPC_ADDR') ??
      'http://localhost:8080';
    this.client = new yorkie.Client({ rpcAddr });
  }

  async onModuleInit() {
    await this.client.activate();
    this.logger.log('Yorkie client activated');
  }

  async onModuleDestroy() {
    await this.client.deactivate();
    this.logger.log('Yorkie client deactivated');
  }

  async withDocument<T>(
    documentId: string,
    callback: (doc: Document<SpreadsheetDocument>) => T | Promise<T>,
  ): Promise<T> {
    const doc = new yorkie.Document<SpreadsheetDocument>(
      `sheet-${documentId}`,
    );
    await this.client.attach(doc, { syncMode: SyncMode.Manual });
    try {
      const result = await callback(doc);
      await this.client.sync(doc);
      return result;
    } finally {
      await this.client.detach(doc);
    }
  }
}
