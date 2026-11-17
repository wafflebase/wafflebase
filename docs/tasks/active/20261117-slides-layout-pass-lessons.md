# Slides editor layout pass — lessons

## Check a review finding against the design docs before dispatching it

The layout review flagged the right-cluster panel toggles changing from
labels (idle) to icons (object / text edit) as an inconsistency, and the
toolbar agent removed the labels. That form change is a documented
decision (`slides-toolbar-redesign.md` § Labelled chrome): the labels
follow Google, whose Background / Theme row is a no-selection
affordance, and fall back to icons only when the strip is too narrow.

Rule: before turning a review observation into an agent task, grep the
subsystem's design doc for the behavior. "Looks inconsistent" is a
hypothesis; a doc that names the behavior and its reason outranks it.

## Parallel agents in one checkout

Five agents edited disjoint file sets in the same working tree with no
git operations of their own, which avoided per-worktree installs. It
held: no file collisions. The shared cost was noise — each agent saw the
same 155 frontend `tsc` errors and could not tell them from another
agent's in-flight edit. They came from running `tsc -p tsconfig.app.json`
directly; `pnpm verify:fast` (the real gate) was green. Point agents at
the package's own typecheck script, not a hand-picked tsconfig.

## Self-review log

(rounds recorded here)
