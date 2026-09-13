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

## Review round 16

Merged `origin/main` first (the PR was `CONFLICTING`). One conflict, in
`shared-document.tsx`: main's #1055 renamed the `DocumentProvider` wrapper to
`CollabDocumentProvider` on the same JSX element this branch had given a
`token` prop. Resolved as the union.

- [x] Blocking (test-adequacy) — `Spreadsheet.recalculateCrossSheetFormulas`'s
      read-only early return now has
      `packages/sheets/test/view/spreadsheet-readonly-recalc.test.ts`, built
      on the `worksheet-readonly-editing.test.ts` prototype-context technique.
      Mutation-checked: deleting the gate reddens it.
- [x] Correctness (minor) — read-only mounts still show the *persisted*
      cross-sheet cached value. Behaviour left as it is; the trade-off is now
      stated in the engine method's doc comment along with why the in-memory
      alternative was rejected (see lessons).
- [x] Correctness (minor) — `assertWritable` "unhandled rejection".
      **Rejected**: every caller catches. Evidence in the report and lessons.
- [x] Correctness (nit) — divider drag records the grab offset
      (`packages/notes/src/view/editor.ts`), with a jsdom regression test.
- [x] Design-fit (nit) — the notes editor comment no longer claims the webhook
      ships in shadow mode.
- [x] Docs — `packages/frontend/README.md`, `docs/design/sharing.md` and
      `docs/design/template-gallery.md` corrected for the enforce-by-default
      flip this PR made.
- [x] Design-fit (minor) — `sharing.md` gained a short "The read-only rule"
      subsection recording the cross-cutting `doc.update()` rule and the table
      of non-command write paths it covers.
- [x] Design-fit (minor) — `register-templates.ts` calls
      `assertYorkieAuthEnforced` instead of re-deriving the check.
- [x] Correctness (minor) — the `read-only.ts` proxy's `isExtensible` /
      `preventExtensions` pair. Judged unreachable (nothing freezes the raw
      store) and left as is; the docs package's explanation of *why* the pair
      is invariant-safe was ported into the notes copy, which had dropped it.
- [x] Correctness (minor) — the lakehouse parity `beforeAll` has its own
      `SETUP_TIMEOUT_MS` instead of sharing 180s with the warm-up.
- [x] Test-adequacy (minor) — `CommentPopover.test.tsx` (new), the
      keymap / show-authors half of the shared-notes-layout no-write promise,
      and `yorkieServiceTokenInjector`'s no-secret branch in
      `auth.service.spec.ts`. Deferred: the presence gates inside
      slides/board/pdf `useEffect` closures, and `sideTokenInjector` — see the
      report for why each needs a harness this PR should not build.

Deliberately not done, recorded as follow-ups instead: extracting a shared
generic read-only store proxy from the near-identical notes and docs copies,
and splitting the auth-posture flip out of the notes-toolbar change.

## Review round 17

Scoped hard: six findings, no new modules, no refactors. +255 / −13.

- [x] Correctness (major) — a read-only slides mount skipped
      `ensureSlidesRoot`, and with it the `meta.themeId` / `masterId`
      reconciliation, so `getActiveTheme` could throw on the share route for a
      deck an editor renders fine. Reconciled in `migrateDocument` instead,
      which holds both the meta and the resolved arrays, so the Yorkie read
      path and `MemSlidesStore` stay identical. Regression test in
      `yorkie-slides-store.test.ts`.
- [x] Correctness (major) — `SharedNotesLayout` handed the notes engine a
      `DocsImageUpload` (which rejects) where its `UploadImage` contract wants
      "report it, then resolve `null`", so a failed image upload on the share
      route was the one note mount that said nothing. Adapted at the boundary,
      with a test.
- [x] Test-adequacy (major) — `YorkieDocStore(doc, readOnly)`'s two presence
      gates had no test. New
      `packages/frontend/tests/app/docs/yorkie-doc-store-read-only.test.ts`,
      shaped after the spreadsheet suite (counts `doc.update` calls, not
      emitted changes). Mutation-checked in both directions, so the deliberate
      publish-gated / anchoring-still-runs split is pinned.
