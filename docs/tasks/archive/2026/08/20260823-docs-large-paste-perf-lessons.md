# Lessons — Docs large-paste freeze

## Phase 0 measurements (2026-08-23)

Throwaway benches (deleted after recording):

- `packages/frontend/tests/paste-perf-spike.test.ts` — parse + CRDT insert
  (vitest/jsdom; the hot code is `JSON.stringify` and Yorkie Tree edits, so
  node and Chromium time it the same)
- `packages/docs/perf-layout-spike.html` + `packages/docs/scripts/perf-layout-spike.mjs`
  — `computeLayout` in real Chromium (canvas `measureText` needs a browser)

### ① Parse — linear, minor

| paragraphs | `parseHtmlToBlocks` |
| ---------- | ------------------- |
| 100        | 26 ms               |
| 500        | 79 ms               |
| 2000       | 220 ms              |

### ② CRDT insert — super-linear, dominant

200 blocks inserted via `YorkieDocStore.insertBlockAfter`:

| existing doc size | total   | per block |
| ----------------- | ------- | --------- |
| 100 blocks        | 145 ms  | 0.72 ms   |
| 500 blocks        | 240 ms  | 1.20 ms   |
| 2000 blocks       | 838 ms  | 4.19 ms   |

Per-block cost grows with **document** size — the loop is O(N × docSize).

### ③ Where that cost goes

`insertBlockAfter` opens with `this.getDocument()`, which returns
`cloneDocument(this.cachedDoc)` = `JSON.parse(JSON.stringify(doc))` — a deep
clone of the **whole document**, once per inserted block:

| doc size    | 200 × `getDocument()` | share of ② |
| ----------- | --------------------- | ---------- |
| 100 blocks  | 25 ms                 | 17 %       |
| 500 blocks  | 125 ms                | 52 %       |
| 2000 blocks | 529 ms                | **63 %**   |

### ④ Batched ceiling

The same 200 blocks as N `editByPath` calls inside **one** `doc.update()`:

| doc size    | batched | vs per-block |
| ----------- | ------- | ------------ |
| 100 blocks  | 15 ms   | 9.8×         |
| 500 blocks  | 51 ms   | 4.7×         |
| 2000 blocks | 165 ms  | 5.1×         |

### ⑤ Realistic case — 1000-block paste into a 1000-block doc

| stage                     | time    |
| ------------------------- | ------- |
| parse                     | 163 ms  |
| insert (current)          | 3037 ms |
| insert (batched)          | 470 ms  |

### ⑥ Layout is NOT the problem

`computeLayout` in Chromium, cold (no measure cache, no layout cache — what
`invalidateLayout()` forces):

| blocks | cold   | warm   | incremental |
| ------ | ------ | ------ | ----------- |
| 1000   | 20 ms  | 15 ms  | 0.3 ms      |
| 2000   | 38 ms  | 27 ms  | 1.1 ms      |
| 4000   | 77 ms  | 57 ms  | 2.2 ms      |

Linear and cheap. The full relayout a paste triggers costs tens of ms, not
seconds — do **not** spend effort on incremental layout for this task.

### ⑦ Post-fix scaling (paste of N blocks into an N-block doc)

| N    | parse   | insert  | total   |
| ---- | ------- | ------- | ------- |
| 500  | 82 ms   | 37 ms   | 119 ms  |
| 1000 | 108 ms  | 85 ms   | 192 ms  |
| 2000 | 207 ms  | 187 ms  | 394 ms  |
| 4000 | 762 ms  | 712 ms  | 1473 ms |
| 8000 | 1719 ms | 2102 ms | 3821 ms |

`editBulkByPath` (one tree operation for N nodes) beat the estimate badly:
the projected fix was N `editByPath` calls inside one `doc.update()` at
~470 ms, the real one is **61 ms** — 51× faster than the 3119 ms it replaced.

Two consequences for the busy indicator: nothing under ~4000 blocks needs one
at all, and **parse is now the larger half**, which is why the threshold ended
up measured in clipboard characters (available before parsing) rather than
blocks (available only after it).

