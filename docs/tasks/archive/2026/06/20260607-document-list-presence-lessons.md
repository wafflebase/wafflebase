# Lessons — Document list presence indicators

## CodePair reuse, not copy

CodePair's `YorkieAdminService` (`packages/backend/src/yorkie/yorkie-admin.service.ts`
in `second-brain/03_projects/codepair`) was the pattern source. Worth
noting for future Yorkie-admin work:

- HTTP/2 (`require('http2').connect`) not REST — Yorkie exposes both
  Connect and HTTP/2 endpoints on the same port; we already store the
  RPC addr as `YORKIE_RPC_ADDR`, so we reuse it instead of inventing a
  new env var.
- Auth header is **`API-Key <secret>`** (no `Bearer`).
- Body uses snake_case (`document_keys`, `include_root`,
  `include_presences`). Easy to miss when handcrafting JSON.
- The admin secret is **distinct** from the SDK client key. We added
  `YORKIE_SECRET_KEY` separately and left `YORKIE_PUBLIC_KEY`
  untouched.

## Presence value escape

Presence fields land JSON-stringified — the SDK wraps each value with
`JSON.stringify` before transport. `username: "alice"` arrives as
`"\"alice\""`. Two-step unwrap is safest:

```ts
try { return JSON.parse(value); }
catch { return value.replace(/^"|"$/g, ""); }
```

Forgetting this lands literal quotes in the UI. CodePair just strips
`^"|"$`, but `JSON.parse` is more general (handles escaped quotes
inside the value too).

## Doc key derivation lives at the boundary

Wafflebase already has three frontend prefixes (`sheet-`, `doc-`,
`slides-`). Rather than centralizing them in `@wafflebase/sheets` or
similar shared module, the controller mirrors the prefix table locally
— same pattern as `packages/backend/src/api/v1/docs-content.controller.ts`.
If we add a 4th type, both should be updated.

## Graceful degradation > strict failure

The presence column is decorative; an admin call that times out or
fails auth should not break the document listing. The service catches
errors and returns an empty map. The frontend renders nothing for that
row. No user-facing error toast.

## Polling cadence

5 s `refetchInterval` mirrors what CodePair effectively does (their list
also polls via `useQuery`). Tuning:

- `refetchIntervalInBackground: false` — when the tab is hidden, stop
  hammering the API.
- Faster polling (≤2 s) would surface joiners quickly but ramps up
  admin-API load with the document count.
- Slower polling (≥10 s) makes the avatars feel stale right after
  closing a doc.

## Module scoping note

`YorkieModule` is `@Global()` — no need to import it from
`DocumentModule`. If the global decorator gets dropped later, this
controller will throw `Nest can't resolve dependencies of
DocumentController` and the fix is to add `YorkieModule` to its
imports.

## Code-review pass (2026-06-07)

Took a high-effort self-review and applied every finding. Notable
lessons:

- **Wire format leakage** — original draft forwarded Yorkie's raw
  per-client presence map to React. The fix was a backend projection
  (`PresenceUser[]`) so the UI never JSON.parse's wire data. Frontend
  is dumber, backend tests are cheaper.
- **Standardize raw, not encoded** — three editor entry points
  (docs, slides) called `encodeURIComponent(currentUser.username)`
  before set; the sheets and shared share-link entry stored raw. We
  removed encode at all five call sites and the two decode-on-read
  sites (`docs-view.tsx`, `docs-detail.tsx`). Yorkie SDK already
  JSON.stringifies presence values; a layer of URI encoding on top
  was wrong AND inconsistent.
- **HTTP/2 session pooling** — first draft `connect`/`close`'d on
  every admin call. Holding a lazy singleton `ClientHttp2Session` and
  recreating on `close`/`error` is straightforward and avoids
  handshake churn under polling load. `session.unref()` while idle +
  `session.ref()` per in-flight request keeps NestJS shutdown clean.
- **HTTP/2 status before JSON.parse** — auth failures (401/403)
  arrive with non-JSON bodies. Attaching `req.on('response')` to
  capture `:status` turns "Failed to parse Yorkie admin response"
  into the actual HTTP code in the warn log.
- **Avatar click bubbling** — Radix Tooltip with `asChild` makes the
  Avatar (a div) the trigger; the documents-list row's only guard
  was `closest("input, button")`. Wrapping the avatar stack in a
  `<div onClick={e => e.stopPropagation()}>` is the smallest fix.
- **`getRowId: row => row.id`** stabilizes TanStack row identity
  across the 5 s presence refetch, so any open dropdown/dialog on a
  row keeps state.
- **`yorkieDocKey` switch should throw on unknown** — the original
  fallback to `sheet-${id}` would silently misattribute presences
  for a future doc type. A central util in
  `packages/backend/src/yorkie/yorkie-doc-key.ts` is the single
  source of truth for type → prefix and is consumed by all three
  call sites (legacy controller, v1 controller, YorkieService default).
- **Test stubs** — both e2e suites that stub `YorkieService` now
  also stub `YorkieAdminService` to keep the listing endpoints
  hermetic.
