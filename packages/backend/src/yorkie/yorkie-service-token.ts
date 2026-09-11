import { JwtService } from '@nestjs/jwt';
import type ms from 'ms';

/**
 * The backend's own identity at the Yorkie auth webhook.
 *
 * {@link YorkieService} attaches to documents server-side — the v1 content
 * endpoints, `DocumentCopyService`, template publish/seed — and until now it
 * did so with no token at all. That was survivable only while the webhook
 * defaulted to shadow mode: with enforcement the default, a deployment that
 * registers the webhook methods would 401 every one of those attaches, because
 * an absent token is exactly what the webhook is there to refuse.
 *
 * So the backend authenticates as itself. This is not a bypass of the
 * permission model, it is the layer above it: every server-side path already
 * authorized its caller against Postgres (workspace membership, document
 * manager, API-key scope) before it ever opened a Yorkie document, and the
 * webhook has no way to re-derive that from a document key. Re-checking a
 * *user's* rights here would also be the wrong check, since some of these
 * paths run with no user at all (a seed command, a webhook-driven copy).
 *
 * The token is signed with `JWT_SECRET`, which only this server holds, so
 * nothing but a secret compromise can produce one — and a secret compromise
 * already yields a session for any user. It is as short-lived as a user's,
 * which matters because it does **not** stay inside this process: it is handed
 * to the Yorkie SDK, which sends it to whichever Yorkie server the client is
 * pointed at, on every RPC, over whatever transport `YORKIE_RPC_ADDR` names.
 * That is the reason for {@link YorkieServiceTokenPayload.key} below.
 */
export const YORKIE_SERVICE_TOKEN_TYPE = 'yorkie-service';

/** Payload of a backend service token. Carries no subject: there isn't one. */
export type YorkieServiceTokenPayload = {
  typ: typeof YORKIE_SERVICE_TOKEN_TYPE;
  /**
   * The single Yorkie document key (`sheet-<id>`, `doc-<id>`, …) this token
   * authorizes, when there is one. `decide()` then refuses it for any other
   * key, so an intercepted token buys read/write on the one document the
   * request that minted it was already authorized for, rather than on every
   * document in the deployment.
   *
   * {@link YorkieService.withDocument} builds a fresh client per document and
   * therefore always sets it — that is the path that runs continuously in
   * production and so the one whose token is transmitted over and over.
   *
   * Absent means unscoped, which the ops scripts under `scripts/` need: they
   * walk many documents through one long-lived client, and the SDK refreshes
   * the token whenever the server asks rather than per attach, so a key
   * pinned at construction would be the wrong one by the second document.
   * An unscoped token is therefore an operator-run, one-shot credential held
   * by whoever already has the deployment's `JWT_SECRET`, not something a
   * request path mints.
   */
  key?: string;
};

// DI-free on purpose: `YorkieService` is constructed directly by seed commands
// and integration tests, so it must not grow a module graph to mint this.
const jwt = new JwtService();

export function signYorkieServiceToken(
  secret: string,
  expiresIn: ms.StringValue,
  key?: string,
): string {
  const payload: YorkieServiceTokenPayload = key
    ? { typ: YORKIE_SERVICE_TOKEN_TYPE, key }
    : { typ: YORKIE_SERVICE_TOKEN_TYPE };
  return jwt.sign(payload, { secret, expiresIn });
}

/**
 * The `authTokenInjector` a `yorkie.Client` owned by this backend hands to the
 * auth webhook. `undefined` when there is no secret to sign with, which leaves
 * the client anonymous — correct only against a Yorkie whose project has no
 * auth-webhook methods registered.
 *
 * Pass `key` whenever the client is bound to one document, which every
 * request-path client is; see {@link YorkieServiceTokenPayload.key} for why
 * the ops scripts are the exception.
 */
export function yorkieServiceTokenInjector(
  secret: string | undefined,
  expiresIn: ms.StringValue = '10m',
  key?: string,
): (() => Promise<string>) | undefined {
  if (!secret) {
    return undefined;
  }
  return () => Promise.resolve(signYorkieServiceToken(secret, expiresIn, key));
}

/**
 * The same, for the ops scripts under `packages/backend/scripts`. They build
 * their own client outside Nest, so they have no `ConfigService` to read —
 * but they attach to real documents and are refused exactly like any other
 * anonymous client once the webhook methods are registered, which enforcement
 * being the default means every deployment that registered them.
 *
 * Warns rather than throws when the secret is missing: a script pointed at a
 * local Yorkie with no webhook registered has nothing to authenticate to, and
 * failing there would break a working workflow for a token nobody reads.
 */
export function yorkieServiceTokenInjectorFromEnv(
  secret: string | undefined = process.env.JWT_SECRET,
  expiresIn: string = process.env.YORKIE_TOKEN_EXPIRES_IN ?? '10m',
): (() => Promise<string>) | undefined {
  if (!secret) {
    console.warn(
      'JWT_SECRET is unset, so this script attaches to Yorkie with no auth ' +
        'token; it will be denied wherever the auth webhook is registered.',
    );
    return undefined;
  }
  return yorkieServiceTokenInjector(secret, expiresIn as ms.StringValue);
}
