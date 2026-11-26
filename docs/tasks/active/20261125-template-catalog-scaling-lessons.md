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
