import { Body, Controller, Logger, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService, YorkieTokenPayload } from '../auth/auth.service';
import { DocumentService } from './document.service';
import { ShareLinkService } from '../share-link/share-link.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { isYorkieAuthEnforced } from '../yorkie/yorkie-auth-enforcement';
import { parseYorkieDocKey } from '../yorkie/yorkie-doc-key';
import { YORKIE_SERVICE_TOKEN_TYPE } from '../yorkie/yorkie-service-token';
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

/**
 * The identities whose access is resolved per document: an end user, or an
 * anonymous share-link visitor. The backend's own service token is answered in
 * {@link YorkieAuthController.decide} before it reaches here, so it is not part
 * of this union.
 */
type DocumentScopedIdentity = Exclude<
  YorkieTokenPayload,
  { typ: typeof YORKIE_SERVICE_TOKEN_TYPE }
>;

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
 * Revision **read** methods. Yorkie sends these with verb `r`, but a
 * document's version history is not part of what a share-link *viewer* is
 * given: `getRevision` returns a full snapshot of every past state, including
 * content that was deleted before the link was ever shared. Google Docs hides
 * version history from viewers and commenters for the same reason, and the
 * viewer route (`shared-document.tsx`) never mounts the history panel at all.
 *
 * So these two require the same authority a write does — workspace membership
 * or a share link with the `editor` role — even though their verb says read.
 * See `docs/design/revision-history.md` §2.
 */
const REVISION_READ_METHODS = new Set(['ListRevisions', 'GetRevision']);

/**
 * Methods whose verb does not mean what it says, and are therefore authorized
 * as a **read** whatever verb they carry.
 *
 * `AttachDocument` is sent with `rw` unconditionally — empirically so even for
 * a brand-new local `Document` with zero local changes attaching to an
 * already-populated remote one, recorded against a real Yorkie server in
 * `test/revision-history.e2e-spec.ts`. Only `PushPull` derives its verb from
 * the change pack (`AccessAttributes(pack)`, `server/rpc/auth/auth.go`), which
 * is why the design doc calls it "the real read/write gate".
 *
 * Taking attach's verb at face value would deny a share-link **viewer** their
 * very first attach, so with enforcement the default every viewer link would
 * break on any deployment that registered the method — a denial the verb never
 * meant to express. The residual is a change pack carried by the attach
 * itself: a hand-rolled client could smuggle one write past this method, while
 * every write after it is still refused at `PushPull`. Closing that needs a
 * truthful verb from Yorkie; see `docs/design/yorkie-auth-webhook.md` § Risks.
 */
const READ_GATED_METHODS = new Set(['AttachDocument']);

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
 * **Enforcing is the default**, because this is the only place a *write* by a
 * share-link `viewer` is refused (`hasAccess`: `link.role === 'editor'`), and a
 * viewer holds both halves needed to reach Yorkie directly — their share token,
 * which mints a Yorkie token at `GET /auth/yorkie-token`, and the project's
 * public key, which every visitor's bundle carries. So a client that is not our
 * frontend attaches and writes regardless of what our editors mount: the
 * read-only mounts on the share routes (`readOnlyNoteStore`, `readOnlyDocStore`,
 * the editors' own `readOnly` state) keep *this app* from writing where it must
 * not, which is a correctness boundary, not an access-control one. A default
 * that allowed the write would leave viewer-means-read-only true only of
 * well-behaved clients.
 *
 * Shadow mode — computing the decision, logging it, and allowing the request
 * anyway — remains available for the rollout window, but only by asking for it:
 * `YORKIE_AUTH_WEBHOOK_ENFORCE=false` and nothing else
 * ({@link isYorkieAuthEnforced}). It is an observation instrument, not a
 * posture, so {@link logPosture} says at boot which one this deployment is in
 * rather than leaving the gap to be inferred from a quiet log.
 *
 * Registering the methods on the Yorkie project is still a separate, manual
 * step: with none registered Yorkie never calls this endpoint and nothing here
 * runs. That is the switch that disables the feature; the variable only chooses
 * whether a computed denial is honored.
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
    this.enforce = isYorkieAuthEnforced(
      configService.get<string>('YORKIE_AUTH_WEBHOOK_ENFORCE'),
    );
    this.logPosture();
  }

  /**
   * Say at boot which posture this deployment is in. Shadow mode otherwise
   * announces itself only through a `[shadow] would deny` line, which appears
   * when somebody is *already* doing the thing that is not being refused — so
   * an install that is unprotected looks identical to one that is protected
   * until the day it matters.
   */
  private logPosture(): void {
    if (this.enforce) {
      this.logger.log('yorkie auth webhook: enforcing per-document access');
      return;
    }
    this.logger.warn(
      'yorkie auth webhook: SHADOW mode — every request is allowed and ' +
        'per-document access is NOT enforced, because ' +
        'YORKIE_AUTH_WEBHOOK_ENFORCE is set to false. A share-link viewer can ' +
        'write to a document by attaching with their own Yorkie client; the ' +
        "editors' read-only mounts do not bound anything but this app. Unset " +
        'the variable when the rollout window is over.',
    );
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
      // The target is logged with it — a denied `rw` on a named document is a
      // write this deployment just let through, and telling that apart from a
      // stale token needs the key and the verb, which the token must never
      // join (it is a bearer credential).
      const target = (body?.attributes ?? [])
        .map((attr) => `${attr?.key ?? '?'}:${attr?.verb ?? '?'}`)
        .join(',');
      this.logger.warn(
        `[shadow] would deny method=${body?.method} target=${target} status=${decision.status} reason=${decision.reason}`,
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

    // This backend's own Yorkie client (`YorkieService`). Every server-side
    // path — the v1 content endpoints, `DocumentCopyService`, template
    // publish/seed — authorized its caller against Postgres before opening the
    // document, and none of that authority is recoverable from a document key
    // here; some of those paths (a seed command) have no user at all. The
    // token is signed with `JWT_SECRET` and never leaves the process, so
    // nothing outside this server can present one. See
    // `src/yorkie/yorkie-service-token.ts`.
    if (identity.typ === YORKIE_SERVICE_TOKEN_TYPE) {
      return ALLOW;
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
      const denied = await this.checkAttribute(identity, attr, method);
      if (denied) {
        return denied;
      }
    }
    return ALLOW;
  }

  /** Returns a deny decision, or `null` when the attribute is allowed. */
  private async checkAttribute(
    identity: DocumentScopedIdentity,
    attr: AuthAttribute,
    method: string,
  ): Promise<AuthDecision | null> {
    const parsed = attr.key ? parseYorkieDocKey(attr.key) : null;
    if (!parsed) {
      return { status: 403, allowed: false, reason: 'unknown document key' };
    }
    // Reading a document's history needs editor-or-member authority even
    // though Yorkie asks for it with verb `r` — see REVISION_READ_METHODS.
    // Conversely `AttachDocument` always claims `rw`, so its verb is ignored
    // and read access is enough — see READ_GATED_METHODS.
    const needWrite = REVISION_READ_METHODS.has(method)
      ? true
      : attr.verb === 'rw' && !READ_GATED_METHODS.has(method);
    const ok = await this.hasAccess(identity, parsed.id, needWrite);
    return ok
      ? null
      : { status: 403, allowed: false, reason: 'no access to document' };
  }

  private async hasAccess(
    identity: DocumentScopedIdentity,
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
