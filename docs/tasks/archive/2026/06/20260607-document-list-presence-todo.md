# Document list presence indicators

Show "who is editing" avatars on the documents list, modeled after
CodePair's `DocumentCard` + `YorkieAdminService` integration.

## Background

- CodePair backend calls `/yorkie.v1.AdminService/GetDocuments` over
  HTTP/2 with `include_presences: true` and merges the per-document
  `presences` map into the listing response.
- Wafflebase backend currently only attaches/detaches via the SDK
  (`YorkieService.withDocument`); there is no admin channel.
- Frontend lists documents in `packages/frontend/src/app/documents/
  document-list.tsx`; no editor-presence column today.
- Yorkie document keys follow the per-type convention (`sheet-<id>`,
  `doc-<id>`, `slides-<id>`); same `initialPresence` shape across
  packages: `{ username, email, photo, ... }`.

## Plan

1. **Backend env** — add `YORKIE_SECRET_KEY` (admin-scoped API
   key). Keep existing `YORKIE_PUBLIC_KEY` (SDK client key) untouched.
2. **YorkieAdminService** — new service in
   `packages/backend/src/yorkie/yorkie-admin.service.ts` that posts to
   `${YORKIE_API_ADDR}/yorkie.v1.AdminService/GetDocuments` over HTTP/2
   with body `{document_keys, include_root: false, include_presences:
   true}` and header `Authorization: API-Key <secret>`. Returns a `Map<
   docKey, presences>`.
3. **DocumentController** — extend `GET /documents` and `GET
   /workspaces/:id/documents` to fold yorkie key derivation
   (`type → prefix`) into a single admin call and emit `presences` on
   each list entry. Single-doc endpoints unchanged.
4. **Frontend types** — extend `Document` in
   `packages/frontend/src/types/documents.ts` with
   `presences?: Record<string, { data: Record<string, string> }>`.
5. **DocumentList UI** — add an "Editing" column to the TanStack
   table that:
   - parses raw presence fields (strip surrounding quotes that the
     SDK adds — `JSON.parse(value)` works for strings)
   - dedupes by `email`/`username`
   - renders overlapping shadcn `Avatar`s (manual `-space-x-2`)
   - hides itself when no presence.
6. **Polling** — set `refetchInterval: 5000` on the list `useQuery`
   so the UI catches new joiners without a refresh.
7. **Verification** — `pnpm verify:fast`; smoke `pnpm dev` two-window
   test (window A in sheet/doc/slides, window B on listing).

## Checklist

- [x] Backend env loaded; admin secret reachable via ConfigService
- [x] `YorkieAdminService.getEditors(keys)` returns merged map (clean DTO)
- [x] `DocumentController` list endpoints attach `editors`
- [x] v1 API list endpoint also attaches `editors` (parity)
- [x] Frontend `Document` type has `editors?` field
- [x] DocumentList renders Editing avatars and hides when empty
- [x] `useQuery` polls every 5 s with stable row identity (`getRowId`)
- [x] e2e tests stub `YorkieAdminService`
- [x] `pnpm verify:fast` green
- [x] lessons file captured
- [x] code-review (high effort) self-review applied — 15 findings fixed

## Risks

- Admin secret leakage — server-side only, never bundled to frontend.
- Admin call latency — bulk endpoint, one round-trip per list fetch;
  failures should degrade silently (return docs without presences).
- Presence value escape: SDK stores JSON-stringified values
  (`"\"alice\""`); UI must unwrap before display.
- Same user across multiple tabs/clients — dedupe by stable identity
  field (`email` first, fall back to `username`).
