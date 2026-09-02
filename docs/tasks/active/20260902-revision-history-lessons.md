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

## An option the API never had

The fourth probe above was wrong in a way that took an implementer to
catch. `AttachOptions` in `@yorkie-js/sdk@0.7.18` has **no `readOnly`
field**. Passing `readOnly: true` to `attach()` from a plain `.mjs` script
put an excess property on an object literal, JavaScript dropped it in
silence, and the "read-only client" was an ordinary read-write one. The
probe therefore demonstrated nothing about read-only access, while reading
exactly like a proof — and that sentence went into a design doc and was
approved.

What saved it: the integration test in Task 8 could not reproduce the
setup, because the option it was told to use does not exist. Re-deriving
the finding forced a better route — a real share-link `viewer` against an
*enforcing* webhook, whose `PushPull` write is denied while its
`restoreRevision` succeeds — which is both stronger evidence and the shape
the deployed permission model actually has.

Two rules:

- **An excess property on an options object is not an error in JavaScript.**
  A probe that passes an option the API never declared proves whatever it
  would have proved with the option omitted. When a probe's whole meaning
  rests on one flag, check that flag against the type declarations — the
  same `.d.ts` that was already open to confirm the method exists.
- **Prefer the probe that mirrors production.** "Attach with a flag" was
  convenient; "authenticate as the share-link role the deployment actually
  issues" was the real question, and it was barely more work.

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