- [x] Docs — three claims this branch itself made false: `notes-settings.ts`
      ("the read-only shared viewer does not use them"), `notes-view.tsx`'s
      `showAuthors` fallback justification (the revision preview calls the
      engine's `initialize()` directly and never mounts `NotesView`), and
      `notes.md`'s "the share-link page (which has no menu)".
- [x] Test-adequacy (minor) — `read-only.test.ts` called `setLocalSelection`
      and `recordSelectionForHistory` with no assertion behind them; both are
      now pinned through `MemNoteStore.currentSelection`.
- [x] Correctness (minor) — the notes split divider now ends its drag on
      `pointercancel`, which this branch's own touch-drag enablement made
      reachable; without it a cancelled touch drag left the body's
      `col-resize` cursor and `user-select` lock applied.

Follow-ups recorded rather than fixed: `shared-notes-layout.test.tsx`'s
`renderLayout` waits on a `lazy()` import with `findByRole`'s default 1s
budget, which timed out once under load on a cold Vite transform cache.

## Review round 18

Zero blocking, zero confirmed-major: all five lenses cleared the branch, three
of them chasing and dropping candidate findings against round 17's fixes (the
`themes[0]` bounds question, the `layouts` backfill asymmetry, and the notes
read-only proxy's allowlist). Four low-severity items remained, three of them
defects *in round 17's own fixes*. Prose and tests only.

- [x] Docs (minor) — the claim class, not the instance. Round 17 fixed
      `notes-settings.ts`'s module header and left the same class of claim in
      four other places, and its own replacement was inaccurate: a viewer
      mount reads the keymap and blame-gutter keys but **not** the stored view
      mode (`shared-notes-layout.tsx:55-57` short-circuits it to `"view"`), so
      it reads two of the three. Six occurrences found by grepping the claim
      rather than the reported line, all corrected:
      `notes-settings.ts`'s header, `readShowAuthors`'s JSDoc (which claimed
      the switch decides "whether this user's display name is recorded" —
      false and privacy-relevant: `YorkieNoteStore.editText` stamps the name on
      every insert regardless, which is what the toolbar copy and
      `notes-view.tsx`'s own prop doc already say),
      `packages/documentation/notes/writing-a-note.md` (still telling users the
      switch "isn't available in a note opened through a share link"),
      `docs/design/notes/notes.md`'s per-browser-preferences bullet,
      `packages/notes/src/view/editor.ts`'s `showAuthors` option doc, and this
      task's own lessons file.
- [x] Test-adequacy (minor) — `yorkie-doc-store-read-only.test.ts`'s "still
      reads peer presence" case asserted only `Array.isArray(getPresences())`,
      which holds with the read half gated too. It now seeds a peer's presence
      into the local document (borrow the actor id, write, hand it back, mark
      the peer online) and requires it back through `getPresences()`.
      Mutation-checked: red with `if (this.readOnly) return []` in
      `getPresences`.
- [x] Test-adequacy (minor) — `yorkie-slides-store.test.ts`'s "still backfills
      a writable mount of the same deck" built a *fresh empty* document, so it
      exercised `ensureSlidesRoot`'s `needsRoot` path, not the backfill-on-an-
      existing-broken-deck path its name promises. Both halves of the pair now
      build the same customized deck through one `seedCustomizedDeck()` helper.
      Mutation-checked: deleting the `meta.themeId` / `masterId` reconciliation
      leaves the old body green and turns the new one red.
- [x] Correctness (minor) — `migrate.ts`'s read-path reconciliation read
      `themes[0].id` / `masters[0].id` without checking the value is a string.
      The bounds are safe (the arrays are forced non-empty at `:80-85`), but
      the entries come off the CRDT, where a peer can write `{ name: 'x' }`
      with no id — and assigning that `undefined` to a `string` field is worse
      than leaving the mismatch, because `getActiveTheme` then matches
      `undefined === undefined` and resolves a theme with no palette instead of
      throwing the error that names the id. Reconciles onto the first entry
      with a non-empty string id, or leaves `meta` alone. Three tests in
      `packages/slides/test/model/migrate.test.ts`.
- [x] Flake guard (optional) — `shared-notes-layout.test.tsx`'s `renderLayout`
      gives its `lazy()` toolbar import a 15s budget instead of `findBy*`'s 1s
      default. Two agents saw it time out locally on a cold Vite transform
      cache (`notes-toolbar` plus ~20 tabler icons); it passes in CI.
