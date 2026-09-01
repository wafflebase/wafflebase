# Template Gallery — Task Tracking

Design doc: [template-gallery.md](../../design/template-gallery.md)
PR: [#1000](https://github.com/wafflebase/wafflebase/pull/1000)
Status: **Phases 1 and 2 shipped (#1000, #1001, #1005), all in v0.6.8.
Remaining: `pdf`/`image` thumbnails, and all of Phase 3 — the `public` tier
is still refused with a `400`**

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
- [x] Open questions below answered before Phase 1 starts — the
      **Decisions (2026-09-01)** section is those answers, all three
      settled on the day Phase 1 (#1000) shipped

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
- [x] Client-rendered thumbnail capture uploaded through `POST /images`; type
      icon fallback (column, serving and card rendering are in place) — #1005,
      for the 5 CRDT types. `pdf`/`image` are still the icon; see 2b below
- [x] Backend e2e coverage through the HTTP layer, alongside the existing
      share-link/document integration specs — #1005 (`template.e2e-spec.ts`:
      guards and `ValidationPipe` really wired, a real `ShareLink` row present
      after publish and gone after unpublish, no `previewToken` on a
      serialized browse card)

## Phase 2 — Workspace gallery (the store)

Phase 1 shipped the spine — one template, one link, one copy. This is the phase
that makes a listing **findable**: there is no discovery surface at all today.
The `workspace` tier's authorization already shipped and is tested, so none of
the work below is authorization work.

### 2a. `GET /templates` — the collection endpoint

The single largest piece, and the one every later surface reads.

- [x] `GET /templates?scope=workspace|public&workspaceId=&type=&category=&tag=&q=&sort=popular|recent&cursor=&limit=`
- [x] Visibility as a **query constraint, never a post-filter**; `scope=workspace`
      runs `assertMember` first and constrains on the *document's* current
      workspace (the Phase 1 rule)
- [x] `unlisted` listings never appear in any collection — holding the id is
      their entire access story
- [x] **No `previewToken` in list responses** — a page of 24 cards must not hand
      out 24 non-expiring read capabilities; the token comes from
      `GET /templates/:id` when a card is opened
- [x] Keyset pagination on `(useCount, id)` / `(publishedAt, id)`, not offset
- [x] `@@index([visibility, status, publishedAt])` for the recency sort —
      #1005; `sort=recent` had been sorting the whole tier, since the
      `useCount` index cannot serve it
- [x] Tests: cross-tier leakage (unlisted absent, another workspace's listings
      absent, a moved document's listing absent), token omission, cursor
      stability while counts change

### 2b. Thumbnails

- [x] Client-side capture at publish — #1005, though **not** by the routing
      this box sketched. Slides render slide 1 offscreen
      (`renderThumbnail()`); `doc`, `sheet` and `board` composite the live
      editor canvases, because neither package exports an offscreen renderer
      and a board has no first page; `note` is *synthesized* from the first
      lines of markdown, since it is the one editor with no canvas at all.
      The mounted editor registers a capture source and the Share dialog asks
      a registry by document id — `components/` may not import `@/app/*`
- [x] Downscale ~640 px WebP → `POST /images` → store the **id**, never a URL
- [x] Refresh on republish; document that a thumbnail is a snapshot
- [x] Card and landing page render it (landing page already does)
- [ ] `pdf` / `image` thumbnails — the stored blob's first page and the image
      itself. Not built; both still fall back to the type icon. (`file` has no
      thumbnail by design.)

### 2c. Taxonomy

- [x] Fixed `category` list shared by backend validation and the frontend picker
      (Business / Education / Personal / Project management / Finance /
      Marketing / Design / Other) — a constant, not a table
- [x] Tag normalization on write: trim, lowercase, de-duplicate, max 10
- [x] Category + tag inputs in the Share dialog's Template section

### 2d. Surfaces

- [x] **Templates** tab at `/w/:workspaceId/templates`
- [x] **New from template** picker in the documents-list create menu
- [x] Manager may unpublish any listing in their workspace (publishing itself is
      manager-gated at this tier too — see Decisions). `unpublish()` calls
      `assertManager` → `isDocumentManager(role, authorID, userId)`, which a
      workspace owner satisfies for every document in the workspace
- [x] Refuse to publish a document whose root holds a `datasource` /
      `lakehouse` tab — #1005 (`template-content-guard.ts`), and it runs at
      **use** as well as publish, because a listing tracks a live document.
      Fails closed, and only `sheet` documents pay the Yorkie read:
      `TabMeta.datasourceId` is workspace-scoped, so a
      cross-workspace use lands an inert tab. Not an access bypass (every
      datasource route re-derives auth from the row's own `workspaceId`), but a
      template depending on a private connection is not shareable. Costs one
      Yorkie read at publish, which is rare

### 2e. Phase 1 shortcuts cleared here

A gallery makes both far more visible than a single hand-sent link did.

- [x] Embed the preview in `/t/:id` instead of opening `/shared/<token>`.
      Cheaper than estimated: every component below the route already took
      `token` as a prop, so this was extracting `SharedDocumentByToken`, not
      a refactor of a 1088-line component
- [x] Return a logged-out visitor to `/t/:id` after sign-in. **Not** via the
      OAuth `state` as sketched — `state` must stay an opaque token compared
      by equality. The path rides in its own short-lived cookie and is
      re-validated on read by `safeReturnPath`

## Phase 3 — Public community gallery

Everything the workspace tier can skip *because* its audience is bounded.
`public` stays refused with a `400` until all of it exists — this phase is not
a flag flip.

### 3a. Review pipeline

- [ ] Requesting `public` sets `status: 'pending'` and lists nothing
- [ ] `POST /templates/:id/review { decision, reason? }` gated on
      `WAFFLEBASE_TEMPLATE_REVIEWER_IDS` (configuration, not a new admin console)
- [ ] `template_reviewed` notification on both outcomes; the rejection reason is
      the notification `preview` — a submission that disappears silently is the
      failure mode CapCut's help pages are mostly about
- [ ] Reviewer queue view (pending listings + reports)

### 3b. Frozen-copy promotion

- [ ] `WAFFLEBASE_TEMPLATE_WORKSPACE_ID` system workspace, seeded once
- [ ] Approval copies into it and re-points `documentId`, recording the
      publisher's original in `originId`
- [ ] Republish → new frozen copy → re-review; the superseded copy is deleted
      once the listing points at its replacement
- [ ] Re-host the frozen copy's embedded images into listing-owned keys
      (reuse the Miro importer's re-hosting shape), so a publisher deleting an
      image cannot break an approved listing

### 3c. Public browse

- [ ] `/templates` page outside `PrivateRoute`, reading 2a with `scope=public`
- [ ] Document-type and category facets, popular/recent sort
- [ ] Search: `ILIKE` over title/description + tag containment; `pg_trgm` index
      only if it gets slow — Postgres only, no new infrastructure

### 3d. Trust and safety

- [ ] License grant required to submit (`licensedAt`); grant text as a docs page
- [ ] Attribution (author) on the listing and the card
- [ ] `TemplateReport` model + `POST /templates/:id/report { reason }`,
      authenticated and throttled
- [ ] Takedown sets `status: 'rejected'` + visibility back to `unlisted`; never
      touches the document, and copies already made stay
- [ ] Ranking guards: a publisher's own use does not increment `useCount`;
      per-user throttle on `use`

## Still Non-Goals at every phase

Monetization (Canva's royalty pool / CapCut's payouts — needs payments, tax and
fraud defence), template versioning, and CapCut-style parameterized slots
(decided against, see Decisions).

## Review

**Phase 1 landed in [#1000](https://github.com/wafflebase/wafflebase/pull/1000).**
25 files, +2621/-20. The spine only: one template, one link, one copy. There is
no discovery surface, which is what Phases 2–3 above are.

What the design predicted and what actually happened:

- **The copy engine carried the feature.** `DocumentCopyService` needed one
  optional `dest` parameter; every document type, the rollback ordering and the
  comment stripping came for free. The estimate that this would be a small
  change held.
- **The unauthenticated image route removed the hardest problem** before it
  cost anything. Checking it first was worth more than any code in the PR.
- **Four review findings survived verification**, two of them real defects in
  code this PR added, both fixed with regression tests before merge:
  `publish()` blanked unmentioned fields on a partial re-publish — which could
  silently widen a `workspace` listing to `unlisted`, the *more* permissive
  tier — and `unpublish()` deleted the listing before revoking its non-expiring
  preview link, so a failed revoke stranded a permanent anonymous read
  capability with nothing left to surface it. The other two were doc-accuracy:
  the Risks table stated Phase 3 mitigations in the present tense, and the
  status header of this file still said implementation had not started.
- **Two authorization gaps were caught in self-review** before the PR opened,
  both about *which id* confers authority — see the lessons file.
- **One cost not predicted:** the frontend chunk-count gate. A single lazy
  route put the build at 216 chunks against a 215 cap and the pre-push
  `verify:self` refused the push. Bumping the cap was the right side of the
  trade for a public route a signed-in session never opens.
- **One limitation found by review, deferred with a plan:** a `datasource` /
  `lakehouse` tab copied across a workspace boundary lands inert. Refusing to
  publish such a document is a Phase 2 item above.
