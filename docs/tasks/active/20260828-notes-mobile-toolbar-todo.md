# Notes: make the toolbar usable on a phone

## Problem

`packages/frontend/src/app/notes/notes-toolbar.tsx` has no mobile branch
at all — it renders all 19 controls unconditionally:

- undo / redo
- bold / italic / strikethrough
- bullet / numbered / task / indent / outdent
- link / quote / code block / foldout / table / image
- an `ml-auto` group: keymap dropdown, view-mode dropdown

The `Toolbar` root is `overflow-x-auto`, so nothing is clipped — the
strip scrolls horizontally instead. That is the defect: `ml-auto` pushes
the view-mode and keymap dropdowns to the far end of the scroll area, so
on a phone the two controls that decide what the screen even shows are
the two you cannot see without dragging the strip sideways.

Docs already solved this (`docs-formatting-toolbar.tsx:635-800`):
`useIsMobile()` keeps undo/redo + B/I/U inline and moves everything else
into an `IconDotsVertical` dropdown with `DropdownMenuLabel` sections.
Notes never picked the pattern up.

Second, independent defect on the same screen: `viewMode` defaults to
`"both"`, which `packages/notes/src/view/editor.ts:247` lays out as a
fixed `flex: 1 1 50%` split. On a 375px phone that is ~187px per pane.
`viewMode` is a per-user localStorage preference, so anyone who uses
split on the desktop lands in split on their phone.
`shared-document.tsx:343` is worse — a writable share link hardcodes
`"both"` and mounts **no toolbar**, so there is no way out of the split
at all.

## Plan

- [x] `notes-toolbar.tsx`: branch on `useIsMobile()`. Inline on mobile:
      undo / redo / separator / bold / italic / strikethrough /
      separator / `⋮`. Everything else into the `⋮` dropdown under two
      `DropdownMenuLabel` sections:
      - *Lists* — bullet / numbered / task as `DropdownMenuCheckboxItem`
        (checked off `formats.list`), indent / outdent as
        `DropdownMenuItem` with the same `canIndent` / `canOutdent`
        disabling the inline buttons use.
      - *Insert* — Link as a checkbox item (`formats.link`), Quote /
        Code block / Foldout / Image as plain items, and Table as a
        fixed **"Table (3×3)"** item. `TableGridPicker` is a hover grid
        and unusable by touch; docs' mobile menu already settled on 3×3.
- [x] Lift `ImageButton`'s hidden `<input>` into `NotesToolbar` so one
      `imageInputRef` serves the desktop button and the mobile menu item.
      Drops a component and avoids docs' `document.createElement("input")`.
- [x] Leave the `ml-auto` group alone — once the strip fits, it is
      visible again on its own.
- [x] Split guard: drop `Split` from the view-mode menu on mobile
      (Editor / Preview only), and in `notes-detail.tsx` demote a stored
      `"both"` to `"edit"` before passing it to `NotesToolbar` /
      `NotesView`. Do **not** write the demoted value back to
      localStorage — the desktop preference has to survive, and widening
      the window should return to split.
- [x] ~~`shared-document.tsx:343` →
      `readOnly ? "view" : isMobile ? "edit" : "both"`.~~ **Dropped in
      review** — see below. Left at `both`, with a comment explaining why.
- [x] Tests — new `notes-toolbar.test.tsx` (matchMedia + `innerWidth`
      stubs, following `slides/toolbar/index.test.tsx`): desktop keeps
      the list/insert buttons inline; mobile removes them from the strip
      and exposes them in the `⋮` menu while undo/redo/B/I/S stay inline;
      mobile's view-mode menu offers no Split.
- [x] `docs/design/notes/notes.md`: add a mobile section (the doc
      currently has zero occurrences of "mobile").

## Review

`pnpm verify:fast` green (exit 0). Browser smoke in `pnpm dev` against a
real note at a 390×844 viewport:

- The strip no longer overflows — `scrollWidth === clientWidth === 390`,
  eight buttons (Undo, Redo, Bold, Italic, Strikethrough, More formatting
  options, Keyboard, View mode). The two dropdowns that used to sit off
  screen are visible without scrolling.
- The `⋮` menu renders both sections; Indent / Outdent correctly disabled
  on an empty document. `Table (3×3)` inserted a real 3×3 markdown table,
  so the menu drives the editor and not just the DOM.
