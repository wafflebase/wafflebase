# Slides — morphing mobile toolbar (Phase B-1, partial)

## Problem

Phase B-0 (`20260519-slides-mobile-shell-todo.md`) wired the
SidebarProvider + SiteHeader + SlidesToolbar shell on mobile, but the
mobile toolbar itself is static and minimal:

```
[↶] [↷] │ [+] │ ............... [⋮]
                                  ├─ Add slide
                                  └─ Theme… (stub)
```

Compared to the desktop morphing toolbar (`packages/frontend/src/app/slides/toolbar/index.tsx`), mobile is missing:

- Insert entry — text box / image / shape / line cannot be added on mobile.
- Object contextual controls (Fill / Border / Replace / Font).
- Arrange (z-order, alignment, group, duplicate, delete).
- Text-edit inline formatting (B / I / U / size / color / lists / align).
- Slide background fill.
- Theme panel wiring.

The desktop toolbar already morphs across `idle` / `object` / `text-edit`
via `getToolbarState(editor, store)`. The same state machine drives the
mobile morph — only the renderer differs.

## Goal

Promote `MobileSlidesToolbar` from static to morphing:

```
Idle:        [↶] [↷] │ [+] │ [➕Insert] ............... [⋮]
                                  └─ bottom sheet: Text / Image / Shape / Line

Shape/Conn:  [↶] [↷] │ [+] │ [🎨Format] [≡Arrange] ............... [⋮]
                                  ├─ Format sheet: Fill / Border / Width / Style
                                  └─ Arrange dropdown: align / order / group / dup / del

Image:       [↶] [↷] │ [+] │ [🖼️Image]   [≡Arrange] ............... [⋮]
                                  ├─ Image sheet: Replace / Reset crop / Alt
                                  └─ Arrange dropdown (same)

Text elem:   [↶] [↷] │ [+] │ [🎨Format] [≡Arrange] ............... [⋮]
                                  └─ Format sheet: Fill / Border / Font / Size

Text-edit:   [↶] [↷] │ [B] [I] [U] │ [Aa Format] ............... [✓Done]
                                              └─ bottom sheet: TextStyleGroup +
                                                 TextFormatGroup + TextParagraphGroup
                                                 vertical/wrapped layout
```

Overflow `⋮` (always available):

- Theme… (opens ThemePanel as bottom sheet)
- Background fill… (opens ThemedColorPicker sheet)
- Slide thumbnails… (placeholder for future)

## Non-Goals

- Per-shape adjustment drag-diamonds on mobile (Phase C).
- Connector endpoint re-routing on touch (Phase C).
- Mobile-specific keyboard shortcuts.
- Persisting bottom-sheet position / size.
- Long-press selection / multi-select (Phase B-2).

## Plan

### 1. State plumbing — extract once, render twice

`packages/frontend/src/app/slides/toolbar/index.tsx`:

- Hoist the existing `useState<ToolbarState>` + `useEffect` subscription
  out of the desktop branch so the morph state is available to both
  renderers. Currently the state is computed before the `isMobile`
  branch but only consumed by desktop.
- Pass `state` (and `editor`, `store`, `theme`, `upload`, `onImagePick`,
  `onToggleThemePanel`) down to a new
  `MobileSlidesToolbar`.

### 2. `MobileSlidesToolbar` — morphing renderer

New file: `packages/frontend/src/app/slides/toolbar/mobile-toolbar.tsx`

- One component, three render branches keyed on `state.kind`.
- Bottom sheets use `@/components/ui/sheet` with `side="bottom"`. Each
  sheet has open/close state local to the toolbar. Closing on any
  action that switches selection state (e.g. tapping Delete also closes
  the Arrange dropdown) — handled by the sheet itself via the existing
  `<SheetClose asChild>`.
- Reuse existing controls verbatim where possible:
  - Idle Insert sheet — buttons that call `editor.setInsertMode(...)`,
    `ShapePicker` / `LinePicker` inlined into the sheet (their existing
    DropdownMenu trigger stays, just rendered inside the sheet).
  - Object Format sheet — reuse `ShapeControls` / `ImageControls` /
    `TextElementControls` directly. They are horizontal rows of
    buttons today; flex-wrap inside the sheet handles the layout.
  - Object Arrange dropdown — reuse `ArrangeMenu` as-is (already a
    DropdownMenu).
  - Text-edit Format sheet — reuse `TextStyleGroup`, `TextFormatGroup`,
    `TextParagraphGroup` stacked vertically.
- Inline B/I/U in text-edit mode: bind directly to
  `state.textEditor.applyStyle({ bold/italic/underline })` and read
  pressed state via `state.textEditor.getSelectionStyle()`.

### 3. `+ Slide` label — drop "Slide" text

`packages/frontend/src/app/slides/toolbar/slide-group.tsx`:

- Strip `<span className="text-xs">Slide</span>` and the gap-1 so the
  primary button is icon-only (`[+]`). The chevron next to it stays
  for the layout picker. Affects both desktop and mobile — matches
  Google Slides desktop, frees ~30px on mobile.

### 4. Wire overflow items

`packages/frontend/src/app/slides/slides-detail.tsx`:

- Add `themePanelOpen` state to `MobileSlidesLayout` (mirrors
  `DesktopSlidesLayout`).
- Pass `onToggleThemePanel` to `SlidesToolbar`.
- Mount `ThemePanel` for mobile as a bottom sheet rather than the
  desktop side panel (the panel itself is unaware of its host — we
  wrap it in a `Sheet` from `MobileSlidesLayout`).
- Background fill overflow item triggers a sheet hosting
  `ThemedColorPicker` bound to `store.updateSlideBackground`.

### 5. Verification

- `pnpm verify:fast` green.
- Manual smoke in `pnpm dev` with Chromium mobile emulation:
  - Idle: tap `+ Insert` → sheet opens. Tap Text → sheet closes, insert
    mode = text. Same for Image / Shape (via picker) / Line.
  - Tap a shape → toolbar morphs. Tap `🎨 Format` → Fill / Border
    visible. Tap `≡ Arrange` → align / order / group / delete.
  - Double-tap a text box → toolbar morphs to text-edit. B/I/U toggle
    pressed-state with selection. Tap `Aa Format` → font size / color
    / list visible. Tap `Done` → exits text editing, morph back to
    object state.
  - Overflow `⋮` → Theme item opens ThemePanel in bottom sheet.
  - Desktop unchanged after refactor.

## Out of Scope (for B-2 / C)

- Slide-ops FAB (`+` / duplicate / delete on canvas).
- Long-press multi-select.
- Mobile drag-handle haptic feedback.
- Adjustment diamonds on parametric shapes.

## Risks

- Reusing horizontal desktop control rows inside a bottom sheet may
  produce cramped layouts at < 360px. Mitigation: each control row is
  wrapped in `flex flex-wrap gap-2`; if any specific row visibly
  overflows on test, swap in a vertical stack.
- `ShapePicker` / `LinePicker` use absolute-positioned popovers
  internally — when rendered inside a Sheet (which is itself a
  portal), the popover may be clipped by the sheet content. If so,
  wrap them in a `Portal` or inline the picker grid directly.
- Hoisting state into the parent `SlidesToolbar` touches the desktop
  path. Mitigation: keep behavior byte-identical (use the same
  variables, just pass them to a different child).
