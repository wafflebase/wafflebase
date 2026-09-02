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

## Three wrong claims, all erring the same direction

Three separate statements in the approved design document turned out to
be wrong, caught only once execution reached the task that had to *use*
each claim rather than just read it:

- A `readOnly: true` `AttachOptions` field that does not exist in
  `@yorkie-js/sdk@0.7.18` — the design-phase probe passed it anyway, JS
  silently dropped the excess property, and the "read-only client" that
  successfully called `restoreRevision` was an ordinary read-write one.
  Caught when Task 8's implementer could not reproduce the setup from the
  design doc's own description.
- An auth-webhook method enum inferred, during design, to have no
  `*Revision` entry — read off a truncated string in the server binary via
  `strings`. The server actually validates registration against that enum
  and accepts all four revision method names; the whole "blocked on
  upstream" framing of the permission model was backwards. Caught when
  Task 8's fix round tried to register the methods for real and the
  server accepted them.
- A chunk-budget bump (`harness.config.json`, `maxChunkCount` 220→224,
  a broad `^editor-` 1500 kB override) justified in Task 11's initial
  commit by a guessed cause ("a third importer now on the shared path").
  Rejected on review: an independent rebuild of both the pre-feature
  baseline and HEAD in a worktree showed the real chunk count went
  218→213 — narrower, not wider — and two exact-file `manualChunks`
  entries closed the gap the guess had papered over.

All three errors point the same direction: toward the problem being
deeper and less fixable than it actually was. That is worth naming as a
pattern, not three unrelated slips — a design process that only reads
claims and never acts on them will systematically over-estimate how
blocked it is. The generalizable rule: **a claim inferred from an
artifact — a `strings` dump, an options object's shape, a build-size
heuristic — is a hypothesis, not a fact, and the cheapest way to test it
is to make the system act on it.** Attach with the flag and try a write.
Register the method and see if the server accepts it. Diff the actual
chunk output before writing the justification. Reading harder does not
substitute for this; two of the three wrong claims were the result of
careful reading of the wrong kind of evidence (a binary's strings, an
options object with no type-checking) rather than carelessness.

## A fixture that doesn't match the real type passes while testing nothing

Two independent instances of the same failure mode showed up in this
plan:

- A sheet-preview test fixture used a `worksheets` key that does not exist
  on the real type. The mount under test never actually ran — the test
  passed because nothing in it depended on the mount executing, not
  because the mount worked. Caught only in Task 11's review round, after
  the implementer had already relied on the fixture as if it proved the
  path was covered.
- A timezone-grouping regression test built its `Date`s from UTC ISO
  strings. At `TZ=UTC` — which is exactly what CI's `ubuntu-latest`
  runners default to — the local-time and UTC-time getters used by
  `toLocalDayKey` return identical values, so the guard could not
  distinguish a correct local-time implementation from a regressed
  UTC-only one. It would have passed CI even after a regression.

The corollary that caught both, and is worth carrying forward as a
standing habit rather than a one-off fix: **a regression guard nobody has
watched fail is not known to work.** In both cases the fix round asked for
(and got) evidence of the test actually going red against a deliberately
reverted or wrong implementation before accepting it as a real guard —
not evidence that it currently passes, which a vacuous test also produces.
When a fixture or test's whole value rests on "this exercises the real
code path," prove that by breaking the path on purpose and watching the
test notice, rather than trusting that a passing assertion means the path
ran.
