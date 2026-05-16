---
title: PPTX import — honor `<a:blip><a:alphaModFix>` image opacity
date: 2026-05-17
status: active
---

# PPTX import — honor `<a:blip><a:alphaModFix>` image opacity

## Context

Reported on the "Yorkie, 캐즘 뛰어넘기.pptx" deck (shared URL
`/shared/bec73346-bcd2-4ef3-b8d4-bb78dce375b7`): the first slide's
background image should be visibly dimmed/faded, but it imports at full
opacity. Inspecting `ppt/slides/slide1.xml` shows the original effect:

```xml
<p:blipFill>
  <a:blip r:embed="rId3">
    <a:alphaModFix amt="19000"/>
  </a:blip>
  <a:stretch><a:fillRect/></a:stretch>
</p:blipFill>
```

`amt="19000"` is 19% alpha — there is no Gaussian blur in the source,
just a low-opacity overlay that *reads* as blurred to the eye.

The design doc already promised this mapping
(`docs/design/slides/slides-themes-layouts-import.md` row "`<a:blip>`
`alphaModFix` | applied as image alpha | ⚠️") but the code path is
missing in all three layers:

1. **Model** — `ImageElement.data` has `{ src, crop?, alt? }`. No
   `opacity` field.
2. **Importer** — `packages/slides/src/import/pptx/image.ts` reads
   `r:embed` + `<a:srcRect>` only. `<a:alphaModFix>` is silently
   dropped.
3. **Renderer** — `packages/slides/src/view/canvas/image-renderer.ts`
   draws with no `globalAlpha` adjustment.

## Goal

Round-trip PPTX `<a:alphaModFix>` into a rendered image whose alpha
matches the source within rounding. Scope is strictly opacity — other
blip effects (`lumMod`, `duotone`, real Gaussian `<a:blur>`) stay
out-of-scope and remain in the existing "lossy import" toast.

## Plan

- [ ] **RED** — failing importer test: `<a:alphaModFix amt="19000"/>`
      → `data.opacity ≈ 0.19`. No `alphaModFix` → `opacity` undefined.
      Clamp out-of-range `amt` values.
- [ ] **RED** — failing renderer test: when `data.opacity < 1`, the
      paint path wraps the `drawImage` in `save()` + `globalAlpha *= opacity`
      + `restore()`. When `opacity` is undefined or `1`, no change.
- [ ] Add `opacity?: number` (0..1) to `ImageElement.data` in
      `packages/slides/src/model/element.ts`. Yorkie store passes plain
      `data` literals through, no schema change needed.
- [ ] Importer: parse `<a:blip><a:alphaModFix amt="..."/>`. Divide by
      100,000, clamp to `[0, 1]`. Skip when `amt === 100000` (full
      opacity == default) so the field stays undefined for default
      cases.
- [ ] Renderer: in `drawImage`, when `data.opacity` is set and `< 1`,
      `ctx.save()` → `ctx.globalAlpha *= data.opacity` → paint →
      `ctx.restore()`. Placeholder path stays at full alpha (fallback
      UI is intentionally always-visible).
- [ ] Run `pnpm slides test` to confirm RED → GREEN for both targeted
      tests, then `pnpm verify:fast`.
- [ ] Self-review the diff with `superpowers:requesting-code-review`.
- [ ] Capture lessons in
      `docs/tasks/active/20260517-pptx-image-opacity-lessons.md`.

## Non-goals

- No round-trip to PPTX export (not in scope for any import work
  today).
- No support for `<a:blip>` `lumMod`/`lumOff`/`duotone`/`<a:blur>` —
  those stay dropped, with the existing import-report channel.
- No new editing UI for opacity. The user can't author this directly
  yet; it only appears via import.

## Verification

- `pnpm slides test` covering `image.test.ts` (importer) and
  `image-renderer.test.ts` (renderer).
- Manual: re-import the source PPTX through the CLI / UI, open
  slide 1, confirm the photo renders dimmed.
