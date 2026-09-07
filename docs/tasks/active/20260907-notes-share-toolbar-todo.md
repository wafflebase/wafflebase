# Notes share link: mount the toolbar (issue #1044)

A note opened through a share link mounts no toolbar, while the same note
opened from the workspace does. Notes is the only editable document type where
the two entry paths differ. On a phone an editor-role visitor lands in a fixed
50/50 split (~187px panes) with no control that can leave it.

The recorded rationale (`shared-document.tsx:393-408`,
`docs/design/notes/notes.md`) said the split had to stay *because* there is no
toolbar. Adding the toolbar dissolves that constraint.

## Scope (from the issue's N1–N8)

- [x] N1 — mount `NotesToolbar` on `SharedNotesLayout`, lazily; the layout owns
      `viewMode` / `keymap` / `showAuthors` and takes `editor` from
      `NotesView`'s `onEditorReady`.
- [x] N2 — mobile demotes a `both` mode to `edit` for the render only; with a
      toolbar present the demotion is reversible.
- [x] N3/N4 — viewer mounts the toolbar with `readOnly`, so
      `canFormat = !readOnly && mode !== "view"` hides the formatting group on
      its own and leaves the view menu. A viewer gains the source/preview
      switch.
- [x] N5 — thread `token` into `SharedNotesLayout` and pass
      `shareTokenImageUploader(token)` as `uploadImage`.
- [x] N6/N7 — keymap + blame gutter come from the per-browser preference as an
      initial value and are **session-local** from then on: an anonymous
      visitor never writes `localStorage`.
- [x] N8 — no separate branch for a workspace member arriving via the share
      URL; the route is chosen by path.

Plus, from "Proposed fix":

- [x] 3 — engine divider touch target: `touch-action: none` and a ~24px hit
      area, visual band unchanged.
- [x] 4 — delete the obsolete rationale comments; correct
      `docs/design/notes/notes.md` (§Mobile and the image-upload known
      limitation).

## Plan

1. Extract `SharedNotesLayout` out of `shared-document.tsx` into
   `app/shared/shared-notes-layout.tsx`. It is the only shared layout that
   needs its own state machine now, and the extraction is what makes it
   testable without importing every engine `shared-document.tsx` statically
   pulls in.
2. Lazy-load `NotesToolbar` there, following the `SlidesToolbar` precedent.
3. Thread `token` from the `resolved.type === "note"` call site.
4. Widen the notes split divider's hit area in `packages/notes`.
5. Tests: `shared-notes-layout.test.tsx` in the style of
   `notes-toolbar.test.tsx` — mobile starts at `edit`, a viewer gets no
   formatting group but keeps the view menu, the uploader reaches `NotesView`,
   nothing is written to `localStorage`.
6. Docs + `harness.config.json` chunk-count reason if the gate needs it.

## Out of scope

Sheets/Board toolbars having no mobile branch (symmetric across both entry
paths — its own issue). Docs and Slides need no change.
