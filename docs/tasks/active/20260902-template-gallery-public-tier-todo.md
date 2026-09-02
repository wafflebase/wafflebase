# Template Gallery — Public Tier (Phase 3)

Design doc: [template-gallery.md](../../design/template-gallery.md)
Predecessor task: [20260901-template-gallery-todo.md](./20260901-template-gallery-todo.md)
PR: [#1009](https://github.com/wafflebase/wafflebase/pull/1009) — the plan, and where 3a lands
Status: **planned, nothing implemented.** `visibility: 'public'` is still
refused with a `400` and stays refused until 3d lands.

## What this phase is actually for

`unlisted` already serves a logged-out visitor at `/t/:id`, so reading a
template from outside its workspace is not what is missing. What is missing is
**discovery and trust**: being found rather than only received, and being worth
opening once found. Canva's marketplace tier, on top of the template link and
Brand Templates tiers Phases 1–2 already built.

## Principles

- **`visibility: 'public'` is written only by the approval path.** Publish and
  update keep refusing it forever; a publisher asks via a separate `submit`
  verb. `assertPublishable` is not relaxed — it is the invariant.
- **Submission changes nothing observable.** `visibility` stays at the effective
  tier through review so an already-handed-out link neither breaks nor widens.
  Only `status` moves.
- **Fail closed on configuration.** An empty reviewer allowlist means no
  reviewers, which means the gallery stays shut — the same direction the current
  `400` fails in.
- **Fix the boundary, not just the tier.** Cross-workspace image loss is a live
  defect at every tier; the re-hosting work belongs in `DocumentCopyService`,
  not in the promotion path.
- **The public tier opens last.** Each PR merges on its own with the gallery
  still closed; only 3d lifts the refusal.

## PR 3a — Review pipeline

- [x] Prisma: `TemplateListing.status` gains `removed`; add `submittedAt`,
      `reviewedAt`, `reviewedBy`, `reviewNote`. Migration. Update the `status`
      column comment in `schema.prisma`, which still records "only the `public`
      tier ever leaves `listed`" — the assumption `browse()` was written on.
      (The `[visibility, status, publishedAt]` index already shipped in Phase 2;
      do not re-add it.)
- [x] `assertPublicTierOpen()` — one guard consulted by **both** `submit` and
      `approve`, throwing until 3d. Without it 3a is a complete path to
      `visibility: 'public'`, and `GET /templates?scope=public` already ships
      unauthenticated.
- [x] `POST /templates/:id/submit { license: true }` — manager-gated, sets
      `status: 'pending'` + `submittedAt` + `licensedAt`. Refuses without the
      license grant (`400`). Refuses a listing already `pending` or `removed`.
- [x] `TemplateReviewerGuard` reading `WAFFLEBASE_TEMPLATE_REVIEWER_IDS`
      (comma-separated user ids). Empty allowlist → every review route `403`.
- [x] `POST /templates/:id/review { decision, note? }` —
      `approve` | `reject` | `takedown`.
- [x] `takedown` sets `status: 'removed'`, `visibility: 'unlisted'`, and revokes
      the preview share link **in the same transaction** as the row write.
- [x] Every decision write is a compare-and-set on the status it was validated
      against, answering `409` when it matches nothing — otherwise two
      reviewers deciding at once both pass the source-state check and the later
      write wins, leaving a public listing nobody approved. `submit` takes the
      same guard.
- [x] `reject` leaves `visibility` untouched — the listing keeps working at the
      tier it already had.

**Fix the shipped readers the new states break** (see the design's *How the new
states compose with the shipped service*; each is a real contradiction with
`template.service.ts` as it stands, not a hypothetical):

- [x] `assertPublishable` refuses the **transition into** `public`, not its
      presence — otherwise an approved listing can never be re-published or have
      its title edited (`visibility` falls back to the stored `'public'`).
- [x] `publish()`/`update()` **preserve `status`** instead of writing
      `status: 'listed'`; a `removed` listing refuses republish. As shipped, one
      re-publish reverses a takedown and re-mints the revoked preview link.
- [x] `browse()`'s status filter becomes scope-dependent: `'listed'` for
      `scope=public`, `{ not: 'removed' }` for `scope=workspace`. Otherwise a
      submitted workspace listing vanishes from its own tab.
- [x] `removed` is checked **before** the visibility switch in `isVisibleTo`
      (a takedown writes `visibility: 'unlisted'`, which returns `true`
      unconditionally), and `use()` gains the same check — it never reads
      `status` today.

- [x] `GET /admin/templates/review` — pending submissions, reviewer-gated,
      **returning each submission's `previewToken`** (`findForViewer` gives a
      reviewer nothing for a `workspace`-tier listing). Reports join it in 3d,
      when `TemplateReport` exists.
