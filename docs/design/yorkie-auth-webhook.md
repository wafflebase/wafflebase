---
title: yorkie-auth-webhook
target-version: 0.6.0
---

# Yorkie Auth Webhook — Per-Document Access Control

## Summary

Today the frontend attaches to Yorkie with only the project **public key** and
a spoofable `metadata.userID`. Any client holding the public key can attach to
**any** document key (`sheet-<id>`, `doc-<id>`, `slides-<id>`, `pdf-<id>`) and
read or write it — the Postgres permission model (`WorkspaceMember`,
`ShareLink`) is invisible to Yorkie, and read-only is only self-enforced by the
frontend `syncMode`. This is the real authorization boundary today, and it is
open.

Yorkie's **auth webhook** closes this: on privileged RPCs Yorkie forwards
`{ token, method, attributes:[{ key, verb }] }` to a backend endpoint, which
answers `{ allowed }` (HTTP `200`/`401`/`403`). We plug our existing permission
logic into that endpoint so Yorkie enforces workspace membership and share-link
roles per document, per verb.

**Status: shipped.** The webhook endpoint
(`packages/backend/src/document/yorkie-auth.controller.ts`), the two token
endpoints, the `tokenType === 'access'` replay guard, the shared rawBody scope,
and both frontend injectors are all implemented and wired. What remains
operational (not code) is registering the webhook methods on the Yorkie
project. Enforcement itself is the **default**: `YORKIE_AUTH_WEBHOOK_ENFORCE`
selects shadow mode only when it is set to the literal `false`, so an install
that registers the methods and configures nothing else denies. The sections
below describe the design as built.

## Goals / Non-Goals

**Goals**
- Server-enforced per-document read/write authorization at the Yorkie layer,
  backed by the existing `WorkspaceMember` / `ShareLink` model.
- Identity that cannot be spoofed by the client — authorization derives from a
  backend-minted token, not from `metadata`.
- Works for both authenticated users (JWT session) and anonymous share-link
  visitors (viewer / editor).
- Safe, reversible rollout (shadow/log-only before enforcing).

**Non-Goals**
- Replacing the Postgres permission model — the webhook *reads* it, doesn't
  change it.
- Field/cell-level or tab-level authorization — grain is the whole document key.
- Changing the presence/`metadata.userID` path — it stays for avatars; it is
  simply no longer trusted for authorization.
- Fixing the `pdf` no-CRDT case — PDFs still attach a `pdf-<id>` Yorkie doc for
  comments/presence and go through the webhook like any other type.

## Proposal Details

### Webhook contract (yorkie 0.7.12, `api/types/auth_webhook.go`)

Request body Yorkie POSTs to us:

```json
{
  "token": "<opaque token from authTokenInjector>",
  "method": "PushPull",
  "attributes": [{ "key": "sheet-<uuid>", "verb": "r" }]
}
```

- `verb`: `"r"` (read) or `"rw"` (read-write).
- Response: `{ "allowed": true, "reason": "ok" }`.
- Status semantics (from yorkie `pkg/webhook/client.go`): `200` → allowed;
  `401 Unauthenticated` → token invalid/expired, triggers the client's
  `authTokenInjector('token expired')` refresh + retry; `403 PermissionDenied`
  → valid token, insufficient rights, rejected without retry.

`AuthMethods()` (methods that hit the webhook when registered). We only need to
enforce a subset:

| Method | Handling |
| --- | --- |
| `ActivateClient` / `DeactivateClient` | No document. Validate token only (is it a live session / valid share?). |
| `AttachDocument` | Enforce **read**: resolve docKey → doc; require access. Its verb is always `rw` and so carries no write intent — see the verb risk below. |
| `PushPull` | Enforce (the real read/write gate; `verb` reflects sync mode). |
| `Watch` (+ deprecated `WatchDocument`) | Enforce read access. |
| `Broadcast` | Enforce read access (presence). |
| `DetachDocument` | **Always allow** — detach/GC must succeed even after a role is revoked. |
| `RemoveDocument` | Enforce write access (document deletion). |

### Webhook authentication — reuse the HMAC guard

