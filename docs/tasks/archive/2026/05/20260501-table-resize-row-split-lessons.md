---
title: Lessons — table resize handle missing on split-continuation page
date: 2026-05-01
---

# Lessons

## Renderer/resolver coordinate formulas must share a helper

The bug was a duplicated formula. `DocCanvas` had:

```ts
const tableOriginY = pageY + pl.y - rowYOffsets[pl.lineIndex] - splitOffset;
```

while `TextEditor.resolveTableFromMouse` had:

```ts
const tableOriginY = bandTop - tl.rowYOffsets[firstPl.lineIndex];
```

Both names match (`tableOriginY`) but the resolver silently dropped the
`- splitOffset` term. As long as a row never split across pages the
two formulas agreed, so the divergence stayed invisible until split
rows shipped (#170 area). The lesson: **whenever two paths must land on
the same screen pixel — renderer and hit-test, in this case — extract
the math into a single named helper and call it from both sides.**

## Symptom asymmetry is a strong locator

User reported: column resize works, row resize does not. The shared
codepath is `detectTableBorder`, which uses `localX` for column hits
and `localY` for row hits. An asymmetry between two sibling code
branches that share most of their input is almost always a hint that
ONE of the inputs is wrong. Tracing back from `localY` led directly to
`tableOriginY` and the missing offset. **When two parallel features
share a function and only one breaks, suspect the input that only that
branch uses.**

## Treat hit-area "tightness" as a separate concern

While fixing `tableOriginY`, I also tightened `bandBottom` to use
`rowSplitHeight` instead of the full `line.height`. This wasn't the
root cause of the reported bug, but it was a latent issue in the same
function: a split fragment ending at a page break would have its hit
area extend beyond the page break into empty space. Fixing it in the
same change avoids leaving a known-stale calculation behind.
