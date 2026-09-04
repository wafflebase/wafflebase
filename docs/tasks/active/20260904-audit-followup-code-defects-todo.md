# Code defects found by the docs audit

The homepage/docs audit (#1014) fixed the documentation but deliberately
touched no code. It surfaced twelve code-level defects, listed in that PR by
severity. This task works through the ones that need no product decision.

Every item below was found by reading code to check a documentation claim, so
each has a cited origin. None was found by a test — which is itself worth
noting when deciding what tests to add.

## In scope — done (2026-09-04)

- [x] **Mass assignment on `PATCH /api/v1/workspaces/:wid/documents/:did`.**
      `documents.controller.ts` declares `@Body() body: { title?: string }`, an
      inline structural type, so the emitted metatype is `Object` and the
      global `ValidationPipe({whitelist, forbidNonWhitelisted})` in `main.ts`
      skips it. The body reaches `prisma.document.update` intact
      (`document.service.ts`), and `type` / `fileId` / `fileSize` / `mimeType`
      are all updatable scalars. Writing `type` reroutes which editor opens a
      document; writing `fileId` repoints a blob with none of the
      `assertFileIdAllowed` checking its sibling route performs. Fix with a DTO
      class so the existing pipe engages.
- [x] **Cells write verbs have no document-type check and seed a spreadsheet
      root.** `cells.controller.ts` passes `initialRoot:
      initialSpreadsheetDocument()` on PUT/DELETE/PATCH, which creates
      `sheets['tab-1']`. A write to `tab-1` against a doc/slides/note/pdf id
      answers 200 and leaves a permanent, invisible `sheet-<id>` Yorkie
      document that later reads back. Sibling controllers already have
      `assertSheetDocument`.
- [x] **`POST /images` has no Multer `limits.fileSize`.** Its v1 sibling sets
      one; the browser route uses a bare `FileInterceptor` and is rejected
      afterwards in `image.service.ts`, so an oversized body is buffered whole
      into memory first.
- [x] **`readBoundedInteger` does not bound.** `lakehouse/duckdb.service.ts`
      substitutes the default for an out-of-range value and logs nothing, so
      `LAKEHOUSE_DUCKDB_THREADS=64` silently yields 2 — less than the default
      the operator was trying to exceed.
- [x] **Docs body context menu offers a dead "Insert comment" row.** Gated
      only on `!readOnly` (`docs-context-menu.tsx`), but `beginCompose` no-ops
      without a non-collapsed selection (`docs-comments-controller.ts`). The
      table menu already gates on `hasSelection`.
- [x] **`upload-panel.tsx` never renders `item.warning`.** `UploadItem` carries
      the field and two producers set it — CSV truncation and PPTX lossy
      conversion — but the panel renders only `item.reason`. Both warnings
      exist solely as a transient toast, so a user who dismisses it cannot
      learn their sheet was truncated or their deck lost fidelity.
- [x] **`packages/backend/README.md` repeats the CLI-login error #1014 fixed
      in the self-hosting guide.** It says an unset `GITHUB_CALLBACK_URL` is
      refused; `oauth-state.ts` returns `NODE_ENV === 'production'` in that
      case, which the shipped image sets, so it is allowed.

## Decided

- [x] **`packages/frontend/.env.production` is committed with upstream
      production configuration.** **Done 2026-09-04.** Both this and
      `packages/documentation/.env.production` (which carried the same GA
      property) are untracked, gitignored, and replaced by `.example`
      templates. `publish-ghpage.yml` now supplies the five `VITE_*` values
      from **repository variables** with a preflight that fails the build when
      a required one is missing — hardcoding them in the workflow would have
      reproduced the same bug in every fork. Verified with three real builds:
      values supplied win over the file, the real values reproduce today's
      bundle, and an unconfigured build falls back to localhost rather than
      silently upstream.

      **Before this merges**, set the repository variables
      (`VITE_BACKEND_API_URL`, `VITE_YORKIE_RPC_ADDR`, `VITE_YORKIE_PUBLIC_KEY`
      required; `VITE_FRONTEND_BASENAME`, `VITE_GA_ID` optional). Missing
      required ones fail the publish run — the live site is unaffected, it just
      does not update. `VITE_GA_ID` is the one to watch: unset is silent, and
      both the app and the docs site lose analytics.

- [x] **Any workspace member can edit or delete another member's datasource
      connection**, and execute against its stored credential. Every handler in
      `datasource.controller.ts` gates on `assertMember` alone.
      **Decided 2026-09-04: leave as-is.** The shared-credential model is
      intended, and #1014 documented it accurately along with the
      least-privilege-account advice that follows from it. Tightening it would
      change behaviour for existing workspaces to no benefit.

## Deferred — needs design, not just a fix

- [ ] **No global exception filter is registered**, so Prisma errors and
      TypeErrors escape as 500s (e.g. an omitted `cells` key on batch update
      throws in `Object.entries`). Adding one is a cross-cutting change to
      every route's error contract and deserves its own design pass.
- [ ] **Cross-sheet references to a non-sheet tab fail silently as empty**
      rather than `#REF!`. `sheet-view.tsx` filters resolution to
      `type === "sheet"` and the evaluator reads the miss as `''`, so
      `=SUM(DataSource1!A1:A9)` renders `0` — indistinguishable from real empty
      data. The same silence covers a typo'd sheet name, so the fix belongs at
      the resolver boundary and affects every formula, not just datasources.
- [ ] **Version history is unreachable on mobile for slides only.**
      `MobileSlidesLayout`'s `RightPanel` union omits `"history"` while notes'
      mobile path keeps it. The panel is the only route to a restore.

## Surfaced by the code review on this branch — not fixed

Found while reviewing the fixes above. Each is the same defect class the
branch set out to remove, or a consequence of it.

- [ ] **`Add link` is dead at a caret inside a header or footer.** The body
      context menu offers the row on `!readOnly` alone, but the registered
      callback bails silently: `docs-view.tsx`'s `onLinkRequest` returns early
      when `getCursorScreenRect()` is undefined, and that resolves through
      `cursor.getPixelPosition` against the **body** layout with no
      header/footer branch — the render path branches to `computeHFCursorPixel`
      for exactly this reason, above a comment in `packages/docs/src/view/editor.ts`
      that states it outright. `⌘K` has the same outcome. Fix is either a
      header/footer branch in `getCursorScreenRect` or a `canLink` gate
      mirroring the `canComment` one this branch added.
- [ ] **`POST /images` has no multipart MIME filter.** The v1 route rejects a
      bad MIME before buffering; the browser route relies solely on
      `ImageService.upload`, so an authenticated caller can make the process
      buffer up to 10 MB of `application/zip` first. The size limit still
      bounds the allocation, so this is asymmetry and wasted work rather than a
      memory hole. A one-liner now that `ALLOWED_IMAGE_MIME_TYPES` is shared,
      but it changes a client-visible error path.
- [ ] **No `--warning` token.** `upload-panel.tsx`'s `text-amber-700
      dark:text-amber-500` is the only raw palette colour in
      `packages/frontend/src`; every other status colour goes through a token.
      Adding one touches `packages/core/src/tokens/semantic.ts` (interface plus
      both maps), `packages/core/scripts/build-css.ts`, two core tests and a
      snapshot, and `packages/frontend/src/index.css`'s `@theme inline` bridge.
      It must carry **two** values — light ≈ amber-700, dark ≈ amber-500 — as
      neither stop clears 4.5:1 on both backgrounds.
- [ ] **`applyTableCellStyle` snapshots before its guard.**
      `packages/docs/src/view/editor.ts` calls `docStore.snapshot()` before
      `if (!cellInfo) return;`, unlike all six sibling table methods —
      `deleteTable` even carries a comment stating the convention — so a no-op
      call burns an undo step. It is also the only table method whose
      cell-range branch omits the `blockId === tableBlockId` cross-check that
      `table-merge-context.ts` makes. Unreachable through the menu today.
- [ ] **Cells `GET` is the last type-unchecked route on the sheet surface.**
      Every sibling family, `GET /tabs` included, answers 400 for a wrong
      document type; cells reads answer `404 Tab not found`, which cannot be
      told apart from a bad `tabId`. This branch left it deliberately — it is a
      documented contract and reads create nothing — but the reason given
      ("changing it is an API-contract change") applies equally to the write
      verbs, which did change. Worth settling as a stated API change rather
      than leaving the asymmetry.
- [ ] **`assertSheetDocument` is copy-pasted into nine controllers**,
      differing only in a message prefix. Matching the siblings was right for
      this fix, but nine identical private methods is the shape that let the
      cells one go missing.