- View mode read `Editor` despite a stored `both`, and widening to 1280px
  restored the full inline toolbar *and* the split — the demotion is
  view-local and reversible, as intended.
- The editable share link (`/shared/:token`) at 390px shows one full-width
  editor rather than the old 50/50 split.

Self-review caught one real defect in the first cut. Radix returns focus
to the trigger when a menu closes, so every overflow-menu action left the
caret on the `⋮` button — on a phone that drops the soft keyboard right
after the user asked for a formatting change. `TableDropdown` calling
`editor.focus()` inline was the standing evidence. Fixed once for every
item with `onCloseAutoFocus` (preventDefault + `editor.focus()`), pinned
by a test, and confirmed in the browser: after picking Quote from the menu
`document.activeElement` is back inside `.cm-editor` and `> ` is inserted.

One thing outside the plan. `Toolbar` renders a plain `div`, so the
existing `aria-label="Note toolbar"` was never exposed — an `aria-label`
on a generic container does not reach the accessibility tree. Added
`role="toolbar"` at the notes call site, which is also what lets the tests
address the strip separately from Radix's portalled menus. Left the shared
`Toolbar` primitive alone: the sheets/docs/slides toolbars pass no label,
and giving them a role without one would be a downgrade.

Also had to raise one unrelated timeout.
`tests/app/slides/toolbar/text-edit-section.test.ts`'s import smoke test
ran on vitest's default 5s while cold-importing the slides toolbar's whole
module graph, competing with every other worker for the transform
pipeline. Adding this branch's test file was enough to tip it — it timed
out in two of three full-suite runs here and passed alone every time.
Raised to 20s with a comment; the assertion is that the module resolves,
never that it resolves quickly.

### Review round

Five parallel reviewers over the branch diff (CLAUDE.md compliance, bug
scan, git history, prior PR comments, code-comment compliance). Three
findings were real and are fixed; the rest were checked and rejected.

**The shared-document change was wrong and is reverted.** The history
reviewer traced `viewMode={readOnly ? "view" : "both"}` back to `af8e6fc69`
and found the reason it was written that way: that route mounts no toolbar,
so the split is the only thing that renders a preview there at all.
Demoting it to `edit` on a phone traded a cramped preview for **no**
preview, with no control to switch back — removing a capability with no
replacement. The original framing of this as "the worse case, fix it too"
had the argument backwards. Reverted to `both` with a comment recording
why, and the design doc now says the surface is deliberately not demoted.
Doing it properly means giving that route its own mode control, which is a
feature, not a layout fix.

**The view-mode menu destroyed the stored `both`.** Two reviewers found it
independently. `mode` reaching the toolbar is the *effective* mode, so on a
phone a stored `both` shows as `edit` — and Radix fires `onCheckedChange`
for the already-checked item too, so a tap that changed nothing reported
`edit` upward and persisted it. The comment there already claimed to
"ignore the toggled-off case"; it just never did. Now guarded for real, and
`handleViewModeChange` additionally skips `writeViewMode` on mobile: a
phone cannot offer Split, so a choice made on a phone must not overwrite a
preference only a desktop could have set. Without that second half the
guarantee held only until the user picked Preview once. Two tests added.

**"Nineteen controls" was 18** — miscounted in the original todo and
carried into a source comment and a test docstring. Corrected. The
`NotesToolbar` docblock still described only the desktop layout, and now
describes both.

Rejected after checking: a claimed first-paint flash of the split layout
from `useIsMobile()` returning `false` on the first render. `NotesView`
creates the editor inside an effect gated on a `didMount` state flag, so
`initialize()` never runs on the first commit — by the render that does
create it, the hook's own effect has already reported the real width. The
container renders as an empty `div` until then, so there is nothing to
flash.

### Not covered

- No test pins `notes-detail`'s demotion or its mobile write-skip — both
  live in a route component that needs a Yorkie `DocumentProvider` to
  render. Verified in the browser instead (above). The toolbar's half —
  no Split offered, and no upward report when the active mode is
  re-picked — is unit-tested.
- An editable share link on a phone still gets the ~187px split. That is
  now a deliberate known limitation rather than an oversight; the fix
  needs a mode control on that route.
- The breakpoint is the shared 768px `useIsMobile`, so a portrait tablet
  gets the phone toolbar. That matches docs and slides; no reason found to
  diverge here.
