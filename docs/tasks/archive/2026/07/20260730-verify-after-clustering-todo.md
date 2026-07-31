# Verify after clustering: stop paying the verifier per wording

Follow-up to [restatement clustering](20260730-restatement-clustering-todo.md)
(#591). That PR added `clusterFindings` to collapse restatements of one defect,
but ran it *after* the verifier — so the verifier still ran once per wording
before the collapse, which is the token waste #578 first surfaced.

## The problem

Per-lens flow in `review-panel.mjs` was: sample → union → **verify each fresh
finding** → prior re-check → `merged = clusterFindings(dedupeFindings(...))`.

With four restatement pairs (the #578 shape), the verifier opened four redundant
sessions (and four redundant `git blame` calls via `noveltiesFor`) for defects
that clustering then collapsed to one.

## The change

- [x] Cluster the fresh findings **before** the verifier pass:
      `const detected = clusterFindings(findings)`; verify / annotate / tally over
      `detected`, not the raw `findings`.
- [x] Keep the merge-step `clusterFindings(dedupeFindings([...kept, ...priorKept]))`
      — it now only collapses **cross-pass** restatements (a prior finding the
      fresh pass re-found in different words).
- [x] A finding can now be clustered twice, so `mergeCluster` **flattens**
      `mergedFrom` (each folded member contributes itself + its own prior
      `mergedFrom`, and the rep's is kept) instead of overwriting — no wording is
      lost across the two passes.
- [x] `raised`/`raisedConfidence` stats stay on raw `findings` (honest raised
      count); `sentToVerifier` now counts distinct defects (`detected`).
- [x] Tests: re-cluster-keeps-every-wording regression; full agent suite green.
- [x] Design doc (`harness-engineering.md`) updated: ordering + the tradeoff.

## The tradeoff (stated, not hidden)

Clustering now decides what the verifier sees, so a wrong merge means a folded
wording is judged only through its representative. Bounded by: the conservative
similarity threshold (the #578 distinct pairs score 0.000, staying separate), and
`mergeCluster` electing the strongest wording (gating → highest severity →
evidence-bearing) as representative, with every folded wording still rendered so a
bad merge is visible rather than silent.

## Guarding the drop decision (added after CodeRabbit review of #601)

- [x] Re-verify a refuted cluster's folded members individually before dropping
      them (`resolveClusterVerdict`), so a wrong merge cannot drop a
      genuinely-distinct finding on a shared refutation. A representative refutation
      is honoured only when every folded BLOCKING wording is also confidently
      refuted; otherwise the cluster is kept, carrying the surviving verdict. The
      re-verification runs only on the rare dropping verdict of a multi-member
      cluster, so the confirmed common path stays one session per cluster.

## Not done here (candidate follow-up)

- The prior-round re-check still verifies each `priorForLens` entry; those were
  already collapsed when persisted last round, so the waste there is minimal —
  left as-is to keep this change focused.
