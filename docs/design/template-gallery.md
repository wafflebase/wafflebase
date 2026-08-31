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

### Goals

- Publish any document type as a template with a title, description, category
  and tags, at one of three visibility tiers: **unlisted link**, **workspace**,
  **public**.
- Anyone allowed to see a listing can preview it read-only without an account,
  and can start their own independent copy in a workspace they belong to.
- The publisher's document is never mutated by anyone using it.
- Reuse what exists: the copy service, share links, the image bucket, the
  documents list.

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

- **Preview opens `/shared/<previewToken>`** rather than embedding the viewer
  in the landing page. It is literally the existing per-type read-only layout,
  but reached by navigation: `SharedDocument` is a 1088-line component keyed on
  `useParams`, and refactoring it to take a token prop would put the live share
  route at risk for a preview pane. Embedding is a follow-up.
- **A logged-out visitor goes to `/login`, not back to `/t/:id`.** The GitHub
  callback returns the browser to `FRONTEND_URL`, so a return path has to be
  carried through the OAuth `state` and validated server-side — an auth change,
  not a gallery one. Until it lands the page says to reopen the link.
- **No thumbnail is captured yet.** The column, the serving path and the card's
  rendering are in place; what is missing is the editor-side capture. It is the
  client-rendered canvas the editor can already draw (`drawSlide`, the docs page
  renderer, the sheet grid), uploaded through `POST /images`, with a type icon
  as the fallback for anything that cannot render one.

Publishing at the `public` tier is refused with a `400` for as long as Phase 3
does not exist — failing closed, because a publisher told "ok" would believe
their template was in a gallery that nothing reviews.

**Phase 2 — Workspace gallery.** `visibility: 'workspace'`, a **Templates** tab
in the workspace, and **New from template** in the documents-list create menu.
Publishing stays manager-gated here too, and a manager may unpublish anyone's
listing in their workspace. This is the Brand Templates / Google org-gallery
tier and needs no review.

**Phase 3 — Public gallery.** `visibility: 'public'` enters `status: 'pending'`
and needs approval before it is listed, plus: a public `/templates` browse page
(type and category facets, sorted by `useCount` or recency), the frozen-copy
promotion above, an explicit license grant accepted at publish time (the
publisher permits anyone to copy and modify the content), attribution on the
listing, and a report endpoint whose takedown deletes the *listing* and never
the document. Review starts as a maintainer allowlist rather than an admin
console; there is no admin surface today and building one is a larger project
than this feature.

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
| Copy cost — a popular template is copied concurrently, each copy attaching to two Yorkie documents. | Same bound as `Make a copy`, one document's worth of content per request; rate-limit `use` per user with the existing throttler. |
| Comments or share links leaking into a copy. | `DocumentCopyService` already strips comments and carries no share links; the destination parameter does not change that. |
| An abandoned listing points at a deleted document. | `documentId` cascades, so the listing goes with it. |
| The public tier attracts spam and copyright violations, which is a moderation cost, not a code cost. | It is the reason public is Phase 3 and behind a maintainer allowlist: the workspace tier delivers most of the value with none of this exposure. |