The auth webhook is signed by the **same** yorkie webhook client as the event
webhook: `X-Signature-256: sha256=HMAC-SHA256(rawBody, project.SecretKey)`. The
existing `YorkieSignatureGuard`
(`packages/backend/src/document/yorkie-signature.guard.ts`) and the
`packages/backend/src/main.ts` rawBody-capture hook therefore apply
**unchanged** — no new secret. The guard authenticates *Yorkie* as the caller;
the `token` in the body then authenticates the *end user*.

The rawBody `verify` hook in `packages/backend/src/main.ts` is scoped to the
`/internal/yorkie/` prefix (`YORKIE_WEBHOOK_PATH_PREFIX`), so it covers both
`/internal/yorkie/events` and `/internal/yorkie/auth` with no per-path change.

### Token strategy (the hard part)

The JWT session lives in an **httpOnly** cookie, so `authTokenInjector` (browser
JS) cannot read it. We mint a separate, short-lived **Yorkie access token** the
injector *can* hold:

- `GET /auth/yorkie-token` — JWT-cookie-guarded. The browser sends the session
  cookie automatically (`credentials: 'include'`); the endpoint returns a signed
  short-lived token (≈10 min) in the body, e.g. a JWT
  `{ typ: 'yorkie', sub: <userId>, exp }` signed with a backend secret.
- Anonymous share visitors have no session. `POST /auth/yorkie-token/share`
  (no JWT guard) takes the share token in the body — kept out of URLs/logs since
  it grants access — and returns a token `{ typ: 'yorkie-share', shareToken, exp }`.
  The webhook, not this endpoint, does the real validation
  (`ShareLinkService.findByToken`: existence, expiry, document match, role).

The webhook decodes the token to `{ userId }` or `{ shareToken }` and resolves
access from there. Identity is thus **backend-signed**, not client-asserted.

**The backend is a third identity.** `YorkieService.withDocument` attaches
server-side for the v1 content endpoints, `DocumentCopyService` and the template
seed, and it is not any user: some of those paths run from a command line with
no session at all. It supplies its own `{ typ: 'yorkie-service' }` token
(`packages/backend/src/yorkie/yorkie-service-token.ts`), which `decide()`
allows unconditionally. That is the layer *above* the permission model rather
than a hole in it — every one of those paths authorized its caller against
Postgres (workspace membership, document manager, API-key `write` scope) before
opening the document, and none of that authority is recoverable from a document
key inside the webhook. The token is signed with `JWT_SECRET`, is as short-lived
as a user's, and never leaves the process, so only a secret compromise can
produce one — and a secret compromise already mints a session for any user.
Before it existed, a deployment that registered the webhook methods 401'd every
server-side attach, which is the whole reason enforce-by-default could not have
shipped without it.

**Token-replay hardening.** The Yorkie token is signed with `JWT_SECRET` (same
key as the session access token) but, unlike the httpOnly session cookie, it is
readable by client JS. So `JwtStrategy.validate` must reject anything that isn't
an access token: it now requires `tokenType === 'access'`, which blocks both a
captured Yorkie token (`typ: 'yorkie'`) and a refresh token (`tokenType:
'refresh'`, which shares `JWT_SECRET` when `JWT_REFRESH_SECRET` is unset) from
being replayed as a `Bearer` session. `verifyYorkieToken` conversely rejects
access/refresh tokens, so the two token families can't cross over.

### Permission resolution

For each attribute `{ key, verb }`:

1. `parseYorkieDocKey(key)` → `{ type, id }`. Unknown prefix → `allowed:false`
   (`403`).
2. Load `Document(id)` → its `workspaceId`. Missing doc → `403`.
3. Determine the caller's role on that document:
   - **User token**: `WorkspaceService.assertMember(workspaceId, userId)` → a
     member gets `rw` (current model has no per-doc viewer role for members).
   - **Share token**: `ShareLinkService.findByToken(shareToken)`; require
     `link.documentId === id` and not expired. `role === 'editor'` → `rw`,
     `role === 'viewer'` → `r`.
4. Compare to requested `verb`: grant if `verb === 'r'` and role allows read, or
   `verb === 'rw'` and role allows write. Else `403`.

Token invalid/expired/malformed → `401` (so the client refreshes). Valid token
but no access → `403`.

A single request may carry multiple attributes; **all** must pass.

### Frontend wiring

