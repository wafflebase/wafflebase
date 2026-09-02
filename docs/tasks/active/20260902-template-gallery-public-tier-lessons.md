# Template Gallery — Public Tier: Lessons

Todo: [20260902-template-gallery-public-tier-todo.md](./20260902-template-gallery-public-tier-todo.md)

## From planning (2026-09-02)

- **A design doc's claim about existing behavior is a claim, not a fact.** This
  doc asserted that `GET /images/:id` being unauthenticated kept a copied
  document's images rendering across a workspace boundary. It does not: that
  route serves thumbnails, while most in-document pickers upload through the
  workspace-scoped route. Checking the call site (`postWorkspaceImage` in
  `app/spreadsheet/image-upload.ts`) took one grep and turned the largest piece
  of Phase 3 from "public-tier durability" into "fix a defect that has been in
  `use` since Phase 1". Verify the "what we already have" section of a design
  before building on it.
- **One grep found the defect; it did not find its shape.** The first write-up
  said the workspace-scoped route was "shared by sheets, slides, docs and
  board", which was wrong at both edges: `doc` uses `docsImageUploader` →
  `POST /images` at the bucket root and is unaffected, while `note` — excused in
  the same paragraph as "external links anyway" — uses the workspace route and
  is affected. `slides` is mixed (native insert scoped, PPTX import not). Code
  review caught it. Finding the *first* call site is where the investigation
  starts, not where it ends; enumerate every caller before writing the sentence
  that generalizes over them.
- **Check the readers, not just the states.** Four separate findings in review
  were the same omission: a new state machine was specified without walking the
  functions that already read those columns. `publish()` writes
  `status: 'listed'` unconditionally (so a republish reverses a takedown),
  `browse()` filters `status: 'listed'` for both scopes (so submission is not
  the no-op the design claimed), and `assertPublishable` refuses the *presence*
  of `public` rather than the transition into it (so an approved listing could
  never be edited again). When a design adds a state, enumerate every existing
  query over that column in the same pass.
- **The cheap re-hosting target is a silent gate removal.** Copying an image to
  an unscoped bucket-root key makes every copy render, which reads as "it
  works" — and publishes a private workspace's images at a permanent
  unauthenticated URL. When the fix for a broken read is "make it readable",
  check which gate you just deleted.
- **A preview that holds a share token hides bugs the copy will have.** The
  broken-image case is invisible in the template preview and visible only in the
  document the user receives. When two paths read the same content with
  different credentials, test the one with fewer.
- **Model the effective state and the workflow state separately.** Writing
  `visibility: 'public', status: 'pending'` on submission would have changed how
  an already-shared listing reads *during review*. Keeping `visibility` at the
  effective tier and moving only `status` means submission is observably a no-op.
- **One rejection state cannot carry two verdicts.** "Not good enough for the
  gallery" and "may not be served at all" need different states, or a copyright
  takedown leaves the content reachable by link.
- **Look for unowned routes when a feature widens an audience.**
  `DELETE /images/:id` had no ownership check and no client; it was harmless
  while ids stayed inside a workspace and becomes a vandalism path the moment a
  gallery publishes them.
