# Lessons — shape & connector dash rendering

## Enumerate branches, not call sites

The first pass listed "stroke calls in `shape-renderer.ts`" and fixed
four. It missed a fifth, because `drawShape` returns to `shape-special.ts`
for action buttons before reaching any of them. Grepping one file answers
"where does this file stroke", not "what can this function do".

**Rule:** when fixing a painter/dispatcher, read it to the bottom and
enumerate every `return`. Then make that enumeration executable — the
`KINDS` table in `stroke-dash.test.ts` is now the registry, with a
comment saying a new early return needs a row. A list in a design doc
cannot fail.

## `?? default` is a claim about which absence you mean

Round 1 made an absent `dash` read as `'solid'` so a row would stay
checked. Round 2 found `value` is *also* `undefined` when there is no
stroke at all — the default for every `filled` insert kind — so a
borderless shape claimed a solid border. Round 3 found a third meaning:
a connector without a stroke is painted anyway, with a 2px default, so
"no border" was false there too.

One `undefined`, three meanings, and the picker's type (`Stroke |
undefined`) cannot tell them apart. The fix was not a cleverer default in
the picker but resolving it in `shape-controls`, which knows the element
type.

**Rule:** before writing `?? something`, list every way the value can be
absent. If more than one, the defaulting belongs where the cases are
distinguishable — usually further up, where the type is still known.

## A passing assertion is not a tested one

Three assertions on this branch passed while testing nothing:

- `every(...)` over recorded calls — vacuously true when there were none,
  so it passed on the unfixed renderer it was meant to guard.
- `Number(getAttribute(...)) <= 3` — a missing attribute is `0`.
- `toMatch(/size-/)` on `querySelector('svg')` — reached the row's *check
  icon*, whose class is `size-4`: the exact class the assertion existed
  to rule out.

The last is the instructive one. It was not loose matching alone; it was
loose matching against an element I never confirmed was the right one.

**Rule:** run every new test against the unfixed code and watch it fail.
`git stash push <source files>` scopes that to seconds. Then prefer exact
values over bounds or patterns, and identify elements by something
structural (here: the preview's own `<line>` → `ownerSVGElement`) rather
than by "the first one of this tag".

## Reviews compound when each round is told what the last found

Three rounds each found something real, and none repeated. That was not
luck: each reviewer was handed the previous rounds' findings as
already-fixed, plus the specific claims they had already verified, and
pointed at angles nobody had examined. Round 3's finding lived in a file
the diff never touched — reachable only by asking "who else reaches this
component".

Two of the three rounds found a defect **introduced by the previous
round's fix**. A fix is new code and deserves the same scrutiny as the
original; a round that only re-reviews the original diff will miss it.

## Fixed-px patterns in a scaled coordinate space

`dashArray()` returns px, but OOXML defines dashes as multiples of the
line width, and slides render through a fit-scale ctm. So a thick dotted
border reads as a solid bar, and a dotted border in a 160px thumbnail
antialiases toward a continuous line. `DASH_PREVIEW_MAX_WEIGHT` in the
picker is a workaround for the first symptom.

Worth naming as a known gap rather than leaving for a bug report: the
workaround is the tell that the model is wrong, and writing that down is
what makes the follow-up findable.
