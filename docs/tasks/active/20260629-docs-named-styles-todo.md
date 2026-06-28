# Docs Named Styles — Task Tracking

Design doc: [docs-named-styles.md](../../design/docs/docs-named-styles.md)
Roadmap item: Phase 6.5 in
[docs-wordprocessor-roadmap.md](../../design/docs/docs-wordprocessor-roadmap.md).

Google Docs paragraph-style model: a fixed catalog (Normal / Title / Subtitle /
Heading 1–6) whose definitions are redefinable per document, plus per-user
default styles. Single PR.

## Phase 1: Core model (`packages/docs/src/model`)
- [x] 1.1 `model/named-styles.ts` — `StyleId`, `NamedStyleDef`, `DocStyles`,
      `BUILTIN_STYLES`, `blockStyleId`, `resolveStyleInline/Block`,
      `materializeBlockSpacing`, `rematerializeDocSpacing`. Unit tests.
- [x] 1.2 Refresh built-in values: headings non-bold, grayscale colors,
      spacing. Removed `HEADING_DEFAULTS` / `TITLE_DEFAULTS` / `SUBTITLE_DEFAULTS`
      from `types.ts`; re-exports updated to named-styles.
- [x] 1.3 `Document.styles?: DocStyles` field in `model/types.ts`.

## Phase 2: Layout cascade (`packages/docs/src/view/layout.ts`)
- [x] 2.1 `resolveBlockInlines(block, docStyles?)` uses registry; empty-block
      `getLineMaxFontSizePx` fallback uses it too.
- [x] 2.2 Thread `docStyles?` through `computeLayout` → `layoutBlock` →
      `assignLineHeights` and the table-layout path.
- [x] 2.3 Editor `recomputeLayout` (body/header/footer) + `pdf-exporter` pass
      `document.styles`. Slides text-box stays on built-ins. Tests: override wins.

## Phase 3: Store API
- [x] 3.1 `DocStore`: `getDocStyles` / `setDocStyles` /
      `updateStyleDefinition` / `resetStyle` / `resetAllStyles`.
- [x] 3.2 `MemStore` impl + eager block-spacing re-materialization helper.
- [x] 3.3 `setBlockType` re-materializes block spacing when `StyleId` changes.
- [x] 3.4 `YorkieDocStore` impl — root `stylesJson` (JSON string) getter/setter;
      batched single-undo re-materialization; cache invalidation.
- [x] 3.5 Backend `docs-tree.ts` `DocsYorkieRoot.stylesJson` serialize/clear.
- [x] 3.6 Store + collaboration round-trip tests (MemStore 8, docs-tree 2).
- [x] 3.7 EditorAPI: getDocStyles/setDocStyles/updateStyleToMatch/
      resetNamedStyle/resetAllNamedStyles.

## Phase 4: Frontend UI
- [x] 4.1 `text-style-options.ts` — add Heading 4–6 (⌥4–⌥6) + `styleId` +
      `blockTypeToStyleId`.
- [x] 4.2 `text-style-group.tsx` — capability-gated Options submenu (Update to
      match / Reset / Save / Use / Reset styles). One-click apply preserved.
- [x] 4.3 `docs-formatting-toolbar.tsx` — wire Save/Use via new api client.
- [x] 4.4 "Update to match" reads caret block formatting in editor.ts.

## Phase 5: Per-user default styles (backend)
- [x] 5.1 Prisma `UserDocStyles` model + migration.
- [x] 5.2 `GET` / `PUT` `/auth/me/doc-styles` (JWT) + service.
- [x] 5.3 Frontend client (`api/doc-styles.ts`) + wire Save / Use.
- [x] 5.4 Backend e2e for the endpoints (gated, DB required).

## Verification
- [x] `pnpm verify:fast` green (EXIT=0).
- [ ] `pnpm dev` manual smoke: apply each style, Update to match, Reset,
      Save/Use my default styles, collaboration sync, PDF export fidelity.
- [x] Update Phase 6.5 checkbox in the wordprocessor todo.

## Review
(filled at completion)
