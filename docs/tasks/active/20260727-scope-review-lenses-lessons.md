# Lessons — Path-scope the review lenses (#563 D1)

## Don't bundle work the agent can do with work it structurally cannot

The most expensive lesson here, and it cost $9.36 and a paged PR to learn.

#563 asked for three deliverables. D1 is a data + test change; D2 and D3 edit
`.github/workflows/*.yml`, which the agent App **cannot push** — no `workflows`
scope, and the rejection is wholesale, so it would also have discarded the
legitimate D1 fix riding in the same push. The agent did the only thing it could:
committed the workflow edits as an unapplied `.patch` under `docs/` and said so.

What followed was the loop behaving *correctly* on an impossible task:

- `design-fit` reported the deliverable unimplemented. It was right.
- The fixer tried applying the patch, got the push rejection, and wrote a
  detailed, accurate rebuttal in the PR thread.
- The next round's panel never saw that rebuttal — it receives the diff, the
  changed files, the issue spec, and prior *findings*, and nothing else. The
  finding was re-raised, twice over.
- The fixer, with nothing left it could legally do, produced no commit, and the
  no-commit detector paged.

Every component did its job. The defect was upstream, in the issue: **split work
at the capability boundary when filing, not when reviewing.**

## An inline copy of config is not a test of that config

The first draft's scoping test restated the four glob sets as literals, with a
comment saying they mirror `lenses.json`. That test passes no matter what the
manifest says — the shipped behavior change was untested, and the comment made it
look covered.

`test-adequacy` flagged this precisely. Two things worth noting about *when*:

- It approved the identical flaw in round 1 and rejected it in round 2. The
  criticized property never changed between those rounds. That is a false
  negative, and it is the second recorded instance of this pattern after #548.
- Being right in round 2 does not retire the concern. A reviewer that finds a
  real defect only half the time is not a gate you can lean on.

The fix reads the manifest, so the assertions move when the config moves.
Verified by mutation rather than assumed: three independent manifest edits each
make the suite fail.

## Assert the safety property; don't comment it

"`correctness` stays `['**']` to guarantee a non-empty required-check set" was a
comment on a data file. Nothing enforced it, and the reason lives two files away
in `mark-ready.mjs`, where an empty required set is rejected because
`[].every` is vacuously true.

It's now a test that fails with the full explanation. Path-scoping is a
one-character-edit away from silently dead-ending the pipeline; that deserves an
assertion, not prose.

## Scoping a *security* gate by path is different from scoping the others

The first draft scoped `security` to `packages/**|scripts/**|.github/**`, which
quietly exempted root-level supply-chain and secret vectors — root
`package.json`, lockfiles, `.npmrc`, `Dockerfile`. The panel caught it and the
fixer reverted it correctly.

General rule the episode suggests: cost-driven scoping is fine for lenses that
answer "is this change well-built" (`design-fit`, `test-adequacy`), and
dangerous for lenses that answer "is this change safe." Cheapness is a bad reason
to create a coverage hole in a blocking security gate.

## Follow-ups (out of scope here, per issue)

- D2/D3 — tighter fixer prompts, focused implement exploration. Separate
  human-pushed PR.
- Drop `samples` 2→1 on stable lenses.
- Model-tier lenses to a cheaper first pass.
- Incremental re-review of only changed files.
