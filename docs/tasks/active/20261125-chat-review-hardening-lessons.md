# Chat review hardening — lessons

## Process

- Six streams ran in parallel worktrees branched from one plan commit that
  fixed the shared contracts first (URL params, DTO fields, stream event,
  panel API). Merges were mostly clean; every conflict was two streams
  appending adjacent blocks (schema fields, describe blocks, an add/add
  spec), resolved by keeping both. The semantic breaks a clean merge hid
  were signature changes one stream made under another's call site
  (user-keyed `draftStore`, a fifth `ChatMessageService` dependency): run
  the typecheck and the touched suites after every merge, not only at the
  end.
- A retry path that returns an existing row must load the same relations as
  the normal read (`findByClientId` lacked `refs`, so a deduped retry lost
  its document cards). When two streams meet in one function, re-read it
  whole after the merge.
- Grouping small shared modules into one `manualChunks` home looked like the
  elegant answer to the chunk-count gate and made the group eager (one
  module was reachable from the entry, and the manual chunk absorbed its
  dependencies: ~200 kB plus vendor-yorkie on every route). Measure the
  eager set after any `manualChunks` change; a measured budget bump with its
  reason was the right fix here.
- Flakes seen under the load of six parallel streams, each passing alone:
  `sheet-view-link-card.test.tsx` ("tells the engine once the card has
  closed"), one chat e2e run while `verify:self` ran beside it, a notes
  `commands.test.ts` case. `agent:tests` failed once because `npm ci` in
  `scripts/agent` ran concurrently with the lane: never reinstall a
  directory a running verify lane reads.

## Self-review

- Round 1 (correctness/tests): blocked on design-fit (anchor codec written
  twice, backend and frontend) and test-adequacy (editor panel wiring
  covered only by a source grep). Fixed both, plus 18 minors, in three
  parallel fix streams (shared codec in `@wafflebase/core`; behavioural
  detail-page tests and editor wiring; chat UI correctness). The "bundles P2
  with the P1 pass" design-fit minor is the user's explicit one-PR choice,
  recorded as a known limitation.
- Round 2's first panel run crashed in every lens (`spawn Unknown system
  error -88`) while `verify:self` ran beside it: an infra failure, not a
  verdict. It was rerun in place with `--round 2` rather than spending the
  bound. Never run the panel next to a full verify lane.
- Round 2's design-fit pass (`superpowers:requesting-code-review`) found
  what the panel had not: a deploy-skew Critical. The frontend ships on
  merge, the backend is pinned later, and `forbidNonWhitelisted` turns a new
  post field into a `400` the client classified as final, so every send
  would have failed until the backend deployed. Fixed by resending without
  `clientId` once the server names it. Rule: any new request field needs a
  client that tolerates the previous backend. It also found unthrottled
  edits (now a notification path), a Files query on every message, and a
  duplicate-link card pointing at the wrong anchor; all fixed in two
  parallel streams.
- The `typesVersions` map added to `@wafflebase/core` failed `scripts:tests`:
  the agent jobs' install allow-lists `package.json` fields. The backend
  build's own `paths` maps core's declarations instead.
