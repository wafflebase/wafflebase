# Lessons — design editor open loop

## The bottom rung is the one nobody has walked

`scripts/design-pr.mjs` has four rungs, and rung 3 — the one a maintainer with
`gh` and push rights takes — was driven repeatedly, including to open this
task's own pull request. Rung 1, the one written *for* the person the tool
exists for, had only ever been reasoned about.

Forcing it (a `PATH` with no `gh`) found the script answering a missing git
identity with a raw Node stack trace. Nothing about that was subtle; it had
simply never been run.

The general shape: **a fallback path is exercised by the people least able to
report it.** Everyone who can diagnose the failure has an environment where the
fallback never triggers. Force the condition rather than waiting for a report,
and prefer forcing it over reading the code, which is what had already happened.

## `execFileSync` throws, and a wrapper decides who sees it

```js
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
```

That is correct for a script whose reader is its author — the exception carries
the stderr and the stack points at the call. For a script whose reader has never
used git seriously, it prints a serialised argv and a stack trace where an
instruction belongs.

The wrapper is the right place to decide, because every call site inherits it:
catching there and routing to the script's own `stop()` means no git failure can
ever print a stack again, including the ones not yet written.

## git identity is per-clone more often than it looks

wafflebase's own `user.name` is set in the repository's local config, not
globally — so **every fresh clone on this machine has no identity**, and so does
every clone made by someone who has only ever used git through an IDE. A tool
that commits on someone's behalf should check for it and never fill it in: a
commit attributed to a name the person did not choose is worse than one that did
not happen.

Check *after* the plan prints and *before* anything is created, so the stop
leaves the tree untouched and `--dry-run` keeps its "change nothing" contract.

## Some verification ends in someone else's repository

Rung 2 ends in a pull request against a repository the runner cannot write to.
There is no way to drive that honestly: any real target means forking a
stranger's project and opening a pull request on it.

So it was driven with `gh repo view`, `repo fork` and `pr create` answered by a
shim and **everything else real, including the push** — then written down as
exactly that, naming the one unexercised call. A verification with a stated hole
is worth more than an untested claim and more than a skipped box; what makes it
worth anything is that the hole is named.

## Measure the cost you are about to optimise

The install step was left as a full workspace `pnpm install` with a note that the
filtered alternative's saving was unknown. Measured: **123 s from a clone with no
`node_modules` to an editor answering `/metadata`**, of which the shell build was
16.6 s.

That did not inform the optimisation — it retired it. Two minutes is not worth a
narrower install that would still have to pull the frontend's dependencies. The
measurement was cheaper than the analysis that had been substituting for it.
