---
title: template-gallery
target-version: 0.6.8
---

# Template Gallery — Publishing and Reusing Documents as Templates

## Summary

A place where a user publishes a document as a **template** and other users
start a new document from it — the Canva "Use template" / CapCut "Use this
template" loop, applied to sheets, docs, slides, notes and boards.

The destination is a **public community gallery** — anyone can browse published
templates and start a document from one. The three visibility tiers below are
the rollout path to that, not alternatives to it: the unlisted and workspace
tiers ship first because they exercise the same publish/preview/use spine
without the moderation surface, and the public tier turns it on.

The proposal is deliberately unambitious about mechanism: a template is an
ordinary document plus a **listing** row, and "use a template" is the
`POST /documents/:id/copy` engine that already ships
([document-copy.md](document-copy.md)) pointed at a *different* workspace.
Nothing about the document model, the Yorkie schema, or `Document.type`
changes. What is genuinely new is a listing model, a discovery surface, and —
only for the public tier — review and attribution.

### Scope map

The whole feature, and where each piece lands. Phases 1 and 2 shipped in 0.6.8;
Phase 3 is the branch this table now describes.

| Capability | Phase | State |
| --- | :---: | --- |
| `TemplateListing` model, publish / unpublish / edit | 1 | shipped |
| Preview via a minted `viewer` share link | 1 | shipped |
| Use → copy into a destination workspace | 1 | shipped |
| `/t/:id` landing page, unlisted link sharing | 1 | shipped |
| Manager gate, per-tier visibility, `useCount` | 1 | shipped |
| **`GET /templates` collection endpoint** (facets, sort, keyset pages) | 2 | shipped |
| **Thumbnail capture** per document type | 2b | shipped (5 of 8 types — see [Thumbnails](#thumbnails)) |
| **Category taxonomy + tag normalization** | 2 | shipped |
| **Workspace Templates tab**, New-from-template picker | 2 | shipped |
| Embedded preview, post-login return to `/t/:id` | 2 | shipped |
| **Review pipeline** (submit → approve / reject / takedown) + reviewer allowlist | 3a | shipped |
| **Cross-workspace image re-hosting** — fixes `use`, not only public | 3b | shipped |
| Re-review on change + content watermarks (bait-and-switch defence) | 3b | shipped |
| **Frozen-copy promotion** into a system workspace | — | deferred, see [Keeping an approved listing honest](#keeping-an-approved-listing-honest) |
| **Public `/templates` browse page** + search | 3c | shipped |
| Takedown state (`removed`) + reviewer queue | 3a | shipped |
| License grant, attribution, report intake | 3d | shipped |
| Ranking guards (self-use, rate limits) | 3d | shipped |
| Monetization, versioning, parameterized slots | — | Non-Goal |

Phase 1 built the *spine* — one template, one link, one copy. Phase 2 built the
*store*: the collection endpoint, the taxonomy, and the workspace surfaces that
turn a set of listings into something you can browse. Phase 3 is what makes it
public — everything the workspace tier can skip because its audience is
bounded.

### Goals

- Publish any document type as a template with a title, description, category
  and tags, at one of three visibility tiers: **unlisted link**, **workspace**,
  **public**.
- Anyone allowed to see a listing can preview it read-only without an account,
  and can start their own independent copy in a workspace they belong to.
- **Browse and search** the templates the caller is allowed to see, faceted by
  document type and category and ranked by usage, so a template is found rather
  than only received.
- A public listing is **reviewed before it is listed**, attributed to its
  author, licensed explicitly, reportable, and immutable after approval.
- The publisher's document is never mutated by anyone using it.
- Reuse what exists: the copy service, share links, the image bucket, the
  documents list, the notification system.

### Non-Goals

- **Monetization.** Canva's royalty pool and CapCut's per-export payouts need
  payments, tax handling, and usage-fraud defence. Out of scope; the `useCount`
  this design records is the metric such a program would later need.
- **Parameterized templates.** CapCut's replaceable-clip slots are **declined**,
  not deferred pending evidence: we are adopting the Canva model, where a
  template is copied and then edited in its own editor. See *Declined:
  parameterized templates* for what we would build if that changes.
- **A template file format.** Both reference products avoid one, and so do we —
  see *Why a template is not a document type*.
- **Editing someone else's listing**, template versioning, and per-template
  collaboration. A listing is republished, not versioned.

## Research: how Canva and CapCut share documents

### Canva — three tiers over one artifact

1. **Template link.** In a design, *Share → Template link → Create template
   link*. The recipient opens the URL, is told a template was shared with them,
   and clicks **Use template**; Canva creates a new copy inside *their* account
   and the publisher's design is untouched. Gated on a paid plan
   ([Canva Help: share a template link](https://www.canva.com/help/share-template-link/)).
2. **Brand Templates.** A design published into the team's gallery as an
   on-brand starting point, visible only inside that team
   ([Canva Help: publish designs as Brand Templates](https://www.canva.com/help/publish-team-template/)).
   Google Workspace's org template gallery is the same tier with the same
   shape — *Submit template*, pick a category, optionally submit a copy rather
   than the original, admin-gated on who may submit
   ([Google: custom Drive templates](https://support.google.com/a/answer/3055325)).
3. **Marketplace, via Canva Creators.** Designs are reviewed against quality
   standards before they are published, become searchable inside the editor's
   template panel, and earn royalties from a monthly pool proportional to how
   often they are *used*
   ([Canva Creators](https://www.canva.com/creators/templates/)).

The template is never a distinct file type. It is a design plus a publish mode,
and the shared primitive across all three tiers is **copy-on-use**.

### CapCut — the same tiers, plus a parameterized template

1. **Send project.** A `.capcut` project file handed to a peer — the literal
   export/import path, equivalent to our `.xlsx`/`.pptx` round trip.
2. **Publish as Template.** Creator-gated (Creator Center access, tied to
   account level and an 18+ agreement) and, crucially, the project carries
   **replaceable material clips**: the author ticks each clip that a user may
   swap and can constrain it by media type and maximum duration, so the
   published template is a *schema of slots* rather than a flat copy
   ([CapCut: set replaceable material clips](https://www.capcut.com/help/how-to-set-replaceable-material-clips)).
   Metadata is title + hashtags + clip count + duration.
3. **Moderation, then a feed.** Every template goes through automated and human
   review — typically 6–24 hours, longer under load — and is rejected for
   copyright, non-original work, broken assets, or unsupported AI effects
   ([CapCut moderation](https://www.capcut.com/trust/safety/moderation),
   [review time](https://www.capcut.com/help/template-review-time-become-longer)).
   Users then discover templates in a feed, hit **Use template**, batch-replace
   the placeholder clips with their own media, and export.

### What both agree on

| Property | Canva | CapCut | Consequence for us |
| --- | --- | --- | --- |
| Copy-on-use, original immutable | ✅ | ✅ | We already have the engine. |
| Template = normal artifact + listing metadata | ✅ | ✅ | No new `Document.type`. |
| Three visibility tiers (link / team / public) | ✅ | ✅ (peer file / — / feed) | Ship them in that order. |
| Public tier is reviewed | ✅ | ✅ | Public is a distinct, later phase. |
| Usage count is the primary metric | ✅ royalties | ✅ payouts | Record `useCount` from day one. |
| Slots / placeholders | ❌ (everything is editable) | ✅ | Optional; defer. |

The one axis where they differ is parameterization, and it tracks the medium:
a Canva design is edited after copying anyway, while a CapCut template must be
usable in thirty seconds on a phone. Office documents sit on Canva's side of
that line, which is why *Deferred: parameterized templates* is deferred and not
central.

## What we already have

Roughly the whole engine, which is why this is a small feature:

- **`POST /documents/:id/copy`** (`DocumentCopyService`) duplicates any of the
  eight types — whole-root Yorkie snapshot for `sheet`/`slides`/`board`, the
  `Tree`/`Text` serializers for `doc`/`note`, S3 `CopyObject` for the blobs —
  with ordered rollback, comment stripping, and a read-only permission gate.
  Its **only** template-relevant limitation is that the destination is
  hardcoded to `source.workspaceId` / `source.folderId`.
- **`ShareLink` + `/shared/:token`** already give anonymous, role-scoped,
  revocable read access with a per-type read-only viewer for every document
  type ([sharing.md](sharing.md)).
- **`GET /images/:id` is unauthenticated** and immutably cached
  (`packages/backend/src/image/image.controller.ts`), which is what lets a
  *thumbnail* render for a visitor holding nothing.

  It does **not** cover every image inside a document, and an earlier revision
  of this section claimed it covered them all. There are two upload paths and
  which one a document used decides whether its images survive a copy:

  | Path | Key | Read | Types using it |
  | --- | --- | --- | --- |
  | `postSharedImage` → `POST /images` | bucket root | unauthenticated | thumbnails; `doc` (`packages/frontend/src/app/docs/export-utils.ts`); PPTX-imported `slides` images |
  | `postWorkspaceImage` → `POST /api/v1/workspaces/:wid/images` | `{workspaceId}/{id}` | member / workspace API key / share token | `sheet`, `board`, `note`, and natively inserted `slides` images (`packages/frontend/src/app/spreadsheet/image-upload.ts`) |

  So a document copied across a workspace boundary loses the images in the
  second row *today*, at every tier — and the preview is what hides it: the
  preview carries a share token and renders fine, while the copy the user
  actually receives does not. `doc` is unaffected, `slides` is affected only
  for images inserted in the editor, and `note` — which an earlier revision of
  this document excused as "external links anyway" — is affected like any
  other. See
  [Cross-workspace image re-hosting](#cross-workspace-image-re-hosting).
- Workspaces, folders, member roles, the documents list with its row and bulk
  menus, notifications, and the share-link view analytics.

The gaps are exactly: a destination parameter on copy, a listing model, a
discovery surface, a logged-out landing page, and (public only) review.

## Proposal

### Why a template is not a document type

`Document.type` is defined as a **viewer-routing key** — "which editor opens
this" ([generic-file-upload.md](generic-file-upload.md)) — and
`DocumentCopyService` dispatches on it. A template must open in the editor of
whatever it is a template *of*, so a `template` type would have to carry a
second, real type inside it and every consumer would have to unwrap it. The
listing is therefore a sidecar row:

```prisma
model TemplateListing {
  id          String    @id @default(uuid())
  documentId  String    @unique          // Document, onDelete: Cascade
  workspaceId String                     // publisher workspace, Cascade
  createdBy   Int                        // User, SetNull-safe on display
  shareLinkId String?                    // preview link, minted at publish

  title       String
  description String?
  category    String?
  tags        String[]
  thumbnailId String?                    // key in the image bucket

  visibility  String    @default("unlisted") // unlisted | workspace | public
  status      String    @default("listed")   // listed | pending | rejected | removed
  useCount    Int       @default(0)
  licensedAt  DateTime?                      // publisher's license grant
  originId    String?                        // publisher's original, once
                                             // `documentId` points at a frozen copy

  submittedAt DateTime?                      // Phase 3: review columns
  reviewedAt  DateTime?
  reviewedBy  Int?
  reviewNote  String?

  publishedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([visibility, status, useCount])
  @@index([visibility, status, publishedAt])  // shipped in Phase 2
  @@index([workspaceId, visibility])
}

model TemplateReport {                       // Phase 3d
  id         String   @id @default(uuid())
  listingId  String                          // TemplateListing, Cascade
  reporterId Int                             // User, Cascade
  reason     String                          // copyright | inappropriate |
                                             // broken | spam | other
  note       String?
  status     String   @default("open")       // open | dismissed | actioned
  createdAt  DateTime @default(now())

  @@unique([listingId, reporterId])          // one person cannot bury a queue
  @@index([status, createdAt])               // open reports, oldest first
}
```

`documentId` is unique: one document has at most one listing, so "publish" is
an upsert and the listing is the document's publish mode, matching Canva.

### The two mechanics

**Publish** is gated at the *manager* tier — workspace owner or document author,
`isDocumentManager()` — at **every** visibility tier, including the workspace
one. It is the same bar as minting an editor share link, and for the same
reason: publishing hands the document's content to an audience the workspace's
membership no longer bounds. A plain member who wants their document published
asks a manager, exactly as they do for an editor link.

Publishing mints a non-expiring
`viewer` `ShareLink` and stores its id on the listing; unpublishing revokes it.
That is what makes preview free: `/t/:id` resolves the listing, then renders
through the existing `/shared/:token` per-type read-only layouts, and the Yorkie
auth webhook already honours that token in enforce mode.

**Use** is the copy service with a destination:

```ts
copy(source: DocumentModel, userId: number, dest?: { workspaceId, folderId })
```

`POST /templates/:id/use { workspaceId, folderId? }` is the only place a
document crosses a workspace boundary, so authorization inverts relative to
every other document route: **read authority comes from the listing**
(`public`, or `workspace` and the caller is a member of the publisher's
workspace, or `unlisted` and the caller holds the link), and **write authority
comes from destination membership** (`assertMember(dest.workspaceId)`, plus the
existing `assertSameWorkspace` check for `folderId`). The copy is authored by
the caller, so the audit trail names whoever used the template, not the
publisher.

Naming needs one small change: `copyTitle()` always appends `(copy)`, which is
right for a duplicate and wrong for a template use. A `uniqueTitle(base,
existing)` variant returns `base` when it is free and falls back to the same
`(2)`, `(3)` de-duplication, so the first use of "Weekly Report" is called
"Weekly Report".

`useCount` increments on success in the same transaction as nothing else — it
is a counter, not a ledger, and an occasional lost increment is acceptable.

### Live source vs. frozen copy

Canva's template link tracks the live design: edit the design and the template
changes. That is right for the unlisted and workspace tiers, where the audience
already trusts the publisher, and it is what falls out of pointing the listing
at `documentId`.

It is wrong for the public tier, where it is a bait-and-switch: a template
approved as a budget sheet could be edited into something else after review,
under the same listing and the same accumulated usage count. So **approving a
public listing re-points it at a frozen copy** — the copy service again, into a
system-owned workspace, at approval time. The publisher keeps editing their
original; republishing produces a new frozen copy and re-enters review.

### Phasing

**Phase 1 — Template link (unlisted).** *Shipped.* The listing model,
publish/unpublish from a **Template** section at the bottom of the document
header's Share dialog, the `dest` parameter on the copy service,
`POST /templates/:id/use`, and the public `/t/:id` landing page: the card,
author, use count, **Use this template**, and **Preview**.

Three things came out smaller than sketched above, deliberately:

- **Preview opened `/shared/<previewToken>`** in a new tab rather than
  embedding the viewer. *Cleared in Phase 2* — and the stated reason turned out
  to be wrong, which is worth recording: `SharedDocument` is 1088 lines, but
  every component below the route already took `token` as a **prop**. The
  coupling to the router was a single `useParams` line, so the split into
  `SharedDocumentByToken` was one commit's worth of moving a function
  signature, not the refactor this bullet feared.
- **A logged-out visitor went to `/login`, not back to `/t/:id`.** *Cleared in
  Phase 2* — see *Returning a visitor after login*.
- **No thumbnail is captured yet.** *Cleared in Phase 2b* — see
  [Thumbnails](#thumbnails), including the three types that read the live
  editor canvas instead of an offscreen renderer and the documents that still get no
  picture at all.

Publishing at the `public` tier is refused with a `400` for as long as Phase 3
does not exist — failing closed, because a publisher told "ok" would believe
their template was in a gallery that nothing reviews.

**Phase 2 — Workspace gallery.** The Brand Templates / Google org-gallery tier,
and the phase that turns a set of listings into something browsable. The
authorization for `visibility: 'workspace'` already shipped and is tested; what
is missing is everything that lets anyone find such a listing. Four pieces,
detailed in *Discovery: the collection endpoint*, *Thumbnails* and *Taxonomy*
below:

1. `GET /templates` — the collection endpoint, shared by every later surface.
2. Thumbnail capture, so a card has something to show.
3. A category taxonomy and tag normalization, so facets mean something.
4. The surfaces: a **Templates** tab at `/w/:workspaceId/templates`, and a
   **New from template** picker in the documents-list create menu.

Publishing stays manager-gated here, and a manager may unpublish any listing in
their workspace. No review: workspace membership is the trust boundary. The two
Phase 1 shortcuts — the preview opening in a new tab, and a logged-out visitor
not returning to `/t/:id` — are also cleared here, because a gallery makes both
much more visible than a single hand-sent link does.

**Phase 3 — Public gallery.** Everything the workspace tier can skip *because*
its audience is bounded, and the public tier cannot. It shipped as four steps —
3a review, 3b the bait-and-switch defence plus cross-workspace images, 3c
browse, 3d trust — and `visibility: 'public'` stayed refused with a `400` until
the last one, so no intermediate state could list content that nothing reviews.
The sections below carry the detail.

Two preconditions gate the tier at runtime rather than being documented and
hoped for, and both are checked at `submit` *and* `approve` because a setting
can change between a submission and its decision:
`WAFFLEBASE_TEMPLATE_REVIEWER_IDS` must name somebody (no reviewers means no
review pipeline), and `YORKIE_AUTH_WEBHOOK_ENFORCE` must be `true` (see
[Keeping an approved listing honest](#keeping-an-approved-listing-honest)).

Note what Phase 3 is *not*: it is not what makes a template readable outside its
workspace. `unlisted` already does that, and `/t/:id` already serves a logged-out
visitor. What the public tier adds is **discovery and trust** — being found
rather than only received, and being worth opening once found. In Canva's terms,
Phases 1–2 built the template link and the Brand Templates tier; this is the
marketplace.

#### The state machine

One invariant carries the phase: **`visibility: 'public'` is written only by the
approval path.** The publish and update routes go on refusing it with a `400`
forever, and a publisher asks for the public tier through a separate verb:

```http
POST /templates/:id/submit { license: true }    → status: 'pending'  (visibility unchanged)
POST /templates/:id/review { decision, note? }  → approve  : visibility='public', status='listed'
                                                  reject   : status='rejected',  visibility unchanged
                                                  takedown : status='removed',   visibility='unlisted',
                                                             preview link revoked
```

Every transition has an **allowed set of source states** (`approve` and
`reject` only from `pending`; `takedown` from `listed`, `pending` or
`rejected`; nothing from `removed`), and every write is **conditional on the
status it was validated against** — a compare-and-set, not an unconditional
update by id. Two reviewers deciding at once otherwise both pass the source-state
check and the later write simply wins: a takedown followed by a concurrent
approve leaves `status: 'listed', visibility: 'public'` on a listing whose
preview link was already deleted, which is a public listing no reviewer
approved. The loser gets a `409` telling them to look again.

**`submit` takes the same guard**, and the case it exists for is a submission
racing a takedown: with the guard, a takedown that commits first leaves the
submission matching nothing and the publisher gets a `409`; without it, the
submission would write `pending` over `removed` and walk back a terminal
decision. (`submit` also refuses a `removed` listing outright when it reads
one — the compare-and-set is what covers the window between that read and the
write.)

The takedown's link revoke rides in the **same transaction** as the row write,
which is what makes the ordering question disappear: revoke-first leaves a
listing that looks live with no preview if the row write is lost, and row-first
leaves a row reading "removed" while the content stays anonymously readable.
Neither half may land alone.

Keeping `visibility` at its **effective** tier through review is the load-bearing
part, and it is a correction to this document's earlier sketch, which had a
submission write `visibility: 'public', status: 'pending'` together. That would
change how the listing reads *while it is being reviewed*: a `public` listing is
only visible when `status: 'listed'`, so an unlisted link already handed out
would stop resolving the moment its owner submitted it, and a workspace listing
would silently acquire a tier its members never approved. Separating the two
means submission changes nothing at all and approval changes everything, which is
also the only version a reviewer can reason about — what they are looking at is
what the publisher's audience sees today.

`rejected` and `removed` are distinct for a related reason. A rejection says the
submission does not meet the gallery's bar; it is not a verdict on the
publisher's private sharing, so the listing keeps working as the unlisted or
workspace listing it already was. A takedown says the content may not be served
at all — so it blocks every non-manager read and revokes the preview share link.
A single `rejected` state cannot express the second, which is the one a copyright
report needs.

`removed` is therefore **terminal in a way `rejected` is not**: it refuses
resubmission, republishing, editing, *and* unpublishing. The last one is what
makes the rest true rather than decorative — see the `unpublish()` row below.
A rejected listing, by contrast, is revised and resubmitted; that is the normal
path.

The publisher has to be able to see the decision, so a listing carries
`submittedAt` / `reviewedAt` / `reviewNote` back to its **manager only** (and to
the reviewer queue, which needs the wait time). The notification carries the
same note, but it is best-effort and is suppressed entirely when the reviewer
happens to be the publisher — the listing is the durable copy. Withholding it
from everyone else is deliberate: a reviewer's note is written for the
publisher, not for the gallery.

#### How the new states compose with the shipped service

A state machine is only as good as the readers it passes through, and
`TemplateService` already has seven. Four of them are wrong under the new states
in ways that are invisible from the state diagram, so they are enumerated here
rather than discovered during implementation.

| Reader | Today | Change |
| --- | --- | --- |
| `publish()` / `update()` | `assertPublishable` throws on `visibility === 'public'`, full stop (`template.service.ts:613`) | Must refuse the **transition into** public, not its presence. Otherwise an approved listing can never be re-published or even have its title edited, because `visibility` now falls back to the existing `'public'` — which contradicts this document's own "a republish produces a new frozen copy and re-enters review". |
| `publish()` | writes `status: 'listed'` unconditionally in the upsert `data` (`:214`), and re-mints `shareLinkId` when the stored one is gone (`:203`) | Must **preserve** `status`. As shipped, a manager re-publishing reverses a reviewer's takedown in one call and silently re-mints the preview link the takedown revoked. A `removed` listing refuses republish outright. |
| `browse()` | `where = { status: 'listed' }` for **both** scopes (`:438`) | Must be scope-dependent: `status: 'listed'` for `scope=public`, `status: { not: 'removed' }` for `scope=workspace`. Otherwise a workspace listing disappears from its own workspace's tab the moment it is submitted, and stays gone after a rejection — which is exactly the "submission changes nothing observable" property this design is built on. The comment on `TemplateListing.status` in `schema.prisma` records the old assumption ("only the `public` tier ever leaves `listed`") and moves with it. |
| `findForViewer()` / `use()` | authorize through `isVisibleTo`, which returns `true` unconditionally for `unlisted` (`:560`) | `removed` is checked **before** the visibility switch, not inside it — a takedown writes `visibility: 'unlisted'`, so a check placed in the switch would never run. `use()` needs it too: it consults `isVisibleTo`/`isManagerOf` and never looks at `status` (`:392`). |
| `findByDocument()` | `findUnique({ where: { documentId } })` | Becomes a `findFirst` matching `documentId` **or** `originId`; `originId` is not unique, so the signature genuinely changes. Without it the publisher's own Share dialog loses the listing the moment it is approved. |
| `assertManager()` / `isManagerOf()` / `toCard().canManage` | resolve membership against `listing.document.workspaceId` | Left alone — because promotion authors the frozen copy to the **publisher** (see [Frozen-copy promotion](#frozen-copy-promotion)), `isDocumentManager` keeps answering yes for them through `doc.authorID` even though the document now lives in the system workspace. Authoring it to the reviewer instead would hand every public card's manage rights to the reviewer and take `unpublish` away from the publisher. |
| `unpublish()` | deletes the listing, revokes the link, discards the thumbnail | Must **refuse** a `removed` listing, and this is the least obvious of the seven. `publish` reads the `removed` status off the *existing* row — so deleting that row first makes the next publish a `create`, which mints a fresh non-expiring anonymous preview link to the content a reviewer took down. Unpublish → publish would otherwise reverse a takedown with two buttons that already ship. The row stays as a tombstone. (It additionally deletes the frozen copy, from 3b.) |
| `findByDocument()` (again) | gates on workspace membership, never on `status` | Returns `null` for a `removed` listing to anyone but its manager. Membership rather than visibility is the gate here, so the takedown's "refuses every non-manager read" needs stating twice. |

Backward compatibility is free: every new column is nullable, `removed` is an
additive status value, and existing rows are `status: 'listed'` at a
non-public tier, which every rule above leaves alone.

#### Review

`POST /templates/:id/review` is gated by a `TemplateReviewerGuard` reading a
comma-separated allowlist of user ids from `WAFFLEBASE_TEMPLATE_REVIEWER_IDS`,
not by a new admin console — there is no admin surface today and building one is
a larger project than this feature. **An empty allowlist means no reviewers,
which means the public tier stays closed**: the same direction the current `400`
fails in, so a deployment that never configures anything never accidentally
opens a gallery.

An API without a screen would mean reviewing by `curl`, which in practice means
not reviewing, so 3a also ships one page at `/admin/templates`: pending
submissions and open reports, each with the embedded preview the landing page
already renders and approve / reject / takedown buttons. It is a queue, not a
console — it can see templates and nothing else.

The preview needs saying explicitly, because the landing page's token does not
reach a reviewer: `findForViewer` gives a `workspace`-tier listing only to a
member or a manager, and a reviewer is neither. `GET /admin/templates/review`
therefore returns each submission's `previewToken` itself, under the reviewer
guard. That is a real capability — a non-expiring read link to a document whose
workspace the reviewer does not belong to — and it is the point: reviewing
content means being able to see it. It is bounded to submissions, which their
publisher volunteered for review.

**Opening the tier is one guard, not a state.** `assertPublicTierOpen()` is
consulted by both `submit` and `approve`, and throws until 3d lands. Without it
3a would be a complete path to `visibility: 'public', status: 'listed'` — and
`GET /templates?scope=public` already ships unauthenticated, so an approval in
3a would be world-enumerable immediately. Each PR merges with the gallery shut
because this one function says so, not because the pieces happen not to connect.

Every outcome notifies the publisher through the existing notification system —
with one exception, a reviewer deciding their *own* listing, who is not notified
for the same reason an actor never notifies themselves anywhere else here.
Notifying at all matters because a submission that disappears silently is the
failure mode CapCut's own help pages are mostly about. The **decision is the
type** —
`template_approved` / `template_rejected` / `template_removed`, not one
`template_reviewed` carrying a field — for the same reason `comment_mention`
and `comment_reply` are separate types: the client renders one sentence per
type, and "your template was reviewed" makes the reader open it to learn the
one thing they wanted to know. The reviewer's note rides along as the
notification's `preview` — the only thing in the *payload* that carries a
reason. It is not the only copy of one: the note is also stored on the listing
and returned to its manager, which is what covers the self-review case, a failed
notification, and a publisher who reads the Share dialog before their inbox.

#### Cross-workspace image re-hosting

The largest piece of Phase 3, and the one that fixes something already broken.

In-document images are uploaded through the **workspace-scoped** route and read
back through an access-gated one, so a document copied into another workspace
loses them — at every tier, since Phase 1. The preview is what hides it: the
preview mounts on a share token and renders every image, while the copy the user
receives holds URLs it cannot read. A public gallery would make this the first
thing every visitor sees.

So the re-hosting walker is not a promotion-only step. It runs wherever a
document crosses a workspace boundary — that is, in `DocumentCopyService`
whenever `dest.workspaceId !== source.workspaceId`, which covers both
`POST /templates/:id/use` and approval-time promotion. It walks the *copy's*
root, and for each image URL pointing at this deployment's workspace-scoped
route, `CopyObject`s the object into **`{destWorkspaceId}/{newId}`** and
rewrites the reference to the destination's own workspace-scoped URL. URLs
pointing at a third-party host are left exactly as they are; we are not
mirroring the internet.

**The source workspace is checked, not trusted.** A workspace-scoped image URL
carries a workspace id, and that id sits in document content its author wrote —
so a URL naming *someone else's* workspace is an ordinary thing for a document
to contain, and a walker that re-hosts whatever it finds would `CopyObject` an
image out of a workspace the copier cannot read into one they can. That is an
IDOR with a server-side copy doing the reading. The walker therefore re-hosts a
URL only when its workspace segment equals the **source document's own**
`workspaceId`, and leaves every other URL exactly as it is — where it goes on
403-ing, which is the correct outcome for a reference the source workspace never
had the right to serve either.

The destination scope is the other half, and is easy to get wrong in the
cheaper direction. Re-hosting into an unscoped bucket-root key would also
"work" — `GET /images/:id` is unauthenticated, so every copy would render — but
it would publish every image of a `workspace`-tier template at a permanent,
world-readable, immutably-cached URL, as a side effect of one member copying a
template into a private workspace. That is a gate silently removed, not a bug
fixed. It is also what the Miro importer this section takes as its model
actually does: it re-uploads with a `workspaceId` and rewrites to
`/api/v1/workspaces/:wid/images/:id` (`packages/backend/src/miro/miro.service.ts`).
A public listing's frozen copy is no exception — its images land scoped to the
system workspace and are served to visitors through the listing's own share
token, which is the same capability the preview already rests on.

The walker also needs the budget the Miro importer has and this section
originally omitted: an aggregate ceiling on objects and bytes, with anything
skipped reported rather than dropped. `POST /templates/:id/use` is a
member-reachable route, and "one document's worth of content" stops bounding it
once each image is a server-side `CopyObject`. The objects the walker created
join `copy()`'s rollback, which today discards only `fileId`.

**The two callers take opposite failure policies**, and the difference is who
lives with the result. On `use`, a skipped image degrades the copy — the caller
asked for a document, one un-re-hosted image beats no document, and it is
*their* copy to fix. On **promotion it fails the approval**: a reviewer
approving a template is publishing it to everyone, and an approved listing whose
frozen copy has broken first-party images is a defect handed to every future
user, none of whom can do anything about it. The skipped-object report is
surfaced to the reviewer so the outcome is a decision they make, not a silence.

`pdf` / `image` / `file` documents need nothing: their bytes are already copied
by `CopyObject`. `doc` needs nothing either — its images live at the bucket root
already. **`note` is affected but excluded from the first pass**: its whole
content is a single Yorkie `Text`, so rewriting a markdown image link is a CRDT
edit rather than a JSON mutation. That is a deferral with a cost — a copied note
loses its images — not the "external links anyway" excuse an earlier revision of
this document gave.

Two related repairs land with it:

- **`DELETE /images/:id` is removed.** It is guarded by `JwtAuthGuard` and
  nothing else (`packages/backend/src/image/image.controller.ts`), so any
  signed-in user who knows an id can delete the object behind it. The reach is
  the bucket root, not the whole bucket — `VALID_IMAGE_ID_PATTERN` admits no
  `/`, so workspace-scoped `{ws}/{id}` objects are unreachable — but the bucket
  root is exactly where template thumbnails live, and a public gallery hands
  every visitor their ids. No client calls it: the thumbnail-replace path goes
  through `ImageService.delete` in-process, and the CLI's `images delete`
  targets the workspace-scoped `DELETE /api/v1/workspaces/:wid/images/:id`
  instead. Deletion stays available internally, where a caller has already
  proven what it owns.
- The frozen copy is re-scanned by `assertContentIsShareable` at approval time.
  Publishing checks a document once; a `datasource` tab added afterwards would
  otherwise reach the gallery.

#### Keeping an approved listing honest

A public listing tracks a **live** document, which is what makes bait-and-switch
possible: a budget sheet is approved, then edited into something else, under the
same listing, the same author and the same accumulated use count. Content edits
flow client → Yorkie and never reach this backend, so nothing in the review
pipeline would notice.

Except that they do leave one trace. Yorkie's `DocumentRootChanged` event
webhook already fires on every real root edit, to keep `Document.updatedAt`
moving for the documents list — and that signal is enough. **An edit to an
approved public listing's document returns it to `pending`**, which drops it out
of the gallery and back into the queue until someone looks again. The publisher
is told, because a template that quietly stops being public is the same silent
disappearance the rest of this pipeline exists to prevent; the notification is
deduped per day, since editing a document is not one event.

The write is guarded on `visibility: 'public', status: 'listed'` rather than
read-then-written, so it runs alongside reviewer decisions without walking a
takedown back to `pending`, and on `reviewedContentAt` — the *same* watermark
visibility compares against, not `reviewedAt`. Those are different clocks, and
an event landing between them would otherwise push `contentChangedAt` past the
approval (hiding the listing) while matching no row here (so it never enters
the queue): hidden and unreviewable at once. It also ignores an event older
than the decision it would undo — the handler always answers 200, which suppresses only the retries
it can see. And it must stay cheap: it fires for *every* document's every edit,
so the case that matters is "this document has no public listing", which
`documentId`'s unique index answers in one lookup that touches nothing.

**A status is only as good as the write that set it**, though, and this one is
set by a webhook a deployment registers per Yorkie project. So the listing also
carries two watermarks — `contentChangedAt`, written on every edit whatever the
listing's state, and `reviewedContentAt`, the value a reviewer attested to — and
`isVisibleTo` refuses a public listing whose content has moved past its
approval. That is the half that needs nothing to have run: an unregistered
webhook, a failed write, or a delivery that never arrives leaves the gallery
correct on the two paths where content actually reaches somebody. The collection
query keeps using `status`, because Prisma cannot express a column-to-column
comparison there; the single-row paths are the ones that matter.

Four things this defence has to cover that "the document changed" alone does
not:

- **Edits during review.** The transition only fires from `listed`, so an edit
  while a listing is `pending` matches nothing — and that is the cheaper attack:
  submit clean content, let a reviewer read it, edit, and the approval that
  lands afterwards publishes what nobody looked at. So approving is an
  **attestation**: the queue hands the reviewer the current `contentAt`, the
  approval echoes it, and a mismatch — including the difference between "never
  edited" and "edited once" — is a `409`.
- **The card, not just the document.** A gallery card *is* its title,
  description, category and thumbnail. Editing those needs no Yorkie write at
  all, so the webhook would never see it; `update()` — *and* `publish()`, which
  is an upsert taking the same fields — therefore re-enters review when one of
  them changes on an approved public listing. `tags` and `visibility` do not,
  because they steer discovery rather than represent the template.
- **The card while it is *under* review.** The content attestation does not
  reach here either: a card edit writes no Yorkie change, so `contentChangedAt`
  does not move and the reviewer's echoed watermark still matches — the
  approval would publish metadata nobody inspected. Card fields are therefore
  **frozen while `pending`** (`409`), which is the honest shape: a submission
  under review is a fixed thing, and a decision is coming.
- **Who can trigger it.** A public listing hands `previewToken` to every
  visitor, and with `YORKIE_AUTH_WEBHOOK_ENFORCE` unset the auth webhook only
  *shadows* — it logs the decision it would have made and allows the write. That
  would make an anonymous visitor able to edit any public template, and since an
  edit returns a listing to review, one cheap request per card would empty the
  gallery into a queue only a human on the allowlist can drain. The public tier
  therefore **refuses to operate unless enforcement is on**, checked at both
  `submit` and `approve` rather than documented and hoped for.

This is the cheaper half of a trade worth naming. [Frozen-copy
promotion](#frozen-copy-promotion) below would let an approved listing keep
serving while its publisher edits, because the gallery would point at an
immutable copy rather than at their document — but it needs a system workspace,
a promotion transaction, and image re-hosting on that path. Re-review-on-change
needs none of them and fails in the safe direction: the listing leaves the
gallery rather than silently misrepresenting itself. The cost is that a
publisher fixing a typo drops out of the gallery until a reviewer looks again,
which is noise for reviewers and latency for publishers — and that a
collaborator's edit, or a comment, does the same. Promotion remains the
hardening step, and when it lands the signal has to move with it: the listing
will point at a frozen copy nobody edits, so the edits that matter will be on
`originId`.

#### Frozen-copy promotion

Approval runs the copy service into a system-owned workspace
(`WAFFLEBASE_TEMPLATE_WORKSPACE_ID`, seeded once) and re-points `documentId` at
that copy, recording the publisher's original in `originId`. The publisher keeps
editing their document; a republish produces a new frozen copy and re-enters
review. This is what makes an approved listing immutable — see *Live source vs.
frozen copy*.

The order is not incidental, because `documentId` cascades on delete:

1. re-scan the origin with the content guard;
2. copy origin → system workspace;
3. re-host the frozen copy's images;
4. mint a fresh non-expiring `viewer` share link **on the frozen copy** — the
   stored one still points at the publisher's live document, which is precisely
   what promotion exists to stop showing;
5. in one transaction: `documentId` → frozen, `originId` → origin (first
   promotion only), `visibility` → `public`, `status` → `listed`, `shareLinkId` →
   the new link, plus `publishedAt` / `reviewedAt` / `reviewedBy`;
6. *then* revoke the old share link and delete the superseded frozen copy.

Step 6 after step 5, always: deleting a document the listing still points at
cascades the listing away with it.

**The frozen copy is authored by the publisher, not the reviewer.** It is the
honest attribution, and it is also what keeps the listing manageable: every
authorization read in the service resolves membership against the *document's*
workspace, which is now the system one, and `isDocumentManager` answers yes
anyway through `doc.authorID`. Author it to the reviewer instead and the
publisher loses `unpublish` and `update` on their own listing while the reviewer
gains manage rights on every public card. `DocumentCopyService.copy` already
takes the author as a parameter, so this is a call-site decision, not a change.

Three more consequences to handle rather than discover:

- `findByDocument` must match `documentId` **or** `originId`, or the publisher's
  own Share dialog stops finding the listing the moment it is approved.
- `unpublish` deletes the frozen copy as well as the listing.
- A promoted listing no longer appears in its publisher's workspace Templates
  tab, because `scope=workspace` constrains on the *document's* current
  workspace and the document now lives in the system one. That constraint is
  deliberate (it is what stops a listing following a document out of the
  workspace), so the listing is reachable from the origin document's Share
  dialog and from the public gallery instead.

#### Browse and search

Less is new here than the phase list suggests, which is the Phase 2 collection
endpoint doing its job: `q`, `sort=popular|recent`, the `ILIKE` clause, the
keyset cursor and the `[visibility, status, publishedAt]` index all shipped
already, and `TemplateGallery` already takes `scope: "workspace" | "public"`.
What 3c actually adds is the **unauthenticated `/templates` route** outside
`PrivateRoute`, the type and category facets with an empty state, tag
containment inside `q`, and the in-app Public tab. A `pg_trgm` index waits until
search is measured slow — Postgres only, no new infrastructure.

Inside the app the same components gain a **Public** tab in the workspace
Templates tab and in the New-from-template dialog, so a public template is
reachable where a user is already choosing one — Canva's editor-side template
panel, next to its gallery.

The list response still carries no `previewToken`, for the reason given in
*Discovery: the collection endpoint*: a page of cards would otherwise be a page
of non-expiring read capabilities.

One honest limit: the frontend is a Vite SPA with no server rendering, so the
public gallery is close to invisible to search engines. Making it indexable is a
separate project (prerendering or an SSR surface) and is not smuggled in here.

#### License, attribution, report, ranking

- **License.** Submitting requires an explicit grant that others may copy and
  modify the content, recorded as `licensedAt`; a submission without it is a
  `400`. Without the grant we would be redistributing someone's document on an
  assumption.
- **Attribution.** A public card shows the publisher's username and avatar to
  anonymous visitors. Their email never appears. The submission dialog says this
  in a sentence, because it is the part of publishing that is about the person
  rather than the document.
- **Report and takedown.** `POST /templates/:id/report { reason, note? }` —
  authenticated and throttled with the same `UserThrottlerGuard` the notification
  endpoint uses — files a `TemplateReport` into the reviewer queue, one row per
  reporter per listing so a single account cannot stack a queue.

  Reporting is **public-tier only**: a report routes the listing to the global
  reviewer allowlist *with its preview token*, and `listForReview` bounds that
  capability to submissions a publisher volunteered. A workspace or unlisted
  listing already has a trust boundary — its members, or whoever holds the link
  — and does not go there.

  The intake is deliberately **inert**: it records that somebody objected and
  does nothing else. It does not hide the listing, does not notify the
  publisher, and does not count toward a threshold. A report that acted on its
  own would be a takedown anyone could trigger, which is a heckler's veto with
  extra steps; the decision stays with the allowlist and this only makes sure
  they hear about it. Authorization is "can you see this listing", which also
  keeps the route from being an oracle for whether an unlisted id exists.

  Re-filing updates the reason but does not reopen a closed report: the unique
  index bounds *rows*, and this bounds the work each row can generate — without
  it a reporter whose report was dismissed re-files forever and forces a
  re-dismissal each time.

  Closing a report is a **separate action from deciding the listing**, and that
  separation is the point: most reports do not end in a takedown, and a queue
  that only empties when content is removed pressures whoever drains it toward
  removing content. A takedown never touches the document, and documents
  already created from the template are independent copies and stay. A takedown
  *does* close every open report about its listing, in the same transaction as
  the decision — a reviewer who stops mid-session must not leave reports that
  can never be closed, since a second takedown on a `removed` listing is a
  `400` and dismissing one would record the opposite of what happened.

  Nothing about a report reaches the publisher except through a reviewer's own
  words. The takedown note is written by the reviewer, never prefilled from the
  report: it is delivered as a decision, and reporter-authored text arriving
  under a reviewer's authority is not something to pass through.
- **Ranking guards.** `useCount` drives the default sort, so it must not be
  trivially inflatable: a use by the listing's own publisher does not increment
  it, and `POST /templates/:id/use` carries a per-user throttle — which bounds
  the copy cost too, since a use is a Yorkie read plus a write plus any image
  re-hosting. Detecting coordinated inflation across accounts is out of scope,
  which is another reason monetization stays a Non-Goal: the counter is a
  ranking hint, not money.

### Discovery: the collection endpoint

One endpoint serves the workspace tab, the New-from-template picker, and the
public browse page. Introducing it is the single largest piece of Phase 2.

```
GET /templates?scope=workspace&workspaceId=…&type=&category=&tag=&q=
              &sort=popular|recent&cursor=&limit=
```

Three properties are load-bearing:

- **Visibility is a query constraint, never a post-filter.** The `where` clause
  is built from what the caller may see — `scope=public` becomes
  `visibility: 'public', status: 'listed'`; `scope=workspace` is checked against
  `assertMember` first and constrains on the *document's* current workspace, for
  the reason [given below](#live-source-vs-frozen-copy) and enforced in Phase 1.
  `unlisted` listings never appear in any collection: holding the id is their
  whole access story, and a list that included them would hand out that
  capability wholesale.
- **A list response carries no `previewToken`.** A page of 24 cards would
  otherwise hand out 24 non-expiring read capabilities to satisfy a thumbnail
  grid. Cards render from `thumbnailId`; the token comes from the single-listing
  `GET /templates/:id` when a card is actually opened. This is the same rule
  that made `GET /documents/:id/template` membership-gated in Phase 1.
- **Keyset pagination, not offset.** The existing
  `@@index([visibility, status, useCount])` supports `(useCount, id)` cursors
  directly; `sort=recent` needs a matching `[visibility, status, publishedAt]`
  index. Offset paging over a gallery that reorders as counts change skips and
  repeats rows.

### Thumbnails

A gallery without thumbnails is a list of titles. Capture happens **client-side
at publish time**, because the renderers are all in the browser and the backend
has no canvas.

The mounted editor **registers a capture source**
(`packages/frontend/src/lib/thumbnail-capture.ts`); the Share dialog asks the
registry for a picture by document id. That indirection is the design: the
dialog lives in `components/` and must not learn that a deck is painted
differently from a spreadsheet, and an editor must not learn that the template
gallery exists. It is also what the frontend's architecture lint requires —
`components/` may not import `@/app/*`.

| Type | Source | State |
| --- | --- | --- |
| `slides` | `renderThumbnail()` into an offscreen canvas — **slide 1**, the same call the left-rail panel makes | shipped |
| `doc`, `sheet`, `board` | composite of the live editor canvases | shipped |
| `note` | **synthesized** — the first lines of the markdown drawn onto a canvas | shipped |
| `pdf`, `image` | the stored blob's first page / the image itself | not built |
| `file` | none — a document-type icon | by design |

Two arms differ from the offscreen-per-type sketch this section used to carry,
and the reasons are worth keeping:

- **`doc` and `sheet` read the canvas on screen.** Neither package exports an
  offscreen page or grid renderer — the paint path is private to the mounted
  editor (`packages/docs/src/view/editor.ts`,
  `packages/sheets/src/view/gridcanvas.ts`), and exporting one is a larger
  change than a thumbnail justifies. It is the *same* renderer either way, so
  the pixels are right; only the framing differs (wherever the author is
  scrolled, rather than page 1 or the used range). The composite exists because
  these editors layer canvases — a spreadsheet paints its grid and its
  selection overlay separately — and canvases thinner than 48 px are skipped so
  a ruler does not put a stripe down every card. The composite is cropped to
  **what was drawn**, not to the container, and backed by the nearest ancestor
  background that actually paints. Both rules exist because a constant white
  backdrop plus a container-sized crop put a white band across the top of every
  dark-mode docs card, where the skipped 20 px ruler strip left nothing drawn:
  what is skipped as chrome has to be outside the picture, and what shows
  through a transparent overlay has to be the editor's own colour rather than a
  colour that is only right in one theme.
- **`board` reads it too, and always will.** A board is an unbounded plane with
  no first page; the view the author left it on is the honest cover.
- **`note` is not captured at all — it is drawn.** Notes is the one DOM editor
  (CodeMirror plus a DOM preview), so `packages/notes/src` contains no canvas
  to photograph, and the usual DOM-to-canvas trick — an SVG `foreignObject`
  drawn as an image — taints the canvas in Chrome exactly as a remote image
  does. `packages/frontend/src/app/notes/notes-thumbnail.ts` therefore
  *synthesizes* a card from the first
  lines of the markdown, the way a repository card does. It is a different kind
  of artifact from the others — a description of the note rather than a picture
  of the editor — but it is true to the content, cannot fail, and beats one
  type having no image in a gallery.

A capture composites at **device pixels**, capped at 2×: `getBoundingClientRect`
is CSS pixels while the editor's bitmap is `dpr` times that, so sizing the
output to the rect threw away half of every retina capture before it was even
downscaled.

The result is downscaled (longest edge 1280 px, WebP with a PNG fallback),
uploaded through the existing `POST /images`, and its **id** — never a URL —
stored in `thumbnailId`, so a listing can only ever point at this deployment's
bucket.

That route, and specifically **not** the workspace-scoped
`POST /api/v1/workspaces/:wid/images` the in-document image pickers use. The
two are not interchangeable and the ids are not portable between them: the
workspace route stores under `{workspaceId}/{id}` and is read back only
through an access-gated route (member, workspace API key, or share token),
while a template card renders for a visitor holding none of those. Uploading a
thumbnail through the workspace route stores an id on the listing that
`GET /images/:id` cannot resolve — the object is at a different key — so every
card 404s. `api/images.ts` names the two `postWorkspaceImage` and
`postSharedImage` for that reason. A thumbnail is a snapshot: it goes stale when the document changes, and
is refreshed by *Update preview* in the Share dialog's Template section. That
is the correct trade, since the alternative is rendering a document per card on
every gallery paint.

Thumbnails therefore arrive in **whatever shape their document is** — 16:9 for
a deck, the editor viewport for a docs / sheet / board capture — so the gallery
card letterboxes rather than crops (`object-contain` in a fixed `16/10` box).
The box stays one size so the grid stays a grid; cropping to fill it cut the
sides off every slide, and the picture is the thing being chosen.

Every failure degrades to **no thumbnail**, never to a failed publish: capture
is attempted, and a listing without one shows its document-type icon exactly as
every card did before this existed. On a republish a failed capture is *omitted*
from the request rather than sent as null, so it cannot blank the picture an
earlier publish stored.

#### Images and the tainted canvas

A canvas that has drawn an image fetched **without** CORS is tainted, and
`toBlob` throws `SecurityError` on it — so before this was addressed, any
document holding a single remote image got no thumbnail. That is not a rare
case: the first real deck tested hit it.

The editors originally set no `crossOrigin` at all, deliberately, because most
third-party image hosts send no `Access-Control-Allow-Origin` and an `<img>`
that asks for CORS against such a host fails outright rather than falling back.
Both requirements hold, and they never apply to the same host — so the loaders
now **ask for CORS and retry once without it**
(`@wafflebase/core/image`, used by the Slides, Docs and Sheets image caches):

- our own image bucket answers with the header (the API enables CORS for the
  app origin), so its images load first time and leave the canvas readable;
- a host that does not costs one failed request and then renders exactly as it
  did before, tainting the canvas exactly as it did before.

The retry has to replace the caller's cached element or a later draw finds the
one that already failed, which is why the ordering lives in one shared helper
rather than three copies.

What remains uncoverable is a document referencing **another deployment's**
bucket — a deck imported with `https://api.wafflebase.io/images/…` URLs opened
against a local server, say. That origin's CORS allowlist does not include this
one, so the retry path renders it and the canvas stays tainted. Capture answers
`null` and the card falls back to its document-type icon, as it does for any
other failure.

### Seeding a deployment's gallery

A new deployment's gallery is empty, and there is no way to fill it from
outside a browser: publishing is JWT-only and the CLI has no `templates`
namespace. Two operator commands close that, and the split between them falls
out of the thumbnail rule above.

`pnpm backend seed:templates` creates the documents and writes their content,
using the writers the v1 content endpoints already use. It **does not publish
them**. `pnpm backend register:templates` drives the real Share dialog with
Playwright — publish, category, tags, submit — and then the reviewer queue.

Registering through the UI rather than through `TemplateService` is not
ceremony. The picture is taken by whichever editor is mounted at publish time,
so a headless publish produces a listing with no thumbnail; and the ordering
the UI happens to take is the *only* one the review rules permit, because
`thumbnailId` is a `CARD_FIELD`:

| When the thumbnail is attached | What happens |
| --- | --- |
| after approval (`public` + `listed`) | `cardReviewReset` returns it to review — out of the gallery |
| while `pending` | `assertCardEditable` refuses it outright |
| after publish, before submit | accepted; neither guard applies |

Keeping a service-level publish path beside the UI one was rejected for the
reason `publish()` itself gives: it would be a second, unguarded way to swap an
approved gallery card.

The catalogue lives in `packages/backend/src/template/seed/catalog/` as
TypeScript rather than JSON or binaries, so it typechecks against the real
document models and can reference `BUILT_IN_LAYOUTS` / `DEFAULT_MASTER` instead
of duplicating a theme catalogue into a fixture. Everything in it is authored
for this repository: template galleries such as Canva's, Slidesgo's and Google
Slides' are free to *use* and not free to *redistribute*, so nothing derived
from them may be seeded.

Operational preconditions, and the one ordering trap, are in
[`packages/backend/README.md`](../../packages/backend/README.md) — in
particular that `register:templates` requires the Yorkie auth webhook to be
enforced while `seed:templates` writes with a tokenless Yorkie client, so the
documents must be seeded before those webhook methods are registered.

### Returning a visitor after login

A template link is handed to people who may not have an account, so "sign in"
must not lose the template. GitHub returns the browser to `FRONTEND_URL` with
nothing of ours attached, so the return path needs somewhere to survive the
round trip.

It rides in **its own short-lived cookie**, set by `GET /auth/github?returnTo=`
and consumed by the callback — deliberately *not* inside the OAuth `state`.
`state` is a CSRF token whose entire value is that it is opaque and compared by
equality; packing routing data into it would mean parsing attacker-supplied
structure out of the one field that must stay a bare comparison.

The cookie is not the security boundary and is not treated as one: the endpoint
that sets it is unauthenticated, so its value is attacker-chosen by
construction. `safeReturnPath()`
(`packages/backend/src/auth/login-return-path.ts`) is the boundary, and it runs
**again on read** rather than trusting what was stored. It reduces the value to
a same-origin path or `null`, rejecting rather than sanitizing:

- absolute URLs and anything carrying a scheme, including a scheme smuggled
  into the first segment (`/javascript:…`);
- **protocol-relative** values in both spellings the URL parser accepts —
  `//evil.example` and `/\evil.example`, since the parser folds `\` to `/`;
- **control characters**, which is what closes `/\n/evil.example`: the parser
  strips the newline and is then looking at `//evil.example`. Rejecting rather
  than stripping is the point — a stripped character means this function and
  the browser saw different strings.

Query and fragment survive, because `/t/abc?use=1` is a legitimate target.

### What the Share dialog can actually set

The listing's card metadata is `title`, `description`, `category`, `tags` and
`thumbnailId`. Four of the five are set from the Share dialog's Template
section; `title` seeds from the document's own title and is not separately
editable, on the grounds that a template named differently from the document it
came from is a second name to keep in sync.

`description` was reachable by **nothing** until it was noticed while
reproducing this flow end to end. The column, the DTO, the frontend API type,
the gallery card and `/t/:id` all carried it, and no control anywhere sent it —
so every listing published through the product had `description: null` and
every card rendered without one. It is now a field on both the publish block
and the listing form.

Two consequences worth stating, because they are shared with the other card
fields rather than special:

- Clearing it sends `null`, not `''`. `@IsOptional()` skips validation for
  `null` rather than rejecting it, so the value reaches `update()` and clears
  the column; `''` would store a present-but-empty description that every
  reader then has to treat as absent. The DTO is typed `string | null` to say
  so — it previously said `string` while the dialog sent `null`.
- Editing it on an approved public listing returns that listing to review, via
  the same `cardReviewReset` path as the title, category and thumbnail. The
  dialog sends the field on every Save, so `isSame()` is what keeps an
  *unchanged* description from knocking a live card out of the gallery.

### Taxonomy

Facets are only useful if the values are closed. `category` becomes a fixed list
shared between backend validation and the frontend picker (roughly: Business,
Education, Personal, Project management, Finance, Marketing, Design, Other) —
a constant, not a table, because it changes at release cadence and a table would
invite per-workspace divergence that the public gallery could not merge. `tags`
stay freeform but are normalized on write (trimmed, lowercased, de-duplicated,
max 10), so `Budget`, `budget ` and `budget` are one facet.

### Declined: parameterized templates

CapCut's replaceable clips have a natural analog: a `{{placeholder}}`
convention inside sheet cell values, docs text runs and slides text bodies,
collected at use time into a fill-in dialog that substitutes them in the fresh
copy before it opens. It needs no schema change — placeholders are just text —
and a substitution pass would have to be written per engine.

We are not building it. CapCut needs slots because its template must be usable
in thirty seconds on a phone, without opening an editor; an office document is
opened in its editor either way, which is exactly why Canva — whose medium is
ours — makes everything editable and parameterizes nothing. Recorded here so
the option is a decision rather than an oversight.

## Risks and Mitigation

| Risk | Mitigation |
| --- | --- |
| Publishing leaks workspace-internal data — a template is a real document, and publishing exposes it anonymously. | Manager-gated publish, plus a confirm dialog that names the tier and states the document becomes readable by anyone with the link. Public listings are additionally reviewed. |
| A public listing is edited into something else after approval. | Approval re-points the listing at a frozen server-side copy; republishing re-enters review. |
| Images embedded in a template are workspace-scoped objects, so a copy made in another workspace cannot read them — the copy arrives with broken images, at **every** tier, and the preview hides it because the preview holds a share token. | A real defect since Phase 1, not a public-tier risk. **Phase 3b** re-hosts them in `DocumentCopyService` on any cross-workspace copy, which covers `use` and promotion alike — see [Cross-workspace image re-hosting](#cross-workspace-image-re-hosting). `note` is excluded and stays a known limitation. |
| `DELETE /images/:id` is guarded by nothing but `JwtAuthGuard`, so any signed-in user who learns an id can delete any image in the deployment — and a public gallery publishes those ids. | The route has no client (thumbnail replacement calls `ImageService.delete` in-process), so **Phase 3b deletes it**. Deletion stays internal, where the caller has already proven what it owns. |
| Copy cost — a popular template is copied concurrently, each copy attaching to two Yorkie documents. | Same bound as `Make a copy`, one document's worth of content per request. Today only the global per-IP throttle applies; a per-user limit on `use` is **Phase 3** (3d), which is when a listing gets an audience large enough for this to matter. |
| A template containing a `datasource` / `lakehouse` tab is used in another workspace, where its `TabMeta.datasourceId` resolves to nothing. | Known limitation of Phase 1, and new with cross-workspace copy: within a workspace the reference stayed valid. It is not an access bypass — every datasource route re-derives authorization from the row's own `workspaceId` — but the tab is inert. **Closed at publish time:** publishing refuses a document whose root holds such a tab (`template-content-guard.ts`), which is the honest boundary — a template depending on a private connection is not shareable. The scan reads only `sheet` documents and fails closed, since a document we could not read is not a document we can clear. It runs at publish, not at use: a sheet published first and given a datasource tab later still hands out an inert tab, which is the ordinary consequence of a listing tracking a live document. |
| A document holding a remote image cannot be captured, so the templates most worth looking at are the ones with no picture. | Accepted for now, and degraded to the pre-existing behavior (the type icon) rather than to an error. **Closed for our own images:** they are now requested with credentialed CORS, so the canvas stays readable — see [Images and the tainted canvas](#images-and-the-tainted-canvas). What remains is a document referencing *another deployment's* bucket, whose CORS allowlist does not include this origin, and a third-party image URL, which is deliberate: most such hosts send no header, and rendering the image matters more than reading the canvas back. |
| A thumbnail outlives the listing it was taken for. | Unpublishing deletes the object and replacing one deletes what it replaced, so nothing accumulates and the id stops resolving. What deletion cannot reach is a copy already in a browser or shared cache: `GET /images/:id` answers `public, max-age=31536000, immutable`, which is correct for content-addressed bytes and is what every document image depends on. The residual exposure is bounded by who could hold the URL — an unguessable UUID that was only ever reachable through a card the holder had already seen — so a cached copy shows them a picture they had already been shown. Turning the route `no-store` to close it would deoptimize every image in every document for that, which is the wrong trade; a listing whose *content* must not outlive it is what the Phase 3 frozen copy is for. |
| Comments or share links leaking into a copy. | `DocumentCopyService` already strips comments and carries no share links; the destination parameter does not change that. |
| An abandoned listing points at a deleted document. | `documentId` cascades, so the listing goes with it. |
| The public tier attracts spam and copyright violations, which is a moderation cost, not a code cost. | It is the reason public is Phase 3 and behind a maintainer allowlist: the workspace tier delivers most of the value with none of this exposure. |
| A collection endpoint hands out preview capabilities in bulk — a page of cards would carry a page of non-expiring read tokens. | List responses omit `previewToken` entirely; it is returned only by the single-listing read, when a card is opened. `unlisted` listings never appear in any collection. |
| `useCount` ranks the gallery, so it is worth inflating. | **Phase 3** (3d) adds the guards: a publisher's own use will not increment it, and `use` gets a per-user throttle. Neither exists yet, and neither needs to before there is a ranked gallery to game. Detecting coordinated inflation is out of scope regardless, which is another reason monetization stays a Non-Goal — the counter is a ranking hint, not money. |
| The review queue backs up and submissions sit silently, the complaint CapCut's own help pages are mostly about. | Both review outcomes notify the publisher through the existing notification system, and a rejection carries its reason. Queue depth is an operational problem the allowlist keeps small by construction. |
| Frozen copies accumulate: every approved republish creates another document in the system workspace. | The superseded frozen copy is deleted once the listing points at its replacement. Documents users already created from it are independent copies and are unaffected. |
| A public listing breaks when the publisher deletes an embedded image. | Promotion re-hosts the frozen copy's images into listing-owned keys, so an approved listing no longer depends on the publisher's objects. |
| Submitting for review changes how an already-shared listing reads — a handed-out unlisted link stops resolving, or a workspace listing silently widens. | `visibility` stays the effective tier through review and is written to `public` only by approval; `status` alone moves. Submission changes nothing a viewer can observe. |
| A takedown for copyright leaves the content served, because "rejected" only means "not in the gallery". | `removed` is a distinct state: it blocks every non-manager read and revokes the preview share link. `rejected` is the milder verdict and returns the listing to the tier it already had. |
| The approval transaction re-points `documentId` and deletes the document it replaced, and `documentId` cascades. | The ordering is fixed and written down: re-point first, delete second. Getting it backwards deletes the listing, not just its old copy. |
| A publisher reverses a reviewer's takedown by re-publishing: `publish()` writes `status: 'listed'` unconditionally and re-mints a revoked preview link. | `publish()`/`update()` preserve `status`, and a `removed` listing refuses republish. Enumerated with the other four readers the new states change in [How the new states compose with the shipped service](#how-the-new-states-compose-with-the-shipped-service), because the state diagram does not show any of them. |
| Re-hosting takes the cheap path and copies images to an unscoped bucket-root key, silently publishing a private workspace's images at a permanent unauthenticated URL. | Objects land at `{destWorkspaceId}/{newId}` and the reference is rewritten to the destination's workspace-scoped URL — a gate preserved, not removed, and what the Miro importer already does. |
| The re-hosting walker turns a bounded copy into an unbounded one: a template with hundreds of images becomes hundreds of `CopyObject` calls on a member-reachable route. | An aggregate object/byte ceiling with a skipped-items report, borrowed from the Miro importer along with the shape. Failure degrades the copy rather than failing it, and created objects join `copy()`'s rollback. |
| Shipping 3a alone opens the gallery by accident — `submit` → `approve` reaches `visibility: 'public'` and `GET /templates?scope=public` is already unauthenticated. | `assertPublicTierOpen()` is consulted by both `submit` and `approve` and throws until 3d. Merge order cannot open the tier; one function decides. |
| A promoted listing disappears from its publisher's own workspace Templates tab. | Accepted and documented: `scope=workspace` constrains on the document's *current* workspace, which is what stops a listing following a document out of a workspace. The publisher reaches it from the origin document's Share dialog, which matches on `originId` as well as `documentId`. |
| The public gallery is invisible to search engines. | Accepted. The frontend is a Vite SPA with no server rendering; indexability is a prerendering/SSR project, not something to fake inside this feature. |
