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

## The `scripts/` index needed a word-boundary match

`verify-integration.mjs` is a prefix of `verify-integration-docker.mjs`, so a
plain `includes` would have exempted the shorter name whenever the longer one
was documented. The gate matches on `(?<![\w.-])name(?![\w.-])` and a test case
pins it.
