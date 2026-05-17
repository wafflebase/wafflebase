# Slides Mobile Light Edit (Phase B) — Lessons

Companion to
[`20260517-slides-mobile-edit-todo.md`](./20260517-slides-mobile-edit-todo.md).
Capture anything surprising encountered during the spike and the
four implementation PRs — touch-event quirks on iOS/Android, IME
edge cases, editor-internal coupling that didn't show in the
read-only path, store-API ergonomics for mobile, Playwright
snapshot rebaselines, etc.

## Decisions from brainstorming

- **Reuse the desktop `SlidesEditor` whole, do not fork.** The
  editor's programmatic surface (`enterTextEditing`,
  `setSelection`, `getActiveTextEditor`, `store.*`) is already
  what touch needs. The mobile-specific work is in the UI shell
  (bottom-sheet, FAB, undo/redo header) and the touch-vs-mouse
  gap-fillers (hit tolerance, `touch-action`, IME handling).
  Forking would double maintenance for no clear UX win.
- **`SlidesStore` is the only mutation API.** Mobile components
  never call `doc.update` directly. This keeps Yorkie sync,
  undo/redo, and persistence inherited from desktop with zero
  new mutation surface.
- **Read-only is preserved via `mode: 'view'` prop.** Phase A's
  `SlideRenderer` path is kept for shared-link viewers; default
  `mode='edit'`. Permission wiring lands in Task 4.
- **Spike (Task 0) is the gate.** If `> 5` editor-internal
  changes are needed to make touch work, stop and revisit option
  (A) — a standalone mobile editor over `SlidesStore` +
  reused `hit-test`/`selection`/`text-box-editor` modules. The
  spike is intentionally throwaway — no PR.

## Spike interaction matrix (iOS Simulator, iPhone 16 Pro)

Driven by user interactively on the booted sim while the spike branch
was checked out. Android Chrome not yet covered; deferred to a real
device pass during Task 1b once the Pointer Events migration lands.

| Interaction | iOS sim | Notes / fix |
|---|---|---|
| Tap element → select | ✅ works | iOS synthesizes `mousedown→mouseup→click` from a tap, so the editor's single-event selection path fires. |
| Drag element → move | ❌ blocked | iOS does NOT synthesize `mousemove` during a touch drag. The editor's drag handlers (`document.addEventListener('mousemove', ...)`) never fire. **Fix: migrate `editor.ts` + sibling files to Pointer Events.** ~35 listener strings in `editor.ts` alone, +3 sibling files (`thumbnail-panel.ts`, `context-menu.ts`, `layout-picker.ts`). Mechanical rename — `PointerEvent extends MouseEvent`, no state-machine change. |
| Double-tap text → enter text edit | ✅ works | `dblclick` is synthesized from a double-tap; `enterTextEditing` mounts the docs text-box. |
| Tap blank canvas → clear selection | ✅ works | Same path as tap-select; the editor's "tap on empty world" branch fires. |
| Long-press → context menu suppressed | ❌ blocked | iOS callout (text/image preview) is NOT a `contextmenu` event — `onContextMenu={(e) => e.preventDefault()}` is a no-op against it. **Fix: CSS on canvas-host: `-webkit-touch-callout: none; user-select: none;`.** Tiny patch in `MobileSlidesView`. |
| Drag corner handle → resize | ❓ untested in sim | Inherits the drag fix. Re-check after Pointer Events migration. |
| Drag rotate handle → rotate | ❓ untested in sim | Same — re-check after migration. |
| Type with virtual keyboard (Korean IME) | ❓ needs real device | Sim keyboard uses Mac IME, not iOS IME. Defer to physical iPhone smoke. |
| Pinch on canvas (should NOT zoom page) | ❓ needs real device | Sim pinch is Cmd+drag, unreliable. `touch-action: none` is in place; verify on hardware. |

## Gate decision

**Result:** gate-pass with caveat — Option (B) selected.

**Strict gate:** ≤ 5 editor-internal changes < 20 LoC each. The
Pointer Events migration is ~38 listener strings across 4 files
(`editor.ts`, `thumbnail-panel.ts`, `context-menu.ts`, `layout-picker.ts`).
Strict line-count breach.

**Gate spirit:** "any change invasive (touches editor.ts's state
machine)" — NOT breached. Pointer Events are a strict superset of
Mouse Events; PointerEvent inherits from MouseEvent at the TS level;
the rename is purely the event-type string. The state machine,
hit-test, drag-commit, render pipeline are unchanged.

**Alternative considered: option (A)** — standalone mobile editor
over `SlidesStore` + reused `hit-test`/`selection`/`text-box-editor`.
Rejected because the mobile-only code path would be larger and more
maintenance-heavy than the mechanical Pointer Events rename, which
desktop benefits from too (pen tablet / stylus support comes for
free).

**Selected path: option (B)** — split Task 1 into:
- **PR 1a (Pointer Events migration):** slides package only.
  Mechanical rename, smoke desktop unchanged. Lands first.
- **PR 1b (Mount SlidesEditor on mobile):** original Task 1 work
  with the `mode='edit'` branch in `MobileSlidesView`, hit-test
  tolerance, and the `-webkit-touch-callout` CSS. Lands on top of 1a.

The Phase B todo (`20260517-slides-mobile-edit-todo.md`) has been
updated to reflect this split.

## Spike-only artifacts (cleaned up at the end of Task 0)

- `packages/frontend/public/_spike-login.html` — one-shot cookie
  installer that bypassed GitHub OAuth in the sim. Tokens were passed
  via URL hash and never hit server logs. Deleted with the spike branch.
- `mobile-slides-view.tsx` SlidesEditor mount changes — discarded
  with the spike branch (the real version lands in PR 1b).

## Observations during implementation

_Filled per PR. Format: `**Where:**`, `**What:**`, `**Why surprising:**`,
`**Resolution:**`._
