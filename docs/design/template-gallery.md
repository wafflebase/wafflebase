---
title: template-gallery
target-version: 0.7.0
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

The whole feature, and where each piece lands. "Shipped" is measured against
`main` at 0.6.7 + Phase 1.

| Capability | Phase | State |
| --- | :---: | --- |
| `TemplateListing` model, publish / unpublish / edit | 1 | shipped |
| Preview via a minted `viewer` share link | 1 | shipped |
| Use → copy into a destination workspace | 1 | shipped |
| `/t/:id` landing page, unlisted link sharing | 1 | shipped |
| Manager gate, per-tier visibility, `useCount` | 1 | shipped |
| **`GET /templates` collection endpoint** (facets, sort, keyset pages) | 2 | shipped |
| **Thumbnail capture** per document type | 2b | shipped (4 of 8 types — see [Thumbnails](#thumbnails)) |
| **Category taxonomy + tag normalization** | 2 | shipped |
| **Workspace Templates tab**, New-from-template picker | 2 | shipped |
| Embedded preview, post-login return to `/t/:id` | 2 | shipped |
| **Review pipeline** (`pending` → `listed` / `rejected`) + reviewer allowlist | 3 | — |
| **Frozen-copy promotion** into a system workspace | 3 | — |
| **Image re-hosting** for public listings | 3 | — |
| **Public `/templates` browse page** + search | 3 | — |
| License grant, attribution, report / takedown | 3 | — |
| Ranking guards (self-use, rate limits) | 3 | — |
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
  (`packages/backend/src/image/image.controller.ts`), so images embedded in a
  copied sheet/slides/board keep rendering after the copy crosses a workspace
  boundary. This removes what would otherwise be the hardest problem here.
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
  status      String    @default("listed")   // listed | pending | rejected
  useCount    Int       @default(0)
  licensedAt  DateTime?                      // publisher's license grant
  originId    String?                        // publisher's original, once
                                             // `documentId` points at a frozen copy

  publishedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([visibility, status, useCount])
  @@index([workspaceId, visibility])
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
  [Thumbnails](#thumbnails), including the two types that read the live editor
  canvas instead of an offscreen renderer and the documents that still get no
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
its audience is bounded, and the public tier cannot. `visibility: 'public'` is
still refused with a `400` until all of it exists; the phase is not a flag flip.

- **Review.** Requesting `public` sets `status: 'pending'` rather than listing
  anything. `POST /templates/:id/review { decision, reason? }` is gated on a
  reviewer allowlist read from configuration
  (`WAFFLEBASE_TEMPLATE_REVIEWER_IDS`), not on a new admin console — there is no
  admin surface today and building one is a larger project than this feature.
  Both outcomes notify the publisher through the existing notification system
  (a new `template_reviewed` type; the rejection reason is the notification's
  `preview`), because a submission that disappears silently is the failure mode
  CapCut's own help pages are mostly about.
- **Frozen-copy promotion.** Approval runs the copy service into a system-owned
  workspace (`WAFFLEBASE_TEMPLATE_WORKSPACE_ID`, seeded once) and re-points
  `documentId` at that copy, recording the publisher's original in `originId`.
  The publisher keeps editing their document; a republish produces a new frozen
  copy and re-enters review. This is what makes an approved listing immutable —
  see *Live source vs. frozen copy*.
- **Image re-hosting.** A frozen copy still references the publisher's image
  objects by URL, so a publisher who deletes an image breaks every future use of
  a listing that a reviewer approved. Promotion therefore walks the frozen
  copy's root for image URLs pointing at our own bucket, `CopyObject`s each into
  a listing-owned key, and rewrites the reference — the same re-hosting shape
  the Miro importer already performs for `imageUrl`s it downloads.
- **Browse and search.** A public `/templates` page outside `PrivateRoute`,
  reading the same collection endpoint with `scope=public`: document-type and
  category facets, `useCount` or recency sort, and a query box. Search starts as
  `ILIKE` over title/description plus tag containment, with a `pg_trgm` index if
  it gets slow — Postgres only, no new infrastructure.
- **License and attribution.** Submitting for public review requires an explicit
  grant (`licensedAt`) that others may copy and modify the content; the listing
  shows the author. Both are prerequisites for listing, not decorations: without
  the grant we would be redistributing someone's document on an assumption.
- **Report and takedown.** `POST /templates/:id/report { reason }` —
  authenticated and throttled — files a `TemplateReport` row into the reviewer
  queue. A takedown sets `status: 'rejected'` and drops visibility back to
  `unlisted`; it never touches the document, and documents already created from
  the template are independent copies and stay.
- **Ranking guards.** `useCount` drives the default sort, so it must not be
  trivially inflatable: a use by the listing's own publisher does not increment
  it, and `POST /templates/:id/use` gets a per-user throttle.

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
| Images embedded in a template are workspace-scoped objects that the publisher can delete, breaking every copy. | Already true of `Make a copy` today ([document-copy.md](document-copy.md)); images are not deleted with a document. Phase 3 should re-host a public listing's images alongside its frozen copy — the Miro importer's re-hosting path already does exactly this. |
| Copy cost — a popular template is copied concurrently, each copy attaching to two Yorkie documents. | Same bound as `Make a copy`, one document's worth of content per request. Today only the global per-IP throttle applies; a per-user limit on `use` is **Phase 3** (3d), which is when a listing gets an audience large enough for this to matter. |
| A template containing a `datasource` / `lakehouse` tab is used in another workspace, where its `TabMeta.datasourceId` resolves to nothing. | Known limitation of Phase 1, and new with cross-workspace copy: within a workspace the reference stayed valid. It is not an access bypass — every datasource route re-derives authorization from the row's own `workspaceId` — but the tab is inert. **Closed:** publishing now refuses a document whose root holds such a tab (`template-content-guard.ts`), which is the honest boundary — a template depending on a private connection is not shareable. The scan reads only `sheet` documents and fails closed, since a document we could not read is not a document we can clear. |
| A document holding a remote image cannot be captured, so the templates most worth looking at are the ones with no picture. | Accepted for now, and degraded to the pre-existing behavior (the type icon) rather than to an error. See [the tainted-canvas limit](#the-tainted-canvas-limit) for the fix and why it is not bundled here. |
| Comments or share links leaking into a copy. | `DocumentCopyService` already strips comments and carries no share links; the destination parameter does not change that. |
| An abandoned listing points at a deleted document. | `documentId` cascades, so the listing goes with it. |
| The public tier attracts spam and copyright violations, which is a moderation cost, not a code cost. | It is the reason public is Phase 3 and behind a maintainer allowlist: the workspace tier delivers most of the value with none of this exposure. |
| A collection endpoint hands out preview capabilities in bulk — a page of cards would carry a page of non-expiring read tokens. | List responses omit `previewToken` entirely; it is returned only by the single-listing read, when a card is opened. `unlisted` listings never appear in any collection. |
| `useCount` ranks the gallery, so it is worth inflating. | **Phase 3** (3d) adds the guards: a publisher's own use will not increment it, and `use` gets a per-user throttle. Neither exists yet, and neither needs to before there is a ranked gallery to game. Detecting coordinated inflation is out of scope regardless, which is another reason monetization stays a Non-Goal — the counter is a ranking hint, not money. |
| The review queue backs up and submissions sit silently, the complaint CapCut's own help pages are mostly about. | Both review outcomes notify the publisher through the existing notification system, and a rejection carries its reason. Queue depth is an operational problem the allowlist keeps small by construction. |
| Frozen copies accumulate: every approved republish creates another document in the system workspace. | The superseded frozen copy is deleted once the listing points at its replacement. Documents users already created from it are independent copies and are unaffected. |
| A public listing breaks when the publisher deletes an embedded image. | Promotion re-hosts the frozen copy's images into listing-owned keys, so an approved listing no longer depends on the publisher's objects. |
