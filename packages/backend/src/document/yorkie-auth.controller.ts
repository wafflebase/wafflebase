import { Body, Controller, Logger, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService, YorkieTokenPayload } from '../auth/auth.service';
import { DocumentService } from './document.service';
import { ShareLinkService } from '../share-link/share-link.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { parseYorkieDocKey } from '../yorkie/yorkie-doc-key';
import { YorkieSignatureGuard } from './yorkie-signature.guard';

/**
 * Yorkie auth-webhook request body (yorkie 0.7.12,
 * `api/types/auth_webhook.go`). `verb` is `"r"` (read) or `"rw"` (read-write).
 */
type Verb = 'r' | 'rw';
interface AuthAttribute {
  key?: string;
  verb?: Verb;
}
interface YorkieAuthBody {
  token?: string;
  method?: string;
  attributes?: AuthAttribute[];
}

/**
 * The decision, before the shadow/enforce gate. `status`/`allowed` must stay
 * consistent because yorkie only accepts three (status, allowed) pairs
 * (`server/rpc/auth/webhook.go#handleWebhookResponse`): `200 + true` (allow),
 * `403 + false` (permission denied), `401 + false` (unauthenticated → the
 * client refreshes its token via `authTokenInjector` and retries). Any other
 * pair is treated by yorkie as an invalid response.
 */
interface AuthDecision {
  status: 200 | 401 | 403;
  allowed: boolean;
  reason: string;
}

const ALLOW: AuthDecision = { status: 200, allowed: true, reason: 'ok' };
const UNAUTHENTICATED: AuthDecision = {
  status: 401,
  allowed: false,
  reason: 'invalid or expired token',
};

/**
 * `DetachDocument` is always allowed: a client must be able to detach (and let
 * Yorkie GC its tombstones) even after its access was revoked or its token
 * expired mid-session. See `docs/design/yorkie-auth-webhook.md`.
 */
const ALWAYS_ALLOWED_METHOD = 'DetachDocument';

/** Methods with no document context — a valid token is sufficient. */
const CLIENT_METHODS = new Set(['ActivateClient', 'DeactivateClient']);

/**
 * Yorkie **auth** webhook: server-enforced per-document read/write access. On
 * privileged RPCs Yorkie POSTs `{ token, method, attributes:[{key, verb}] }`
 * here; we resolve the token to an identity and check it against the Postgres
 * permission model (`WorkspaceMember` / `ShareLink`) per document key + verb.
 *
 * Authenticated by HMAC signature ({@link YorkieSignatureGuard}, shared with
 * the event webhook) — the signature proves the caller is Yorkie; the `token`
 * in the body proves who the end user is.
 *
 * Rollout: while `YORKIE_AUTH_WEBHOOK_ENFORCE` is not `true`, the computed
 * decision is logged but never enforced (always returns allow), so the webhook
 * can be registered and observed before it starts denying traffic.
 */
@Controller('internal/yorkie')
@SkipThrottle()
@UseGuards(YorkieSignatureGuard)
export class YorkieAuthController {
  private readonly logger = new Logger(YorkieAuthController.name);
  private readonly enforce: boolean;

  constructor(
    private readonly authService: AuthService,
    private readonly documentService: DocumentService,
    private readonly workspaceService: WorkspaceService,
    private readonly shareLinkService: ShareLinkService,
    configService: ConfigService,
  ) {
    this.enforce =
      configService.get<string>('YORKIE_AUTH_WEBHOOK_ENFORCE') === 'true';
  }

  @Post('auth')
  async handleAuth(
    @Body() body: YorkieAuthBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ allowed: boolean; reason: string }> {
    const decision = await this.decide(body);

    if (!this.enforce && !decision.allowed) {
      // Shadow mode: surface what we *would* have done, but let the request
      // through so a resolver bug can't lock everyone out during rollout.
      this.logger.warn(
        `[shadow] would deny method=${body?.method} status=${decision.status} reason=${decision.reason}`,
      );
      res.status(ALLOW.status);
      return { allowed: ALLOW.allowed, reason: 'shadow' };
    }

    res.status(decision.status);
    return { allowed: decision.allowed, reason: decision.reason };
  }

  /**
   * Pure-ish authorization decision (no HTTP concerns), so it can be unit
   * tested directly. Unknown methods fall through to the generic
   * verify-token-then-check-attributes path.
   */
  async decide(body: YorkieAuthBody): Promise<AuthDecision> {
    const method = body?.method ?? '';
    if (method === ALWAYS_ALLOWED_METHOD) {
      return ALLOW;
    }

    let identity: YorkieTokenPayload;
    try {
      identity = this.authService.verifyYorkieToken(body?.token ?? '');
    } catch {
      return UNAUTHENTICATED;
    }

    // Client-scoped methods carry no document; a valid token is enough.
    if (CLIENT_METHODS.has(method)) {
      return ALLOW;
    }

    // A document-scoped method must name the document(s) it targets. An empty
    // attribute list leaves nothing to authorize, so fail closed rather than
    // blanket-allow — a would-be bypass then surfaces as a shadow-mode log
    // before enforcement is turned on.
    if (!body?.attributes?.length) {
      return {
        status: 403,
        allowed: false,
        reason: 'missing document attributes',
      };
    }

    for (const attr of body.attributes) {
      const denied = await this.checkAttribute(identity, attr);
      if (denied) {
        return denied;
      }
    }
    return ALLOW;
  }

  /** Returns a deny decision, or `null` when the attribute is allowed. */
  private async checkAttribute(
    identity: YorkieTokenPayload,
    attr: AuthAttribute,
  ): Promise<AuthDecision | null> {
    const parsed = attr.key ? parseYorkieDocKey(attr.key) : null;
    if (!parsed) {
      return { status: 403, allowed: false, reason: 'unknown document key' };
    }
    const needWrite = attr.verb === 'rw';
    const ok = await this.hasAccess(identity, parsed.id, needWrite);
    return ok
      ? null
      : { status: 403, allowed: false, reason: 'no access to document' };
  }

  private async hasAccess(
    identity: YorkieTokenPayload,
    documentId: string,
    needWrite: boolean,
  ): Promise<boolean> {
    if (identity.typ === 'yorkie') {
      // Need the document's workspace to check membership. Membership grants
      // read+write; the model has no per-member viewer role today (see design
      // doc's granularity note).
      const doc = await this.documentService.document({ id: documentId });
      if (!doc) {
        return false;
      }
      try {
        await this.workspaceService.assertMember(doc.workspaceId, identity.sub);
        return true;
      } catch {
        return false;
      }
    }

    // Anonymous share visitor: the link decides the role and the document.
    // `findByToken` already loads + validates the document (FK, expiry), so no
    // separate document read is needed here.
    try {
      const link = await this.shareLinkService.findByToken(identity.shareToken);
      if (link.documentId !== documentId) {
        return false;
      }
      return needWrite ? link.role === 'editor' : true;
    } catch {
      return false;
    }
  }
}
