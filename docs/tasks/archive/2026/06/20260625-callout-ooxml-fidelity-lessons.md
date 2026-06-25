# Lessons — Callout OOXML geometry fidelity

## Port from the authoritative preset, not memory

The ONLYOFFICE `core` repo encodes ECMA-376 `presetShapeDefinitions.xml`
verbatim as C++ string literals
(`MsBinaryFile/Common/Vml/PPTXShape/OOXMLShapes/C<Name>.cpp`). Fetching
those gave the exact `gdLst` guides and `pathLst` points, which caught
two things memory would have missed: the wedge tail base is a fixed
`w/4` (`7..10`/`12` twelfths), and arrow head depth is `ss`-based, not
`w`/`h`-based.

## OOXML guide operators are worth a tiny helper module

`pin`, `?:` (ternary on `>0`), `cat2`/`sat2` (cosine/sine-arctangent),
`mod` (vector magnitude), and `arcTo` (current-point-derived ellipse
centre) recur across callouts. Encoding them once in `ooxml-math.ts` let
each builder read almost identically to the preset XML, which made the
ports auditable and cut transcription mistakes.

## `arcTo` must derive its centre from the current point

OOXML `<arcTo stAng swAng>` starts at the *current* point and recomputes
the ellipse centre from it, exactly like `basic/cloud.ts`. Using the
nominal frame centre instead would introduce a discontinuity at the
arc's start (visible on `wedgeEllipse` / `wedgeRoundRect`).

## Geometry changes ⇒ three test surfaces to update

Each builder change rippled to: (1) the per-builder `isPointInPath`
probes (recompute interior points from the new guides — the old points
were calibrated to the old approximation), (2) the shape-registry Path2D
snapshot (`-u`), and (3) any adjustment-count / handle-count assertions
(border callouts went 2/4/6 → 4/6/8 adj). The pre-commit `verify:fast`
runs the snapshot, so forgetting `-u` blocks the commit — expected, not a
regression.

## Spec bounds vs geometry are independent

Widening an `AdjustmentSpec` `min`/`max` to the OOXML "unbounded" range
broke the handle-clamp tests for zero geometric benefit — the builder
math, not the spec bounds, drives the rendered shape. Keep the existing
sensible drag bounds (`±100000` for wedge tails) unless a default value
actually exceeds them (border leader targets need a wider range).

## Single Path2D can carry fill-only + stroke-only sub-paths

Border callouts are a filled box plus a `fill="none"` leader. Rather
than cramming the leader into the fill path (winding artifacts), a
dedicated `LEADER_BUILDERS` map returns the open polyline and the
renderer strokes it after the body — matching the OOXML two-path model
and the existing `OUTLINE_BUILDERS` pattern.
