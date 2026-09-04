# Template gallery seed

The public gallery at `/templates` is empty, and there is no way to fill it
without a browser: `POST /documents/:id/template` is JWT-only and the CLI has
no `templates` namespace. Seed it with a set of templates authored for this
repo.

## Licensing (the constraint that shapes everything)

Canva / Slidesgo / Google Slides / Microsoft Office template galleries are
**free to use, not free to redistribute**. Their designs are copyrighted and
their terms forbid republishing. Nothing from them enters this repo.

Every template here is authored for Wafflebase and carried under the repo's
Apache-2.0 licence. `packages/backend/src/template/seed/catalog/README.md`
states that, because a template is content that other people copy.

## Approach

- **Sources are TypeScript, not JSON or binaries.** They typecheck against
  `DocsDocument` / `SlidesDocument` / `NoteDocument`, and can reference
  `BUILT_IN_LAYOUTS` / `BUILT_IN_THEMES` / `DEFAULT_MASTER` instead of
  duplicating a theme catalogue into a fixture. Diffs stay readable.
- **Seeding is a backend command, not a new HTTP surface.** Filling a gallery
  is an operator action with DB access, not an API-key action; a new public
  route would be auth surface to maintain forever. `pnpm backend seed:templates`
  boots a Nest context and reuses the writers the v1 controllers already use
  (`writeDocsRoot` / `writeSlidesRoot` / `writeNoteRoot` /
  `updateWorksheetCell`) plus `TemplateService`.
- **The public-tier gates are not bypassed.** The command runs
  `publish → submit → review(approve)` through `TemplateService`, so
  `WAFFLEBASE_TEMPLATE_REVIEWER_IDS` and `YORKIE_AUTH_WEBHOOK_ENFORCE=true`
  are real preconditions. It refuses with the reason if either is missing.
- **Idempotent.** Re-running updates the existing listing rather than
  creating a second one, keyed on a stable seed slug.

## The watermark hazard

`review({ decision: 'approve', contentAt })` pins `reviewedContentAt` to the
listing's `contentChangedAt`, and `isVisibleTo` hides the listing once live
content moves past it. `contentChangedAt` is driven by the **asynchronous**
Yorkie `DocumentRootChanged` event webhook, so a script that writes content
and approves seconds later can have its own write land *after* the approval —
knocking the listing back to `pending` and out of the gallery.

So the command writes content first, then waits for the watermark to settle
before approving, and verifies the listing is publicly visible afterwards.

## Tasks

- [x] `seed/types.ts` — `TemplateSeed` (slug, type, listing metadata, content)
- [x] `seed/catalog/` — the 10 templates + `README.md` licence statement
- [x] `seed/seed-templates.ts` — Nest standalone runner: resolve workspace +
      author, create-or-reuse document, write content, publish, settle,
      submit, approve, verify
- [x] `pnpm backend seed:templates` wiring
- [x] Tests: catalogue shape (every seed passes the same validators the v1
      content controller applies), plus cached-total arithmetic
- [x] `pnpm verify:fast`
- [x] Run it against a local stack and look at `/templates`

## Starter set

| Template | Type | Category |
| --- | --- | --- |
| Weekly Business Review | slides | Business |
| Project Kickoff | slides | Project management |
| Monthly Budget Tracker | sheet | Finance |
| Sprint Task Tracker | sheet | Project management |
| Content Calendar | sheet | Marketing |
| Invoice | sheet | Finance |
| Product Requirements Doc | doc | Project management |
| Meeting Notes | doc | Business |
| Weekly 1:1 | note | Business |
| Retrospective Board | board | Project management |

## Non-goals

- **Thumbnails.** `publish` accepts a `thumbnailId`, but there is no headless
  capture path — the frontend captures on a Canvas. Seeded listings fall back
  to the document-type icon, which the gallery renders in a uniform picture
  box. Headless capture (slides first, via the existing `drawSlide` offscreen
  path) is a follow-up.
- A `templates` CLI namespace or `/api/v1` template routes.

## Review

Ran end to end against a local stack: 10 documents created, published,
submitted and approved; all ten `public` / `listed`; the gallery renders them;
a re-run reports `10 refreshed` and creates nothing. Slides, sheet, doc and
board content were each opened in the preview and checked by eye.

Four things the plan did not have:

**`tsx` cannot run a Nest context.** esbuild does not emit
`design:paramtypes`, so every injected dependency arrived `undefined` and the
first provider threw. `ts-node` then failed differently — it is CJS and the
engine packages are ESM TypeScript. The command runs from `dist` instead,
which is also how the app itself runs, so a production seed uses the same
artefact. `seed:templates:build` is the convenience wrapper.

**Formula cells rendered blank.** Nothing recalculates a formula until an
editor session opens the document, and a template is *previewed* far more
often than it is opened — so Variance and every Total read as an empty column
on the one screen that decides whether somebody uses the template. Fixed by
caching the evaluated value beside the formula, which is what a real `.xlsx`
does. The catalogue test re-derives every cached total from the seed's own
sample data, so editing a sample number without its total fails CI; verified
by mutation (flip one variance, the test fails).

**`@wafflebase/docs`'s Node entry was missing `BlockMarker`.** Pre-existing
and latent: `packages/slides`' PPTX import/export reads it from that entry, so
those three modules never typechecked against `node.ts` — visible as three
`tsc` errors on a clean tree, but no backend code imported slides *runtime*
values until this catalogue did, so nothing failed. One line in `node.ts`.

**Three content validators are now exported** from
`api/v1/docs-content.controller.ts`, so the catalogue test runs the same
checks `PUT /documents/:id/content` applies rather than keeping a second copy
of the contract that could drift.

Not verified: the watermark settle path against a **live event webhook**. The
local Yorkie project has none registered, so `contentChangedAt` stayed null
throughout and the settle loop returned on its first two reads. The logic is
written for the case that matters on a deployment that does register it, and
the seed verifies the listing really ended up `public`/`listed` afterwards —
but the race itself has not been observed.
