# Lessons: shared-core prompt caching

- [x] **A cost optimisation can be silently undone by an unrelated cost
      optimisation.** #607 was a pure manifest edit — no code, no test churn, 388/388
      green — and it was right on its own axis (#610 then did the same for `security`). It also removed most of #594's cache
      saving, because caching depended on a property (`samples: 2` ⇒ a lens shares a
      prefix with itself) that nothing in the manifest advertised as load-bearing.
      Neither PR's tests could catch it: both were green throughout. `cache-report.mjs`
      is what made it visible, and only because it was run deliberately.

- [x] **"Subset" and "prefix" are different questions, and only one of them is the
      one caching asks.** The intuitive fix — let the lens that reads everything warm
      the cache, let the narrower lenses read a prefix of it — is wrong twice over:
      slices that are subsets by file class are not leading byte runs (git's
      alphabetical file order interleaves them), and even class-ordered they would
      need multiple cache breakpoints, where the SDK exposes one. Sharing requires
      byte-**identity**. Once that is clear the design inverts: don't make one lens's
      prefix a superset others nest into, make the *common* part identical for
      everyone and push each lens's remainder out of the cache entirely.

- [x] **Check what the optimum actually is before engineering toward it.** A
      remainder is cacheable only if the same bytes form a shared leading prefix for
      some other session, and none do — `docs` reads the prose part of `security`'s
      remainder, but as a different byte string — so a cache write there is a `~1.25×`
      premium nothing reads back. The theoretical best is therefore "core cached and
      shared, remainder at full price", which the simple design already achieves. The
      elaborate nesting scheme would have been strictly more fragile for zero gain.

- [x] **The set-membership habit is hard to shake, even while arguing against it.**
      The first draft of these notes justified not caching the remainder because it
      was "read by exactly one lens" — a *set* claim, in the very document whose point
      is that caching answers a *byte* question. It reached the right conclusion for
      the wrong reason, and the wrong reason is also false: `docs` does read part of
      `security`'s remainder. Caught in review of this PR, not by a test, because
      nothing mechanical checks that a rationale is the operative one.

- [x] **Deleting a parameter is a stronger guarantee than a comment asking you not
      to use it.** `lensCacheKey` carried a long warning that no `lens.title` or
      rubric may appear in the prefix, and a `lens` argument that made violating it
      easy — the `needsIssueSpec` branch was already doing so, splitting `design-fit`
      off on every PR. Removing the parameter makes the invariant structural, and the
      test now asserts `lensCacheKey.length === 1` rather than grepping the output for
      titles it happens to know about.

- [x] **The safety argument has to be a property, not an assurance.** Widening the
      cached prefix is only acceptable because `core + extra` is *exactly* the lens's
      own slice, so scope routing is untouched. That is asserted by reconstruction —
      re-slice both halves, compare the block sets against `diffForLens` — for every
      lens in the manifest, rather than by trusting the filter predicates to be
      complements. The guard that makes it hold (a lens must read every core class,
      or it keeps its own slice) is what keeps the prose-only `docs` lens from being
      handed the code diff.

- [x] **Regrouping diff blocks is safe; reformatting them would not be.** The split
      concatenates core blocks ahead of the remainder, so a lens's blocks no longer
      arrive in diff order. That is fine only because each block keeps its bytes
      exactly and findings cite `file:line` resolved from hunk headers *inside* a
      block — the same reason `sliceDiffByFile` is careful to preserve block bytes.
