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
