# Live document-title sync — Lessons

- A value that lives outside the CRDT (Postgres) is invisible to peers unless
  something pushes it. When a bug report names one editor, check whether the
  data path is shared — here every type had the same gap.
- `@yorkie-js/sdk` 0.7.25 has no `Document.broadcast`; broadcast moved to
  `Channel`. Presence is the cheapest per-document signal already attached.
- `verify:fast` CLI typecheck reads `@wafflebase/slides` from its built `dist`;
  after main adds exports, rebuild docs + slides before trusting a red lane.

## Self-review

- Round 1 — blocked on correctness/test-adequacy/blast-radius: announce could
  throw before the renamer's own cache refresh; a rename before attach was
  dropped (`@yorkie-js/react` publishes `doc` only after attach); six copies of
  the handler were untested. Fixed all: `useDocumentRename` owns PATCH →
  refresh → try/catch announce, queues a pre-attach announce, one test file.
- Round 2 — panel blocked on correctness/security: a handler created before
  attach kept `doc` undefined in its closure, so a PATCH that resolved after
  attach was never announced; ignoring `watched` lost renames during a
  reconnect; a peer looping `titleRev` drove unthrottled refetches. Fixed:
  handler reads the doc through a ref, any unrecorded `titleRev` (seed,
  `watched`, `presence-changed`) refetches, 2s leading+trailing coalescing.
  Code-review subagent (no blockers) minors also taken: non-secure-context
  rev, file renamed to `use-document-rename.ts`, test typing. Not pruning
  `seen` on `unwatched` — that would reopen the reconnect hole.
- Round 3 (bound) — panel blocked on correctness: a live remote title reset
  `SiteHeader`'s draft mid-edit; the attach-time path could not fire because
  the SDK delivers watch-init presences as `initialized` on the `presence`
  topic, which `others` drops (verified in `yorkie-js-sdk.es.js`). Fixed both
  with tests. Loop stopped at the 3-round bound; round 4 not run — the fixes
  are unreviewed by the panel, flagged in the PR body.
- Round 4 (panel fix round) — blocked on correctness: protecting the draft from
  peer renames protected *every* open input, so an untouched one committed the
  title it was opened with back over a peer's rename on blur; and a rename
  whose PATCH resolved after unmount queued its announce on a dead hook, so
  peers kept the stale title. Fixed: `SiteHeader` tracks a `dirty` flag and
  only an edited draft resists `title`; the rename handler captures the
  document before the await and announces on that handle.
- Round 5 (panel fix round) — blocked on blast-radius + correctness, both on
  the same point: capturing the document handle before the `await` fixed the
  *reference*, not the fact that `DocumentProvider`'s unmount cleanup calls
  `client.detach()`. A presence write on a detached document is a local change
  nothing syncs, so peers still missed exactly the commit-then-navigate rename
  the capture was written for — and the fake doc in the test had no
  `getStatus`, so the assertion passed on a document the real app would have
  detached. Fixed by moving the write that has to survive to *before* the
  request: `titleRevPending` is a heads-up sent while the document is
  certainly attached, and a peer that never sees the matching `titleRev` reads
  the row once the cooldown has passed. Both writes now go through the
  `getStatus() === "attached"` check `PresenceIdentityRepair` already applies.
- Lesson: an async teardown you do not own (here `client.detach()` fired from
  an ancestor's effect cleanup) cannot be outrun by capturing a handle. The
  only writes that survive an unmount are the ones issued before it — so send
  the durable signal first and treat the post-await one as the optimization.
- Lesson: a fake that omits the method a guard reads turns that guard into a
  no-op, and the test goes green on behavior the real object forbids. Give
  stubs the state the production invariant is expressed in.
- Lesson: before choosing an SDK event topic, read the topic's filter in the
  SDK source — `others` silently excludes `initialized`.
- Lesson: "don't clobber the user's draft" and "don't revert a peer" are the
  same race read from two sides. An open input is not evidence of a draft —
  only a keystroke is.
