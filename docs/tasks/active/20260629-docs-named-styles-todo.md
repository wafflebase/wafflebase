# Docs Named Styles — Task Tracking

Design doc: [docs-named-styles.md](../../design/docs/docs-named-styles.md)
Roadmap item: Phase 6.5 in
[docs-wordprocessor-roadmap.md](../../design/docs/docs-wordprocessor-roadmap.md).

Google Docs paragraph-style model: a fixed catalog (Normal / Title / Subtitle /
Heading 1–6) whose definitions are redefinable per document, plus per-user
default styles. Single PR.

## Phase 1: Core model (`packages/docs/src/model`)
- [ ] 1.1 `model/named-styles.ts` — `StyleId`, `NamedStyleDef`, `DocStyles`,
      `BUILTIN_STYLES` (refreshed Google Docs values), `blockStyleId(block)`,
      `resolveStyleInline` / `resolveStyleBlock`. Unit tests.
- [ ] 1.2 Refresh built-in values: headings non-bold, grayscale colors,
      spacing (Title/Subtitle/H1–6 per design table). Replace
      `HEADING_DEFAULTS` / `TITLE_DEFAULTS` / `SUBTITLE_DEFAULTS` (keep thin
      back-compat re-exports if still referenced).
- [ ] 1.3 `Document.styles?: DocStyles` field in `model/types.ts`.

## Phase 2: Layout cascade (`packages/docs/src/view/layout.ts`)
- [ ] 2.1 `resolveBlockInlines(block, docStyles?)` uses registry; default =
      built-in. Update the empty-block `fallbackSize` branch too.
- [ ] 2.2 Thread `docStyles?` through `computeLayout` → `layoutBlock`.
- [ ] 2.3 Editor `recomputeLayout` + `pdf-exporter` pass `document.styles`.
      Slides text-box editor stays on built-ins. Tests: override wins.

## Phase 3: Store API
- [ ] 3.1 `DocStore`: `getDocStyles` / `setDocStyles` /
      `updateStyleDefinition` / `resetStyle` / `resetAllStyles`.
- [ ] 3.2 `MemStore` impl (plain `this.doc.styles`) + eager block-spacing
      re-materialization helper shared with apply path.
- [ ] 3.3 `setBlockType` re-materializes block spacing when `StyleId` changes.
- [ ] 3.4 `YorkieDocStore` impl — root `styles` getter/setter + `readDocStyles`
      proxy-unwrap; `writeFullDocument`; cache invalidation.
- [ ] 3.5 Backend `docs-tree.ts` `DocsYorkieRoot.styles` serialize/deserialize.
- [ ] 3.6 Store + collaboration round-trip tests.

## Phase 4: Frontend UI
- [ ] 4.1 `text-style-options.ts` — add Heading 4–6 (⌥4–⌥6).
- [ ] 4.2 `text-style-group.tsx` — per-style submenu (Apply / Update to match /
      Reset) + Options (Save / Use my default styles / Reset styles).
- [ ] 4.3 `docs-formatting-toolbar.tsx` — wire callbacks to store via EditorAPI.
- [ ] 4.4 "Update to match" reads caret block effective formatting.

## Phase 5: Per-user default styles (backend)
- [ ] 5.1 Prisma `UserDocStyles` model + migration.
- [ ] 5.2 `GET` / `PUT` `/auth/me/doc-styles` (JWT) + service.
- [ ] 5.3 Frontend client + wire Save / Use my default styles.
- [ ] 5.4 Backend e2e for the endpoints.

## Verification
- [ ] `pnpm verify:fast` green.
- [ ] `pnpm dev` manual smoke: apply each style, Update to match, Reset,
      Save/Use my default styles, collaboration sync, PDF export fidelity.
- [ ] Update Phase 6.5 checkbox in the wordprocessor todo.

## Review
(filled at completion)