- [x] Frontend `/admin/templates` queue page: embedded preview (reuse
      `SharedDocumentByToken`), approve / reject / takedown with a note field.
- [x] Notification types — **three, not one**: `template_approved` /
      `template_rejected` / `template_removed`. The decision is the type for the
      same reason `comment_mention` and `comment_reply` are separate; a single
      `template_reviewed` would make the reader open it to learn the one thing
      they want to know. Note becomes the `preview`; dedupe keys on the decision
      instant so a second decision on a revised listing is not absorbed.
- [x] Tests: state machine transitions (each decision from each start state),
      allowlist empty → closed, submit without license → 400, a pending
      workspace listing still appears in `scope=workspace` browse, republish
      cannot clear `removed`, `use()` refuses a `removed` listing.

**Landed.** One consequence worth stating rather than discovering: because
`assertPublicTierOpen()` gates `submit` as well as `approve`, nothing can enter
the queue until 3d, so `/admin/templates` is empty by construction until then.
That is the intended state — the alternative, gating only `approve`, would let a
publisher submit and then wait indefinitely, which is the silent-disappearance
failure this pipeline exists to avoid. The state machine behind the gate is
tested by opening it in the spec (`openPublicTier`), so 3d is a one-line change
to a path already exercised.

## PR 3b — Cross-workspace images + frozen-copy promotion

- [ ] Image re-hosting walker in `DocumentCopyService`, run whenever
      `dest.workspaceId !== source.workspaceId`. Rewrites only URLs pointing at
      this deployment's workspace-scoped image route; `CopyObject` into
      **`{destWorkspaceId}/{newId}`** and rewrite to the destination's
      workspace-scoped URL — *not* an unscoped bucket-root key, which would
      publish a private workspace's images at a permanent unauthenticated URL.
      Third-party URLs untouched.
- [ ] Aggregate object/byte ceiling with a skipped-items report (mirror
      `MAX_REHOSTED_IMAGES` / `MAX_TOTAL_IMAGE_BYTES` in `miro.service.ts`).
      Failure degrades the copy rather than failing it.
- [ ] Extend `copy()`'s rollback to discard re-hosted objects — it discards only
      `fileId` today, so a later `copyContent` failure orphans them.
- [ ] Per-type walkers: `sheet` (worksheet images), `board` and natively
      inserted `slides` images (element `data.url`, background image fills).
      **`doc` needs nothing** — its images already live at the bucket root
      (`docsImageUploader` → `POST /images`), as do PPTX-imported slides images.
      `pdf`/`image`/`file` need nothing (blob already copied). **`note` is
      affected but deferred** — single Yorkie `Text`, rewriting is a CRDT edit;
      a copied note loses its images until then.
- [ ] Only re-host a URL whose workspace segment equals the **source
      document's own** `workspaceId`. The id sits in author-written content, so
      a URL naming another workspace is an ordinary thing for a document to
      contain — and re-hosting it would `CopyObject` an image out of a
      workspace the copier cannot read (IDOR, with the server doing the
      reading). Everything else is left alone and goes on 403-ing. **Negative
      test required**: a document referencing `{otherWorkspaceId}/{id}` copies
      with that URL untouched and no `CopyObject` issued.
