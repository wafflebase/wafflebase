# Lessons — Design Archive Policy

## "Shipped" ≠ "still valid" — verify folded facts against code

When folding old design docs into canonical docs, do **not** trust the
doc's own framing of currency. Two of eleven "shipped, presumably valid"
notes were actually superseded by later redesigns:

- docs-table-ui's IME cell routing (`cellAddress` →
  `insertTextInCell`) was removed by the Block[]-cells redesign — and
  the *target* doc explicitly contradicted it (Key Decisions: "no
  `cellAddress` on `DocPosition`").
- frontend dual-editor was a 2-type design; code now has 3 types
  (`sheet`/`doc`/`slides`).

**Rule:** after folding, grep the codebase for every concrete symbol the
fold asserts (`type`, field, function, file). A fact that contradicts the
target doc or the code is obsolete → reword to current reality + a
one-line historical pointer, don't copy it verbatim. The target doc's own
"Key Decisions" section is the cheapest contradiction detector.

## rtk proxy mangles piped / multi-path / `-g` shell commands

Several verification commands silently failed or returned wrong results
under the rtk hook:

- `ls dir | rg pattern` returned "(empty)" when files existed.
- `rg -g '!**/dist/**'` errored (`-g` got rewritten to grep's `-g`).
- multi-path `rg pat pathA pathB` returned nothing while single-path hit.

**Rule:** for verification greps, run **one pattern, one explicit source
path, no pipes, no `-g`**. Exclude `dist` by pointing at `packages/*/src`
directly rather than glob-excluding. When a search returns "missing" for
something you expect to exist, re-run it the simple way before believing
the negative — a false "MISSING" nearly caused me to flag valid facts
(`ghosts`, `TableGridPicker`, `themed-color-picker`) as stale.

## Disambiguate the two "archives"

`docs/design/archive/` (design notes) and `docs/tasks/archive/` (completed
task pairs) are different. When removing the design archive, leave the
task-archive references (harness-engineering.md, slides-hover) untouched.
