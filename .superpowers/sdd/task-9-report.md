# Task 9 Report: Group + Element Dispatch

## Files

- **Created:** `packages/slides/src/export/pptx/group.ts`
- **Created:** `packages/slides/test/export/pptx/group.test.ts`

## Test Command + Output

```
pnpm --filter @wafflebase/slides exec vitest run test/export/pptx/group.test.ts
```

```
 RUN  v4.1.8 /Users/hackerwins/Development/wafflebase/wafflebase/packages/slides

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  08:48:28
   Duration  154ms (transform 56ms, setup 0ms, import 70ms, tests 2ms, environment 0ms)
```

## chOff / chExt Details

Confirmed against `src/import/pptx/group.ts` (`composeGroupTransform`) and
`src/import/pptx/shape.ts` (`parseGrpSp`):

- The importer stores child frames in **group-local coordinates** by subtracting
  the AABB origin `(ox, oy)` from every world-frame child (`worldToGroupLocal`).
- It stores `refSize = { w: aabb.w, h: aabb.h }` on the `GroupElement`.
- It reconstructs the world scale as `localSx = frame.w / chExtW` and
  `localSy = frame.h / chExtH` (from `composeGroupTransform`).

**Export convention:**
- `<a:off>` = `frame.{x, y}` — group position in parent space.
- `<a:ext>` = `frame.{w, h}` — group size in parent space (may differ from
  refSize after a resize).
- `<a:chOff>` = `(0, 0)` — our model always uses origin-anchored local space.
- `<a:chExt>` = `refSize ?? frame.{w, h}` — the denominator for the
  local-to-world scale. On re-import `scale = ext / chExt = frame.{w,h} / refSize`,
  which is the correct proportional scale for the children.

This is the exact inverse of what the importer writes on export.

## Group Effects: Inverse Details

The importer explicitly does NOT read `<p:grpSpPr><a:effectLst>` (see
`src/import/pptx/shape.ts` lines 197-200):

> "No group-level effects import: the renderer paints drop shadow /
> reflection on single-silhouette leaves only (shape / image / text),
> and the Format panel doesn't expose group effects — importing
> `<p:grpSpPr><a:effectLst>` would be unrenderable, uneditable dead data."

Therefore `GroupElement.data.effects` is **never populated by PPTX import**
(it only exists if set programmatically in the editor). Exporting it would
produce XML that re-imports as a group with no effects — a round-trip loss.

Per the task requirement "export only what it reads," `groupToXml` does
**not** emit `<a:effectLst>` on `<p:grpSpPr>`.

## Concerns

None. The implementation is straightforward — it directly inverts the import
path. The round-trip fixture in Task 14 will be the definitive gate.
