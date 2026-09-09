/**
 * One reading of `YORKIE_AUTH_WEBHOOK_ENFORCE`, shared by everything whose
 * safety depends on it (the webhook itself, and the public template tier).
 *
 * **Enforcing is the default.** The webhook is the only place a share-link
 * `viewer`'s *write* is refused, and a viewer holds both halves needed to
 * reach Yorkie without going through this app — their share token, which mints
 * a Yorkie token at `GET /auth/yorkie-token`, and the project's public key,
 * which ships in every visitor's bundle. A default that allowed the write
 * would make "viewer means read-only" a property of well-behaved clients
 * rather than of the deployment, so an install that registers the webhook
 * methods and configures nothing else must enforce.
 *
 * Making that the default meant paying the one documented denial it would
 * otherwise have caused: Yorkie sends `AttachDocument` with verb `rw`
 * unconditionally, so an install that registered that method would have
 * refused a share-link viewer their very first attach. `READ_GATED_METHODS`
 * (`src/document/yorkie-auth.controller.ts`) authorizes attach as a read for
 * that reason, leaving `PushPull` — whose verb is derived from the change pack
 * — the write gate. See `docs/design/yorkie-auth-webhook.md` § Risks for the
 * residual and the upstream follow-up.
 *
 * Shadow mode is therefore an explicit opt-in for the rollout window: the
 * literal string `false` (trimmed, case-insensitive) and nothing else. A typo
 * enforces rather than silently opening the door — the failure mode of getting
 * this wrong in the safe direction is a denial somebody notices, and in the
 * unsafe direction is a bypass nobody does.
 */
export function isYorkieAuthEnforced(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() !== 'false';
}
