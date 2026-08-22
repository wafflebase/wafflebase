# Lessons — credential pool failover

## A rule that is right for one becomes wrong for many, silently

`nextCredential`'s refusal to fail over on a 401 was not an oversight. It had a
docblock arguing for it, and the argument was correct against a single
credential: no other token can fix a wrong secret, so trying them all is waste.

The premise changed underneath it when the pool landed. Nothing in the change
was flagged as invalidating that reasoning, because the reasoning lived in a
comment on a function the pool change did not touch. The failure it caused was
also shaped to hide: with four slots and run-id sharding, three runs in four
looked perfectly healthy.

When a design assumption is written down, it is worth asking which change would
falsify it — and putting THAT in the comment, not just the conclusion. The
rewritten docblock names the premise ("a pool of separate accounts breaks
that") so the next reader can see the dependency.

## "Matching" comments are not a mechanism

`SESSION_LIMIT_RE` existed twice, each copy carrying a comment saying it matched
the other. That promise held exactly until one of them needed to grow. The same
shape as the #757 finding on the docs read/write walks: two copies with a
comment asserting they agree will drift, and the drift is invisible until the
case that separates them arrives.

The fix is the same either way — one definition, imported. Cheap here because
`ask.mjs` already imported from `redact.mjs`.

## An all-of-them failure and a one-of-them failure look identical from a PR

Every `agent-review-*` lens failed on every blocked PR, which reads as "these
PRs are bad". They were not: two different infra faults were producing lens
failures with real-looking "1 blocking finding" summaries.

The signal that separates them is duration. An infra failure completes in ~9
seconds; a real lens takes minutes. Checking `output.summary` for
"review did not run" — and the lens's start/complete timestamps — answered in
one query what reading the diffs never would have.

## Prefer the diagnostic that names the thing

`auth-smoke.mjs` checks every credential and reports per SECRET NAME without
printing the token. Running it converted "the pool is flaky" into
"`CLAUDE_CODE_OAUTH_TOKEN_2` is expired" in 30 seconds. It existed the whole
time; the reflex to reach for it is what was missing.
