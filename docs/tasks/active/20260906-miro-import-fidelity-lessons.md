# Miro import fidelity — lessons

## Hand-written fixtures encode the same assumption as the code

Every defect on this branch had a passing test sitting next to it. The fixtures
were written from the same mental model as the mapper, so they asserted the
model rather than reality:

| Fixture said | API sends | Cost |
| --- | --- | --- |
| `borderWidth: 3` | `"2.0"` | 4,383 shapes lost their outline |
| `fillColor` with no `fillOpacity` | `fillOpacity: "0.0"` on 81% of items | 3,433 shapes became opaque white boxes |
| text with `geometry.height` | text never has one | 3,821 items ~50px out of place |
| `style` always present | 513 items have none | 51 shapes invented a white fill |

A test written from the implementation's assumptions cannot fail on that
assumption being wrong. **For any external API, keep at least one fixture
copied verbatim from a real response** — `packages/board/src/import/miro/real-payload.test.ts`
is that fixture here, and its docstring says not to tidy it.

## Measure the real payload before believing a symptom report

"Some shapes don't show up" was consistent with a dozen hypotheses. Pulling the
actual board (8,888 items / 1,994 connectors) and replaying it through
`mapMiroItems` turned every one into a number, which is what made it possible
to rank the fixes and to write commit messages that say *why*. It also killed
two plausible-sounding "bugs":

- **Free-ended connectors (915, 46%) are not a defect.** Those ends carry no
  coordinate anywhere in the payload; refusing to invent one is correct. What
  was wrong was only that they shared a counter with a different failure.
- **Frame titles must NOT be escaped.** Miro sends them already escaped
  (`Creating Document &amp; Auth Webhook`, 35 of 145 on the board), so routing
  them through the HTML parser is what *decodes* them. "Escape it like the card
  branch does" would have printed a literal `&amp;` on the canvas.

Both are pinned by tests now, because both look like bugs to the next reader.

## An asymmetry that looks like a bug may be load-bearing

The two connector ends read their stroke cap through visibly different
expressions — the start required a defined value, the end did not. That reads
as a copy-paste slip, and "fixing" it into symmetry would have silently removed
the arrowhead from every default connector, since Miro's own defaults are
`none` at the start and `stealth` at the end. **When two branches differ and
the difference is not explained, find out whether the difference is the
behaviour before removing it** — then state it as a named constant so the next
reader does not have to.

## Estimates are safer when the error is symmetric

Text height cannot be computed without measuring glyphs, which a pure mapper
has no canvas for, so wrapping is always under-counted. Anchoring the text in
the *middle* of its frame rather than the top turns that unavoidable error from
a one-directional drift into a symmetric spread about the point Miro placed.
The same instinct applies wherever a value must be guessed: prefer the
representation where being wrong is centred rather than accumulating.

## Two counters can hide as one

`skipped` and `approximated` were already split for a good reason (absent vs
degraded). This branch found the same failure one level down: two very
different connector drops, sharing one key, so a truncated import read as a
Miro problem. **A counter that answers "how many" but not "why" cannot tell the
user what to do next.** The corollary bit on the way out — a key that names a
*reason* rather than a *type* stops composing with wording built for types, and
produced "…their target was not imported skipped" until the review caught it.

## An index into someone else's list is a coupling, not a value

`pickConnectorSite` returned `0 | 1 | 2 | 3` and called them N/E/S/W. That is
true of the *default* connection-site list and of nothing else: an `ellipse`
has eight sites whose index 1 is NW. Every Miro circle — 722 of them — had its
connectors attached to the wrong side and bowed along the wrong outward normal,
and the rect family hid it completely, because there a cardinal and its index
happen to coincide.

The shape of the bug is worth remembering: **a bare index is meaningless
without the list it indexes**, so passing one across a module boundary silently
hard-codes the callee's current shape. The fix was to move up one level of
abstraction — choose a *direction*, resolve it against the real list — and to
import the resolution from the package that owns it rather than reimplementing
it. The local reimplementation had also quietly lost frame rotation, which the
renderer applies and a comment in this repo confidently claimed it did not.

Three review passes ran over this branch. Rounds 1 and 2 each found real
defects *in code the branch had just added*, including one that the first round
introduced. Reviewing once is not the same as reviewing until it is clean.

## Raising a limit is a load test of everything downstream of it

Raising `MAX_ITEMS` from 5,000 to 10,000 changed one constant and no logic, and
it still broke something. The import's terminal `result` line carries the whole
board as a SINGLE NDJSON line, and the reader split its accumulated buffer on
every chunk — quadratic in line length. That was invisible while the line was
capped at ~7.5 MiB and a ~1.3 s main-thread freeze at ~15 MiB, because
quadratic cost grows four times faster than the thing being doubled.

The reader's own comment said its buffer was "bounded in practice by one line",
which was **true and misleading**: it bounded the buffer without bounding the
cost, because nobody had asked how big one line gets. So when raising a limit,
enumerate what is sized *against* it — not just what stores it — and check the
complexity of each, not only the capacity.

## A flaky test is worse than no test, and ratios are not safer than budgets

The first version of the linearity guard compared two timed runs and required
the larger to be under 3x the smaller. That looks more portable than an
absolute budget and is not: both measurements carry scheduling noise, so under
load the *small* run inflates and the bound collapses. It failed on the very
push that introduced it.

The fix was to stop measuring a ratio and start exploiting the margin. One
shape separated the two implementations by ~70x, which is wide enough for a
plain budget — and `Math.min` over three runs makes it robust, because
scheduling noise only ever adds time, so the fastest run is the honest one.
Then verify **both** directions: that it fails against the old implementation,
and that it passes under deliberate CPU contention.

## The verify gate is ~4 minutes; budget for it

`pnpm verify:fast` runs on every commit via the pre-commit hook and takes
around four minutes, so a 17-commit branch spends the best part of an hour in
verification alone. Run the affected package's tests directly while iterating
(`pnpm --filter @wafflebase/board exec vitest --run src/import/miro/`), and use
a generous command timeout for the commit itself — a two-minute default kills
the hook mid-run and leaves nothing committed.
