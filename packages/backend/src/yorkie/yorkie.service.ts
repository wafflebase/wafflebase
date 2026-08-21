import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import yorkie, { Document, SyncMode } from '@yorkie-js/sdk';
import { SpreadsheetDocument } from './yorkie.types';
import { YORKIE_DOC_KEY_PREFIXES } from './yorkie-doc-key';

export interface WithDocumentOptions {
  syncMode?: 'readwrite' | 'readonly';
  /**
   * Override the Yorkie document key prefix. Defaults to `'sheet-'` for
   * spreadsheet documents. Word-processor documents use `'doc-'`, matching
   * the frontend convention in `packages/frontend/src/app/docs/docs-detail.tsx`.
   */
  docKeyPrefix?: string;
  /**
   * Seed a brand-new (empty) Yorkie document with this initial root. Yorkie
   * applies it only when the document is empty, so it is idempotent. Pass it on
   * write paths that assume a canonical root shape.
   */
  initialRoot?: Record<string, unknown>;
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
    this.apiKey = this.configService.get<string>('YORKIE_PUBLIC_KEY');
  }

  async withDocument<T, R extends Record<string, unknown> = SpreadsheetDocument>(
    documentId: string,
    callback: (doc: Document<R>) => T | Promise<T>,
    options?: WithDocumentOptions,
  ): Promise<T> {
    const prefix = options?.docKeyPrefix ?? YORKIE_DOC_KEY_PREFIXES.sheet;
    const client = new yorkie.Client({
      rpcAddr: this.rpcAddr,
      apiKey: this.apiKey,
    });
    const doc = new yorkie.Document<R>(`${prefix}${documentId}`);
    let attached = false;
    try {
      await client.activate();
      await client.attach(
        doc,
        options?.initialRoot
          ? { syncMode: SyncMode.Manual, initialRoot: options.initialRoot as R }
          : { syncMode: SyncMode.Manual },
      );
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
