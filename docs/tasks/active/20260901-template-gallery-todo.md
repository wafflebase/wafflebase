# Template Gallery — Task Tracking

Design doc: [template-gallery.md](../../design/template-gallery.md)
Status: **research + design written; implementation not started, not approved**

## Principles

- **Reuse the copy engine, do not fork it.** `DocumentCopyService` already
  handles all eight types with rollback. The only change it needs is a
  destination parameter; a second copy path would drift from it immediately.
- **A template is not a document type.** `Document.type` routes viewers. The
  listing is a sidecar row, so every template opens in its own editor.
- **Publish is a permission escalation.** It exposes a document's content
  beyond the workspace, so it is manager-gated at every tier, not member-gated
  like `Make a copy`.
- **Ship the tiers in order.** The workspace gallery delivers most of the value
  with none of the moderation exposure; public is last and is a policy project
  as much as a code one.

## Step 0: Research and design (this step)

- [x] Canva researched — template link, Brand Templates, Creators marketplace
- [x] CapCut researched — send project, replaceable-clip templates, moderation
      queue, feed discovery, usage-based payouts
- [x] Google Workspace org template gallery cross-checked as the same tier as
      Brand Templates
- [x] Existing spine measured on `main`: `DocumentCopyService` (destination
      hardcoded to the source's workspace/folder), `ShareLink` + `/shared/:token`,
      unauthenticated `GET /images/:id`, workspace/folder/member model
- [x] `docs/design/template-gallery.md` + index row in `docs/design/README.md`
- [ ] Open questions below answered before Phase 1 starts

## Decisions (2026-09-01)

- [x] **Target is the public community gallery.** Phases 1–2 are the rollout
      path to it, not alternatives — they exercise the publish/preview/use spine
      before the moderation surface is turned on. Moderation, licensing and
      takedown are in scope.
- [x] **Publishing is manager-gated at every tier**, workspace included. Same
      bar as an editor share link, same reason.
- [x] **Canva model — no parameterization.** `{{placeholder}}` slots are
      declined, not deferred; recorded in the design doc so it stays a decision.

## Phase 1 — Template link (unlisted)

- [x] `TemplateListing` Prisma model + migration
      (`20260831225618_add_template_listing`)
- [x] `dest?: { workspaceId, folderId, title }` on `DocumentCopyService.copy()`,
      defaulting to the source's — existing `Make a copy` behavior unchanged
- [x] `uniqueTitle(base, existing)` beside `copyTitle`, so the first use of
      "Weekly Report" is named "Weekly Report", not "Weekly Report (copy)"
- [x] `POST /documents/:id/template` (manager-gated) — upsert listing, mint the
      non-expiring `viewer` share link; `DELETE /templates/:id` revokes it
- [x] `POST /templates/:id/use { workspaceId, folderId? }` — read authority from
      the listing, write authority from destination membership
- [x] `GET /templates/:id` (`OptionalJwtAuthGuard`) metadata + preview token
- [x] Share dialog gains a **Template** section, gated on the manager predicate
      it had already resolved for editor links
- [x] `/t/:id` landing page: card, author, use count, workspace picker,
      **Use this template**, **Preview**
- [x] Tests: 26 service cases (publish gate, visibility tiers, cross-workspace
      copy authorization both directions, `useCount` best-effort) + 4 copy-service
      destination cases + `uniqueTitle`
- [ ] Client-rendered thumbnail capture uploaded through `POST /images`; type
      icon fallback (column, serving and card rendering are in place)
- [ ] Embed the preview in `/t/:id` instead of opening `/shared/<token>`
      (needs `SharedDocument` to accept a token prop rather than read
      `useParams`)
- [ ] Return a logged-out visitor to `/t/:id` after sign-in (needs the OAuth
      `state` to carry a server-validated return path — an auth change)
- [ ] Backend e2e coverage through the HTTP layer, alongside the existing
      share-link/document integration specs

## Phase 2 — Workspace gallery

- [ ] `visibility: 'workspace'` + listing scope in `GET /templates`
- [ ] **Templates** tab in the workspace
- [ ] **New from template** in the documents-list create menu
- [ ] Manager may unpublish any listing in their workspace (publishing itself is
      manager-gated at this tier too — see Decisions)

## Phase 3 — Public gallery

- [ ] `status: pending | listed | rejected` + maintainer allowlist review
- [ ] Frozen-copy promotion on approval (copy service into a system workspace)
- [ ] Re-host a public listing's embedded images alongside the frozen copy
      (reuse the Miro importer's re-hosting path)
- [ ] Public `/templates` browse page — type/category facets, `useCount` sort
- [ ] License grant accepted at publish, attribution on the listing
- [ ] Report endpoint; takedown deletes the listing, never the document
- [ ] Rate-limit `use` per user

## Review

_To be filled in when the work lands._
