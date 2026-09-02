# Template Gallery — Public Tier: Lessons

Todo: [20260902-template-gallery-public-tier-todo.md](./20260902-template-gallery-public-tier-todo.md)

## From planning (2026-09-02)

- **A design doc's claim about existing behavior is a claim, not a fact.** This
  doc asserted that `GET /images/:id` being unauthenticated kept a copied
  document's images rendering across a workspace boundary. It does not: that
  route serves thumbnails, while in-document pickers upload through the
  workspace-scoped route. Checking the call site (`postWorkspaceImage` in
  `app/spreadsheet/image-upload.ts`) took one grep and turned the largest piece
  of Phase 3 from "public-tier durability" into "fix a defect that has been in
  `use` since Phase 1". Verify the "what we already have" section of a design
  before building on it.
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
