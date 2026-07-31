# Lessons: token attribution

- [x] **The per-call data already existed — only the label was missing.** Each SDK
      session is its own `result` message in `sessionLog` (own `session_id`, usage,
      cost). The blocker to a per-lens breakdown was purely that `ask.mjs` pushed the
      message un-tagged. A one-field `{ lens, role }` stamp turned a flat total into a
      full breakdown without changing what's logged or any workflow.

- [x] **Tag at the shared choke point, attribute at the caller.** `ask.mjs` is the one
      place every lens sample and every verifier call funnels through, so the stamp
      lives there; the *meaning* (`detection` vs `verifier`, which lens) is only known
      at the `review-panel.mjs` call sites, so `logMeta` is passed in rather than
      inferred. Both verifier paths (representative/fold and prior-round re-check) had
      to be tagged, or verifier cost would have looked artificially low.

- [x] **Ship it dark-safe.** Un-attributed messages fall into an `other` bucket and a
      round with no attribution renders no table, so the change is invisible on old
      PRs and lights up only as instrumented rounds accumulate — no migration, no
      flag day.
