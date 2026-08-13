# Lessons — Refresh the repository index files and gate them

## An index rots in the direction nothing checks

`verify:entropy` had been checking design-doc links for months and the indexes
still drifted, because it checks the wrong direction for this failure. A link
that resolves proves nothing about what the index *omits*: a package added and
never indexed is invisible to a link checker, since nothing points at it. Four
of eleven packages were missing with zero broken links.

**Rule:** when a gate exists over some artifact, ask which direction it walks
before assuming the artifact is covered. Coverage and correctness are different
properties and need different checks.

## Verify every factual claim before writing it into a README

Three claims went into a draft and two were wrong:

- `packages/README.md` called `cli` a "Go CLI". It is TypeScript (tsup →
  `dist/bin.js`) — the stale line had survived since before a rewrite.
- A draft sentence said the engines "all build on `@wafflebase/core`".
  `packages/notes/package.json` declares no workspace dependency at all.
- `scripts/README.md` first listed a top-level `vendor/` directory. The
  vendored pipeline lives at `scripts/agent/vendor/`.

Each was caught by reading `package.json` / the directory rather than by
reasoning from the surrounding prose. An index file is exactly where an
unverified claim survives longest, because nobody re-reads it.

**Rule:** every row in an index is a factual claim about a file on disk. Open
the file.

## Test a gate against a planted tree, not against the repo

`collectFindings(root)` takes a directory so the suite can build fixture trees
in `mkdtemp`. A gate tested only against this repository can assert that a
passing repo passes — which is the one case that carries no information. The
suite's useful cases are the ones planting an *unindexed* entry and asserting
the finding fires, plus the run against the real repo with a planted
`packages/ghost` to prove the wiring is live end to end.

## The first coverage rule read the wrong way round

`isCovered` walked an entry's *ancestors*, which is right for a design doc
(`docs/tables/` covers the files beneath it) and backwards for a package
(`[sheets](sheets/README.md)` links *into* the directory it introduces). The
base fixture — the tree that is supposed to pass everything — failed, which is
what surfaced it immediately. A fixture that must produce zero findings is worth
more than any single negative case.

## A comment that documents an impossible case protects nothing

The word-boundary match in `mentions` shipped with a comment claiming a plain
`includes` would let `verify-integration-docker.mjs` satisfy
`verify-integration.mjs`. It would not — the `.mjs` terminates the shorter name,
so it is not a substring of the longer one. Code review caught it, and the test
"pinning" the behavior passed identically against a naive `includes`.

The guard *is* load-bearing, for a case nobody had written down: directories are
matched without an extension, and `test` occurs inside
`run-browser-tests-docker.sh` — that one row would have exempted `scripts/test/`
in this repository. The test now uses that case and fails without the boundary.

**Rule:** a test whose scenario cannot occur is not a test. When writing one to
pin a guard, delete the guard and confirm the test goes red first.

## A coverage gate must be audited for ways to be green

Review found three, all silent:

- a self-referential link (`[all docs](./)`) resolved to the index's own
  directory, an ancestor of every entry, taking the whole design-doc check green
  with zero coverage;
- `isLinkedInto` is a string-prefix test, so `[board](board/TYPO.md)` granted
  coverage to a package via a path that does not exist — and nothing else
  dead-link checks `packages/README.md`;
- `mentions` scanned fenced code blocks, so a fenced `ls scripts/` dump named
  every entry without introducing any.

Each was a way to pass without being covered, in the one gate whose whole thesis
is that coverage is about an index's *silences*.

**Rule:** after writing a gate, spend a pass attacking it — "how would I make
this green without doing the work?" — and turn each answer into a test.

## A duplicated list needs both copies gated

The root `README.md` duplicates `packages/README.md`'s package list on purpose.
The first version gated only one of them, and the task doc asserted both were
covered. That leaves the unwatched copy as the only one that can rot silently —
regenerating the exact failure the gate was built for, one file over.