### ⑧ `yieldToPaint()` does not get a frame on screen

Measured in Chromium (vite + playwright, counting rAF callbacks between
showing an element and the blocking work):

| waiter                  | frames rendered before the block |
| ----------------------- | -------------------------------- |
| `yieldToPaint()`        | 0, 0, 0, 0, 0                    |
| `yieldToPaintedFrame()` | 1, 1, 1, 1, 1                    |

A `MessageChannel` macrotask drains the task queue but is not a rendering
opportunity, so the indicator would have painted **never** — the feature
would have shipped as a no-op that nobody could see in a unit test. rAF
(fires as part of the rendering steps) plus a macrotask scheduled from inside
it lands reliably after the frame is committed.

This does not make the existing export use of `yieldToPaint()` wrong: in a
loop, a missed rendering opportunity just lands on the next iteration. It is
only fatal before a *single* long block.

## Conclusions

1. The freeze is ~90 % the per-block CRDT insert loop, and ~2/3 of *that* is a
   full-document deep clone repeated once per block. Batching is the fix;
   a progress bar would have papered over a quadratic.
2. `DocStore.snapshot()` is a no-op because Yorkie counts one `doc.update()`
   as one undo unit — so a 1000-block paste was **1000 undo steps** and
   **1000 CRDT changes on the wire**. Batching makes both *constant*
   (measured: 4 undo units for any multi-block paste), not 1 — the
   surrounding split / head-rewrite / tail-rewrite remain separate writes,
   and collapsing them would need a `DocStore` transaction primitive that
   does not exist.
3. Measure before designing UI for slowness. The progress-bar idea was
   reasonable, but the numbers moved the work from "report the wait" to
   "delete the wait": a 1000-block paste went from 3.2 s to ~0.2 s, leaving
   an indicator worth showing only past ~4000 blocks.

## Rules for next time

- When a store method starts with a read that clones whole state, check
  whether callers run it in a loop. `getDocument()` returning a defensive deep
  clone is safe per call and quadratic per loop.
- Time each stage separately before choosing a remedy. Here the intuitive
  culprit (layout/render) was 1 % of the cost.
- Browser-only behavior needs a real browser; vite `createServer` +
  playwright over a scratch HTML page is a cheap harness. It was worth it
  twice here — once for layout cost, once to catch that `yieldToPaint()`
  never renders a frame. Neither jsdom test could have caught the second: the
  unit tests passed against an indicator the user would never have seen.
- Re-measure after the fix before designing the UI that depends on it. The
  Phase 2 threshold, its unit (characters, not blocks), and where the gate
  sits in the pipeline all changed once the write got 51× faster.
- Say what you measured, not the tidy version of it. "One undo unit" was
  true of `insertBlocksAfter` and got restated as a property of the whole
  paste in three comments, where it was wrong (it is 4) — and the
  indeterminate-indicator argument was then built on that wrong claim. The
  real number was one test away the whole time; it is now pinned by
  `editor-undo-selection.test.ts`.
- `requestAnimationFrame` is paused, not throttled, in a backgrounded tab.
  Anything that awaits a frame before doing work needs a timeout fallback,
  or backgrounding the tab stalls the work indefinitely.
- When a test passes both with and without the fix, it is not a test of the
  fix. Mutation-check anything subtle: reverting `yieldToPaintedFrame` to
  `yieldToPaint` left every original test green.
- A *new frontend test file* that mounts the docs editor costs the suite a
  whole extra `@wafflebase/docs` module graph, transformed in parallel with
  everything else. That was enough to time out the unrelated 5 s
  "TextEditSection module imports without error" smoke test — reliably, and
  only with the new file present. Reducing the work *inside* the test did
  nothing; folding it into `editor-undo-selection.test.ts`, which already
  imports the same modules, fixed it. Before blaming a known-flaky test,
  check whether your change is what tipped it: bisect by removing your file,
  not by re-running.
