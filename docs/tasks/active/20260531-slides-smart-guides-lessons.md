# Lessons — Slides Smart Guides

## Surprises during implementation

### 1. Priority tier between equal-spacing and equal-distance was spec'd backward

The original spec ranked `equal-spacing > equal-distance` ("3-element pattern is stronger than pair pattern"). But the second equal-distance test placed the dragged element at `x=372` between B at `x=200..280` and C at `x=500..600` — which incidentally formed a *middle trio* `B-dragged-C` with adjust `-7`. Under the spec priority, equal-spacing wins (adjust `-7`); the test expected equal-distance (adjust `-2`).

We dropped the priority tier entirely. **Smallest `|adjust|` wins across both kinds, per axis, independently.** This is also closer to PowerPoint's observable behaviour (a precise snap shouldn't lose to a coarse one just because it's a different "kind").

**Generalised lesson:** When you write a priority rule, construct a test where two candidates compete on the *exact* same input. If your test setup ever produces a "coincidental" match in a higher-priority bucket, your priority rule is wrong — either the rule, or the priority concept itself.

### 2. Workspace `dist/` types were stale on first `verify:fast`

Pre-existing `Block.marker` TypeScript errors in `packages/slides/test` blocked the very first `pnpm verify:fast` of this branch — before I had touched any source. The cause: tests import `Block` from `@wafflebase/docs`, which resolves to `packages/docs/dist/types.d.ts`, and the workspace `dist` was out of date (didn't have the recently-added `marker` field).

Fix: `pnpm --filter @wafflebase/docs build`. Captured as the existing memory `feedback_workspace_dist_resolution` — but worth re-emphasising: **if `verify:fast` fails on something you didn't touch, rebuild workspace packages before assuming regression.**

### 3. Subagent implementers strip "useless" scaffolding

The Task 1 plan included a `const f = (x, y, w, h): Frame => ({...})` helper in the new test file, intended for re-use across Tasks 2–5. The Task 1 test didn't *call* `f` directly. The first implementer (haiku) silently dropped both `f` and the `Frame` import as unused — TypeScript-correct but it broke the plan's scaffolding-for-later-tasks intent.

**Plan-author lesson:** Don't include scaffolding lines that "look unused" in a step's spec. Either inline them in the step that first uses them, OR add an explicit instruction `// keep these — Task N+ uses them` next to the unused symbols. We worked around with `void f;` per existing project pattern (mirrors `void bbox;` in source).

### 4. Spec's `Span` type needed to be exported from `smart-guides.ts`

The overlay rendering in Task 6 took `Span[]` directly in its helper signature. That meant the public surface of `smart-guides.ts` had to include `Span` along with `SmartGuide`. Easy to miss when writing the plan — flag the public-API surface upfront, not just the user-facing entry points.

## Cut from v1 (track for follow-up)

These were in the design doc but deliberately not implemented:

- **Integration tests in `editor.test.ts`** asserting that a 3-shape drag commits balanced `frame.x` via the store. Unit tests on `smartGuides()` directly already cover the algorithm; the integration test would only verify the wiring, which `pnpm dev` smoke can confirm cheaply.
- **Visual screenshot diffs** in `pnpm verify:browser:docker`. Skipped because the project's visual lane requires a separate fixture setup; not worth blocking v1.
- **N > 30 viewport culling.** The design's perf table promised it but the implementation does not cull. At typical N (5–20) the O(N²) trio loops are well within a 60 fps budget. Revisit when a real PPTX import lands a 40+ element slide and we see jank during drag.
- **Rotated-resize equal-size matching.** Excluded from v1 — rotated handles have ambiguous "same width" semantics.
- **Mobile.** v1 ships off for `MobileSlidesView` light edit; threshold and overlay tuning need separate work.

## Stylistic debt (minor, follow-up cleanup)

- `bestX as Cand` / `bestY as Cand` redundant casts in `smart-guides.ts` (TS narrows correctly after the truthy check). Kept because earlier closure-capture made TS lose the narrowing; verify and drop later.
- `void f` in `smart-guides.test.ts` to silence the unused-helper warning. Either start using `f` in tests or drop both the helper and the void.
- The Y-axis end-trio loop in `smart-guides.ts` lacks the "Case 1 / Case 2" header comments the X-axis loop has. Add for symmetry if touching this region.

## Reversed during PR review

- The earlier choice to let smart-guide arrows show on Shift-locked axes was reverted on CodeRabbit's nudge — showing guides for movement that won't commit is confusing, not informative. Added a `.filter()` in the drag `onMove` handler that drops guides whose axis is zeroed-out by `lockAxis`. The `equal-size` kind is excluded from this path (resize only), so no special-casing needed.

## Subagent-driven development notes

- 8 implementer dispatches + 8 reviewer dispatches over Tasks 1–8 (plus the priority-fix amendment + the corner-handle test addition). Haiku for skeleton/reviews, Sonnet for the multi-loop detection tasks. Roughly 2× wall-clock time vs inline, but main context stayed clean and each commit had verifiable test output.
- **Combined spec + quality review prompts worked well** after Task 2 — saved one round-trip per task while still catching the Task 4 priority bug. The trick is naming the failure mode upfront ("stop and report spec gaps before assessing quality").
- **`git commit --amend` over a per-task SHA** is the right tool for spec-fix corrections (used twice). Avoid creating a "fix-up" commit per task — bloats history and complicates review.
