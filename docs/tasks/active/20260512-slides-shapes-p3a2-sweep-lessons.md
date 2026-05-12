# Lessons — Slides Shapes P3-A.2 (Adjustment Handles Sweep)

> Skeleton committed alongside the todo. Each lesson section is filled
> in as the task completes, mirroring `20260510-slides-shapes-p3a-pilot-lessons.md`.

## Scope reconciliation

_To be filled in as path builders are read. The todo's "Scope reference"
table was inferred from filenames and `ADJUSTMENT_SPECS` entries; any
shape where the actual adjustment semantics differ from the inferred
axis type gets recorded here, with a pointer to the path builder
location that disambiguated it._

## Factory consolidation decisions

_Record which axis families collapsed cleanly into a shared factory
(e.g. directional arrows) vs. which needed per-shape implementations
(e.g. mathDivide/mathNotEqual). The pilot's `radialStarHandle` set the
template; this section captures what worked and what diverged._

## What worked well

_Filled at task close — successes worth carrying into P3-B._

## What to do differently for P3-B

_Filled at task close — anything that did not scale from 9 → 33 shapes
will scale even less from 33 → 80+ shapes for GS parity. Capture
abstractions that should land *before* P3-B starts._

## Accepted limitations carried forward

_Items from P3-A.1's "Deferred" list that this task did not close, plus
any new ones surfaced during the sweep._
