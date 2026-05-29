# Lessons — Slides toolbar add-slide focus

## The editor's "current slide" is editor state, not store state

`SlidesEditor.currentId` is owned by the editor and is **not** derived from
the store. The `store.onChange` handler (`slides-view.tsx`) only re-renders
(`markDirty()` + `render()`); it never moves `currentId`. So any code path
that adds a slide must explicitly call `editor.setCurrentSlide(newId)` for
the canvas to follow — adding to the store alone is invisible to the user.

When adding a similar UI action in the future, check all sibling add paths
for consistency:
- `view/editor/interactions/keyboard.ts` (Cmd+M)
- `view/editor/thumbnail-panel.ts` (right-click New slide)
- `app/slides/toolbar/slide-group.tsx` (toolbar `+ Slide` / layout picker)
- `app/slides/mobile-slides-view.tsx` (mobile)

## `store.addSlide(layoutId, atIndex?)` appends when atIndex is omitted

Omitting `atIndex` inserts at the end of the deck. "Insert after current"
requires computing `currentIdx + 1` from `store.read().slides`. A returned
empty id only happens outside a batch; inside `store.batch` it returns the
new slide id.

## Components only get what's passed down

`SlideGroup` originally received only `store`, so it *couldn't* touch editor
state even though the bug fix needed it. The parent `SlidesToolbar` already
had `editor` in scope — the fix was just threading the prop through. Watch
for "this component can't do X because it lacks the handle" as a smell that
the real fix is one level up.
