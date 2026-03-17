import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import yorkie, { Document, SyncMode } from '@yorkie-js/sdk';
import { SpreadsheetDocument } from './yorkie.types';

@Injectable()
export class YorkieService {
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
      await client.sync(doc);
      return result;
    } finally {
      try {
        if (attached) {
          await client.detach(doc);
        }
      } finally {
        await client.deactivate();
      }
    }
  }
}
