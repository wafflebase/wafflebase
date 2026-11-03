# Lessons — Sheets auto-fit row height (#1115)

## What the bug really was

Not a missing call site. Auto-fit was modelled as an *action* performed by
the local editor after a commit, so it could only ever cover the one write
path that knew to invoke it. Every other writer — the v1 cells API, the
CLI, xlsx import, paste, undo, a remote collaborator — produced the same
stored content and a clipped row.

Modelling it as a *rendering rule* ("a row with no explicit height is as
tall as its content") makes the number of write paths irrelevant.

## Why the fitted height is not persisted

`rowHeights` is the only place a manual height can live, and there is no
flag distinguishing a user-chosen height from a previously auto-fitted
one. Persisting the fit would make every edited row look manual, and the
next API write would then correctly refuse to touch it — re-creating the
reported bug one step later. Keeping the fit in memory keeps the meaning
of a `rowHeights` entry unambiguous: somebody asked for that height.

It also keeps collaborative churn out of the document: N clients viewing
the same sheet would otherwise each race to write the same height.

## Convergence of the re-render

`applyAutoRowHeights` can change row heights, which changes `viewRange`,
which changes the rows fetched on the next pass. Rows that fall *out* of
the fetched range are deliberately left at their current height rather
than shrunk back to the default — without that, growing a row at the
bottom edge would shrink the row that left the range, which would grow the
range again, and the render loop would oscillate.

## Self-review rounds

Round 1 (correctness/tests) — see PR.
