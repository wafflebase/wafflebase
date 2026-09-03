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

## From implementation (2026-09-02 → 09-03)

- **A gate in one writer is a gate with a door beside it.** `update()` returned
  an approved listing to review when its card changed, with a comment
  explaining exactly why it must. `publish()` — same fields, same caller, same
  preserved state, reachable on an existing listing because it is an upsert —
  had none. Whenever a rule protects a column, grep for every writer of that
  column before believing the rule holds.
- **"Documented in three places, implemented in none" is a real failure mode.**
  The README, the design doc and the task file all said the public tier
  required a configured reviewer allowlist. Nothing checked it, and the result
  was a submission that could be accepted and then stranded forever. When a
  doc states a precondition, the same change should add the assert.
- **Apply a threat model to every route that serves the same data, not the
  first one you thought of.** `toCard` stripped `documentId` from the
  collection with a careful comment about Yorkie doc keys; `findForViewer`
  handed the same field to the same anonymous visitors on the read the
  collection links to.
- **A moderation queue has to be drainable honestly.** A takedown that left its
  report open made "dismiss" — which records the opposite of what happened —
  the only way to clear the row. A queue that only empties by removing content,
  or by lying, pressures whoever drains it.
- **Text does not inherit authority from the person who forwards it.** The
  takedown button prefilled the reviewer's note from the reporter's free text,
  which then reached the publisher labelled as a decision.
- **Test the property, not the component.** Every test for the public gallery
  page mounted the component directly, so moving the route inside
  `PrivateRoute` would have kept them all green — while removing the only thing
  the page exists for. Rendering the real route table, and checking the test
  fails when the route moves, is what made it a test.
- **`eslint --fix <dir>` reformats files you did not touch.** Twice it added
  prettier-only churn to unrelated specs and controllers. Lint the files you
  changed, and check `git diff --stat` before committing.
- **`verify:fast` does not run the e2e lane, and CI does.** A constructor
  signature change broke `document-copy-attached.e2e-spec.ts`, which only
  `verify-integration` compiles — six local gates were green while CI was red.
  When a service gains a dependency, grep `test/` for `new <Service>` and run
  `RUN_DB_INTEGRATION_TESTS=true pnpm --filter @wafflebase/backend test:e2e`
  against a scratch database (create one, `migrate deploy`, drop it — never the
  shared dev DB).
- **Authorization before configuration.** `submit()` checked the tier gate and
  its deployment preconditions before `assertManager`, so a non-manager was
  told "no reviewers configured" instead of "not yours" — the cheaper check
  ran first, and leaked how the deployment is set up to anyone signed in.
- **Sequence dependent queries on success, not on `!isError`.** `enabled:
  !queue.isError` still fires on the first render, because nothing is an error
  yet — a non-reviewer collected two 403s for one page.
