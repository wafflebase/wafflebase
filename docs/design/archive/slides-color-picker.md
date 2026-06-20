---
title: slides-color-picker
target-version: 0.4.6
---

# Slides Color Picker — commit/record model + recent colors

## Summary

Every slides color control (Shape fill, Text-box background, Stroke / border,
Table cell fill, Slide background) shares one component,
`ThemedColorPicker` (`packages/frontend/src/app/slides/themed-color-picker.tsx`),
with three sections: **Theme** role swatches, **Standard** hex swatches, and a
**Custom** native `<input type="color">`.

Two problems are addressed:

1. **Custom picks closed the palette instantly.** Each call site ran
   `setOpen(false)` on *every* `onChange`. The native `<input type="color">`
   maps to React `onChange` on the DOM `input` event, so it fires
   continuously while the user drags the color wheel or types an RGB value.
   The first event closed the Radix dropdown behind the OS dialog.
2. **No recent colors.** Users had no quick way back to a color they just used.

## Goals

- Custom color drags / RGB typing apply live without closing the palette;
  it closes only on a discrete swatch pick or an outside click.
- A **Recent** row (max 8, most-recent-first) surfaces recently used colors,
  shared across all slides color controls and persisted **per document**.

### Non-Goals

- Unifying with the Docs text-color UI (`ColorPickerGrid`). Slides needs theme
  role swatches that Docs does not; the two palettes stay separate. The slides
  in-text font-color control (`TextFormatGroup` → `ColorPickerGrid`) is
  unaffected — it has no native input, so no close bug, and recents there would
  require a Docs-shared store that does not exist.

## Proposal Details

### Commit vs record — two independent flags

`ThemedColorPicker.onChange` carries two optional flags so call sites can react
correctly to each interaction:

```ts
onChange(color: ThemeColor, opts?: { commit?: boolean; record?: boolean }): void;
```

| Interaction              | flags                       | call-site effect           |
| ------------------------ | --------------------------- | -------------------------- |
| Theme / Standard / Recent swatch click | `commit + record` | apply + record recent + **close** |
| Custom input drag / type (`onChange`)  | _(none)_          | apply live, stay open      |
| Custom input `onBlur` after a real change | `record`       | record recent, **stay open** |

The native input fires `onBlur` whenever focus leaves — including when the OS
dialog is opened and cancelled without a pick. A `customDirty` ref (armed on
`onFocus`, set by the live `onChange`) gates the blur path so a cancelled dialog
can't re-apply the input's default `#000000` over a role/theme fill.

`record` is decoupled from `commit` on purpose: recording on the custom input's
blur must **not** also close the palette, because a blur fired by clicking a
swatch next would unmount that swatch before its click registers (blur-before-
click race). The custom path therefore closes only via outside-click (Radix
default), which is safe.

Only srgb colors are recorded; role colors are theme-relative, so pinning one as
a "recent color" would lose meaning when the theme changes.

### Per-document recent colors (Yorkie)

A new optional field on the presentation `Meta`:

```ts
// packages/slides/src/model/presentation.ts
export type Meta = { /* … */ recentColors?: string[] };
export const MAX_RECENT_COLORS = 8;
export function pushRecent(list: readonly string[], hex: string): string[];
// → [hex, ...without-hex].slice(0, 8), case-insensitive de-dupe, lower-cased
```

Store method (mirrors `setUnit` across the three layers):

```ts
// Store interface + MemSlidesStore + YorkieSlidesStore
pushRecentColor(hex: string): void; // requires an open batch
```

Call sites record inside the same batch as the color apply (one undo unit):

```ts
store.batch(() => {
  /* apply fill/stroke/background to all selected … */
  if (opts?.record && color.kind === 'srgb') store.pushRecentColor(color.value);
});
if (opts?.commit) { /* markSwatchClicked + setOpen(false) */ }
```

`migrateDocument` runs on every Yorkie read, so — like `unit` / `pxPerPt` — it
copies `recentColors` through (string entries only); without that the list would
be dropped on each read. Normalization (dedupe/cap) is owned by `pushRecent` at
write time. Because the field lives in the Yorkie root, recents are shared with
collaborators and persist across reloads/devices.

The Yorkie `pushRecentColor` reads the existing entries **by index**, not via
`yorkieToPlain`: a live CRDT array proxy throws on `toJSON` inside a
`doc.update` mutation context, so the second push would fail and recents would
never accumulate. Index access / `.length` (the same pattern `removeGuide`
uses) is the safe read inside `update`:

```ts
this.doc.update((r) => {
  const arr = r.meta.recentColors; // live CRDT array or undefined
  const existing: string[] = [];
  if (arr) for (let i = 0; i < arr.length; i++) existing.push(String(arr[i]));
  r.meta.recentColors = pushRecent(existing, hex);
});
```

The picker renders a **Recent** row (8-col grid, hidden when empty) above
**Standard**; call sites pass `recentColors={store?.read().meta.recentColors}`.

### Risks and Mitigation

- **Blur-before-click race** — mitigated by never closing on blur (record only);
  swatch clicks own the close.
- **Cancelled OS dialog clobbering a role fill** — mitigated by the `customDirty`
  ref so blur applies/records only after a real live change.
- **Undo churn** — record shares the color-apply batch, so it never lands as a
  standalone undo entry.
- **Recents persisting unknown colors across migrate** — `migrateDocument`
  filters to string entries; `pushRecent` enforces dedupe + cap on every write.
