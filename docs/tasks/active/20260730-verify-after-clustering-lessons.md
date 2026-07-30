# Lessons: verify after clustering

- [x] **Reordering the two clustering passes needed `mergeCluster` to flatten,
      not overwrite.** Once fresh findings are clustered before verification, the
      surviving representative already carries `mergedFrom`; the later fresh-vs-prior
      merge would re-run `mergeCluster` and clobber it with only the new fold.
      Making `mergeCluster` accumulate each member's own `mergedFrom` makes the
      operation composable and idempotent-safe — a property worth having regardless
      of call order.

- [x] **Stats index-alignment is a correctness trap.** `verdicts` are produced
      over `detected` (post-cluster), so every consumer indexed against them
      (`annotateFindings`, `verifierTally`) had to switch from `findings` to
      `detected`. `raised` deliberately stayed on raw `findings` — it is the honest
      "how many wordings the lens produced" count, with `clusters.collapsed`
      reporting the inflation separately.

- [x] **This reversed a deliberate #591 decision, so the tradeoff is documented in
      code and design doc.** #591 put clustering after verification on purpose
      ("it can never decide what gets verified"). Moving it before is a real
      change to that safety property; the mitigations (conservative threshold,
      strongest-wording representative, every wording rendered) are stated where a
      future reader will look, not assumed.
