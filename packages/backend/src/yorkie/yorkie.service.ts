import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import yorkie, { Document, SyncMode } from '@yorkie-js/sdk';
import { SpreadsheetDocument } from './yorkie.types';

export interface WithDocumentOptions {
  syncMode?: 'readwrite' | 'readonly';
}

@Injectable()
export class YorkieService {
  private readonly logger = new Logger(YorkieService.name);
  private readonly rpcAddr: string;
  private readonly apiKey?: string;

  constructor(private configService: ConfigService) {
    this.rpcAddr =
      this.configService.get<string>('YORKIE_RPC_ADDR') ??
      'http://localhost:8080';
    this.apiKey = this.configService.get<string>('YORKIE_API_KEY');
  }

  async withDocument<T>(
    documentId: string,
    callback: (doc: Document<SpreadsheetDocument>) => T | Promise<T>,
    options?: WithDocumentOptions,
  ): Promise<T> {
    const client = new yorkie.Client({
      rpcAddr: this.rpcAddr,
      apiKey: this.apiKey,
    });
    const doc = new yorkie.Document<SpreadsheetDocument>(
      `sheet-${documentId}`,
    );
    let attached = false;
    try {
      await client.activate();
      await client.attach(doc, { syncMode: SyncMode.Manual });
      attached = true;
      const result = await callback(doc);
      if (options?.syncMode !== 'readonly') {
        await client.sync(doc);
      }
      return result;
    } finally {
      try {
        if (attached) {
          await client.detach(doc);
        }
      } catch (e) {
        this.logger.warn(`detach failed for ${documentId}: ${e}`);
      } finally {
        await client.deactivate();
      }
    }
  }
}
