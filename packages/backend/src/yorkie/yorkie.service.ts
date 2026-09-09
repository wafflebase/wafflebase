import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import yorkie, { Document, SyncMode } from '@yorkie-js/sdk';
import type ms from 'ms';
import { SpreadsheetDocument } from './yorkie.types';
import { YORKIE_DOC_KEY_PREFIXES } from './yorkie-doc-key';
import { signYorkieServiceToken } from './yorkie-service-token';

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
  /**
   * Supplies the backend's own auth-webhook token, the same way the frontend's
   * `authTokenInjector` supplies a user's. Without it the webhook sees an
   * empty token and 401s every server-side attach on a deployment that has
   * registered its methods — which, enforcement being the default, is every
   * deployment that has registered them. See `yorkie-service-token.ts`.
   */
  private readonly authTokenInjector?: () => Promise<string>;

  constructor(private configService: ConfigService) {
    this.rpcAddr =
      this.configService.get<string>('YORKIE_RPC_ADDR') ??
      'http://localhost:8080';
    this.apiKey = this.configService.get<string>('YORKIE_PUBLIC_KEY');

    // `JWT_SECRET` is required for the app to boot at all (`AuthService`), so
    // the unset branch is only reachable from a tool or test that constructs
    // this service with a bare config. Warn rather than throw: such a caller
    // is talking to a Yorkie with no auth webhook registered, and refusing
    // would break it for a token nothing will read.
    const secret = this.configService.get<string>('JWT_SECRET');
    if (secret) {
      const expiresIn = (this.configService.get<string>(
        'YORKIE_TOKEN_EXPIRES_IN',
      ) ?? '10m') as ms.StringValue;
      this.authTokenInjector = () =>
        Promise.resolve(signYorkieServiceToken(secret, expiresIn));
    } else {
      this.logger.warn(
        'JWT_SECRET is unset, so server-side Yorkie attaches carry no auth ' +
          'token; they will be denied wherever the auth webhook is registered.',
      );
    }
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
      authTokenInjector: this.authTokenInjector,
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
