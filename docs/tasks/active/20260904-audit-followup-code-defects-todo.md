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
