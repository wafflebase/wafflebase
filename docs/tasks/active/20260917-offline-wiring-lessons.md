# Offline Persistence Wiring — Lessons (W3–W5)

**Created**: 2026-09-17

## From implementation

**A design can assume an API shape that does not exist, and the assumption can
survive review because it reads as obviously fine.** The design said "nest a
`YorkieProvider` with `key = wb:{userId}:{docKey}`". `key` is React's. The whole
durable path rested on a line nobody could have written. It took five minutes to
prove with a four-line probe and would have taken a day to find by debugging a
store that silently never resumed. **When a plan depends on passing a specific
option to a specific component, check the component's props type before
building on it** — and if the option is named `key`, `ref`, `children`, or
`dangerouslySetInnerHTML`, check twice.

**`tsc --noEmit` was checking nothing, for hours.** `packages/frontend/tsconfig.json`
is `{"files": [], "references": [...]}`, so a bare `tsc --noEmit` compiles an
empty program and exits 0. Every "TSC OK" reported before this was discovered
was vacuous, including ones used to justify a commit. The real command is
`tsc -p tsconfig.app.json --noEmit`, and it surfaces ~147 pre-existing errors —
which is why `verify:fast` has no frontend typecheck lane, and why a green
`verify:fast` says nothing about frontend types. **Before trusting a verification
command, make it fail once on purpose.**

**Fail closed, and be able to say why in one sentence.** Three of these modules
refuse rather than degrade: no Web Locks API means no durability, a lock manager
that threw means no durability, and `isOpenInAnyTab` answers "open" when it
cannot tell. Each is defensible only because the asymmetry is real — refusing
costs a feature, proceeding costs edits. Where that asymmetry does not hold, the
refusal would just be timidity.

**Two edges, one listener.** A preference-change subscriber fires on both
enabling and disabling. Erasing on the wrong one deletes the documents the user
just asked to start keeping. The test for it is the kind that looks redundant
until it is not: `it("does not erase when it is switched on")`.

**Read late, not at setup.** The erase watcher outlives a sign-out and sign-in,
so capturing `userId` when it is registered would erase the wrong account's
documents. Anything that survives an identity change should read identity when
it fires.

## Carried in from earlier stages

**Verify a claimed fix by reverting it.** Every guard in these modules has a
test proven to fail without it. Two revert checks in this batch were themselves
broken — a `perl` substitution mangled the function it was meant to neuter, so
the "check" proved nothing until it was redone with an asserted Python edit.
**A revert check that fails for the wrong reason is worse than none**, because
it reads as evidence.

**Tests that assert a proxy.** The storage layer's two review passes both found
tests that passed for a reason other than the behavior they named. The question
to ask of every test here is not "does it pass" but "would it still pass if the
thing it describes were broken".

_Appended as the work proceeds._

## Review panel, round 4 (blast radius / tests / design fit / security / correctness)

**A guard's scope must match the reach of what it guards.** `collectStale`
deletes across every account on the device — deliberately, since a departed
user never runs their own housekeeping — but it was handed the *account-scoped*
"is this open somewhere" predicate every other caller uses. That answers "not
mine, therefore idle" about another account's live document, so the sweep
collected it and that tab's later appends silently vanished. The two callers
need two predicates (`isOpenElsewhere` / `isOpenForAnyUser`), because the
account scoping is right for the purges and wrong for the sweep.

**Catching a throw is not the same as answering it.** `doc.subscribe` throws on
an event name the pinned SDK does not know, so the subscription had to be
wrapped — but the `catch` only logged. That handler is the sole caller of
`expectLoss`, and `remove()` archives only when the latch is set, so a
swallowed failure turned "archive the work" into "delete it" while the chip
still read `Saved to this device`. Every swallowed failure needs an answer to
"what does the rest of the system now believe that is no longer true".

**A per-device secret on a shared device is a per-everyone secret.** The
client-key salt lived in one `localStorage` key, and the device this feature
exists for is precisely the one where the next reader is a different person. It
is now per account and dropped by the erase.

**An offer is a claim too.** The chip's "turn offline saving on" call to action
fired on the share-link route the design excludes, promising a visitor a
guarantee that could never apply to the document in front of them. The
`not-permitted` lapse already carried the fact; the offer just was not reading
it.