`YorkieProvider` accepts `authTokenInjector` (it spreads `ClientOptions`). It is
wired at both mount points, keeping `apiKey` + `metadata` as-is. The two entry
points call two distinct helpers in `packages/frontend/src/api/auth.ts`:
`fetchYorkieToken()` (GET) for the authenticated case and
`fetchYorkieShareToken(token)` (POST `/auth/yorkie-token/share`) for the
anonymous-share case.

```tsx
// PrivateRoute.tsx (authenticated)
<YorkieProvider
  rpcAddr={...} apiKey={...}
  metadata={{ userID: encodeURIComponent(me.username || 'anonymous-user') }}
  authTokenInjector={fetchYorkieToken}                          // GET /auth/yorkie-token
/>

// shared-document.tsx (anonymous share)
authTokenInjector={token ? () => fetchYorkieShareToken(token) : undefined}  // POST /auth/yorkie-token/share
```

The injector caches the token and re-fetches when yorkie calls it with
`reason === 'token expired'`. For the authenticated case a refetch may itself
`401` (session expired) → fall through to the existing `/auth/refresh` flow.

### Ops — register the webhook on the project

Auth webhook is a **per-project** setting (not a server flag), configured via
the yorkie CLI (mirrors the event-webhook step in
[`documents-last-modified.md`](documents-last-modified.md)):

```shell
yorkie project update <project> \
  --auth-webhook-url http://wafflebase.wafflebase.svc.cluster.local:3000/internal/yorkie/auth \
  --auth-webhook-method-add AttachDocument \
  --auth-webhook-method-add PushPull \
  --auth-webhook-method-add Watch \
  --auth-webhook-method-add DetachDocument \
  --auth-webhook-method-add Broadcast \
  --auth-webhook-method-add RemoveDocument
```

Local dev (`docker compose`) uses the default project; add a one-shot setup
script that `yorkie login`s and runs the above against `localhost:8080` so
contributors can opt in. Leaving the URL unset keeps today's behavior.

### Rollout

1. **Endpoint + token endpoints + frontend injectors** — shipped. With the
   webhook URL **unregistered** there is no enforcement, but tokens flow.
2. **Shadow mode** (opt-in, for the rollout window only): register the webhook
   with `YORKIE_AUTH_WEBHOOK_ENFORCE=false` — the handler computes the
   decision, logs the one it *would* have made, but always returns `allowed`.
   Watch for false denials (token gaps, key-parse misses, share edge cases).
3. **Enforce** (the default): unset `YORKIE_AUTH_WEBHOOK_ENFORCE` so the handler
   honors the computed decision. Registering the methods with the variable
   unset goes straight here, which is the intended path for a new deployment.
4. Reversible at every step: flip the flag back, or unregister the webhook
   methods to fully disable.

## Risks and Mitigation

- **Shadow mode reads as protection and is not** → it computes a decision and
  allows the request anyway, so a deployment left in it is *observably* running
  the webhook while enforcing nothing. This matters most for share-link
  **viewers**:
  a viewer's write is refused here and nowhere else, and a viewer holds both
  halves needed to skip us — their share token, which mints a Yorkie token at
  `GET /auth/yorkie-token`, and the project's public key, which ships in every
  visitor's bundle. Client-side read-only mounts (`readOnlyNoteStore`,
  `readOnlyDocStore`, the editors' `readOnly` state) therefore bound *our app's*
  write paths and no one else's; they are correctness boundaries, not access
  control, and no feature should be reviewed as if they were. **Mitigation:**
  shadow mode is no longer the default — `isYorkieAuthEnforced`
  (`src/yorkie/yorkie-auth-enforcement.ts`) reads only the literal `false` as
  shadow, so registering the methods and configuring nothing else denies, and a
  typo lands on the side that denies rather than the side that opens. Shadow
  stays reachable because it is the instrument for the verb question below, but
  it must now be asked for. On top of that the controller logs its posture at
  boot — `SHADOW mode — … per-document access is NOT enforced` — so an install
  that did opt out sees the gap in its own logs rather than inferring it from
  the absence of denials; and features whose safety depends on the distinction
  (the public template tier, revision history) assert enforcement themselves
  through the same helper rather than assuming it.
