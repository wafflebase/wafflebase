# Revision history — lessons

Paired with [`20260902-revision-history-todo.md`](./20260902-revision-history-todo.md).

## Probe the dependency before designing on top of it

The whole feature was assumed to be a CodePair port. Four cheap probes
against the running `wafflebase-yorkie-1` container changed the design
instead:

- `POST /yorkie.v1.YorkieService/ListRevisions` → `400 invalid_argument`,
  where a fabricated method name → `404`. That distinction is what proves
  an RPC exists on a server you have no source checkout for.
- `strings`-grepping the server binary surfaced `autoRevisionEnabled`,
  `ListRevisionsByAdmin`, and the auth-webhook method enum
  (`…AttachDocumentDetachDocumentRemoveDocument`) — the last of which
  showed, by *absence*, that revisions are ungated.
- 620 scripted changes against a probe document produced exactly one
  automatic revision, `snapshot-503`. That is what established the
  timeline is per-`snapshotInterval`, not per unit of time — the single
  fact that most separates this from Google Docs.
- Attaching `readOnly: true` and calling `restoreRevision` **succeeded**.
  A permission hole asserted from reading an enum is a hypothesis; one
  demonstrated by rolling back a real document is a finding.

Rule for next time: when a feature rests on someone else's server, spend
the ten minutes to make it answer. Reading the SDK's `.d.ts` would have
confirmed the API exists and told us nothing about who is allowed to call
it.

## Don't port a wrapper that upstream has since absorbed

CodePair's `useYorkieRevisions` (152 lines) is a faithful hand-roll of
`client.listRevisions / createRevision / getRevision / restoreRevision`
against `client` + `doc`. `@yorkie-js/react@0.7.18` — the version
wafflebase already pins — exports `useRevisions()` doing exactly that,
bound to the ambient `DocumentProvider`. CodePair pins `0.7.12` and
predates it. Prior art shows you the *shape* of a solution; check whether
its scaffolding is still load-bearing before copying it.

## Shadow mode is not a permission boundary

`YORKIE_AUTH_WEBHOOK_ENFORCE=false` computes the decision, logs what it
would have denied, and allows the request. A feature whose safety depends
on the webhook cannot ship to a deployment in that state — "the gate is
deployed" and "the gate is closed" are different claims. Worth re-checking
per deployment rather than assuming, since the flag defaults to `false`.

_(append during implementation)_
