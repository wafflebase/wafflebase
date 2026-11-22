import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import yorkie, { Client, Document, SyncMode } from '@yorkie-js/sdk';
import type ms from 'ms';
import { SpreadsheetDocument } from './yorkie.types';
import { YORKIE_DOC_KEY_PREFIXES } from './yorkie-doc-key';
import { yorkieServiceTokenInjector } from './yorkie-service-token';
import {
  type ApiWriterIdentity,
  WebhookEventService,
} from '../webhook/webhook-event.service';
import { currentApiWriter } from '../webhook/api-writer-context';

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
  /**
   * The API key this write is made with, recorded in the document's
   * `content_updated` window before the push so the event names it (the
   * webhook loop guard, docs/design/webhooks.md). Defaults to the key of the
   * current `/api/v1` request (`currentApiWriter`); a JWT session has none.
   */
  writer?: ApiWriterIdentity;
}

@Injectable()
export class YorkieService {
  private readonly logger = new Logger(YorkieService.name);
  private readonly rpcAddr: string;
  private readonly apiKey?: string;
  /**
   * Signing material for the backend's own auth-webhook token, which supplies
   * this client's identity the way the frontend's `authTokenInjector` supplies
   * a user's. Without it the webhook sees an empty token and 401s every
   * server-side attach on a deployment that has registered its methods —
   * which, enforcement being the default, is every deployment that has
   * registered them. See `yorkie-service-token.ts`.
   *
   * Kept as material rather than a ready injector because the token is
   * **scoped to one document key**, and the key is only known per
   * {@link withDocument} call. A leaked or intercepted token then buys the one
   * document the request that minted it was already authorized for, not the
   * whole deployment.
   */
  private readonly tokenSecret?: string;
  private readonly tokenExpiresIn: ms.StringValue;

  constructor(
    private configService: ConfigService,
    // Optional so the e2e suites and tools that build this service by hand
    // keep working; the app always provides it (`YorkieModule` imports
    // `WebhookEventModule`).
    @Optional() private readonly webhookEvents?: WebhookEventService,
  ) {
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
    this.tokenSecret = secret;
    this.tokenExpiresIn = (this.configService.get<string>(
      'YORKIE_TOKEN_EXPIRES_IN',
    ) ?? '10m') as ms.StringValue;
    if (!secret) {
      this.logger.warn(
        'JWT_SECRET is unset, so server-side Yorkie attaches carry no auth ' +
          'token; they will be denied wherever the auth webhook is registered.',
      );
    }
  }

  async withDocument<
    T,
    R extends Record<string, unknown> = SpreadsheetDocument,
  >(
    documentId: string,
    /**
     * `client` is the attached client, for the per-document RPCs that live on
     * it rather than on the document (revisions). It is deactivated when the
     * callback settles, so it must not escape it.
     */
    callback: (doc: Document<R>, client: Client) => T | Promise<T>,
    options?: WithDocumentOptions,
  ): Promise<T> {
    const prefix = options?.docKeyPrefix ?? YORKIE_DOC_KEY_PREFIXES.sheet;
    const docKey = `${prefix}${documentId}`;
    const client = new yorkie.Client({
      rpcAddr: this.rpcAddr,
      apiKey: this.apiKey,
      // Scoped to this one document: the client is built per call, so the
      // token it hands over the wire authorizes nothing else.
      authTokenInjector: yorkieServiceTokenInjector(
        this.tokenSecret,
        this.tokenExpiresIn,
        docKey,
      ),
    });
    const doc = new yorkie.Document<R>(docKey);
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
      const result = await callback(doc, client);
      if (options?.syncMode !== 'readonly') {
        await this.recordApiWrite(documentId, options?.writer);
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

  /**
   * Note an `/api/v1` write in the webhook coalescing window. Best-effort: the
   * write itself is what the caller asked for, and losing one loop-guard
   * entry costs a receiver at most one event it could have skipped.
   */
  private async recordApiWrite(
    documentId: string,
    explicit: ApiWriterIdentity | undefined,
  ): Promise<void> {
    const writer = explicit ?? currentApiWriter();
    if (!writer || !this.webhookEvents?.enabled) return;
    try {
      await this.webhookEvents.noteApiWrite(documentId, writer);
    } catch (e) {
      this.logger.warn(
        `webhook api-writer note failed for ${documentId}: ${e}`,
      );
    }
  }
}
