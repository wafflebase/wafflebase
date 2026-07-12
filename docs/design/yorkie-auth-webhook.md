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
| `AttachDocument` | Enforce: resolve docKey → doc; require access; `rw` needs write role. |
| `PushPull` | Enforce (the real read/write gate; `verb` reflects sync mode). |
| `Watch` (+ deprecated `WatchDocument`) | Enforce read access. |
| `Broadcast` | Enforce read access (presence). |
| `DetachDocument` | **Always allow** — detach/GC must succeed even after a role is revoked. |
| `RemoveDocument` | Enforce write access (document deletion). |

### Webhook authentication — reuse the HMAC guard

The auth webhook is signed by the **same** yorkie webhook client as the event
webhook: `X-Signature-256: sha256=HMAC-SHA256(rawBody, project.SecretKey)`. The
existing `YorkieSignatureGuard` (`document/yorkie-signature.guard.ts`) and the
`main.ts` rawBody-capture hook therefore apply **unchanged** — no new secret.
The guard authenticates *Yorkie* as the caller; the `token` in the body then
authenticates the *end user*.

The rawBody `verify` hook in `main.ts` is currently path-scoped to
`/internal/yorkie/events`; extend it to also cover `/internal/yorkie/auth`.

### Token strategy (the hard part)

The JWT session lives in an **httpOnly** cookie, so `authTokenInjector` (browser
JS) cannot read it. We mint a separate, short-lived **Yorkie access token** the
injector *can* hold:

- `GET /auth/yorkie-token` — JWT-cookie-guarded. The browser sends the session
  cookie automatically (`credentials: 'include'`); the endpoint returns a signed
  short-lived token (≈10 min) in the body, e.g. a JWT
  `{ typ: 'yorkie', sub: <userId>, exp }` signed with a backend secret.
- Anonymous share visitors have no session. `GET /auth/yorkie-token?shareToken=<t>`
  (no JWT guard) validates the share token via `ShareLinkService.findByToken`
  and returns a token `{ typ: 'yorkie-share', shareToken, exp }`.

The webhook decodes the token to `{ userId }` or `{ shareToken }` and resolves
access from there. Identity is thus **backend-signed**, not client-asserted.

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

`YorkieProvider` accepts `authTokenInjector` (it spreads `ClientOptions`).
Add it in both mount points, keeping `apiKey` + `metadata` as-is:

```tsx
// PrivateRoute.tsx (authenticated)
<YorkieProvider
  rpcAddr={...} apiKey={...}
  metadata={{ userID: encodeURIComponent(me.username || 'anonymous-user') }}
  authTokenInjector={async () => fetchYorkieToken()}       // GET /auth/yorkie-token
/>

// shared-document.tsx (anonymous share)
authTokenInjector={async () => fetchYorkieToken(resolved.token)}  // ?shareToken=
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

1. **Ship the endpoint + token endpoint + frontend injector** with the webhook
   URL **unregistered** — no enforcement, but tokens now flow.
2. **Shadow mode**: register the webhook but have the handler always return
   `allowed:true` while logging the decision it *would* have made. Watch for
   false denials (token gaps, key-parse misses, share edge cases).
3. **Enforce**: flip the handler to honor the computed decision.
4. Reversible at every step: unregister the webhook methods to fully disable.

## Risks and Mitigation

- **Bug denies all access** → staged shadow→enforce rollout; `DetachDocument`
  always allowed; instant rollback by unregistering webhook methods.
- **Token/session expiry mid-session** → short-lived token + `401`-driven
  `authTokenInjector` refresh; authenticated refetch chains into the existing
  `/auth/refresh`. Needs an integration test for the expiry→refresh→retry path.
- **Webhook latency on the hot path** → the webhook is on every PushPull; keep
  it a single indexed Postgres read (Document + membership/share), cache
  token-decode, and rely on yorkie's retry/backoff (`--auth-webhook-*` tunables)
  rather than blocking. Consider a short in-process cache keyed by
  `(tokenHash, docId, verb)`.
- **Spoofed identity** → authorization uses only the backend-signed token;
  `metadata.userID` is never trusted for access decisions.
- **Forged webhook calls** → mandatory HMAC via `YorkieSignatureGuard`; endpoint
  refuses when `YORKIE_SECRET_KEY` is unset (same posture as the event webhook).
- **Member vs viewer granularity** → current model grants members `rw` and only
  distinguishes viewer/editor on share links. Per-member viewer roles are a
  model change, out of scope here; noted so the resolver has a clear extension
  point.
- **Comment/side documents sharing a key** → they resolve to the same
  `Document.id`, so the same access decision applies; no special-casing needed.
- **Deploy sequencing** → the token endpoint and frontend injector must ship
  before the webhook is registered, or clients send no token and every call
  `401`s. Registration is the last, explicitly-gated step.
