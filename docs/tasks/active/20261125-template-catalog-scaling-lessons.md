# Template Catalog Scaling — Lessons

- Before planning "acquire templates like Canva", check redistribution terms:
  nearly every free template site allows *use* but forbids redistribution,
  which is exactly what a copy-on-use gallery does. Authoring is the only
  path that scales cleanly.
- When parallel section drafts overlap (locale, attribution), resolve the
  conflict explicitly in the assembled doc rather than keeping both shapes.
- A recorded design rejection can rest on a misread comment — re-read the cited
  code (`publish()` upsert comment) before treating the rejection as binding.

## Self-review log

- Round 1 (correctness/tests): 6 blocking, all in `template-sync`: clock-skew
  in event wait, first publish attesting to unwritten content, approve with
  undefined `contentAt` when the event webhook is unregistered, allowlist gate
  only in the CLI entry, no tests for the CLI guards. All taken as fixes.
- Parallel PRs that both touch every seed file are not independent: split by
  making one a pure rename and the other a one-line-per-seed edit, then rebase
  with `-X find-renames=40%`; a file split still needs one manual fix.
- Stricter types from one parallel PR break another PR's test fixtures only at
  integration time — run the combined suite before trusting either green.
- Round 2 (design fit/blast radius): 5 blocking, all `template-sync`: stale
  seed record after unpublish (correctness + blast-radius), third-party edit
  inside the event-wait window attested, `assertSeedDocument` guards untested,
  state machine tested only against a hand-written service mock. All taken as
  fixes (read-back content hash before approve; real-service DB contract test).
- A self-declared "known limitation" in a security-relevant path is a finding
  waiting to happen — close the window instead of documenting it.
- Round 3 (security/docs): 4 blocking — loop bound reached, escalated to a
  human. (a) deleting `register:templates` leaves 16 sheet/doc/board seeds with
  no operator path (design-fit); (b) the rewritten content-write path is faked
  in every test (test-adequacy); (c) card drift via the Share dialog is invisible
  because sync trusts its own `cardHash` record instead of the listing
  (blast-radius); (d) the root-hash read-back cannot see third-party content
  that `writeContent` does not overwrite, e.g. an injected sheet tab (security).
- Scope lesson: retiring a tool before its replacement reaches parity is a
  regression even when the phase plan says "slides first".
- Panel round (correctness/security): 2 blocking. (a) `writeContent`'s refusal
  ran after `doc.update` returned, so the change was already a local change and
  `withDocument`'s unconditional detach would have shipped it — a refusal that
  withholds nothing. Moved inside the updater, where Yorkie drops the clone and
  records no change. (b) `approveOne`'s exact-title row locator was page-wide
  over `<li>`, and the admin page's Reports list renders a listing title in
  byte-identical markup, so a report could be counted as a second row and the
  new ambiguity refusal would abort the run; scoped to rows carrying an Approve
  button.
- A guard that reads a *pre-commit* CRDT proxy instead of the committed root
  only substitutes while the two serialize alike. Assert that where every input
  passes (`expectedRootHash` computes both) rather than reasoning about it once.
- Panel round (security): 1 blocking. The axis-id renaming the root hash is
  built on was not injective — a cell injected under a key that already reads
  as a positional name (`"r0|c0"`) canonicalized onto the renamed real key and
  one of the two was dropped, so a worksheet could be edited without moving the
  hash. Renamed and literal parts now live in disjoint namespaces and a
  surviving collision throws.
- A canonicalization that feeds a security decision needs to be injective, not
  merely stable: "two writes of the same content agree" is half the property,
  and the half that is easy to test. The other half — two different contents
  disagree — is the one an attacker reads.
- PR review (CodeRabbit 18 inline + 2 outside-diff, panel round 4: 2 blocking).
  All taken as fixes, except two panel claims rejected on evidence: "core
  tests run in no CI lane" (`verify:fast` and the `core:test` lane run them)
  and "make `--workspace` required" (the new manage-authority check is the
  real boundary).
- On this repo `@claude review` on a non-`agent/` branch still launched the
  panel *and* its fix loop, which pushed 3 commits and hit its own bound.
  Fetch before pushing after asking for a review.
- Parallel agents sharing one scratchpad overwrote each other's commit
  message files; give each agent its own subdirectory.
- A failing DB e2e in a reused local database was a missing migration: run
  integration suites on a fresh, migrated scratch database before blaming code.
- CodeRabbit follow-up (6): all valid and fixed — card-edit guard made atomic
  with its write, thumbnail kept on a failed re-read, stale service comments,
  a vacuous regression test (wrong expected token), two self-host doc gaps.
- Never discard stderr on an outward-facing command: a `gh pr comment` with an
  unsupported flag failed silently and was reported as posted. Check the URL it
  prints.
- A backgrounded `git push` can die with SIGPIPE (141) after its hook passes;
  confirm with `git status -sb` that the branch is no longer ahead.
- A regression test must be shown to fail on the pre-fix code; CodeRabbit
  caught one that passed either way.