- [ ] Failure policy differs by caller: `use` degrades (the caller's own copy,
      one missing image beats no document); **promotion fails the approval**
      and surfaces the skipped-object report to the reviewer, because an
      approved listing with broken first-party images is a defect handed to
      every future user.
- [ ] Verify the fix end to end: use a template containing an image into a
      *different* workspace and confirm the copy renders it (today it 403s).
      Use a **`sheet`** — a `doc` works already and would prove nothing, and a
      `note` is excluded from the first-pass walker, so it must assert the
      documented limitation instead of success.
- [ ] Remove `DELETE /images/:id` from `image.controller.ts`; keep
      `ImageService.delete` for in-process callers. Confirm no client calls it.
- [ ] Promotion on `approve`, in this order — re-scan `assertContentIsShareable`
      → copy origin into `WAFFLEBASE_TEMPLATE_WORKSPACE_ID` → re-host images →
      mint a new non-expiring `viewer` link on the frozen copy → single
      transaction re-pointing `documentId`/`originId`/`visibility`/`status`/
      `shareLinkId` → **then** revoke the old link and delete the superseded
      frozen copy.
- [ ] The frozen copy is authored by the **publisher**, not the reviewer — it is
      what keeps `assertManager`/`isManagerOf`/`canManage` answering yes for the
      publisher after the document moves to the system workspace, so `unpublish`
      and `update` keep working without an "authority document" concept.
- [ ] Regression test for that ordering: deleting before re-pointing cascades the
      listing away. Assert the listing survives a republish.
- [ ] `findByDocument` matches `documentId` **or** `originId` — a `findFirst`
      with an `OR`, not `findUnique`, since `originId` is not unique.
- [ ] `unpublish` deletes the frozen copy too.
- [ ] Seed/config check for `WAFFLEBASE_TEMPLATE_WORKSPACE_ID`; a missing or
      unresolvable value makes `approve` fail loudly, not silently list.

## PR 3c — Public browse

Smaller than it looks: `q`, `sort=popular|recent`, the `ILIKE` clause, the keyset
cursor, the recency index and `TemplateGallery`'s `scope` prop all shipped in
Phase 2. What is new:

- [ ] Tag containment inside `q` (title/description `ILIKE` already exists).
      `pg_trgm` index only if measured slow.
- [ ] `/templates` route outside `PrivateRoute`; type + category facets, sort
      control, query box, empty state. Reuse the existing card components.
- [ ] Homepage link into the gallery.
- [ ] **Public** tab in the workspace Templates tab and the New-from-template
      dialog, backed by the same collection call.
- [ ] Confirm list responses still carry no `previewToken`.
- [ ] Note in the design doc: no SSR, so the gallery is not indexable. Not fixed here.

## PR 3d — Trust, then open the tier

- [ ] Prisma `TemplateReport` + migration.
- [ ] `POST /templates/:id/report { reason, note? }` — JWT + `UserThrottlerGuard`,
      unique per (listing, reporter).
- [ ] Reports surface in the 3a queue page.
- [ ] Public card shows publisher username + avatar; never the email.
- [ ] Submission dialog states, in a sentence, that the username and avatar
      become visible to anyone.
- [ ] `useCount` guards: the listing's own publisher does not increment it;
      per-user throttle on `use`.
- [ ] **Lift the refusal**: `submit` becomes reachable end to end and an approved
      listing is genuinely public.
- [ ] devops repo bump for `WAFFLEBASE_TEMPLATE_REVIEWER_IDS` and
      `WAFFLEBASE_TEMPLATE_WORKSPACE_ID`; document both in
      `packages/backend/README.md`.

## Open questions

- Who is on the initial reviewer allowlist, and what is the response-time
  expectation the queue page should state to publishers?
- Does the system template workspace need to be invisible in the workspace
  switcher for its owner, or is "owned by an ops account" enough?

## Review

_(filled in when the phase lands)_
