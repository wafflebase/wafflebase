import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DocumentService } from './document.service';
import { parseYorkieDocKey } from '../yorkie/yorkie-doc-key';
import { YorkieSignatureGuard } from './yorkie-signature.guard';

/**
 * Shape of Yorkie's event-webhook body (yorkie 0.7.12,
 * `api/types/event_webhook.go`). Typed loosely and validated by hand so an
 * unexpected/extra field never turns into a 4xx — Yorkie retries on failure,
 * and we would rather swallow-and-200 anything we don't recognize than
 * trigger a retry storm.
 */
interface YorkieEventBody {
  type?: string;
  attributes?: { key?: string; issuedAt?: string };
}

/** The only webhook event type yorkie emits (fired on real root edits). */
const DOCUMENT_ROOT_CHANGED = 'DocumentRootChanged';

/**
 * Receives Yorkie document event webhooks and mirrors the last-edit time into
 * Postgres (`Document.updatedAt`), which is what the documents list orders by.
 * This is how content edits — which flow client → Yorkie only, never through
 * this backend — become visible to the list without a per-request Yorkie admin
 * call. Authenticated by HMAC signature ({@link YorkieSignatureGuard}); not
 * behind the JWT guard. `@SkipThrottle` so bursts of edit events aren't
 * rate-limited away.
 */
@Controller('internal/yorkie')
@SkipThrottle()
@UseGuards(YorkieSignatureGuard)
export class YorkieEventController {
  constructor(private readonly documentService: DocumentService) {}

  @Post('events')
  @HttpCode(200)
  async handleEvent(@Body() body: YorkieEventBody): Promise<{ ok: true }> {
    if (body?.type !== DOCUMENT_ROOT_CHANGED) {
      return { ok: true };
    }

    const key = body.attributes?.key;
    const parsed = key ? parseYorkieDocKey(key) : null;
    if (!parsed) {
      return { ok: true };
    }

    // Trust Yorkie's issue time as the edit time; fall back to now() if it is
    // missing or unparseable. `touchUpdatedAt` only moves the time forward, so
    // out-of-order / duplicate deliveries are harmless.
    const issuedMs = Date.parse(body.attributes?.issuedAt ?? '');
    const at = Number.isNaN(issuedMs) ? new Date() : new Date(issuedMs);

    await this.documentService.touchUpdatedAt(parsed.id, at);
    return { ok: true };
  }
}
