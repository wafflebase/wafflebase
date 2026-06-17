# Slides color picker — fix custom-input close + per-document recent colors

## Problem

All slides color controls share `ThemedColorPicker`. Two issues:

1. Picking a Custom color closes the palette instantly — every call site
   runs `setOpen(false)` on *every* `onChange`, and the native
   `<input type="color">` fires `change` continuously while dragging /
   typing RGB. The first event closes the Radix dropdown behind the OS dialog.
2. No recent-colors feature.

Fix: distinguish **commit** (swatch click) from **live** (custom input)
interactions. Commit → close + record recent. Live → stay open. Recent colors
persist per-document via Yorkie (`meta.recentColors`).

## Tasks

- [ ] Model: `Meta.recentColors?: string[]`, `MAX_RECENT_COLORS`, `pushRecent()` helper in `presentation.ts`
- [ ] Store interface: `pushRecentColor(hex)` in `store.ts`
- [ ] MemStore impl (`memory.ts`)
- [ ] YorkieStore impl (`yorkie-slides-store.ts`)
- [ ] `ThemedColorPicker`: `onChange(color, opts?: {commit})`, `recentColors` prop + Recent row, custom-input live + blur commit
- [ ] Call sites (commit-gated close + recent push + recentColors prop):
      shape-controls, text-element-controls, global-controls, table-controls(×2),
      border-picker, text-edit-section
- [ ] Unit tests: `pushRecent` dedupe/cap/MRU; MemStore `pushRecentColor` persistence
- [ ] `pnpm verify:fast` green
- [ ] Self code review over branch diff
- [ ] Manual smoke in `pnpm dev`

## Review

- All slides color controls share `ThemedColorPicker`; the in-text font-color
  control uses `TextFormatGroup` → `ColorPickerGrid` (no native input, no close
  bug, shared with Docs) and is intentionally untouched. Actual ThemedColorPicker
  sites: shape-controls, text-element-controls, global-controls, table-controls,
  border-picker (5 files; "No fill" reset left as-is).
- `onChange` gained `{ commit?, record? }`: swatch = commit+record (close +
  record), custom drag = neither (live, stays open), custom blur = record only.
  Decoupling record from commit avoids the blur-before-click race.
- Self-review caught a real bug: custom `onBlur` re-applied the input value
  unconditionally, so cancelling the OS dialog over a role fill clobbered it to
  `#000000`. Fixed with a `customDirty` ref armed on focus / set on live change.
- `recentColors` persisted on `Meta` (Yorkie), preserved through
  `migrateDocument` like `unit`/`pxPerPt`. `pushRecent` owns dedupe/cap/lowercase.
- Verified: slides 1803 passed, frontend tsc clean, `pnpm verify:fast` exit 0.
- Code review (2 parallel agents over the branch diff): no correctness bugs.
  Applied two non-blocking improvements they surfaced: slide-background picker
  now passes the real `value` so a recent/standard swatch shows as selected;
  `migrateDocument` re-enforces dedupe/cap/lowercase on read (defends against
  externally-authored decks). Added migrate tests for both.