- **Bug denies all access** → staged shadow→enforce rollout; `DetachDocument`
  always allowed; instant rollback by unregistering webhook methods.
- **Token/session expiry mid-session** → short-lived token + `401`-driven
  `authTokenInjector` refresh; authenticated refetch chains into the existing
  `/auth/refresh`. Needs an integration test for the expiry→refresh→retry path.
- **Webhook latency on the hot path** → the webhook fires on every PushPull, and
  the current handler is not free: a user token does a Document read *then* a
  membership read (two sequential indexed queries), a share token does one
  `findByToken` (join-loaded), and multiple attributes are checked sequentially.
  That is acceptable for the shadow phase and typical single-attribute traffic,
  but before enabling enforcement at scale the mitigation is: collapse the
  user-token path to one indexed join (document ⋈ membership), check attributes
  concurrently, and add a short in-process cache keyed by `(tokenHash, docId,
  verb)`. Yorkie's retry/backoff (`--auth-webhook-*` tunables) covers transient
  blips.
- **Spoofed identity** → authorization uses only the backend-signed token;
  `metadata.userID` is never trusted for access decisions.
- **Forged webhook calls** → mandatory HMAC via `YorkieSignatureGuard`; endpoint
  refuses when `YORKIE_SECRET_KEY` is unset (same posture as the event webhook).
- **Read-only viewers and the attach/PushPull verb** → for `PushPull` yorkie
  derives the verb from the client's change pack, not the sync mode:
  `AccessAttributes(pack)` is `r` when `pack.HasChanges()` is false, `rw`
  otherwise (`server/rpc/auth/auth.go`). A viewer who never edits a doc that
  already has content pushes no changes → verb `r` → allowed.
  **`AttachDocument` does not follow that rule**: it carries `rw`
  unconditionally, confirmed against a real yorkie server by inspecting the
  webhook body it sends for a brand-new local `Document` with zero local
  changes attaching to an already-populated remote one
  (`packages/backend/test/revision-history.e2e-spec.ts`, which omits
  `AttachDocument` from its registered set for exactly this reason). Honoring
  that verb would deny a share-link viewer their *very first attach*, so with
  enforcement the default every viewer link would break on any deployment that
  registered the method — which is what the earlier "watch the shadow logs
  first" mitigation, written while shadow was the default, quietly deferred.
  **Mitigation (in code):** `READ_GATED_METHODS` in
  `yorkie-auth.controller.ts` authorizes `AttachDocument` as a **read**
  whatever verb it carries, leaving `PushPull` — whose verb is truthful — the
  write gate this document already calls "the real read/write gate". A viewer
  therefore attaches and reads, and every write is refused one RPC later.
  Pinned by `yorkie-auth.controller.spec.ts` ("lets a share viewer attach even
  though attach claims rw", plus the two cases showing attach is not a blanket
  allow and the viewer's `PushPull` write is still 403). The **residual** is a
  change pack carried by the attach itself: a hand-rolled client could smuggle
  one write past that method, while everything after it is refused. Closing it
  needs a truthful verb from yorkie (upstream follow-up) — not a wider webhook
  denial, which costs every viewer their access to buy back one pack. A client
  that emits a local change on *load* under `PushPull` (a lazy migration, field
  initialization) is still denied under enforcement; shadow mode remains the
  instrument for finding one, and it is now asked for rather than assumed.
- **Authenticated access is workspace-membership only** → the `PrivateRoute`
  path injects a *user* token, so the webhook authorizes canonical document URLs
  purely by `assertMember`. A logged-in non-member opening a canonical URL is
  denied — which matches today's behavior (canonical document reads already
  require membership; share access flows through the `/share/:token` route and
  its share token). This is intended, not a regression, but is called out so the
  two entry points (member vs share) stay distinct.
- **Member vs viewer granularity** → current model grants members `rw` and only
  distinguishes viewer/editor on share links. Per-member viewer roles are a
  model change, out of scope here; noted so the resolver has a clear extension
  point.
- **Comment/side documents sharing a key** → they resolve to the same
  `Document.id`, so the same access decision applies; no special-casing needed.
- **Deploy sequencing** → the token endpoint and frontend injector must ship
  before the webhook is registered, or clients send no token and every call
  `401`s. Registration is the last, explicitly-gated step.
