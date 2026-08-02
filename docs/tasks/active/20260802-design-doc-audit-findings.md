# Design Doc Audit — Findings (100 / 100 docs)

Generated from workflow `wf_6991ab3f-696` on 2026-08-02. Each design doc under
`docs/design/` (excluding README.md index and template.md) was audited by an
independent subagent against the shipped codebase.

**Verdict counts:** accurate 16 · minor-drift 57 · significant-drift 27

**37 docs carry at least one high-severity finding.** Dominant pattern:
`roadmap-shipped` (45 of 57 high-sev) — docs written as forward-looking
proposals for features that have since shipped and were never flipped to
present tense. Reader is misled into thinking the feature does not exist.

Discrepancy legend: **documented-not-implemented** (doc claims shipped, code lacks it) ·
**implemented-not-documented** · **roadmap-shipped** (deferred item actually shipped) ·
**stale-reference** (wrong path/symbol) · **other**.

---

## significant-drift (27)

### docs/design/slides/slides-fonts.md

> The doc reads as a forward-looking proposal, but the on-screen rich-fonts work (P0 generated catalog + lazy ensureFontLink, P1 "More fonts…" dialog, P2 full ~1,900-family library) is already shipped; only the stale "current state" framing and the per-doc usedFonts persistence lag behind.

- **[high] roadmap-shipped** — P0 is framed as a future phase ('This document proposes… per-font lazy loading'), but it is fully shipped: FONT_CATALOG is now generated data with a license field (~105 entries incl. Korean/Latin/mono/display + non-web system fonts), an `eager` bootstrap flag, and a per-family `ensureFontLink(family, weights)` lazy loader wired into both editors.
  - _Evidence:_ packages/frontend/src/components/text-formatting/font-catalog.data.ts (FONT_CATALOG_DATA, ~105 entries with license/eager); font-catalog.ts exports ensureFontLink + FONT_CATALOG = FONT_CATALOG_DATA; ensureFontLink used in src/app/docs/docs-formatting-toolbar.tsx:348 and src/app/slides/toolbar/apply-font-family.ts:28
- **[high] roadmap-shipped** — P1's '"More fonts…" dialog (search + category/script filters + in-view IntersectionObserver previews)' and localStorage 'recent' list are shipped, not future. The dialog, its filter module, and the recents store all exist and are wired into the picker.
  - _Evidence:_ packages/frontend/src/components/text-formatting/more-fonts-dialog.tsx (MoreFontsDialog, IntersectionObserver+ensureFontLink); more-fonts-filter.ts (FontCategoryFilter/FontScriptFilter); font-recents.ts (localStorage per-browser recents); font-family-picker.tsx:28 imports/uses MoreFontsDialog
- **[high] roadmap-shipped** — P2 (full ~1,800 library lazy-imported via font-catalog.full.json for the dialog) is shipped: the full library is committed as font-catalog.full.ts (~1,900 families) and dynamic-imported by a memoized loader that the picker already calls.
  - _Evidence:_ packages/frontend/src/components/text-formatting/font-catalog.full.ts (FONT_CATALOG_FULL, 1915 lines); font-catalog-full-loader.ts loadFullFontCatalog() dynamic import; called at font-family-picker.tsx:85
- **[high] stale-reference** — The Summary and 'Background: how fonts flow today' table describe the CURRENT state as a closed hardcoded ~19-family list loaded as a single bootstrap Google Fonts <link>. That is the pre-refactor state; the shipped code is a generated ~105-entry curated catalog plus a full library, with lazy per-family loading. A reader would be misled about what exists today.
  - _Evidence:_ Doc lines 12-17 ('~19 families', 'single Google Fonts CSS <link> at bootstrap') and table row 'Hardcoded FONT_CATALOG (19 entries) font-catalog.ts:35' vs packages/frontend/src/components/text-formatting/font-catalog.data.ts (105 entries) and font-catalog.ts (buildGoogleFontsHref only loads eager fonts; ensureFontLink for lazy)
- **[medium] documented-not-implemented** — P1's per-presentation used-fonts set ('persist per presentation in the Yorkie doc, a `usedFonts: string[]` on the presentation/meta object') is not implemented — no such field or symbol exists — even though the rest of P1 shipped. Only the localStorage recents piece exists.
  - _Evidence:_ grep for 'usedFonts'/'used-fonts' across packages returns no matches; only font-recents.ts (localStorage) exists
- **[low] stale-reference** — Generator script paths/extension drift: doc's P0 table names `scripts/build-font-catalog.ts` and the proposed FontCatalogEntry shape (category/curated/popularity). Actual generators are `.mjs` under the frontend package (plus a separate full-catalog and font-files generator), and the shipped FontEntry uses group/eager/webFont rather than category/curated/popularity.
  - _Evidence:_ packages/frontend/scripts/build-font-catalog.mjs, build-font-catalog-full.mjs, build-font-files.mjs (referenced in generated-file headers); FontEntry in font-catalog.ts uses group/webFont/eager, not category/curated/popularity

### docs/design/slides/slides-background.md

> The doc is written as a forward-looking proposal ("Today... a single Background Color control", Goals, Phase 1/Phase 2 PRs), but the entire feature — model widening, renderer swap, migration, the Background side panel, PPTX gradient round-trip, apply-to-all, and image opacity — is already shipped in the code.

- **[high] roadmap-shipped** — The Summary says 'Today the right-side panel exposes a single Background Color control — a solid ThemeColor picker' and the whole doc proposes building a restructured Background panel. In reality the BackgroundSidePanel is fully built: it uses the generic FillPicker (solid+gradient), and renders 'Reset to theme', 'Apply to all slides', and an image/opacity section. The RightPanel union already includes "background" and the toolbar toggles it exactly as the doc 'proposes'.
  - _Evidence:_ packages/frontend/src/app/slides/background-side-panel.tsx (imports FillPicker + useSlideBackground; strings 'Reset to theme'/'Apply to all slides'/'Background'); packages/frontend/src/app/slides/slides-detail.tsx:152,535 (type RightPanel = "theme" | "format" | "motion" | "background" | null); packages/frontend/src/app/slides/use-slide-background.ts
- **[high] roadmap-shipped** — Proposal Details §1 and Phase 1 item 1 present widening fill from ThemeColor to Fill as future work ('Background.fill?: ThemeColor → Fill', 'MasterBackground.fill: ThemeColor → Fill', add gradient guard to isInheritableFill, resolveBackgroundFill returns Fill). All of this is already in the code: Background.fill is typed Fill, MasterBackground.fill is Fill, resolveBackgroundFill returns Fill, and isInheritableFill already has the `if (fill.kind === 'gradient') return false;` guard.
  - _Evidence:_ packages/slides/src/model/presentation.ts:28 (fill?: Fill), :187-198 (isInheritableFill(fill: Fill) with gradient guard), :208-220 (resolveBackgroundFill returns Fill); packages/slides/src/model/master.ts:20-21 (MasterBackground.fill: Fill)
- **[high] roadmap-shipped** — Proposal Details §2 and Phase 1 item 2 present swapping resolveColor → resolveFillStyle in both slide-renderer background paint sites (with the no-pasteboard bitmapW×bitmapH vs pasteboard SLIDE_WIDTH×slideH nuance) as future work. Both paint sites already call resolveFillStyle with exactly the described bitmap-size/logical-size arguments and the documented comment about the identity-CTM device-pixel case.
  - _Evidence:_ packages/slides/src/view/canvas/slide-renderer.ts:246-249 (no-pasteboard: resolveFillStyle(..., bitmapW, bitmapH)), :268-271 (pasteboard: resolveFillStyle(..., SLIDE_WIDTH, slideH))
- **[medium] roadmap-shipped** — Proposal Details §3 and Phase 1 item 3 present adding a gradient branch to migrateBackground (bg.fill.kind === 'gradient' ? migrateGradientFill : wrapColor) as future work. That exact ternary is already present.
  - _Evidence:_ packages/slides/src/model/migrate.ts migrateBackground (out.fill = bg.fill?.kind === 'gradient' ? migrateGradientFill(bg.fill) : wrapColor(bg.fill))
- **[medium] roadmap-shipped** — Proposal Details §6 and Phase 2 item 7 present PPTX <p:bg> gradient import (add a gradFill branch calling parseGradientFill) and export (swap solidFillXml → fillXml) as future work. The importer already has the gradFill branch calling parseGradientFill, and the exporter already dispatches through fillXml (which emits gradFill for gradients).
  - _Evidence:_ packages/slides/src/import/pptx/slide.ts:193-197 (parseSlideBackground gradFill → parseGradientFill); packages/slides/src/export/pptx/slide.ts:70-72 (backgroundToXml uses fillXml, handles blipFill/gradFill/solidFill)

### docs/design/slides/slides-format-options-panel.md

> The panel shell and its documented v1 sections exist as described, but every feature the doc explicitly frames as a deferred Non-Goal (drop shadow, reflection, recolor, image brightness/contrast) has actually shipped in both the data model and the panel UI, so the doc materially understates what exists.

- **[high] roadmap-shipped** — Doc Non-Goals list Drop shadow and Reflection as 'Tracked as separate v1.1+ specs' requiring new data fields, a paint pipeline, and OOXML mapping. Both are fully shipped: element.ts defines DropShadow, Reflection, and an Effects bag (effects?: Effects) on text/image/shape data with full OOXML mapping comments, and the panel ships drop-shadow-section.tsx and reflection-section.tsx wired into format-panel/index.tsx (DropShadowSection/ReflectionSection) and routed by pick-sections.ts for shape/image/text-element selections.
  - _Evidence:_ packages/slides/src/model/element.ts (DropShadow L174, Reflection L192, Effects L208-211); packages/frontend/src/app/slides/format-panel/drop-shadow-section.tsx, reflection-section.tsx; index.tsx L20-21,307-323; pick-sections.ts (returns 'drop-shadow','reflection')
- **[high] roadmap-shipped** — Doc Non-Goals list 'recolor' for images as a v1.1+ spec needing a new data field and OOXML <a:duotone> mapping. It is shipped: ImageElement.data has recolor?: ImageRecolor ('none'|'grayscale'|'sepia'), and recolor-section.tsx is mounted in the panel (RecolorSection) and routed by pick-sections for image selection.
  - _Evidence:_ packages/slides/src/model/element.ts (ImageRecolor L315, recolor?: L330); packages/frontend/src/app/slides/format-panel/recolor-section.tsx; index.tsx L17,289; pick-sections.ts (image returns 'recolor')
- **[high] roadmap-shipped** — Doc Non-Goals state 'Image brightness / contrast. Requires a canvas filter pipeline ... v1.1+' and the Image Adjustments section is documented as Transparency-only. Both fields exist (ImageElement.data.brightness/contrast, [-1,1], ctx.filter mapping) and image-adjustments-section.tsx renders brightness and contrast sliders alongside transparency.
  - _Evidence:_ packages/slides/src/model/element.ts (brightness L335, contrast L340); packages/frontend/src/app/slides/format-panel/image-adjustments-section.tsx L9-10,33-45 (brightness/contrast state + commit)
- **[medium] documented-not-implemented** — The pickSections mapping table in the doc is stale. Doc: shape→['size-position'], image→['size-position','image-adjustments','alt-text'], text-element→['size-position','text-fitting']. Actual pick-sections.ts returns shape→['size-position','drop-shadow','reflection','alt-text'], image adds recolor/drop-shadow/reflection, text-element adds drop-shadow/reflection/alt-text. The SectionId union is also expanded (recolor/drop-shadow/reflection) and a 'table' selectionType exists that the doc never mentions.
  - _Evidence:_ docs table L150-159 vs packages/frontend/src/app/slides/format-panel/pick-sections.ts (SectionId L3-10, ObjectSelectionType includes 'table' L13-20, per-type returns)
- **[medium] implemented-not-documented** — A slide-size-section (SlideSizeSection) is shipped in the panel and mounted in index.tsx, but the doc's file layout and section list do not mention any slide-size section at all.
  - _Evidence:_ packages/frontend/src/app/slides/format-panel/slide-size-section.tsx; index.tsx L14,243
- **[low] stale-reference** — Doc file layout places pick-sections.test.ts and units.test.ts as siblings inside format-panel/ and lists section unit tests there, but the format-panel source dir contains no test files; tests live under packages/frontend/tests/app/slides/format-panel/ and currently only alt-text-section.test.tsx and drop-shadow-section.test.tsx exist there (no pick-sections/units tests found).
  - _Evidence:_ packages/frontend/src/app/slides/format-panel/ (no *.test.*); packages/frontend/tests/app/slides/format-panel/ (alt-text-section.test.tsx, drop-shadow-section.test.tsx)

### docs/design/docs/docs-font-controls.md

> The doc is written as an unbuilt spec, but the entire feature — the shared text-formatting pickers, the editor API additions, and even a "More fonts" library expansion it explicitly lists as a Non-Goal — is already shipped and wired into the Docs toolbar.

- **[high] roadmap-shipped** — The doc frames the whole feature as future ('This document specifies adding... Four new files under...'). In reality every proposed component exists and is imported/rendered by the Docs toolbar: font-family-picker.tsx, font-size-picker.tsx, line-spacing-picker.tsx, clear-formatting-button.tsx, font-catalog.ts (with FONT_CATALOG and FONT_SIZE_PRESETS = [8,10,12,14,16,18,20,24,32,48,64,96] exactly as specified). A reader would think none of this is built.
  - _Evidence:_ packages/frontend/src/components/text-formatting/{font-family-picker,font-size-picker,line-spacing-picker,clear-formatting-button,font-catalog}.tsx|ts ; packages/frontend/src/app/docs/docs-formatting-toolbar.tsx imports FontFamilyPicker/FontSizePicker/LineSpacingPicker from @/components/text-formatting and renders them (lines 58-65, 428, 433, 625, 671, 691, 786)
- **[high] roadmap-shipped** — Non-Goals states a 'More fonts…' dialog and full-library expansion are explicitly out of scope ('Curated list only in v1; library expansion is a follow-up document'). That follow-up is already implemented: a searchable More-fonts dialog plus the full google/fonts-derived catalog and loader.
  - _Evidence:_ packages/frontend/src/components/text-formatting/more-fonts-dialog.tsx, more-fonts-filter.ts, font-catalog.full.ts, font-catalog-full-loader.ts; font-catalog.ts comment references the 'More fonts…' dialog as a live surface
- **[medium] documented-not-implemented** — Doc says the curated list is exactly 14 hardcoded entries defined in font-catalog.ts, groups limited to Korean/Sans-serif/Serif/Monospace. Actual FONT_CATALOG is FONT_CATALOG_DATA imported from a generated font-catalog.data.ts (~105+ entries) built from google/fonts metadata, and FontGroup adds 'Display' and 'Handwriting'.
  - _Evidence:_ packages/frontend/src/components/text-formatting/font-catalog.ts:16,18-24,66 (import FONT_CATALOG_DATA; FontGroup includes Display, Handwriting); font-catalog.data.ts ~105 'family:' entries
- **[medium] roadmap-shipped** — getRangeStyleSummary() is presented under 'Editor API additions' as something to add, but it is already defined on EditorAPI and implemented in editor.ts (with the mixed-value walk described). The actual return type also includes superscript/subscript, not just the doc's listed keys.
  - _Evidence:_ packages/docs/src/view/editor.ts:64-75 (interface), :2605 (implementation)
- **[medium] stale-reference** — Doc specifies a new method editor.clearFormatting(); the shipped method is named editor.clearInlineFormatting() (dispatches CLEAR_INLINE_STYLE via applyStyle). The rename means the documented symbol does not exist.
  - _Evidence:_ packages/docs/src/view/editor.ts:85 (clearInlineFormatting on EditorAPI), :2799-2803 (impl using CLEAR_INLINE_STYLE); no 'clearFormatting(' method present
- **[low] implemented-not-documented** — The shipped FontEntry interface carries fields the doc's proposed shape omits (weights, license, scripts, eager) and the loading model uses an 'eager' bootstrap subset plus per-family ensureFontLink(), richer than the doc's single-link description.
  - _Evidence:_ packages/frontend/src/components/text-formatting/font-catalog.ts:28-64 (FontEntry extra fields), :102-154 (buildGoogleFontsHref/ensureFontLink)

### docs/design/docs/docs-local-caret-anchoring.md

> The doc frames local caret/selection anchoring as an unbuilt proposal ("proposed fix", "should own", "Rollout Plan"), but the feature is fully implemented and wired end-to-end in yorkie-doc-store.ts and docs-view.tsx, matching the proposed design closely.

- **[high] roadmap-shipped** — The entire proposal is framed as future work ("The proposed fix is to anchor...", "should own the anchored representation", a "Rollout Plan" of steps to do, "before implementation"), but it is already shipped. The proposed types AnchoredDocPosition (region/yorkiePosition/lineAffinity) and AnchoredDocRange (anchor/focus/tableCellRange) exist verbatim; conversion (anchorDocPosition via tree.indexRangeToPosRange) and resolution (resolveAnchoredDocPosition via tree.posRangeToIndexRange) exist; local state localCursorAnchor/localSelectionAnchor/compositionStartAnchor is stored; and Rollout steps 1-5 are all done. A reader would be misled into thinking none of this exists yet.
  - _Evidence:_ packages/frontend/src/app/docs/yorkie-doc-store.ts: AnchoredDocPosition L51-59, AnchoredDocRange L61-64, anchor fields L510-512, anchorDocPosition L872-897, anchorDocRange L941-951, resolveAnchoredDocPosition L992-1017, resolveAnchoredLocalCursor L1097-1116, setCompositionStart L1142-1144
- **[high] roadmap-shipped** — The Data Flow section describes storing an anchor on cursor change and resolving it on remote change as the target design, but this exact flow is live: store.onRemoteChange resolves the anchored local cursor, restores it into the editor, updates the composition start position, and republishes presence. Composition anchoring is wired via editor.onCompositionStart/onCompositionEnd -> store.setCompositionStart. This is the described behavior, already running.
  - _Evidence:_ packages/frontend/src/app/docs/docs-view.tsx L364-387 (resolveAnchoredLocalCursor, restoreLocalCursor, updateCompositionStartPosition, publishResolvedLocalCursor; onCompositionStart/onCompositionEnd -> setCompositionStart)
- **[medium] stale-reference** — The Summary/Background state as CURRENT behavior that remote changes "do not transform that local offset" so the caret ends up pointing at a different character (the #237 bug). That is no longer true: remote changes now resolve the stored anchor back to a shifted DocPosition, so the stated present-tense bug is already fixed.
  - _Evidence:_ yorkie-doc-store.ts resolveAnchoredDocPosition L992-1017 + docs-view.tsx onRemoteChange L364-379 transform the offset via the Yorkie Tree anchor
- **[low] implemented-not-documented** — The shipped AnchoredDocPosition carries extra fields not in the doc's proposed type — blockId, offset, and regionTopIndex — which back the deterministic fallback ladder (fallbackAnchoredDocPosition uses regionTopIndex for prev/next region-block fallback). The doc's proposed type lists only region/yorkiePosition/lineAffinity.
  - _Evidence:_ yorkie-doc-store.ts AnchoredDocPosition L51-59 (blockId, offset, regionTopIndex), fallbackAnchoredDocPosition L1057-1089

### docs/design/frontend.md

> The sheet-engine integration sections (SheetView, YorkieStore, charts, conditional formatting, batch/CellIndex) are accurate, but the app-shell layer is stale: Document type, the editor-type set, routing/provider hierarchy, and presence mechanism all describe an older, sheets-plus-docs-plus-slides app that has since grown board/notes/PDF editors, workspaces, and folders.

- **[high] roadmap-shipped** — The Multi-Editor section frames editors as exactly three types (type: "sheet" | "doc" | "slides") with routes /s /d /p. In reality DocumentType has seven values and three more editors are fully shipped and routed: PDF/image (/f/:id FileDetail), note (/n/:id NotesDetail), and board (/b/:id BoardDetail). getDocumentPath maps all seven types. A reader would wrongly conclude board/notes/PDF editors do not exist.
  - _Evidence:_ src/types/documents.ts DocumentType = "sheet"|"doc"|"slides"|"pdf"|"note"|"image"|"board"; src/App.tsx routes /f/:id, /n/:id, /b/:id; src/app/documents/document-list-utils.ts getDocumentPath()
- **[high] stale-reference** — The Type Definitions block declares Document = { id: number; title; description; createdAt; updatedAt } with no type field. The shipped Document has id: string (not number), a required type: DocumentType, required workspaceId, and optional folderId/author/editors/canManage; updatedAt is optional. The inline type even contradicts the doc's own Multi-Editor section which references doc.type.
  - _Evidence:_ src/types/documents.ts Document type (id: string, type: DocumentType, workspaceId, folderId, author, editors, canManage)
- **[medium] stale-reference** — The routing diagram shows `/ → Documents`, `/settings`, and `/:id → DocumentDetail`. Actual routing: `/` is HomeOrRedirect (marketing/landing), the document list lives at `/documents` and workspace-scoped `/w/:workspaceId`, and there are additional top-level routes (/shared/:token, /invite/:token, /datasources, /harness/*, workspace analytics/settings/datasources). The entire workspaces + folders concept is absent from the doc. The provider hierarchy is also reordered: actual is ThemeProvider > TooltipProvider > QueryClientProvider > BrowserRouter, whereas the doc shows QueryClientProvider > ThemeProvider > BrowserRouter and omits TooltipProvider.
  - _Evidence:_ src/App.tsx (routes + provider nesting); src/app/home-or-redirect.tsx; src/main.tsx (StrictMode wraps App)
- **[medium] stale-reference** — The Presence section defines UserPresence = { activeCell?, activeTabId?, username, email, photo } and describes the flow as keyed on activeCell. The shipped UserPresence extends the full User (id, authProvider, username, email, photo) and carries `selection?: SelectionPresence` as the primary field, with activeCell explicitly annotated `// legacy fallback for mixed-version peers`. The doc documents the legacy field as the current mechanism.
  - _Evidence:_ src/types/users.ts UserPresence (selection?: SelectionPresence; activeCell marked legacy fallback)
- **[low] implemented-not-documented** — The Document Management API table lists only fetchDocuments/fetchDocument/createDocument/deleteDocument. api/documents.ts also exports renameDocument, moveDocument, moveDocuments, and deleteDocuments (bulk + move), and createDocument accepts optional type and fileId. Separately, data validation (data-validation-panel.tsx), a comments system, and share-links are shipped but unmentioned, and DataSource in the doc omits the workspaceId field present in code.
  - _Evidence:_ src/api/documents.ts; src/app/spreadsheet/data-validation-panel.tsx; src/api/share-links.ts; src/types/datasource.ts (workspaceId)

### docs/design/sheets/datasource.md

> File paths, crypto, SQL validation, query-execution limits, and ReadOnlyStore all match the code precisely, but the doc's per-user ownership/access model is stale — datasources are now workspace-scoped and shared among workspace members.

- **[high] documented-not-implemented** — The 'Access Control' section states 'Every operation verifies ds.authorID === userId. Users can only access their own datasources.' The actual controller instead calls workspaceService.assertMember(ds.workspaceId, userId) on every route — access is granted to any member of the datasource's workspace, not just the creator (authorID). A reader would be misled about who can read/query/edit a datasource.
  - _Evidence:_ packages/backend/src/datasource/datasource.controller.ts (assertMember on workspaceId at lines ~66,86-88,100-102,113-114); datasource.service.ts findAllByWorkspace (where: { workspaceId }), findRaw returns record for controller-layer access checks
- **[high] roadmap-shipped** — Current Limitation #5 'Single-user datasources — Connections are private to the creator; collaborators ... cannot use a datasource tab unless they own the connection' is contradicted by the shipped code, and the Medium-term roadmap item 'Shared datasources' is effectively already implemented at the workspace level: any workspace member (via assertMember) can list, get, and execute queries against another member's datasource.
  - _Evidence:_ packages/backend/src/datasource/datasource.controller.ts assertMember gating on /datasources/:id/query and list routes; prisma model DataSource has workspaceId + workspace relation (schema.prisma:37-38)
- **[medium] implemented-not-documented** — The API Endpoints table omits two workspace-scoped routes and mischaracterizes the flat create route. Code exposes 'POST workspaces/:workspaceId/datasources' and 'GET workspaces/:workspaceId/datasources', and the flat 'POST /datasources' now requires a workspaceId in the request body (CreateDataSourceInWorkspaceDto) rather than being a plain per-user create.
  - _Evidence:_ packages/backend/src/datasource/datasource.controller.ts:33,46 (workspace routes) and :60-67 (flat create uses dto.workspaceId + assertMember)
- **[medium] stale-reference** — The documented Prisma DataSource model omits the workspaceId String field and the workspace Workspace relation (onDelete: Cascade) that exist in the actual schema; the doc's model implies datasources are only tied to a User via authorID.
  - _Evidence:_ packages/backend/prisma/schema.prisma:24-39 includes workspaceId + workspace relation not shown in the doc's prisma block
- **[low] other** — Current Limitation #9 'No column type mapping — All values are displayed as strings regardless of the PostgreSQL data type' is slightly stale: the service installs a custom pg type parser (datasourceTypeParser) that overrides parsing for DATE/TIMESTAMP/TIMESTAMPTZ (kept as raw text to avoid timezone shift). It is a narrow workaround, not full type mapping, so the limitation is largely still true but the blanket 'regardless of type' wording is inaccurate.
  - _Evidence:_ packages/backend/src/datasource/datasource.service.ts:19-37 (RAW_TEXT_OIDS + datasourceTypeParser) and :206 (types: { getTypeParser: datasourceTypeParser })

### docs/design/sheets/sheet-image.md

> The frontend data model and Phase 1 floating-image feature match the code, but the entire backend storage section is wrong: the doc frames S3 as future infrastructure and describes a local-filesystem/Prisma-metadata design that was never built — the shipped service uses S3/MinIO directly with no database record.

- **[high] roadmap-shipped** — The doc lists 'S3 storage, thumbnails, CDN (future infrastructure)' as a Phase 1 Non-Goal, puts 'S3 migration' in the Phase 2 roadmap, and states storage is 'local filesystem via StorageService abstraction (swap to S3 later)'. In reality the shipped ImageService is S3-only: it uses @aws-sdk/client-s3 (S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand) against a MinIO endpoint configured via IMAGE_STORAGE_* env vars. S3 is the current implementation, not a future migration.
  - _Evidence:_ packages/backend/src/image/image.service.ts (S3Client, PutObjectCommand); packages/backend/src/image/image.config.ts (IMAGE_STORAGE_ENDPOINT default http://localhost:9000 MinIO, bucket wafflebase-images)
- **[high] documented-not-implemented** — The doc specifies a Prisma `model Image` (id, workspaceId, filename, mimeType, size, width, height, storagePath, createdBy, createdAt) and describes image.service.ts as 'Metadata CRUD (Prisma)' with an upload flow step 'ImageService creates Image record in database'. No such model exists in the schema and the service never touches Prisma — images are stored purely as S3 objects keyed by UUID+extension, with no DB metadata row.
  - _Evidence:_ grep 'model Image' / 'image' in packages/backend/prisma/schema.prisma returns nothing; packages/backend/src/image/image.service.ts has no Prisma/ConfigService DB access
- **[medium] documented-not-implemented** — The documented module structure lists a `storage.service.ts` ('File I/O abstraction (local, future S3)') providing a StorageService, and the upload flow says 'StorageService writes file to uploads/images/:wid/:id.ext'. There is no StorageService anywhere (grep returns zero hits) and no local uploads/ path; the actual image/ dir instead contains image.config.ts and image.constants.ts (not mentioned) and a second controller api/v1/images.controller.ts. I/O is done inline in ImageService via S3.
  - _Evidence:_ grep 'StorageService' packages/backend/src returns nothing; ls packages/backend/src/image/ = image.config.ts, image.constants.ts, image.controller.ts, image.module.ts, image.service.ts
- **[low] stale-reference** — The upload flow states the response is '{ id, url, width, height }'. The actual POST handler returns only '{ id, url }' — no width/height are computed or returned by the backend.
  - _Evidence:_ packages/backend/src/api/v1/images.controller.ts upload() returns { id: result.id, url }; ImageService.upload returns { id, url }

### docs/design/sheets/xlsx-style-import.md

> The doc's core premise — that XLSX style import is entirely unbuilt and this is the tracker to build it — is contradicted by shipped code: Phase 1 (styles.xml parsing → CellStyle, col widths, row heights, hidden) and Phase 2's range-style compaction are already implemented, though conditional formatting and the ff/fs/lk model extension remain correctly future.

- **[high] roadmap-shipped** — The Summary/Motivation/Root-cause sections assert this is unbuilt: 'Today importXlsxWorkbook reads only cell values, formulas, and merges. It never opens xl/styles.xml and never inspects the per-cell s= attribute, so every fill, border, font weight/color, alignment, number format, column width, hidden row/column ... is discarded on import.' In reality Phase 1 is fully shipped. xlsx-importer.ts imports parseStyleTable from ./xlsx-styles, reads XLSX_STYLES_PATH ('xl/styles.xml', line 47/420), reads each cell's s attribute and calls styleTable.resolveCellStyle (lines 351-354), and writes worksheet.rangeStyles (line 387). A reader is actively misled about what exists.
  - _Evidence:_ packages/sheets/src/import/xlsx-importer.ts lines 13, 47, 351-361, 387, 420; packages/sheets/src/import/xlsx-styles.ts (parseStyleTable, resolveCellStyle)
- **[high] roadmap-shipped** — The Motivation table marks Fills, Borders, Cell formats (cellXfs alignment/wrapText), Number formats, and Column widths/hidden cols all as '❌ Currently imported? No', and the Fonts row (bold/underline/strike) as ❌. All of these ARE imported: xlsx-styles.ts parses fonts (b/i/u/st, text color), fills (bg), borders (bt/br/bb/bl), numFmts (number/currency/percent/date), and alignment (al/va); the importer applies column widths via applyColumns, row heights and hidden rows via applyRowStyles, and hidden columns. Only font family/size (Roboto/Arial, 10/11pt) within the Fonts row remain unimplemented (Phase 3).
  - _Evidence:_ packages/sheets/src/import/xlsx-styles.ts lines 108-165 (fonts/fills/borders/numFmt parsing); packages/sheets/src/import/xlsx-importer.ts applyColumns (271-302), applyRowStyles (304-319), convertDateSerial (222-243)
- **[medium] stale-reference** — Root cause bullet: 'parseCell() (xlsx-importer.ts:187) reads only <f> and <v>; the s attribute is ignored.' The s attribute is not ignored — it is read and resolved in parseWorksheet (cell.getAttribute('s') → styleTable.resolveCellStyle) at lines 351-354. Also the line reference is off: parseCell is defined at line 198 (line 187 falls inside resolveCellValue).
  - _Evidence:_ packages/sheets/src/import/xlsx-importer.ts lines 198-211 (parseCell), 351-354 (s resolution)
- **[medium] roadmap-shipped** — Rollout Phase 2 bundles 'compaction' with 'conditional formatting'. The compaction half is shipped — the importer coalesces per-cell patches into maximal rectangles via coalesceRangeStylePatchesMaximal — but conditional-formatting import is genuinely not built (no conditionalFormatting/cfRule/dxfs parsing anywhere in packages/sheets/src/import). The doc frames all of Phase 2 as future. Additionally the Risks table names coalesceAdjacentRangeStylePatches as the Phase 1 coalescer, whereas the shipped importer calls coalesceRangeStylePatchesMaximal (both functions exist in range-styles.ts).
  - _Evidence:_ packages/sheets/src/import/xlsx-importer.ts line 387 (coalesceRangeStylePatchesMaximal); packages/sheets/src/model/worksheet/range-styles.ts lines 329 & 465; grep for conditionalFormatting/cfRule/dxfs in packages/sheets/src/import returned no matches

### docs/design/slides/slides-gradient-editing.md

> The editing UI and model type-discriminator shipped as described, but the doc's core linear+radial widening never landed (render/import/export/UI are still linear-only) and its "slide backgrounds stay solid-only" Non-Goal is contradicted by shipped gradient-background support.

- **[high] documented-not-implemented** — A core Goal ('Widen the model / renderer / importer / exporter from linear-only to linear + radial, preserving radial gradients through the PPTX round-trip') plus the entire Render, Import, and PPTX-export sections describe radial gradient support. Only the model's `type`/`center` fields shipped; the actual radial behavior did not. `resolveFillStyle` has no radial branch and never calls `createRadialGradient` (it only builds `createLinearGradient`). `parseGradientFill` still collapses every `<a:path>` gradient (including `path="circle"`) to a single stop with `type:'linear'` and never reads `<a:fillToRect>` or derives `center`. `gradFillXml` always emits `<a:lin ang>` with no `type` switch and no `<a:path path="circle">`/`fillToRect` output. `GradientEditor` has no Linear|Radial toggle and its own comment states 'Radial gradients are a later phase — this editor only ever emits type: \'linear\''. A reader would wrongly believe radial gradients round-trip and are editable.
  - _Evidence:_ packages/slides/src/view/canvas/render-context.ts:20-49 (linear-only resolveFillStyle, no createRadialGradient); packages/slides/src/import/pptx/shape.ts:956-962 ('<a:path>' collapsed to [stops[0]], type:'linear'); packages/slides/src/export/pptx/color.ts gradFillXml (always <a:lin>, doc-comment 'Serialize a linear GradientFill'); packages/frontend/src/app/slides/fill-picker/gradient-editor.tsx:50-54 ('this editor only ever emits type: linear')
- **[high] roadmap-shipped** — The Non-Goals list 'Gradient fills on text boxes, table cells, and slide backgrounds. Those remain solid-only parallel stacks.' Slide backgrounds actually DO support gradient fills now: `Background.fill` is typed `Fill` (which includes `GradientFill`), the background side panel renders the same `FillPicker` (Solid|Gradient tabs), and `use-slide-background` implements `onChangeGradient`/`persistGradient` writing a gradient fill via `updateSlideBackground({ fill })` with a live-drag `gradientDraft`. (Text boxes and table cells do remain solid-only — table-controls uses ThemedColorPicker directly — so the non-goal is only wrong about backgrounds.)
  - _Evidence:_ packages/slides/src/model/presentation.ts:28 (Background.fill?: Fill); packages/frontend/src/app/slides/background-side-panel.tsx:105-111 (FillPicker with onChangeGradient); packages/frontend/src/app/slides/use-slide-background.ts:95-124,193 (onChangeGradient/persistGradient → updateSlideBackground({fill}))

### docs/design/slides/slides-image-crop.md

> The doc's entire premise — that the interactive crop UX is "missing" and only a disabled placeholder ships — is inverted: the full P0 crop feature (editor session, active toolbar button, double-click entry, model helpers, renderer overlay, tests) is already shipped.

- **[high] roadmap-shipped** — The Summary states 'What is missing is the interactive crop UX: there is no way for a user to define or adjust a crop in the editor' and 'The toolbar ships a disabled IconCrop placeholder ... deferred to a separate spec'. In current code the whole P0 crop UX is fully implemented: editor.ts has cropSession, enterImageCrop/exitImageCrop/isCropping/onCropChange/resetImageCrop, double-click on an image enters crop (el.type==='image' branch), and the toolbar Crop button is active (calls enterImageCrop, shows aria-pressed/'Done cropping'). A reader would be misled into thinking none of this exists.
  - _Evidence:_ packages/slides/src/view/editor/editor.ts (cropSession at 831; enterImageCrop at 3677; exitImageCrop at 1350/2209/2215; image double-click branch ~3671-3679); packages/frontend/src/app/slides/toolbar/image-controls.tsx:90-138 (active Crop button, isCropping/onCropChange, aria-pressed)
- **[high] roadmap-shipped** — The doc lists model helpers, renderer overlay, and coordinate math as proposed new work to add. They are already implemented: model/image-crop.ts exports applyCropHandle, panFull, windowToFrame, rotateVec, MIN_CROP_PX and crop/full derivation; image-renderer.ts exports drawCropPreview used by slide-renderer.ts. Dedicated tests also already exist.
  - _Evidence:_ packages/slides/src/model/image-crop.ts (applyCropHandle:72, panFull:109, windowToFrame:168, MIN_CROP_PX:32); packages/slides/src/view/canvas/image-renderer.ts:107 drawCropPreview; test/model/image-crop.test.ts, test/view/canvas/crop-preview.test.ts, test/view/editor/image-crop-session.test.ts
- **[low] stale-reference** — Proposed API/structure names differ from what shipped: doc specifies methods enterCropMode/exitCropMode and a croppingElementId field, plus a new interactions file view/editor/interactions/crop.ts. Shipped code uses enterImageCrop/exitImageCrop (no croppingElementId field — only cropSession), and places helpers in model/image-crop.ts with the session inline in editor.ts (no crop.ts interaction file exists).
  - _Evidence:_ grep found no croppingElementId or crop.ts in packages/slides; editor.ts uses cropSession + enterImageCrop/exitImageCrop; helpers live in packages/slides/src/model/image-crop.ts
- **[low] stale-reference** — The 'existing surface' table cites the toolbar path as 'frontend/.../toolbar/image-controls.tsx' with state 'partial (Crop disabled)'. Actual path is packages/frontend/src/app/slides/toolbar/image-controls.tsx and the Crop button is fully wired, not disabled.
  - _Evidence:_ packages/frontend/src/app/slides/toolbar/image-controls.tsx:124-138

### docs/design/slides/slides-native-undo.md

> The doc is written as a future proposal to migrate YorkieSlidesStore off snapshot undo, but that migration is already fully shipped in code, so the doc's "current behavior" description and its entire proposal are stale.

- **[high] roadmap-shipped** — The doc's whole thesis ("This document specifies migrating Slides to doc.history ... and removing the snapshot machinery") is already implemented. YorkieSlidesStore uses doc.history.undo()/redo(), the ambient-root batch refactor (activeRoot/activePresence/withUpdate), the undoFloor + canUndo floor gate, and even markUndoBaseline — exactly as proposed. The class doc-comment itself cites this design doc as the shipped rationale.
  - _Evidence:_ packages/frontend/src/app/slides/yorkie-slides-store.ts: undo()/redo() at ~L632-645 call this.doc.history.undo()/redo(); withUpdate() L590-596; batch() single doc.update L598-630; undoFloor field L347 + canUndo() L647-656; markUndoBaseline() L669-671; class comment L302-314 references docs/design/slides/slides-native-undo.md
- **[high] documented-not-implemented** — The Summary describes CURRENT YorkieSlidesStore behavior as snapshot-based: "batch() pushes a full SlidesDocument snapshot onto an undoStack, and undo() restores it by reconciling the live Yorkie root against the snapshot." None of this exists in the Yorkie store anymore. grep for undoStack/redoStack/replaceRoot/reconcileArrayById/reconcileObjectFields/updateGroupData in yorkie-slides-store.ts returns nothing; that snapshot machinery survives only in MemSlidesStore (memory.ts L1791-1808), which the doc correctly scopes as a Non-Goal. A reader would be misled into thinking the Yorkie store still snapshots.
  - _Evidence:_ grep of packages/frontend/src/app/slides/yorkie-slides-store.ts finds no undoStack/redoStack/replaceRoot/reconcile* symbols; packages/slides/src/store/memory.ts L1791-1808 still has this.undoStack.push / this.redoStack
- **[medium] roadmap-shipped** — The Test Strategy lists tests to "Add" (multi-element-drag grouping test; undo-floor test ported from Docs) and to "Keep" ("one batch = one undo entry"). These already exist and pass, under a describe block explicitly named for native doc.history.
  - _Evidence:_ packages/frontend/tests/app/slides/yorkie-slides-store.test.ts: describe 'YorkieSlidesStore — undo/redo (Yorkie-native doc.history)' L202; 'one batch = one undo entry' L203; 'groups a multi-element drag into a single undo unit' L217; 'cannot undo past the seeded initial state (undo floor)' L259; 'markUndoBaseline protects a post-construction deck seed' L286

### docs/design/slides/slides-theme-catalog.md

> The doc's proposed change (de-brand defaults, expand to 23 themes) is fully shipped in code, yet the doc still frames it as an unbuilt "Proposal/Rollout" and its "Current state" section describes the obsolete 5-theme brand-baked state as if it were present.

- **[high] stale-reference** — The 'Current state' section claims packages/slides/src/themes/index.ts 'registers five themes in picker order: defaultLight, defaultDark, streamline, focus, material' and shows default-light.ts binding accent1: palette.syrup with brand display fonts. The real current code registers 23 themes in BUILT_IN_THEMES and default-light.ts is already de-branded (accent1: '#1A73E8', fonts: Inter/Inter). The section describes the pre-change state as if it were current, actively misleading a reader about what exists.
  - _Evidence:_ packages/slides/src/themes/index.ts (BUILT_IN_THEMES has 23 entries: defaultLight..beachDay, wafflebase); packages/slides/src/themes/default-light.ts (accent1 '#1A73E8', Inter); git log commit 57e964683 '#383 de-brand defaults, expand to 23 themes'
- **[high] roadmap-shipped** — The entire doc is written as a forward-looking proposal ('This design de-brands...', 'Proposal', 'Rollout: Single PR, commit-layered', 'Acceptance: BUILT_IN_THEMES has 23 entries'). All of it is already implemented and merged: 23 theme literals exist, default-light/dark are de-branded, and a dedicated wafflebase.ts brand theme with palette.syrup/butter/berry/leaf bindings ships last in the picker exactly as proposed.
  - _Evidence:_ packages/slides/src/themes/wafflebase.ts (brand palette + typography.display/body); packages/slides/src/themes/index.ts (23-entry BUILT_IN_THEMES, wafflebase last); git commit 57e964683 (#383)
- **[medium] stale-reference** — The Testing section names two unit tests at packages/slides/src/themes/*.test.ts: 'catalog.test.ts' and 'fonts-in-catalog.test.ts'. catalog.test.ts exists as claimed, but 'fonts-in-catalog.test.ts' does not exist in that directory; the font-in-catalog assertion shipped instead as packages/frontend/src/app/slides/theme-fonts.test.ts. The doc also omits the shipped packages/slides/src/themes/debrand.test.ts.
  - _Evidence:_ packages/slides/src/themes/catalog.test.ts and debrand.test.ts exist; no fonts-in-catalog.test.ts anywhere; packages/frontend/src/app/slides/theme-fonts.test.ts ('theme fonts are in the catalog')
- **[low] stale-reference** — The doc refers to the brand tokens package as '@wafflebase/tokens' (Summary line 14, De-branding line 101, line 170). The shipped wafflebase.ts imports palette/typography from '@wafflebase/core/tokens' — the tokens were extracted into @wafflebase/core (commit 174c7e006 'Extract @wafflebase/core').
  - _Evidence:_ packages/slides/src/themes/wafflebase.ts line 2: import { palette, typography } from '@wafflebase/core/tokens'; git commit 174c7e006

### docs/design/slides/slides-themes-layouts-import.md

> The core theme/layout/import model, resolvers, and store mutations match code, but the doc's Non-Goals/Future sections mis-frame several features as out-of-scope/deferred that have actually shipped (PPTX export, first-class groups, first-class tables, a 100+-kind shape registry).

- **[high] roadmap-shipped** — Doc lists PPTX export as a Non-Goal ('out of scope. PDF export remains the only export format. PPTX export is on the v2 backlog') and repeats it under Future/Out of Scope. In reality a full PPTX exporter is shipped and wired end-to-end (package export, frontend action, CLI command).
  - _Evidence:_ packages/slides/src/export/pptx/ (20 files incl. index.ts's 451-line exportPptx); packages/slides/src/index.ts:250 `export { exportPptx }`; packages/frontend/src/app/slides/pptx-actions.ts:2,92; packages/cli/src/slides/pptx-export.ts + packages/cli/src/commands/slides.ts:175 `.command('export <doc-id> <file>').description('Export a slide deck to PPTX')`
- **[high] roadmap-shipped** — Doc Non-Goals says 'Group elements as a first-class kind — still v2' and that PPTX <p:grpSp> is 'flattened on import' (mapping table: ⚠️ group lost); Future repeats 'Group / ungroup elements — still v2'. Code has a first-class GroupElement and the importer preserves grpSp as a GroupElement (not flattened), with group/ungroup editor + toolbar ops.
  - _Evidence:_ packages/slides/src/model/element.ts:399 `GroupElement` (type:'group'); packages/slides/src/import/pptx/shape.ts:138,169,185,204 'preserving groups as GroupElement'; packages/frontend/src/app/slides/toolbar/arrange-menu.tsx (group/ungroup)
- **[medium] roadmap-shipped** — Doc mapping table and 2026-05-15 re-validation frame PPTX tables as lossy — a 'Matrix of TextElements + border ShapeElements per cell' until docs-tables integration in v1.5. Code imports tables as a first-class TableElement.
  - _Evidence:_ packages/slides/src/model/element.ts:533 `TableElement` (type:'table'); packages/slides/src/import/pptx/table.ts:78-94 builds a TableElement and returns [table]
- **[medium] roadmap-shipped** — Non-Goals says 'Shape library expansion beyond rect/ellipse/line/arrow/roundRect — v2 work. Unsupported PPTX shapes become a placeholder rect on import' and Future repeats 'chevron, donut, blockArc, can, etc. remain placeholder rects until v2'. Code ships a large ShapeKind registry (chevron/donut/blockArc/can/uturnArrow and 100+ kinds). The doc's own re-validation section acknowledges the '117-kind registry' but the Non-Goals/Future scoping sections were not updated.
  - _Evidence:_ packages/slides/src/model/element.ts:54 `export type ShapeKind =` large union incl 'donut'(61),'blockArc'(62),'chevron'(72),'uturnArrow'(75); shape renderers under packages/slides/src/view/canvas/shapes/{flowchart,arrows,callouts,stars,banners,...}
- **[low] stale-reference** — Primary sections (Goals, 'Built-in themes (5)', theme table, picker mockup) present 5 built-in themes as the shipped set; 23 theme modules ship. The doc's PR3 re-review self-corrects ('theme count grew 5 → 23'), so it is internally acknowledged but the main sections remain stale.
  - _Evidence:_ packages/slides/src/themes/ contains 23 theme modules (default-light, default-dark, streamline, focus, material, beach-day, coral, forest, geometric, luxe, marina, modern-writer, momentum, paradigm, plum, pop, shift, slate, spearmint, spotlight, swiss, tropic, wafflebase)
- **[low] stale-reference** — Yorkie-deck table cites SLIDE_WIDTH/HEIGHT at 'presentation.ts:50-51'; the constants live at lines 238/243. Constants exist as described; only the line reference is stale.
  - _Evidence:_ packages/slides/src/model/presentation.ts:238 `export const SLIDE_WIDTH = 1920;`, :243 `export const SLIDE_HEIGHT = 1080;`

### docs/design/slides/slides-tables.md

> The doc's data model, Yorkie schema, and store signatures match shipped code closely, but it is framed as a forward-looking proposal (P1–P6 plan, "cell selection arrives in P3") when in reality nearly the entire feature — cell-range selection, structural ops, Yorkie collaboration, and PDF export — is already implemented.

- **[high] roadmap-shipped** — The 'Known limitations (P1)' section states 'Cell-range selection is absent... Cell selection, Tab/Shift+Tab navigation, and structural ops arrive in P3.' All of this is shipped: the editor implements cell-range selection and hit-testing, and structural ops exist in both stores.
  - _Evidence:_ packages/slides/src/view/editor/editor.ts (startCellRangeDrag, tableCellAtPoint, projectCellRangeRects, cellRangeRects overlay); packages/slides/src/view/editor/overlay.ts makeCellRangeRect; packages/slides/src/view/editor/interactions/keyboard.ts (cell-range delete via withTableCellBody); packages/slides/src/view/canvas/table-renderer.ts exports tableCellAtPoint/tableEdgeAt/nextCellInDirection
- **[high] roadmap-shipped** — The Phasing table presents P1–P6 as a forward plan, but P3 (cell editing/text-bridge), P4 (insert/delete row+col, merge/unmerge, drag-resize), P5 (YorkieSlidesStore table ops + selectedTableCells presence + concurrent integration test), and P6 (PDF export table case) are all shipped in the current tree. The proposal is effectively built, not planned.
  - _Evidence:_ packages/slides/src/store/memory.ts and packages/frontend/src/app/slides/yorkie-slides-store.ts implement insertTableRow/deleteTableRow/insertTableColumn/deleteTableColumn/mergeTableCells/unmergeTableCells/updateTableColumnWidths/updateTableRowHeights/updateTableCellStyle/withTableCellBody; packages/frontend/tests/app/slides/yorkie-slides-table-concurrent.integration.ts; packages/slides/src/export/pdf.ts line 238 (el.type === 'table' case)
- **[low] documented-not-implemented** — The Store interface section adds `addTable(slideId, init)` as the table-creation method. No `addTable` exists on SlidesStore; tables are created through the generic `addElement(slideId, init: ElementInit)` plus the editor's `insertTable(rows, cols, opts)` helper.
  - _Evidence:_ packages/slides/src/store/store.ts (addElement at line 167, no addTable); packages/slides/src/view/editor/editor.ts insertTable at line 1558; grep for addTable across store files returns nothing
- **[low] documented-not-implemented** — PPTX import section says the retired counters are 'replaced with ctx.report.tablesImported (success count) and ctx.report.tableCellsImported.' The code retired tableMergesIgnored/tableBordersApproximated but added no replacement counters; report.ts comment states 'there is no lossy path to count.' No tablesImported/tableCellsImported exists.
  - _Evidence:_ packages/slides/src/import/pptx/report.ts lines 28-31; grep for tablesImported/tableCellsImported returns no code hits
- **[low] stale-reference** — P5 verification names the integration test `two-user-slides-table-yorkie.ts`, but the actual concurrent Yorkie table test is named differently.
  - _Evidence:_ actual file packages/frontend/tests/app/slides/yorkie-slides-table-concurrent.integration.ts; grep for two-user-slides-table finds nothing

### docs/design/design-system-unification.md

> The token/toolbar architecture and named files all check out, but the Status table and the PR #5 narrative are stale — notably the doc claims Sheets has no formatting toolbar and marks it "Not started" while a fully-wired Sheets FormattingToolbar is shipped on main.

- **[high] roadmap-shipped** — PR #5 body states "Sheets currently has no formatting toolbar — all formatting flows through context menus and side panels" and the Status table marks #5 "Not started". In reality a Sheets FormattingToolbar is shipped and mounted: it provides bold/italic, horizontal+vertical alignment, number format, and text/background color via the shared ToolbarButton/ColorPickerGrid — exactly the "minimal set" PR #5 describes. The doc even contradicts itself: Phase 2 ("shipped") says it migrated the Sheets `formatting-toolbar` buttons to ToolbarButton.
  - _Evidence:_ packages/frontend/src/components/formatting-toolbar.tsx (export function FormattingToolbar; imports Toolbar/ToolbarSeparator/ToolbarButton, BG_COLORS/TEXT_COLORS, IconBold/IconItalic/IconAlign*, NumberFormat/VerticalAlign from @wafflebase/sheets), imported by packages/frontend/src/app/spreadsheet/sheet-view.tsx
- **[medium] roadmap-shipped** — Status table lists "Toolbar dropdown unification (Phases 1–3)" as "In review — PR #498 ... 2026-07-19", but PR #498 was merged to main (its Phase 1/2/3 artifacts — toolbar.tsx ToolbarButton with variant icon|menu + forwardRef, color-swatch.tsx, ui/popover.tsx — are all present on main).
  - _Evidence:_ git log main: 5daa1bfde "Unify toolbar dropdowns across editors (#498)" touches packages/frontend/src/components/ui/toolbar.tsx, color-swatch.tsx, ui/popover.tsx
- **[medium] roadmap-shipped** — Status table shows PR #1 `@wafflebase/tokens` package as "Ready to merge — Branch tokens-package, 2026-05-24". It is actually fully shipped: the tokens package landed (PR #292) and was then folded into @wafflebase/core/tokens (PR #477). The doc body carries an "Update (superseded location)" note about the core fold, but the Status row was never updated to reflect that the work merged.
  - _Evidence:_ packages/core/src/tokens/{palette,semantic,radius,typography,contrast,index}.ts exist; git log 174c7e006 "Extract @wafflebase/core (tokens + geometry) — shared-core PR1 (#477)"; f36873543 "Introduce @wafflebase/tokens shared design tokens package (#292)"
- **[medium] roadmap-shipped** — PR #3 "Shared toolbar components" is marked "Not started", but two of its four listed deliverables shipped via #498: `<ToolbarButton>` (packages/frontend/src/components/ui/toolbar.tsx) and `<ColorSwatch>` (packages/frontend/src/components/color-swatch.tsx). Only the `<EditorToolbar>` shell and `<ToolbarGroup>` remain unbuilt (no such symbols found anywhere in packages/frontend/src). The doc's own audit section admits the shared Toolbar/ToolbarButton already exist, but the Status row still reads "Not started".
  - _Evidence:_ packages/frontend/src/components/ui/toolbar.tsx exports Toolbar/ToolbarSeparator/ToolbarButton; packages/frontend/src/components/color-swatch.tsx exports ColorSwatch; grep for EditorToolbar/ToolbarGroup returns no matches
- **[low] stale-reference** — Surface-inventory table row "Toolbars | ... Sheets (none)" is stale (a Sheets toolbar exists). The doc partly self-corrects in the 2026-07 audit section ("the surface inventory above predates" the Notes/Sheets toolbars), so this is acknowledged staleness rather than a hidden error.
  - _Evidence:_ packages/frontend/src/components/formatting-toolbar.tsx (Sheets) vs doc line "Sheets (none)"

### docs/design/docs/docs-docx-import-export.md

> The design is implemented with high fidelity, but the doc still frames the entire feature as unbuilt future work when it is fully shipped and released in v0.3.2.

- **[high] roadmap-shipped** — The doc frames the whole feature as future/planned work: the Summary says these are 'prerequisite features that the Docs model does not yet support', Goals are imperative ('Add the ability'), and everything is under 'Phase 1/2/3'. In reality all of it is shipped and released: inline images (ImageData + image field on InlineStyle in model/types.ts), the backend S3/image module, web-font loading, DOCX import, and DOCX export. A reader would be misled into thinking none of this exists yet.
  - _Evidence:_ packages/docs/src/import/docx-importer.ts (parseHeaderFooter, convertTable recursion, findDirectChild all present), packages/docs/src/export/docx-exporter.ts (DocxExporter class, buildHeaderFooterXml), packages/backend/src/image/{image.controller.ts @Controller('images') POST/GET(:id)/DELETE(:id), image.config.ts IMAGE_STORAGE_* env vars, image.service.ts @aws-sdk/client-s3}, packages/docs/src/view/fonts.ts (Malgun Gothic/Batang/Noto Sans KR mapping), model/types.ts:119 ImageData & :185 image?, docker-compose.yaml minio service, archived completion todo docs/tasks/archive/2026/04/20260410-docx-import-export-todo.md
- **[low] stale-reference** — The File Structure section lists export/docx-builder.ts ('XML generation utilities'), but no such file exists; the XML-generation module is actually named docx-templates.ts.
  - _Evidence:_ packages/docs/src/export/ contains docx-exporter.ts, docx-style-map.ts, docx-templates.ts (no docx-builder.ts)
- **[low] stale-reference** — The doc references adding MinIO to docker-compose.yml and lists docker-compose.yml in the File Structure, but the actual file is docker-compose.yaml (and it already contains the minio service).
  - _Evidence:_ docker-compose.yaml lines 20-31 (minio service); no docker-compose.yml exists at repo root
- **[low] implemented-not-documented** — The import File Structure omits import/units.ts, a shipped module used for OOXML unit conversions.
  - _Evidence:_ packages/docs/src/import/units.ts exists but is not listed in the doc's File Structure

### docs/design/docs/docs-comments.md

> The core docs-comments design (shared module, Yorkie store, orphan/anchor handling, editor setCommentMarkers, bootstrap comments seeding) is faithfully implemented, but the doc's Non-Goals and consumer/type-ownership claims are now materially stale: @user mentions shipped, a whole undocumented PDF-comments consumer exists, base types are owned by @wafflebase/sheets rather than the frontend module, and the described visual test harness does not exist.

- **[high] roadmap-shipped** — Non-Goals and Phase Plan step 4 list '@user mentions and notifications (later phase)' as not built, but @user mentions are fully shipped: encode/parse/query/apply helpers plus a mention picker are wired into the composer and rendered bodies.
  - _Evidence:_ packages/frontend/src/components/comments/mentions.ts (serializeMention, parseMentionBody, detectMentionQuery, applySelectedMentions, extractMentionedUserIds), use-workspace-members.ts, and usage in components/CommentComposer.tsx, CommentBody.tsx, CommentSidePanel.tsx; tests/components/comments/comment-composer-mentions.test.ts. (Notifications/backend job remain unbuilt, consistent with the doc.)
- **[medium] implemented-not-documented** — The CommentAnchor union and consumer list omit a shipped PDF consumer. The shared union now includes a 'pdf-region' variant (PdfRegionAnchor) and a full app/files/comments/ consumer, none of which the doc mentions (it lists only sheets/docs/slides).
  - _Evidence:_ packages/frontend/src/types/comments.ts (PdfRegionAnchor, CommentAnchor = SheetCellAnchor | DocsRangeAnchor | PdfRegionAnchor); packages/frontend/src/app/files/comments/pdf-comment-store.ts, pdf-comments-controller.ts; tests/app/files/pdf-comment-store.test.ts
- **[medium] documented-not-implemented** — The doc lists packages/frontend/visual/docs-comments.spec.ts as a NEW file and devotes section 8.3 to a visual/interaction harness there, but neither the file nor the packages/frontend/visual/ directory exists.
  - _Evidence:_ packages/frontend/visual/ does not exist (ls: No such file or directory); no docs-comments.spec.ts found anywhere under packages/frontend
- **[medium] other** — Ownership drift vs stated boundaries. The doc says the shared frontend module owns the comment data model (types.ts defines Comment/CommentAuthor/Thread/CommentAnchor) and that packages/sheets is untouched (Non-Goal #1). In reality Comment/CommentAuthor and the base Thread<A> are owned by @wafflebase/sheets and re-exported; components/comments/types.ts is a re-export shim and the anchor union lives in @/types/comments.ts, not the module's own types.ts.
  - _Evidence:_ packages/frontend/src/components/comments/types.ts (re-exports from @/types/comments.ts); packages/frontend/src/types/comments.ts imports Comment/CommentAuthor/Thread from '@wafflebase/sheets'; packages/sheets/src/comment/types.ts defines Comment, CommentAnchor, generic Thread<A>
- **[low] stale-reference** — Editor API signatures differ from the doc: doc declares setCommentMarkers(rects: HighlightRect[]) with a HighlightRect type; code has setCommentMarkers(markers: CommentMarker[]) and getCommentMarkerAt(clientX, clientY) rather than (x, y).
  - _Evidence:_ packages/docs/src/view/editor.ts:198 setCommentMarkers(markers: CommentMarker[]); :206 getCommentMarkerAt(clientX, clientY)
- **[low] stale-reference** — Test file locations differ from the doc, which shows colocated __tests__ (src/components/comments/__tests__/, src/app/docs/__tests__/comments.test.ts). Actual tests live under a top-level packages/frontend/tests/ mirror.
  - _Evidence:_ packages/frontend/tests/components/comments/mem-comment-store.test.ts, tests/app/docs/comments/yorkie-comment-store.test.ts (no src/**/__tests__ comment dirs)
- **[low] stale-reference** — Minor interface drift: the doc labels CommentStore as a '6 methods' interface CommentStore<A>, but the shipped interface has 7 members and an extra type parameter CommentStore<A, AnchorInput = A>.
  - _Evidence:_ packages/frontend/src/components/comments/comment-store.ts (CommentStore<A, AnchorInput = A>; addThread/addReply/editComment/deleteComment/setThreadResolved/listThreads/subscribe)
- **[low] stale-reference** — Section 4's DocsDocument schema lists root.header and root.footer as existing JSON fields; the actual Yorkie docs root has no header/footer and instead carries a stylesJson field (comments? and pageSetup? match).
  - _Evidence:_ packages/frontend/src/types/docs-document.ts YorkieDocsRoot = { content, pageSetup?, stylesJson?, comments? }

### docs/design/pdf.md

> Phase 1 is implemented accurately, but the entire Phase 2 (share-token serving, comments, presence, shared route, Share button) is fully shipped despite the doc framing it as an unbuilt "implementation spec," and the FileService now accepts images too, contradicting its stated PDF-only scope.

- **[high] roadmap-shipped** — The doc frames all of Phase 2 as future work ("covers ... Phase 2 as an implementation spec", "the order below is also the intended PR sequence", Non-Goals list comments/presence/share-token viewing as "moved to Phase 2 below"). In reality every Phase 2 slice is shipped: Slice 1 share-token serving, Slice 2 pdf-<id> Yorkie doc + comment store, Slice 3 comment UI/region pins, Slice 4 presence, Slice 5 shared route + Share button. A reader would be misled into thinking PDF comments/sharing/presence do not yet exist.
  - _Evidence:_ packages/backend/src/document/document-file.controller.ts (OptionalJwtAuthGuard + ?token= share-link resolution = Slice 1); packages/frontend/src/app/files/pdf-collab.tsx (DocumentProvider docKey=`pdf-${id}`, initialRoot, activePage presence write), comments/pdf-comment-store.ts, comments/pdf-comments-controller.ts, pdf-comment-layer.tsx; packages/frontend/src/types/comments.ts (PdfRegionAnchor in CommentAnchor union); packages/frontend/src/types/users.ts (PdfPresence); packages/frontend/src/types/pdf-document.ts (initialPdfRoot seeding comments:{}); packages/frontend/src/app/shared/shared-document.tsx (`if (resolved.type === 'pdf')` case); packages/frontend/src/app/files/file-detail.tsx (ShareDialog header button); packages/frontend/src/api/files.ts (pdfFileUrl appends token)
- **[medium] implemented-not-documented** — The Storage layer section states FileService "accepts application/pdf only" and that the image/ module is left untouched with a clean boundary. The shipped FileService actually also accepts image/png, image/jpeg, image/gif, image/webp with a separate 25 MB image cap (MAX_IMAGE_UPLOAD_BYTES) alongside the 50 MB PDF cap, and there is a whole 'image' document type (image-viewer.tsx, DocumentType 'image', file-shell handling image docs) the doc never mentions.
  - _Evidence:_ packages/backend/src/file/file.config.ts (allowedMimeTypes includes the four image types); packages/backend/src/file/file.service.ts (MIME_TO_EXT + per-category cap using MAX_IMAGE_UPLOAD_BYTES); packages/backend/src/file/file.constants.ts (MAX_IMAGE_UPLOAD_BYTES, VALID_FILE_ID_PATTERN allows png/jpe?g/gif/webp); packages/frontend/src/app/files/image-viewer.tsx; packages/frontend/src/types/documents.ts (DocumentType includes 'image')
- **[low] stale-reference** — The Serving section says blob deletion is done by hooking into DocumentService delete. In the code the DocumentService delete methods do no blob cleanup; cleanup is done best-effort in the controller after deletion (per the deleteDocuments doc-comment). Minor location drift, not a missing feature.
  - _Evidence:_ packages/backend/src/document/document.service.ts:126-143 (deleteDocument/deleteDocuments have no fileService.delete; comment: "Blob cleanup ... is done best-effort by the controller after this returns")
- **[low] stale-reference** — The doc says blob-id validation "mirrors VALID_IMAGE_ID_PATTERN"; the shipped constant is named VALID_FILE_ID_PATTERN and validates both pdf and image extensions, reflecting the broadened (non-PDF-only) file module. Cosmetic naming/scope drift.
  - _Evidence:_ packages/backend/src/file/file.constants.ts (VALID_FILE_ID_PATTERN); referenced in packages/backend/src/document/document-file.controller.ts

### docs/design/sharing.md

> The ShareLink model, REST endpoints, permission matrix, and sheet/docs read-only modes match the code exactly, but the doc's security section is materially stale: server-side write protection and rate limiting are actually shipped, and sharing now covers four document types the doc never mentions.

- **[high] roadmap-shipped** — The doc's Non-Goals says 'Server-side write protection — view-only enforcement is client-side only', the Security section says view-only is 'enforced in the browser' and 'Yorkie does not support per-user write auth', and the Risks section frames server-side enforcement as future ('server-side enforcement can be added later via Yorkie webhooks'). In reality the Yorkie auth webhook enforces share-link roles server-side: for an anonymous share visitor hasAccess() returns `needWrite ? link.role === 'editor' : true`, so a viewer-role token requesting an 'rw' verb is denied (403). A reader is actively misled about the security posture — writes by viewer links ARE blocked server-side.
  - _Evidence:_ packages/backend/src/document/yorkie-auth.controller.ts hasAccess() lines ~171-204 (return needWrite ? link.role === 'editor' : true); imports ShareLinkService; checkAttribute returns 403 on no access
- **[medium] roadmap-shipped** — The doc says 'No rate limiting on token resolution — The public resolve endpoint could be brute-forced ... rate limiting via @nestjs/throttler can be added as needed.' @nestjs/throttler is in fact installed and wired globally as an APP_GUARD ThrottlerGuard (default 120 req/min), and the resolve controller carries no @SkipThrottle, so GET /share-links/:token/resolve is already rate limited.
  - _Evidence:_ packages/backend/src/app.module.ts lines 91-119 (ThrottlerModule.forRoot + APP_GUARD ThrottlerGuard); packages/backend/src/share-link/share-link.controller.ts resolve() has no SkipThrottle
- **[medium] implemented-not-documented** — The doc only documents shared read-only support for the Sheet and Docs packages, and its 'Shared document route' section describes rendering 'the spreadsheet' following tabOrder. The shipped shared route additionally handles slides, notes, board, and PDF document types with dedicated read-only layouts, and the resolve endpoint returns a `type` used to branch across all of them. A reader would think only sheets and docs are shareable.
  - _Evidence:_ packages/frontend/src/app/shared/shared-document.tsx SharedSlidesLayout, SharedNotesLayout, SharedBoardLayout, SharedPdfLayout and docKey branching over type doc/slides/note/board/pdf/sheet

### docs/design/sheets/comments.md

> The Phase B core (data model, six Store methods, auto-delete orphan cleanup, #fbbc04 marker) matches shipped code closely, but the doc is stale on scope: @user mentions (an explicit Non-Goal/Phase C item) are fully shipped and wired into the sheet composer, Docs comments and a shared cross-consumer comment module already exist (framed as Phase C+), and the §1 file layout no longer matches.

- **[high] roadmap-shipped** — The doc repeatedly frames '@user mentions and notifications' as a Non-Goal deferred to Phase C (Summary, Goals/Non-Goals §, Phase Plan §8). In reality mentions are fully implemented and wired into the sheets comment flow: bodies encode `@[username](userId)` tokens, the composer has a live mention picker, and the sheet view supplies workspace members. A reader would wrongly conclude mentions do not exist.
  - _Evidence:_ packages/frontend/src/components/comments/mentions.ts (serializeMention/parseMentionBody/detectMentionQuery); packages/frontend/src/components/comments/use-workspace-members.ts; packages/frontend/src/components/comments/components/CommentComposer.tsx imports applySelectedMentions/detectMentionQuery; packages/frontend/src/app/spreadsheet/sheet-view.tsx:178 mentionMembers = useWorkspaceMembers(workspaceId); separate design doc docs/design/comments-mentions.md
- **[medium] roadmap-shipped** — §1/§8 state comment code 'lives inside packages/sheets' until Docs becomes a second consumer, with cross-package extraction deferred to Phase C+ ('The shared @wafflebase/comments package is created when Docs adds comments'). In fact Docs comments have shipped and the comment UI has already been extracted into a shared frontend module consumed by sheets, docs, and pdf. (Nuance: no published @wafflebase/comments package exists — the extraction landed as a frontend-internal shared directory instead.)
  - _Evidence:_ packages/frontend/src/components/comments/ (shared comment-store.ts, thread.ts, types.ts, components/); packages/frontend/src/app/docs/comments/ (DocsCommentPopover.tsx, yorkie-comment-store.ts, docs-comments-controller.ts); packages/docs/src/view/comment-markers.ts; CommentSidePanel<SheetCellAnchor> imported in packages/frontend/src/app/documents/document-detail.tsx:62,674; no package named @wafflebase/comments in any packages/*/package.json
- **[medium] stale-reference** — §1 Module Layout places CommentPopover.tsx, CommentSidePanel.tsx, and CommentComposer.tsx together under packages/frontend/src/app/spreadsheet/components/comments/. Actual: only CommentPopover.tsx lives there; CommentComposer.tsx and CommentSidePanel.tsx live in the shared packages/frontend/src/components/comments/components/, and the spreadsheet's side panel is wired up in app/documents/document-detail.tsx, not the spreadsheet component folder.
  - _Evidence:_ packages/frontend/src/app/spreadsheet/components/comments/CommentPopover.tsx (only file there); packages/frontend/src/components/comments/components/CommentComposer.tsx and CommentSidePanel.tsx; document-detail.tsx renders CommentSidePanel for SheetView
- **[low] documented-not-implemented** — §1 lists packages/sheets/src/comment/index.ts as the public-exports barrel, but no index.ts exists in that directory (only types.ts, thread.ts, anchor.ts and __tests__).
  - _Evidence:_ packages/sheets/src/comment/ contains anchor.ts, thread.ts, types.ts, __tests__/ — no index.ts
- **[low] other** — §6.3 specifies the marker as a '7 × 7 px right triangle'; the renderer draws a 9x9 triangle. Color (#fbbc04) and top-right positioning match.
  - _Evidence:_ packages/sheets/src/view/render-comments.ts:5 comment says '9x9 yellow right-triangle', MARKER_COLOR = '#fbbc04'

### docs/design/slides/slides-hover-and-text-edit-entry.md

> The behavioral spec matches the code precisely, but the doc still frames P0.1/P0.2/P1/P2 as future PR-sized work when the entire feature is already shipped, and its exact line-number citations into keyboard.ts/editor.ts are stale.

- **[high] roadmap-shipped** — The doc frames the work as a forward-looking proposal ('this proposal adds...', phase split into 'PR-sized increments', 'One PR', 'Separate PR', 'Independent PRs', a 'Testing strategy' listing '(new)' test files) and only self-marks P0.3 (Enter/F2) and the P2.6 baseline printable-key rule as 'already shipped'. In reality every remaining phase item is fully implemented in shipped code: P0.1 idle hover outline (overlay.ts paints the '1px solid rgba(26,115,232,0.5)' hoverHighlightFrame outline; editor.ts has private hoverHighlightId, onSelectionHoverMove, clearHoverHighlight), P0.2 text-region I-beam (getTextRegionRect exported from text-box-editor.ts and used in editor.ts), P1.4 empty-placeholder 1-click entry (interactions/select.ts exports isEmptyPlaceholder keyed on placeholderRef), P1.5 slow double-click (interactions/drag.ts defines SLOW_DOUBLE_CLICK_MAX_DURATION_MS=350 and the ~3px classifier), P2.6 initialText forwarding (text-box-editor.ts mountSlidesTextBox accepts initialText and inserts it once; enterEditMode forwards it; keyboard.ts printable rule passes { initialText: e.key }), and P2.7 edge-zone resize cursor (editor.ts § P2.7 block). Multiple code comments cite this doc's exact section numbers (§ P1.4, § P1.5, § P2.6, § P2.7), confirming the work post-dates and shipped from this proposal. A reader would wrongly believe most of the document is unbuilt.
  - _Evidence:_ packages/slides/src/view/editor/editor.ts (hoverHighlightId:700, onSelectionHoverMove:4408, getTextRegionRect import:135, § P2.7:4444-4448), overlay.ts (hoverHighlightFrame:119,310 and 'rgba(26, 115, 232, 0.5)':756), interactions/select.ts:79-85 (isEmptyPlaceholder, cites § P1.4), interactions/drag.ts:8-11 (SLOW_DOUBLE_CLICK_MAX_DURATION_MS=350, cites § P1.5), text-box-editor.ts:54,177,395-571 (getTextRegionRect + initialText, 'P2.6' comment), keyboard.ts:636-678
- **[low] stale-reference** — The doc cites precise line ranges that no longer point at the referenced code. It claims the Enter/F2 entry rule lives at keyboard.ts:481-500 and the printable-key rule at keyboard.ts:514-532 with the v1 caveat at 506-513, but at those lines keyboard.ts actually holds the Cmd+Shift+Enter/Cmd+Enter present-mode rules (481-497), Cmd+A (500-513) and Cmd+M (515-539); the real F2/Enter rule is ~636-651 and the printable-key rule ~662-680. Likewise it references the insert-mode ghost field at editor.ts:479, but private hoverPreview is declared at editor.ts:693.
  - _Evidence:_ packages/slides/src/view/editor/interactions/keyboard.ts:472-539,636-680; packages/slides/src/view/editor/editor.ts:693

### docs/design/slides/slides-keyboard-shortcuts.md

> The keyboard-shortcut proposal (catalog, constraints, present/help callbacks, editable-target gating) is accurately shipped, but the doc's Non-Goals section falsely claims no group concept exists when Group/Ungroup is fully built in the model, catalog, and keyboard layer.

- **[high] roadmap-shipped** — Non-Goals states 'Group / Ungroup ... No group concept exists in the slides model yet; introducing one is a separate design involving model, CRDT, rendering, and selection-box changes.' In reality the group concept is fully shipped: element.ts defines GroupElement (type: 'group'), model/group.ts implements ~500 lines of group transform/AABB/scale helpers, KeyboardContext exposes group()/ungroup() methods (keyboard.ts lines 74-77), and the shortcuts catalog registers 'Mod+Alt+G' (Group) and 'Mod+Shift+Alt+G' (Ungroup) as active Selection shortcuts. The Esc catalog entry even documents 'pop drill-in level' group drill-in.
  - _Evidence:_ packages/slides/src/model/element.ts:399-400 (GroupElement), packages/slides/src/model/group.ts (findElementPath, groupToTransform, bakeGroupScale, etc.), packages/slides/src/view/editor/interactions/keyboard.ts:74-77 group()/ungroup(), packages/slides/src/view/editor/shortcuts-catalog.ts:46-47 (Mod+Alt+G / Mod+Shift+Alt+G)
- **[low] stale-reference** — The doc's proposed ShortcutCategory union lists 'Selection|Slide|Clipboard|Z-order|Nudge|Format|Present|Help'; the shipped type also includes a 'Drag' category used for the Shift-constraint entries. Also the shipped catalog groups Undo/Redo/Show-shortcuts under a 'Help' category rather than a dedicated History category. Minor divergence from the doc's illustrative type.
  - _Evidence:_ packages/slides/src/view/editor/shortcuts-catalog.ts:22-31,83-91
- **[low] documented-not-implemented** — The doc's proposed KeyboardContext interface includes 'onLinkRequest?' ('canvas-level (unused in v1, present for symmetry)'). The shipped KeyboardContext does not declare onLinkRequest; it only carries onStartPresentation and onShowShortcutsHelp. (onLinkRequest still exists on SlidesEditorOptions and text-box-editor, so the plumbing claim holds, but the KeyboardContext field was dropped.)
  - _Evidence:_ packages/slides/src/view/editor/interactions/keyboard.ts:47-96 (no onLinkRequest); editor.ts:241 onLinkRequest option; frontend slides-view.tsx:682 notes onLinkRequest intentionally unwired

### docs/design/slides/slides-pdf-export.md

> The doc frames Slides PDF export as an unbuilt P0 feature ("Slides has no PDF export today"), but the entire pipeline is implemented, exported, and UI-wired in shipped code.

- **[high] roadmap-shipped** — The Summary states 'Slides has no PDF export today... no code exists' and the whole doc is written as a to-build P0 plan (Goals/Non-Goals, 'P0 ships a raster exporter', 'add pdf-lib to slides package.json'). In reality the feature is fully shipped: packages/slides/src/export/pdf.ts (402 lines) implements exportSlidesPdf() and collectFontFamilies() exactly as the raster-per-slide pipeline described; pdf-lib is already in packages/slides/package.json; the frontend exportSlidesPdfAndDownload() exists; and a header Export menu is wired to it. A reader would be misled into thinking none of this exists.
  - _Evidence:_ packages/slides/src/export/pdf.ts:99 (exportSlidesPdf), packages/slides/src/index.ts:243-247 (re-exports exportSlidesPdf/collectFontFamilies), packages/slides/package.json:44 (pdf-lib), packages/frontend/src/app/slides/pdf-actions.ts:25 (exportSlidesPdfAndDownload), packages/frontend/src/app/slides/slides-export-button.tsx:99 (PDF export menu item)
- **[medium] documented-not-implemented** — The doc's proposed cross-origin image strategy ('for external srcs set crossOrigin=anonymous in getOrLoadImage and fall back to placeholder if it taints') was not what shipped. The implemented exporter instead fetches each image's bytes through an injected imageFetcher (credentialed) into a same-origin object URL and renders a cloned slide with rewritten srcs. ExportSlidesPdfOptions also carries imageFetcher/onProgress/title fields the doc's signature does not mention.
  - _Evidence:_ packages/slides/src/export/pdf.ts header comment (cross-origin object-URL clone approach) and ExportSlidesPdfOptions (imageFetcher, title, onProgress); packages/frontend/src/app/slides/pdf-actions.ts uses docsImageFetcher
- **[low] stale-reference** — Naming/surface drift vs shipped code: doc names the frontend helper exportPdfAndDownload(doc, title) but it shipped as exportSlidesPdfAndDownload(doc, title, onProgress?); doc proposes a '@wafflebase/slides/export' subpath export but the symbols are folded into the main '@wafflebase/slides' entry; doc places the UI control in packages/frontend/src/app/slides/toolbar/ next to Present, but it lives in a header Export menu (slides-export-button.tsx). Also opts.metadata.title shipped as opts.title.
  - _Evidence:_ packages/frontend/src/app/slides/pdf-actions.ts:25, packages/slides/src/index.ts:243-247, packages/frontend/src/app/slides/slides-export-button.tsx:21-99

### docs/design/slides/slides-mobile.md

> Core primitives shipped as designed (mobile view/edit modes, Pointer Events migration, handleHitTest tolerance, use-pointer-swipe, SlideRenderer reuse), but the doc's described mount location, shell chrome, and named components diverge materially from what shipped, and a deferred Non-Goal (shared-link read-only) is actually implemented.

- **[high] stale-reference** — Doc (Summary, 'Detection and branching' with a code snippet, and File change summary) states SlidesView in packages/frontend/src/app/slides/slides-view.tsx branches on useIsMobile() and delegates to MobileSlidesView. In reality slides-view.tsx contains zero references to useIsMobile/MobileSlidesView/isMobile; the mobile branch actually lives in slides-detail.tsx (and shared-document.tsx). A reader would look in the wrong file.
  - _Evidence:_ slides-view.tsx: 0 matches for useIsMobile/MobileSlidesView; slides-detail.tsx:17,20,90,738 import and mount MobileSlidesView behind useIsMobile()
- **[medium] documented-not-implemented** — File change summary lists two NEW files: mobile-text-format-sheet.tsx and mobile-slide-ops-fab.tsx. Neither exists. Text formatting shipped as MobileSlidesToolbar (toolbar/mobile-toolbar.tsx) owned by the parent; add-slide shipped as an IconPlus button inside a ThumbnailStrip in mobile-slides-view.tsx.
  - _Evidence:_ ls: mobile-text-format-sheet.tsx / mobile-slide-ops-fab.tsx 'No such file or directory'; packages/frontend/src/app/slides/toolbar/mobile-toolbar.tsx (MobileSlidesToolbar); mobile-slides-view.tsx:674-692 (add-slide button in ThumbnailStrip)
- **[medium] documented-not-implemented** — The 'MobileSlidesView shell' DOM structure (in-shell header with Back/Undo/Redo/title/Present buttons, and a footer with prev/next arrows and 'index / total') is not what shipped. mobile-slides-view.tsx renders only a canvas-host plus a horizontal ThumbnailStrip; there is no in-component header or prev/next footer, and undo/redo + Present are owned by the parent SiteHeader/SlidesToolbar.
  - _Evidence:_ mobile-slides-view.tsx:475-537 (canvas-host + ThumbnailStrip, no header/footer); comments at lines 74 and 143-144 note the parent owns Present button and toolbar undo/redo
- **[medium] roadmap-shipped** — Non-Goals frames 'Shared-link read-only flow (sharing.md)' as a separate, not-yet-wired task, and says mode is decided by slides-detail.tsx per permission. In reality the permission-based view/edit split ships in shared-document.tsx (mode={readOnly ? 'view' : 'edit'}); slides-detail.tsx hardcodes mode="edit".
  - _Evidence:_ shared-document.tsx:580-581 mode={readOnly ? 'view' : 'edit'}; slides-detail.tsx:739 mode="edit" (hardcoded)
- **[low] documented-not-implemented** — The Slide-ops FAB long-press menu (duplicate / delete / change-layout via store.duplicateSlide / removeSlide / applyLayout) is not wired on mobile; only store.addSlide('blank') is called.
  - _Evidence:_ mobile-slides-view.tsx:215 store.addSlide('blank'); grep for duplicateSlide/removeSlide/applyLayout in mobile-slides-view.tsx: 0 matches
- **[low] documented-not-implemented** — The undo/redo store.onHistoryChange hook (listed in File change summary for store.ts, memory.ts, yorkie-slides-store.ts) was never added; grep finds it nowhere. Framed conditionally in prose, so low severity; undo/redo ended up owned by the parent toolbar instead.
  - _Evidence:_ grep onHistoryChange across packages/slides/src and yorkie-slides-store.ts: 0 matches

### docs/design/slides/slides-ruler.md

> The doc reads as an unbuilt proposal (target-version 0.4.2, a six-PR "Phasing" plan, future tense, NEW/MOVED file markers) but the entire slides-ruler feature across all six phases is already implemented in the current 0.6.2 codebase.

- **[high] roadmap-shipped** — The doc frames the whole feature as a design proposal with a six-PR phasing plan yet to be done, but every phase is shipped. P1 shared core: packages/docs/src/view/ruler/{index,tick-renderer,unit}.ts all exist. P2 SlidesRuler controller: `export class SlidesRuler` exists. P3 data+store: `Guide` type and `guides: Guide[]` in SlidesDocument, plus addGuide/moveGuide/removeGuide in the store. P4 interactions: view/editor/ruler/interactions.ts exists. P5 snap: snap.ts defines `SnapGuideKind = 'slide-center'|'guide'|'edge'` with PRIORITY {slide-center:0, guide:1, edge:2} exactly as specified. A reader would be actively misled into thinking this is unbuilt planned work.
  - _Evidence:_ packages/docs/src/view/ruler/index.ts, tick-renderer.ts, unit.ts; packages/slides/src/view/editor/ruler/ruler.ts (class SlidesRuler), interactions.ts, index.ts; packages/slides/src/model/presentation.ts:157 (type Guide) & :171 (guides: Guide[]); packages/slides/src/store/store.ts:313-315 (addGuide/moveGuide/removeGuide); packages/slides/src/view/editor/snap.ts:8,30-33
- **[low] stale-reference** — The Architecture section describes the docs ruler as currently living at packages/docs/src/view/ruler.ts and P1 as a future MOVE into ruler/index.ts. That move is already done: no ruler.ts exists; the class lives at ruler/index.ts with tick-renderer.ts and unit.ts alongside.
  - _Evidence:_ packages/docs/src/view/ruler/index.ts exists; packages/docs/src/view/ruler.ts does not
- **[low] other** — The Presence section types draggingGuide as { id?: string; axis; position }, but the shipped SlidesPresence field omits the id member (only { axis; position }). Consistent with the doc's own statement that broadcasting is deferred, but the field shape differs from the spec.
  - _Evidence:_ packages/slides/src/view/editor/peers.ts:36 `draggingGuide?: { axis: 'x' | 'y'; position: number }`

### docs/design/slides/slides-shapes.md

> The core shape-library contract (136 path builders, three registries, adjustments/handles, action buttons, freeform, shape text body) matches the code, but the line/arrow → ConnectorElement migration was only noted in the Summary and left stale across the Data model, dispatcher, shape-special, picker, and (most misleadingly) the Non-Goals/Out-of-scope connector framing, which is actually shipped.

- **[high] roadmap-shipped** — Non-Goals says 'line and arrow are free-floating; elbow / curved connectors that snap between two source elements are a separate workstream' and Out-of-scope lists 'Elbow / curved connectors that snap to two source elements' as not built. In reality a full ConnectorElement type is shipped: routing 'straight'|'elbow'|'curved', Endpoint {kind:'attached', elementId, siteIndex} snapping to connection sites, drawConnector renderer, elbow/curve bend handles, and bend-drag interactions.
  - _Evidence:_ packages/slides/src/model/connector.ts (ConnectorElement, ConnectorRouting, Endpoint attached), packages/slides/src/model/connection-site.ts, packages/slides/src/view/canvas/connector-renderer.ts (drawConnector), connector-bend.ts, routing.ts (routeElbow/routeCurved), src/view/editor/interactions/bend-drag.ts
- **[medium] stale-reference** — The Data model code block declares ShapeKind starting with '| "line" | "arrow"' as special-cased shape kinds, but the actual ShapeKind union in element.ts contains neither 'line' nor 'arrow' — connectors were extracted into the separate ConnectorElement type.
  - _Evidence:_ packages/slides/src/model/element.ts (export type ShapeKind begins at 'rect' | 'roundRect'…; no 'line'/'arrow' members)
- **[medium] documented-not-implemented** — The Renderer-architecture drawShape snippet dispatches `if (data.kind === 'line') return drawLine(...)` and `if (data.kind === 'arrow') return drawArrow(...)`. The real drawShape has no line/arrow branches, and no drawLine/drawArrow functions exist in the slides package; it instead special-cases action buttons then freeform (a branch the doc's snippet omits) before PATH_BUILDERS. Connectors render via drawConnector in a different file.
  - _Evidence:_ packages/slides/src/view/canvas/shape-renderer.ts drawShape (lines 167-245: isActionButton → freeform → PATH_BUILDERS, no line/arrow); grep found no function drawLine/drawArrow in src
- **[low] stale-reference** — Renderer-architecture tree says shape-special.ts contains 'drawLine, drawArrow, drawActionButton'. The actual file exports only drawActionButton.
  - _Evidence:_ packages/slides/src/view/canvas/shape-special.ts (only `export function drawActionButton`)
- **[medium] stale-reference** — Picker UI section says the Shape picker lives in packages/frontend/src/app/slides/slides-formatting-toolbar.tsx. That file does not exist; the picker is shape-picker.tsx + shape-picker-helpers.ts (with SHAPE_PICKER_CATEGORIES).
  - _Evidence:_ slides-formatting-toolbar.tsx missing (grep found zero references); packages/frontend/src/app/slides/shape-picker.tsx and shape-picker-helpers.ts exist
- **[medium] stale-reference** — Picker UI lists sections in fixed order beginning with 'Lines' (9 sections). The shipped picker has 8 categories with NO Lines section; line connectors were split into a dedicated LinePicker dropdown. The invariant test explicitly asserts 8 categories and that no 'lines' category exists.
  - _Evidence:_ packages/frontend/tests/app/slides/shape-picker.test.ts (expects length 8 and ids [shapes,block-arrows,banners,flowchart,callouts,equation,stars,action-buttons]; asserts no 'lines'); packages/frontend/src/app/slides/line-picker.tsx


## minor-drift (57)

### docs/design/documents-multi-file-upload.md

> The multi-file upload feature described in this proposal has shipped largely as designed, but two deliberate design decisions in the doc were reversed in the shipped code (useSyncExternalStore, and image files as an upload kind).

- **[high] documented-not-implemented** — The doc's 'React glue' section states useSyncExternalStore is 'intentionally not used — there is zero precedent in the codebase and the manual pattern is the established convention', prescribing useState + useEffect + subscribe. The shipped hook does the opposite: it calls useSyncExternalStore(subscribe, getSnapshot) and its own comment says '(not the useState + useEffect pattern)'. A reader following the doc's rationale is actively misled about the chosen convention.
  - _Evidence:_ packages/frontend/src/app/documents/use-upload-queue.ts:1,7,13 (useSyncExternalStore) vs doc lines 141-147
- **[high] roadmap-shipped** — The doc's Non-Goals state 'PDF stays the only binary-backed type; skipped files are not uploaded' and lists multi-image handling as a separate effort; the UploadKind type is declared as only 'sheet'|'doc'|'slides'|'pdf'. In shipped code UploadKind includes 'image', classifyUploadKind maps png/jpg/jpeg/gif/webp → 'image', and the worker uploads those blobs and creates an 'image' DocumentType document (same path as pdf). So image files ARE uploaded as a binary-backed document type, contradicting the Non-Goal.
  - _Evidence:_ packages/frontend/src/app/documents/upload-kind.ts:1,10-15; upload-queue.ts:308-327; packages/frontend/src/types/documents.ts:1 (DocumentType includes 'image') vs doc lines 39,42-43,84
- **[low] stale-reference** — Minor API/path drift: the doc lists the store's exposed API as 'remove(id)' but shipped exports are removeItem/dismissItem (no remove); enqueue is enqueue(files, workspaceId, folderId?) not enqueue(files, workspaceId); the doc puts drop handlers inline in document-list.tsx but they were extracted into use-window-file-drop.ts; the pptx importer is importPptxFile (doc calls it importPptx). UploadItem also gained folderId/docPath/warning fields not in the doc's interface.
  - _Evidence:_ packages/frontend/src/app/documents/upload-queue.ts:67-71,97,110,20-41; use-window-file-drop.ts; document-list.tsx:129; import importPptxFile in upload-queue.ts:5 vs doc lines 64,100,161-169,88-98

### docs/design/context-menu.md

> The shipped architecture (Radix context menu, unified sheet/tab menus, mobile synthetic contextmenu, headerHitTest) matches code, but the documented facade API method names, signatures, and return types are stale, and the cell menu ships more items than documented.

- **[high] documented-not-implemented** — The doc lists facade methods getAdjacentHiddenRows/getAdjacentHiddenColumns returning `{ from: number; to: number } | null`. No such symbols exist; the actual methods are findAdjacentHiddenRows/findAdjacentHiddenColumns and they return `number[]` (an array of hidden indices), which is why sheet-context-menu.tsx computes min/max over the array rather than reading a {from,to} object.
  - _Evidence:_ packages/sheets/src/view/spreadsheet.ts:855-861 (findAdjacentHiddenRows/Columns -> number[]); grep for getAdjacentHidden across packages/ returns nothing; packages/frontend/src/components/sheet-context-menu.tsx:118,122,170-182
- **[medium] documented-not-implemented** — Documented signatures hideRows(index, count)/hideColumns(index, count)/showRows(from, to)/showColumns(from, to) do not match the implementation, which takes an array of indices: hideRows(indices: number[]), showRows(indices: number[]), etc. The component passes arrays accordingly.
  - _Evidence:_ packages/sheets/src/view/spreadsheet.ts:831-851; packages/frontend/src/components/sheet-context-menu.tsx:147-159
- **[medium] implemented-not-documented** — The doc's Cell Menu (and CellMenuItems structure) lists only Cut, Copy, Paste, Delete, but the shipped cell menu also conditionally renders Insert comment (with keyboard hint), Data validation, Insert pivot table, and Delete image; the SheetContextMenu props include onInsertPivotTable, onDeleteImage, onInsertComment, onOpenDataValidation, selectedImageId.
  - _Evidence:_ packages/frontend/src/components/sheet-context-menu.tsx:44-51,204-241

### docs/design/docs/docs-intent-preserving-edits.md

> Phase status, DocStore API, and most symbol-level claims match the shipped code, but the "Native Split/Merge" mechanism section describes a native-CRDT approach the code deliberately abandoned, and SDK version references are stale.

- **[high] documented-not-implemented** — Doc's Yorkie Tree Strategy table and 'Native Split/Merge (SDK 0.7.4)' section state split uses native `editByPath(path,path,undefined,splitLevel)` with splitLevel=2 and merge uses native boundary deletion `editByPath([blockIdx,inlineCount],[nextBlockIdx,0])` triggering automatic CRDT merge (both marked Shipped). The code does neither: splitBlock uses a manual two-step delete-after-content + insert-new-block, with an explicit comment 'Manual two-step split (avoids splitLevel=2 which breaks undo/redo)'; mergeBlock explicitly avoids the single cross-boundary editByPath as a yorkie-js-sdk bug and instead deletes the next block then re-inserts its inline children via editBulkByPath. No splitLevel=2 call exists anywhere (all 3 occurrences are comments explaining why it's avoided).
  - _Evidence:_ packages/frontend/src/app/docs/yorkie-doc-store.ts:1986 (splitBlock manual two-step, 'avoids splitLevel=2 which breaks undo/redo'), :2127-2152 (mergeBlock two-step delete+editBulkByPath, 'Workaround for yorkie-js-sdk Phase 3 Range Narrowing bug'); grep for splitLevel yields only comments (lines 1148, 1986, 2129)
- **[medium] stale-reference** — Doc repeatedly pins behavior to Yorkie SDK versions 0.7.4 ('Native Split/Merge (SDK 0.7.4)', known-edge-cases) and 0.7.6 ('Native Inline Styling (SDK 0.7.6)'). The shipped dependency is @yorkie-js/sdk 0.7.13 (and @yorkie-js/react 0.7.13).
  - _Evidence:_ packages/frontend/package.json:60,89 (@yorkie-js/react and @yorkie-js/sdk both 0.7.13)
- **[low] documented-not-implemented** — The 'DocStore Methods' code block lists Phase 4 'Table cell variants' insertTextInCell / deleteTextInCell / applyStyleInCell. These methods do not exist on the DocStore interface, and the doc's own Phase 4 section states they were intentionally NOT added in favor of unified resolveBlockTreePath DFS. The code block is stale/self-contradictory.
  - _Evidence:_ packages/docs/src/store/store.ts DocStore interface (no *InCell methods; grep 'InCell' finds only unrelated symbols); doc Phase 4 section lines 185-189 confirms unified approach

### docs/design/docs/docs-paste-table-into-cell.md

> The proposal is fully implemented in code, but the doc still frames the #333 fix (recursive fresh ids + findBlockInCells fallback) and its regression test as future/planned when both are already shipped on main.

- **[high] roadmap-shipped** — The doc repeatedly frames the #333 fix as unbuilt/future: 'This note's #333 fix (recursive fresh ids + the findBlockInCells fallback) still needs its own regression coverage ... which is planned for the implementation PR that follows this design note, not part of this doc-only PR' and the Risks table says 'regression test planned for the implementation PR'. In reality the entire #333 fix is already shipped: refreshBlockIds recurses through tableData.rows[].cells[].blocks[]; findBlockInCells has the walkCellsForBlock recursive fallback for blocks not yet in _blockParentMap; and insertBlocks (both single-table and multi-block branches) already calls cloneBlockWithFreshIds. A reader would be misled into thinking this fix is still pending.
  - _Evidence:_ packages/docs/src/store/block-helpers.ts:154-172 (cloneBlockWithFreshIds/recursive refreshBlockIds); packages/docs/src/model/document.ts:42-56 (walkCellsForBlock) and :199-204 (findBlockInCells fallback); packages/docs/src/view/text-editor.ts:3517-3583 (single-table + multi-block branches use cloneBlockWithFreshIds + insertBlockAfter)
- **[medium] roadmap-shipped** — The doc says the #333 model-level regression test — 'a model-level test asserting Doc.getBlock resolves a block inside a freshly pasted nested table that isn't yet in _blockParentMap' — is 'planned for the implementation PR that follows this design note.' That exact test already exists.
  - _Evidence:_ packages/docs/test/model/paste-table-into-cell.test.ts:132-133 (describe 'Doc.getBlock resolves freshly pasted nested-table content (#333)' / it 'resolves a block inside a pasted nested table that is not yet in the parent map')

### docs/design/docs/docs-presence.md

> The documented peer-cursor/label and avatar-jump machinery matches the shipped code closely, but the doc still frames remote selection highlight as a planned Phase 2 Non-Goal when it is in fact fully implemented.

- **[high] roadmap-shipped** — Summary says "Remote selection highlight is Phase 2 (planned)" and Non-Goals lists "Remote selection highlight (Phase 2)" as the first item, but remote peer selection highlighting is fully implemented and wired: DocsPresence carries activeSelection, PeerCursor has a selection field, buildPeerCursors passes it through, editor.ts computes peerSelections highlight rectangles, and doc-canvas.ts renders peer selection highlights per page. A reader would wrongly conclude the feature does not exist.
  - _Evidence:_ packages/frontend/src/types/users.ts:25 (DocsPresence.activeSelection); packages/docs/src/view/peer-cursor.ts:79 (PeerCursor.selection); packages/frontend/src/app/docs/docs-view.tsx:222-231 (buildPeerCursors maps activeSelection→selection); packages/docs/src/view/editor.ts:1541-1559 (peerSelections rectangles); packages/docs/src/view/doc-canvas.ts:181,449-461 (peerSelections rendering)
- **[low] stale-reference** — The §3 code comment places PeerCursor in packages/docs/src/view/types.ts, but PeerCursor is actually defined in packages/docs/src/view/peer-cursor.ts (which the §12 Files table correctly cites); there is no types.ts in that view directory defining it.
  - _Evidence:_ packages/docs/src/view/peer-cursor.ts:73 (export interface PeerCursor); no packages/docs/src/view/types.ts tracked
- **[low] documented-not-implemented** — The §1/§3 type snippets are slightly stale: DocsPresence is shown as "{ activeCursorPos?: {...} } & User" but the real type inlines username/email/photo (not an intersection with User) and also includes activeSelection; the documented PeerCursor type omits the actual clientID and selection fields.
  - _Evidence:_ packages/frontend/src/types/users.ts:17-34; packages/docs/src/view/peer-cursor.ts:73-80

### docs/design/docs/docs-wordprocessor-roadmap.md

> The roadmap is largely accurate — referenced design docs, task tracker, and shipped features all verify — but the manual Ctrl+Enter page break is fully implemented while the doc still frames it as Planned/needing a UI affordance.

- **[high] roadmap-shipped** — The Current State table marks 'Page break (manual Ctrl+Enter)' as '❌ Planned', and Phase 4.2 says it is only 'handled at the layout level via page-break blocks injected by find/replace' and 'needs a first-class UI affordance'. In reality the manual Ctrl+Enter/Cmd+Enter page break is fully wired: the keydown handler routes ctrl/meta+Enter to handlePageBreak(), which splits the block and inserts a first-class createBlock('page-break') block; 'page-break' is a first-class BlockType.
  - _Evidence:_ packages/docs/src/view/text-editor.ts:795-802 (case 'Enter' -> if (e.ctrlKey||e.metaKey) this.handlePageBreak()); packages/docs/src/view/text-editor.ts:2097-2120 (handlePageBreak inserts page-break block via createBlock('page-break')); packages/docs/src/model/types.ts:39 (BlockType includes 'page-break')

### docs/design/slides/slides-animation.md

> The animation engine, data model, store ops, Motion panel, presenter integration, and PPTX animation import are all shipped as the doc claims; the only real drift is the Non-Goals section still saying no PPTX export serializer is built when a full one exists, plus one op name.

- **[high] roadmap-shipped** — Non-Goals states "PPTX export. v1 exports PDF only; ... no serializer is built," and Goals say "v1 exports PDF only." In reality a complete PPTX export serializer exists and is wired into the app, including serialization of the very transitions/animations this doc adds. Even the v0.5.0 Implementation status section omits it. A reader would be misled into thinking PPTX export does not exist.
  - _Evidence:_ packages/slides/src/export/pptx/ (index.ts exportPptx, animation.ts transitionToXml/effectParXml, slide.ts, presentation.ts); exported at packages/slides/src/index.ts:250 (export { exportPptx }); UI wiring in packages/frontend/src/app/slides/slides-export-button.tsx ("PowerPoint (.pptx)") and pptx-actions.ts (calls exportPptx)
- **[low] stale-reference** — Doc lists the new Store op as `reorderAnimations` (plural); the actual op is named `reorderAnimation` (singular). The other four ops (setSlideTransition, addAnimation, updateAnimation, removeAnimation) match exactly.
  - _Evidence:_ packages/slides/src/store/store.ts:91, memory.ts:544, layout-edit-store.ts:193 all define reorderAnimation(slideId, animId, toIndex); grep for reorderAnimations returns nothing

### docs/design/slides/slides-format-effects.md

> The effects data model, rendering, and Format panel sections described in the doc are all shipped and match the code closely; the notable drift is the doc's claim that no PPTX exporter exists, plus its "PR 2" image-recolor work being framed as future when it has shipped.

- **[high] implemented-not-documented** — The doc states "PPTX is import-only in this package (no exporter exists), so 'round-trip' means parsing the OOXML effect elements on import." A full PPTX exporter is in fact shipped: `exportPptx` (and `ExportPptxOptions`) are exported from the package index, and packages/slides/src/export/pptx/ contains ~20 modules including effects.ts, which serializes drop shadow/reflection to `<a:outerShdw>`/`<a:reflection>`. A reader is actively misled about round-trip capability.
  - _Evidence:_ packages/slides/src/index.ts:250 `export { exportPptx } from './export/pptx/index.js'`; packages/slides/src/export/pptx/index.ts (exportPptx orchestrator); packages/slides/src/export/pptx/effects.ts:10 `effectsToXml` emitting outerShdw/reflection; export/pdf.ts also present
- **[medium] roadmap-shipped** — The Rollout section frames PR 2 (image recolor + brightness/contrast) as future work, and the doc tags `recolor-section.tsx` and recolor/brightness/contrast fields as "(PR 2)". These have shipped: ImageRecolor type and brightness/contrast fields exist on ImageElement.data, and the panel includes recolor-section.tsx and image-adjustments-section.tsx.
  - _Evidence:_ packages/slides/src/model/element.ts:315 `ImageRecolor = 'none'|'grayscale'|'sepia'`, :335 brightness, :340 contrast; packages/frontend/src/app/slides/format-panel/recolor-section.tsx and image-adjustments-section.tsx
- **[low] stale-reference** — The doc's frontmatter target-version is 0.4.7, but the slides package is now at 0.6.2, consistent with this design (both PRs) already having landed rather than being upcoming work.
  - _Evidence:_ packages/slides/package.json version 0.6.2 vs docs frontmatter target-version 0.4.7

### docs/design/slides/slides-connectors.md

> The core connector architecture (types, routing, connection-sites, siteWorldPos, buildElementWorldLookup, store update methods, Yorkie store, curveBend) matches the code precisely, but the PR2 status overstates which per-shape connection-site overrides shipped and the store/file-layout sections name symbols and files that don't exist as described.

- **[high] roadmap-shipped** — The PR2 status section marks per-ShapeKind connection-site overrides as '✅ Mostly shipped: diamond / parallelogram / trapezoid / pentagon / hexagon / octagon / star4..star10'. The actual CONNECTION_SITES registry only contains diamond, parallelogram, trapezoid, and ellipse. No pentagon, hexagon, octagon, or star overrides exist; the module's own index.ts comment says 'diamond / parallelogram / trapezoid today'. A reader would believe polygon/star anchor overrides ship when they don't. (ellipse is also present in code but never mentioned in the doc.)
  - _Evidence:_ packages/slides/src/view/canvas/connection-sites/overrides.ts lines 100-112 (CONNECTION_SITES = {diamond, parallelogram, trapezoid, ellipse}); index.ts line 8 comment
- **[medium] documented-not-implemented** — Both the Store Layer section and PR1 rollout list an `addConnector(connector: ConnectorElement): void` method on the SlidesStore interface. No such method exists in store.ts, memory.ts, or yorkie-slides-store.ts. Connectors are inserted through the generic `addElement(slideId, init)` path via `buildConnectorInit`. The updateConnector* methods the doc lists do exist.
  - _Evidence:_ grep 'addConnector' returns nothing in packages/slides/src or packages/frontend/src; packages/slides/src/store/store.ts:167 addElement; insert-connector.ts:186-189 buildConnectorInit + store.addElement
- **[low] stale-reference** — File Organization / Editor Interactions list new files `view/editor/overlays/connection-points-overlay.ts` and `interactions/elbow-bend-drag.ts`. There is no `overlays/` directory (connection-points overlay logic lives in editor.ts / overlay.ts / insert-connector.ts) and the bend-drag file is `interactions/bend-drag.ts`, not `elbow-bend-drag.ts`. The features are implemented; only the file layout/names differ.
  - _Evidence:_ packages/slides/src/view/editor/ has only interactions/ and ruler/ subdirs; interactions/bend-drag.ts exists (no elbow-bend-drag.ts); connection-points refs in editor.ts, overlay.ts, insert-connector.ts
- **[low] stale-reference** — The File Organization section shows unit tests colocated next to source (e.g. view/canvas/routing.test.ts, connection-sites/connection-sites.test.ts, store/memory.test.ts as NEW). All these tests exist but live in a mirror tree under packages/slides/test/ (e.g. test/view/canvas/routing.test.ts), not colocated. Content matches; only location drifts.
  - _Evidence:_ packages/slides/test/view/canvas/routing.test.ts, test/view/canvas/connection-sites/connection-sites.test.ts, test/view/canvas/arrowhead-renderer.test.ts, test/store/memory.test.ts

### docs/design/slides/slides-group.md

> The core grouping design matches shipped code closely (GroupElement, model/group.ts helpers, MemSlidesStore/YorkieSlidesStore group/ungroup, drill-in selection scope/ids, overlay member/context outlines, shortcuts, PPTX group-preserving import), but the PDF-export claims and a few named test helpers are stale or contradicted by the code.

- **[high] roadmap-shipped** — The 'Known Limitations / Follow-ups' section states 'PDF export not implemented for slides v1. The slides export/ directory does not exist yet.' In reality the directory and a full PDF exporter ship today, and it already handles groups (recurses into el.data.children).
  - _Evidence:_ packages/slides/src/export/pdf.ts (header: 'Slides PDF export — P0 raster pipeline'; exports ExportSlidesPdfOptions; flattenElements recurses `if (el.type === 'group') walk(el.data.children)` at line 227); export dir also contains yield.ts
- **[medium] documented-not-implemented** — §9 describes PDF export becoming a vector recursion where 'Each GroupElement opens a PDF transform context' and 'the pdf-lib graphics state stack handles pushGraphicsState / popGraphicsState per group level.' The actual pdf.ts is a raster pipeline that renders each slide through the drawSlide() canvas renderer onto an offscreen canvas and embeds one bitmap per page; groups are handled by the canvas renderer, not by per-group pdf-lib graphics-state pushes.
  - _Evidence:_ packages/slides/src/export/pdf.ts lines 1-45 (imports drawSlide from view/canvas/slide-renderer; comment 'Renders every slide through the existing drawSlide() canvas pipeline ... then embeds one bitmap per page into a pdf-lib document')
- **[medium] documented-not-implemented** — §6.1 claims a shipped 'DEV/test-only helper assertGroupsSettled(elements)' that 'regression tests call after resize/ungroup commits.' No such symbol exists anywhere in the repo.
  - _Evidence:_ grep -rn 'assertGroupsSettled' packages returned zero matches; also no 'Settled'/'settleGroup' helper in packages/slides/src
- **[medium] documented-not-implemented** — §8's import-fidelity invariant is said to be 'enforced by a property test in import/pptx/group.test.ts', and §12 references a fixture set at packages/slides/test/fixtures/pptx-groups/. Neither exists: there are no *.test.ts files in import/pptx and no pptx-groups fixtures directory.
  - _Evidence:_ find packages/slides/src/import/pptx -name '*.test.ts' → none; find packages/slides -path '*fixtures*group*' → none
- **[low] stale-reference** — §3 documents the store API as `group(slideId, elementIds): string` returning 'the new group id'. The actual signature returns an object `{ groupId, excludedConnectorIds }`.
  - _Evidence:_ packages/slides/src/store/memory.ts:919 return type `{ groupId: string; excludedConnectorIds: string[] }`, :1140 `return { groupId, excludedConnectorIds }`; mirrored in store/store.ts
- **[low] documented-not-implemented** — §1 states group invariants are 'enforced by MemSlidesStore and validated in model/migrate.ts'. MemSlidesStore does enforce cycle/empty-group guards, but model/migrate.ts contains no group handling at all.
  - _Evidence:_ grep -ni 'group' packages/slides/src/model/migrate.ts → no matches (cycle/empty checks live in packages/slides/src/store/memory.ts)

### docs/design/docs-site.md

> The VitePress docs site is shipped essentially as designed, but the doc is scoped only to Sheets/Docs/Slides while the live site also ships Notes, Board, and PDF sections plus extra pages, and two path/command references are stale.

- **[medium] implemented-not-documented** — The doc frames the site as covering only 'each shipped module (Sheets, Docs, Slides)' with nav order Guide/Sheets/Docs/Slides/Developers, but the shipped config adds a 'Notes & Board' nav entry and a 'PDF & Files' sidebar group, plus extra content pages the outline omits (guide/import-export, sheets/data-validation, sheets/datasources). A reader would underestimate the site's scope.
  - _Evidence:_ packages/documentation/.vitepress/config.ts nav (lines 67-73: Guide/Sheets/Docs/Slides/'Notes & Board'/Developers) and sidebar groups 'Notes & Board' and 'PDF & Files' (lines 129-146); files packages/documentation/notes/, board/, pdf/, guide/import-export.md, sheets/data-validation.md, sheets/datasources.md
- **[low] stale-reference** — Homepage Changes section says developer-section.tsx links point to /docs/api/rest-api and /docs/api/cli, but the shipped code (and the doc's own Package Structure) uses the /developers/ path segment: /docs/developers/rest-api and /docs/developers/cli.
  - _Evidence:_ packages/frontend/src/app/home/developer-section.tsx:168 (href: "/docs/developers/rest-api") and :176 (href: "/docs/developers/cli")
- **[low] stale-reference** — Doc's local development instruction is `pnpm docs dev`, but no `docs` script alias exists; the actual pnpm filter alias is `documentation`, so the command is `pnpm documentation dev`.
  - _Evidence:_ root package.json defines "documentation": "pnpm --filter @wafflebase/documentation" with no "docs" script

### docs/design/board/board.md

> The SP1 core (viewport seam in slides, @wafflebase/board package, board-document type, single-synthetic-slide store, and full document-type wiring) is shipped exactly as documented; the only drift is that features the doc frames as future SP2/follow-ups (sticky notes, image paste, minimap) have since shipped in the board.

- **[medium] roadmap-shipped** — The doc's Non-Goals (SP1) frame 'Sticky notes, freehand drawing, image paste — SP2' and 'Minimap ... — nice-to-have follow-ups' as not-yet-built. In current code all three are shipped and wired into the board: the toolbar exposes Select/Text/Sticky/Image/Shape/Line (with scribble/freehand in the Line picker), board-view instantiates a minimap and image inserter. A reader treating this doc as current-state would wrongly conclude these are absent from the board.
  - _Evidence:_ packages/frontend/src/app/board/sticky.ts (dropSticky), board-image.ts, board-minimap.ts + minimap-geometry.ts; board-toolbar.tsx (onInsertSticky/onInsertImage, Sticky ▾/Image, 'connectors / scribble live in Line ▾'); board-view.tsx lines 224 createBoardMinimap, 264 insertImageOnSlide, 525-526 onInsertSticky/onInsertImage
- **[low] stale-reference** — The doc describes board-toolbar.tsx as a 'minimal insert toolbar (Select / Text / Shape / Line)'. The shipped toolbar has expanded to Select / Text / Sticky ▾ / Image / Shape ▾ / Line ▾.
  - _Evidence:_ packages/frontend/src/app/board/board-toolbar.tsx header comment 'Sticky ▾ / Image / Shape ▾ / Line ▾' and aria-labels Select/Text box + onInsertSticky/onInsertImage props
- **[low] implemented-not-documented** — The BoardPresence type includes a world-coords `cursor` field, though the doc says SP1 wires the presence channel but does not paint remote cursors. The code comment in board-view.tsx confirms cursor dots are still not rendered and the client does not publish cursor, so behavior matches the doc; only the type carries an as-yet-unused cursor field.
  - _Evidence:_ packages/frontend/src/types/board-document.ts BoardPresence.cursor; packages/frontend/src/app/board/board-view.tsx lines 108-110 'Peer cursor DOTS are not rendered yet ... deferred follow-up'

### docs/design/backend.md

> The documented surface (auth, documents, share-links, datasources, throttler, logging, env, health) is accurate and verified in code, but the Module Architecture and Database Schema sections omit a large amount of shipped surface area, and one rate-limit number is internally inconsistent.

- **[medium] implemented-not-documented** — The Module Architecture diagram/table states AppModule imports only ConfigModule, AuthModule, DocumentModule, ShareLinkModule, DataSourceModule (plus UserModule). The real AppModule additionally imports WorkspaceModule, ApiKeyModule, YorkieModule, ApiV1Module, ImageModule, FileModule, HealthModule, UserDocStylesModule, AnalyticsModule, and FolderModule. The enumeration of AppModule's imports is materially incomplete.
  - _Evidence:_ packages/backend/src/app.module.ts imports lines 6-19 and imports array lines 99-113 (WorkspaceModule, ApiKeyModule, YorkieModule, ApiV1Module, ImageModule, FileModule, HealthModule, UserDocStylesModule, AnalyticsModule, FolderModule)
- **[medium] implemented-not-documented** — The Database Schema ER diagram and prose describe only User, Document, ShareLink, DataSource. The actual Prisma schema also defines Workspace, WorkspaceMember, WorkspaceInvite, ApiKey, Folder, and UserDocStyles. The Document model omits shipped fields type, fileId, updatedAt, workspaceId, and folderId; DataSource omits workspaceId. This is notable because the doc's own access model relies on Workspace/WorkspaceMember, which are absent from the schema section.
  - _Evidence:_ packages/backend/prisma/schema.prisma: Workspace (l.93), WorkspaceMember (l.107), WorkspaceInvite (l.120), ApiKey (l.133), Folder (l.65), UserDocStyles (l.17); Document.type/fileId/updatedAt/workspaceId/folderId l.44-60; DataSource.workspaceId l.37
- **[low] implemented-not-documented** — The Authentication API reference documents /auth/github, /auth/github/callback, /auth/me, /auth/refresh, /auth/logout, but omits three shipped auth endpoints: GET /auth/yorkie-token, POST /auth/yorkie-token/share, and POST /auth/cli/exchange (the last is referenced only in the rate-limit table).
  - _Evidence:_ packages/backend/src/auth/auth.controller.ts: getYorkieToken l.52-57, getYorkieShareToken l.66-74, cliExchange l.146-162
- **[low] stale-reference** — The Risks and Mitigation section states the single default throttler bucket is '60 req/min/IP', contradicting both the code and the doc's own Rate Limiting table (120 req/60s). The configured limit is 120.
  - _Evidence:_ doc line 472 ('60 req/min/IP') vs doc line 310 ('120 req / 60s') and packages/backend/src/app.module.ts l.96 (limit: 120, ttl: 60_000)

### docs/design/comments-mentions.md

> The @mention feature described in the doc is fully shipped and closely matches the design; only minor naming/structural drift exists (a described MentionTextarea wrapper was never created, and two core helper functions are undocumented).

- **[low] documented-not-implemented** — The doc dedicates a section 'Input — MentionTextarea inside CommentComposer' and states mention behavior is 'layered via a small MentionTextarea wrapper / hook'. No MentionTextarea component or hook exists anywhere in the codebase; all trigger/dropdown/tokenize logic is inlined directly into CommentComposer.tsx. Behavior fully matches the spec, but the described sub-component factoring is not real.
  - _Evidence:_ grep 'MentionTextarea' across packages/frontend/src returns nothing; logic lives in packages/frontend/src/components/comments/components/CommentComposer.tsx
- **[low] implemented-not-documented** — The 'New shared helper' section lists the mentions.ts API as parseMentionBody, serializeMention, mentionBodyToPlainText, and extractMentionedUserIds. The shipped module also exports detectMentionQuery (the @-trigger detector) and applySelectedMentions (the submit-time tokenizer) — the two functions that actually drive the input trigger and approach-B tokenize-on-submit — neither of which is named in the API list.
  - _Evidence:_ packages/frontend/src/components/comments/mentions.ts exports detectMentionQuery (line 72) and applySelectedMentions (line 99); doc lines 91-109 omit both
- **[low] stale-reference** — The doc describes the view-local mention map as records of '{ matchedText, userId, username }'. The actual implementation stores a MentionRef[] of '{ userId, username }' keyed by username, with no matchedText field; applySelectedMentions re-matches by username at submit rather than by a stored matchedText.
  - _Evidence:_ CommentComposer.tsx selectedRef is MentionRef[] ({userId, username}); mentions.ts MentionRef type has no matchedText; doc line 145
- **[low] stale-reference** — The doc says the @-trigger fires on an '@ immediately preceded by start-of-text or whitespace'. The shipped detectMentionQuery uses a broader rule: start-of-text or any non-[A-Za-z0-9-] character (so it also triggers after punctuation and CJK glyphs, and deliberately suppresses email@host). Minor behavioral drift from the documented trigger condition.
  - _Evidence:_ MENTION_QUERY_RE = /(?:^|[^A-Za-z0-9-])@([^\s@]*)$/ in packages/frontend/src/components/comments/mentions.ts:65 vs doc line 132-135

### docs/design/board/board-whiteboard-elements.md

> SP2 (stickies, image paste/drop, minimap) is shipped and matches the design's intent and behavior; the only inaccuracies are package/path mis-attribution of the image pipeline and illustrative symbol names in the architecture sketch.

- **[medium] stale-reference** — The architecture diagram lists insert-image.ts (insertImageOnSlide), slides-image-input.ts (setupSlidesImagePaths) and image-upload.ts (uploadImageFile) under '@wafflebase/slides REUSED unchanged'. These are not in the slides engine package: insert-image.ts and slides-image-input.ts live in packages/frontend/src/app/slides/ (board-view.tsx imports them from '../slides/...', not the package), and uploadImageFile is defined in packages/frontend/src/app/spreadsheet/image-upload.ts (spreadsheet, not slides) — board-image.ts imports it via '@/app/spreadsheet/image-upload'. A reader looking in @wafflebase/slides would not find them.
  - _Evidence:_ packages/frontend/src/app/board/board-view.tsx (imports from ../slides/insert-image, ../slides/slides-image-input); packages/frontend/src/app/board/board-image.ts (imports uploadImageFile from @/app/spreadsheet/image-upload); packages/frontend/src/app/spreadsheet/image-upload.ts
- **[low] stale-reference** — Minimap geometry symbol names in the doc are illustrative and differ from shipped names: doc says fit / minimapPointToWorld / worldToMinimap / viewportRectInMinimap; code exports fitScene / miniToWorld / worldToMini / viewportRectInMini (plus sceneBounds, centerViewportOnWorld). Behavior matches.
  - _Evidence:_ packages/frontend/src/app/board/minimap-geometry.ts
- **[low] stale-reference** — Doc says board-detail.tsx builds the upload fn (const upload = (file) => uploadImageFile(file, workspaceId)) and passes uploadFn down. In code board-detail.tsx passes only workspaceId to BoardView; the upload adapter is makeBoardImageUpload in board-image.ts and is wired in board-view.tsx. Minor structural drift, not behavioral.
  - _Evidence:_ packages/frontend/src/app/board/board-detail.tsx (passes workspaceId); packages/frontend/src/app/board/board-image.ts (makeBoardImageUpload)

### docs/design/cli.md

> The CLI design doc matches the shipped implementation well (commands, auth endpoints, skills, TextMeasurer, PPTX/PDF export, notes all present and wired); only low-severity staleness remains in version framing, a function signature, and the project-structure tree.

- **[low] stale-reference** — The doc's frontmatter declares target-version 0.3.7 and section 4 presents a 'Breaking changes from v0.3.6 -> v0.3.7' migration table, but the package has since shipped several minor versions.
  - _Evidence:_ packages/cli/package.json declares "version": "0.6.2" (doc target-version: 0.3.7)
- **[low] documented-not-implemented** — Sections 6.1 and 6.4 state that both paginateLayout(doc, measurer, options) and computeLayout(doc, measurer, options) take the injectable measurer as a parameter. In code only computeLayout takes the measurer; paginateLayout operates on an already-computed layout and takes no measurer.
  - _Evidence:_ packages/docs/src/view/pagination.ts:48 paginateLayout(layout: DocumentLayout, pageSetup: PageSetup); packages/docs/src/view/layout.ts:361 computeLayout(blocks, measurer, contentWidth, ...)
- **[low] documented-not-implemented** — Section 6.2 says FontkitMeasurer 'loads fonts through the existing PdfFonts module (already a fontkit consumer for PDF export)'. The actual FontkitMeasurer imports fontkit directly and maintains its own register()/fonts Map keyed by variant; it does not reference PdfFonts. (The width formula advanceWidth/unitsPerEm*size does match.)
  - _Evidence:_ packages/cli/src/docs/fontkit-measurer.ts imports 'fontkit' directly, uses fontkit.create() and a private this.fonts Map; no PdfFonts import (grep found none)
- **[low] stale-reference** — The section 7 project-structure tree places page-range.ts, page-slice.ts, fontkit-measurer.ts, and dom-polyfill.ts under src/notes/. In the codebase these four files live under src/docs/; src/notes/ contains only content.ts and import.ts.
  - _Evidence:_ packages/cli/src/docs/{page-range.ts,page-slice.ts,fontkit-measurer.ts,dom-polyfill.ts}; packages/cli/src/notes/ has only content.ts, import.ts
- **[low] implemented-not-documented** — The section 7 tree omits several shipped files: slides/pptx-export.ts (the PPTX exporter the doc text says now ships), docs/image-fetcher.ts, config/session.ts, util/csv-parse.ts, and scripts/{debug-cmd.mjs,gen-sample-pptx.mjs}.
  - _Evidence:_ find packages/cli/src listed slides/pptx-export.ts, docs/image-fetcher.ts, config/session.ts, util/csv-parse.ts; scripts/ contains debug-cmd.mjs and gen-sample-pptx.mjs

### docs/design/docs/docs-collaboration.md

> Core architecture claims (DocStore interface, MemDocStore, YorkieDocStore with doc.history undo, content tree + pageSetup root field, Doc(store), syncToStore removed) all match the shipped code; the drift is in stale Non-Goals/future-feature framing where presence and tables have since shipped.

- **[medium] roadmap-shipped** — The Non-Goals section lists 'Presence / remote cursor display (follow-up work)', but remote presence and peer cursors are fully shipped and the status header does not correct this. There is a dedicated peer-cursor module and live presence wiring.
  - _Evidence:_ packages/docs/src/view/peer-cursor.ts (PeerCursor interface, drawPeerCaret, drawPeerLabel, resolvePositionPixel); packages/frontend/src/app/docs/docs-detail.tsx (usePresenceUpdater, getOthersPresences(), peer.presence.activeCursorPos, DocsPresence, UserPresence)
- **[medium] roadmap-shipped** — The node-structure section frames tables as a 'Future block type' (`<table>`, `<list-item>`, `<image>` added later), but tables are shipped end-to-end including nested tables. The Yorkie tree emits type:'table' element nodes and the model has full table APIs.
  - _Evidence:_ packages/docs/src/model/document.ts (insertTable, insertTableInCell, createTableBlock, getParentTableBlock, tableData); packages/frontend/src/app/docs/yorkie-doc-store.ts lines 297/300/407 (type: 'table'); packages/docs/test/model/table.test.ts and nested-table.test.ts
- **[low] documented-not-implemented** — The Editor Integration section states 'initialize(container, store) — store parameter becomes required.' In the shipped signature store is optional and defaults to a new MemDocStore().
  - _Evidence:_ packages/docs/src/view/editor.ts:881 initialize(container, store?: DocStore, theme?, readOnly?) with `const docStore = store ?? new MemDocStore();` (line 891)
- **[low] roadmap-shipped** — The Non-Goals list 'Yorkie-based undo/redo (future migration from local snapshots)' as out of scope; this has shipped (undo/redo delegates to doc.history). The status header and Undo/Redo body section already correct this, so the stale Non-Goals bullet is only a minor internal inconsistency.
  - _Evidence:_ packages/frontend/src/app/docs/yorkie-doc-store.ts:2542-2563 (undo/redo/canUndo/canRedo delegate to this.doc.history.*)

### docs/design/docs/docs-named-styles.md

> The named-styles feature is fully shipped and matches the doc closely (model, resolution paths, store API, backend endpoints, Prisma model, H4-6 UI); the only drift is the Yorkie CRDT storage shape, which the doc describes as a nested root.styles but is actually a scalar JSON string root.stylesJson.

- **[medium] other** — The doc's Store API section says YorkieDocStore stores the registry at root-level `root.styles` "mirroring the pageSetup getter/setter + readDocStyles proxy-unwrap helper", and the Risks section says `styles` is "additive at the Yorkie root, exactly like pageSetup". In reality the registry is stored as a single serialized JSON string under `root.stylesJson` (not a nested CRDT object like pageSetup), and readDocStyles does a JSON.parse rather than a proxy-unwrap. The code comment explicitly documents this as a deliberate deviation (whole-blob LWW string to sidestep Yorkie proxy double-encoding).
  - _Evidence:_ packages/frontend/src/app/docs/yorkie-doc-store.ts lines 570-586 (readDocStyles reads root.stylesJson, JSON.parse), lines 2522/2603-2605 (writes/deletes root.stylesJson); packages/backend/src/yorkie/docs-tree.ts lines 460-462, 561-563 (root.stylesJson serialize/delete)
- **[low] other** — The endpoints table says `GET /auth/me/doc-styles` returns "saved DocStyles (or {})". The controller actually returns the object wrapped as `{ styles }` (and PUT returns `{ styles }` too), not the bare DocStyles blob. Minor response-shape omission.
  - _Evidence:_ packages/backend/src/user-doc-styles/user-doc-styles.controller.ts lines 12-28

### docs/design/docs/docs-pagination.md

> The pagination design is fully shipped and matches the code (types, presets, engine, theme, store, page-break, coordinate mapping); only a trivial helper-signature drift exists.

- **[low] other** — Doc states the helper is resolvePageSetup(doc: Document): PageSetup returning doc.pageSetup ?? DEFAULT_PAGE_SETUP. The actual exported signature is resolvePageSetup(setup: PageSetup | undefined): PageSetup — it takes the PageSetup directly, not the Document (callers pass doc.document.pageSetup).
  - _Evidence:_ packages/docs/src/model/types.ts:649 resolvePageSetup(setup: PageSetup | undefined); callers e.g. packages/docs/src/view/editor.ts:1187 resolvePageSetup(doc.document.pageSetup)

### docs/design/docs/docs-pending-inline-style.md

> The proposal is fully implemented and the technical content matches the code closely; the only drift is that the doc is still written as a future proposal ("This proposal adds", "New file:") for work that has actually shipped.

- **[medium] roadmap-shipped** — The doc is framed throughout in proposal/future tense ('This proposal adds a transient pending style', 'New file: packages/docs/src/view/pending-style.ts (~40 lines)'), but the feature is fully shipped: the file exists with the exact PendingStyle interface, and it is wired into editor.ts (createPendingStyle at line 900, pending.set on collapsed selection at 1008, merge into getSelectionStyle at 2600/2644, pending.clear at 947/1935/1961/2340/2582/3540/3656) and text-editor.ts (consumeForInsert 335, rewindAnchor 351, rebindAnchor 366). A reader would wrongly believe this is unbuilt.
  - _Evidence:_ packages/docs/src/view/pending-style.ts (createPendingStyle/PendingStyle); packages/docs/src/view/editor.ts:900,1008,2600-2601,2644-2645; packages/docs/src/view/text-editor.ts:335,351,366
- **[low] stale-reference** — Testing section states 'New file: packages/docs/test/view/pending-style.test.ts' as the single controller test and says editor integration tests will 'extend existing view/*.test.ts', but three dedicated test files were actually created.
  - _Evidence:_ packages/docs/test/view/pending-style.test.ts, pending-style-editor.test.ts, pending-style-integration.test.ts
- **[low] other** — Doc gives the constructor signature as createPendingStyle(doc: Document); the shipped signature takes the type alias Doc (imported from ../model/document.js), not a type named Document.
  - _Evidence:_ packages/docs/src/view/pending-style.ts:1,16 (import type { Doc }; createPendingStyle(doc: Doc))

### docs/design/docs/docs-pdf-export.md

> The PDF-export design is fully implemented and matches the doc closely; only test-location, fixture-naming, and API-signature details have drifted.

- **[low] stale-reference** — Doc's Testing and File Structure sections place tests/fixtures under packages/docs/src/export/__tests__/fixtures/, but the shipped code puts them under packages/docs/test/export/ with PDF fixtures in packages/docs/test/export/fixtures/pdf/.
  - _Evidence:_ packages/docs/test/export/pdf-exporter.test.ts, packages/docs/test/export/fixtures/pdf/*.json (no src/export/__tests__ dir exists)
- **[low] stale-reference** — Doc lists fixtures simple-paragraph.json, mixed-korean-english.json, with-table.json, multi-page.json; the actual fixture set differs (e.g. with-list.json exists, and the listed simple-paragraph/mixed-korean-english/with-table/multi-page names are not all present).
  - _Evidence:_ packages/docs/test/export/fixtures/pdf/ contains with-headings-and-links.json, with-image.json, with-list.json, with-split-row.json, with-merged-cells.json, with-header-footer-pagenumber.json
- **[low] other** — Public API block shows `static async export(doc, options?: PdfExportOptions)` with options optional, but the implementation declares it required (`opts: PdfExportOptions`).
  - _Evidence:_ packages/docs/src/export/pdf-exporter.ts:61 `export(doc: Document, opts: PdfExportOptions): Promise<Blob>`
- **[low] implemented-not-documented** — The primary PdfExportOptions code sample (lines 138-150) omits `fontResolver`, which the shipped interface includes; it is only mentioned later in the P3-a prose. Minor: main API listing is incomplete.
  - _Evidence:_ packages/docs/src/export/pdf-exporter.ts:31-50 PdfExportOptions includes PdfFontResolver; used at line 71 scanFontsUsed(doc, opts.fontResolver)

### docs/design/docs/docs-ruler.md

> The Document Ruler design is fully shipped in packages/docs and matches the doc; only small drifts in file layout and function signatures.

- **[low] stale-reference** — Doc's File Structure section says the new file is a single module `packages/docs/src/view/ruler.ts`. In code it is a directory module `packages/docs/src/view/ruler/` split into index.ts (Ruler class, RULER_SIZE), unit.ts (RulerUnit, detectUnit, getGridConfig, snapToGrid), and tick-renderer.ts (drawTicks).
  - _Evidence:_ packages/docs/src/view/ruler/index.ts, packages/docs/src/view/ruler/unit.ts, packages/docs/src/view/ruler/tick-renderer.ts (no ruler.ts exists)
- **[low] implemented-not-documented** — The Ruler API differs slightly from the doc's signatures: constructor takes a 3rd `readOnly?` arg; `render()` takes a 6th `cursorPageIndex` arg and cursorBlockStyle is nullable; there is an additional `onDragGuideline` callback not listed alongside onMarginChange/onIndentChange/dispose.
  - _Evidence:_ packages/docs/src/view/ruler/index.ts:56 (constructor readOnly), :104-111 (render cursorPageIndex), :430 (onDragGuideline)
- **[low] implemented-not-documented** — Doc's BlockStyle snippet lists alignment as `'left' | 'center' | 'right'`; actual type also includes `'justify'`. Unrelated to the ruler additions but the reproduced interface is stale.
  - _Evidence:_ packages/docs/src/model/types.ts:103 alignment includes 'justify'

### docs/design/docs/tables/docs-table-resize.md

> The feature is fully shipped and matches the doc's data model, Doc API, border detection, constraints, and layout integration; the only drift is that the drag guideline is rendered in editor.ts (not table-renderer.ts as the doc states) and a couple of cosmetic value mismatches.

- **[medium] stale-reference** — The doc's 'Guideline Rendering' section says 'the table renderer draws the guideline after borders' and the File Changes table lists packages/docs/src/view/table-renderer.ts with change 'Render guideline when dragState is active'. In reality table-renderer.ts contains no guideline code; the guideline is drawn in editor.ts's paint loop, fed by an onDragGuideline callback wired through text-editor.ts. A reader looking in table-renderer.ts for guideline logic finds nothing.
  - _Evidence:_ grep found no guideline/setLineDash/dragState references in packages/docs/src/view/table-renderer.ts; guideline drawing is at packages/docs/src/view/editor.ts:1784-1806 (setLineDash([4,4]), stroke), with onDragGuideline callback at text-editor.ts:177 and 1601
- **[low] stale-reference** — Doc specifies guideline color '#4A90D9'; code uses '#4285F4'. Line dash [4,4] and lineWidth 1 match.
  - _Evidence:_ packages/docs/src/view/editor.ts:1789 ctx.strokeStyle = '#4285F4'
- **[low] other** — Doc's TableData snippet declares rowHeights as 'number[]'; actual type is '(number | undefined)[]', consistent with the doc's prose about per-entry undefined entries but not its type signature.
  - _Evidence:_ packages/docs/src/model/types.ts:468 rowHeights?: (number | undefined)[]

### docs/design/docs/docs-spell-check.md

> The spell-check feature is shipped essentially as documented — every named module, symbol, provider, router, session, EditorAPI method, and the unified DocsContextMenu exist and are wired up; only a couple of numeric/cosmetic details have drifted.

- **[low] stale-reference** — Doc says the vendored dict adds two lazy chunks bumping the frontend chunk count "108 → 110" in harness.config.json. The actual reason entry records the spell-dict bump as "109 → 111" (a slides Slider bump 108→109 landed in between). The load-bearing claims (two lazy dict chunks, a reason entry, main docs entry stays ~346 KB, dict not inlined) all match; only the numeric range is stale.
  - _Evidence:_ harness.config.json maxChunkCountReason: "Prior bump: 109 → 111 when Docs spell check vendored the en_US Hunspell dictionary ... two dynamic-import chunks ... main docs entry stays ~346 kB"
- **[low] implemented-not-documented** — An EditorAPI toggle primitive setSpellCheckEnabled(enabled) is implemented (declared and defined in editor.ts, on by default), yet the doc lists "Toggle spell check on/off (UI control)" as a deferred Non-Goal and never mentions the existing programmatic API. Consistent in spirit (no UI control ships), but the underlying enable/disable API already exists and is undocumented.
  - _Evidence:_ packages/docs/src/view/editor.ts:222 (interface) and :3208 (impl) setSpellCheckEnabled; no frontend UI caller found
- **[low] documented-not-implemented** — The Testing section still lists a "caret word" skip test for both tokenize and SpellSession, but the doc's own Skip-rules narrative states the caret-word skip was tried and removed. No caret-word skip logic is present in tokenize.ts or session.ts, so the caret-word test bullets describe behavior that was intentionally dropped.
  - _Evidence:_ packages/docs/src/spell/tokenize.ts (skip rules: <2 chars, all-caps acronym, URL/email/number ranges — no caret handling); packages/docs/src/spell/session.ts (no caret logic)

### docs/design/docs/docs.md

> Doc is largely accurate and self-aware (Non-Goals updated to "shipped" with valid cross-refs), but the package name is wrong throughout and two sections (Store Abstraction, Data Model) still frame shipped features as future.

- **[medium] stale-reference** — The doc repeatedly names the package '@wafflebase/document' (Summary line 10 and Goals line 26), but the actual package name is '@wafflebase/docs'. A reader would import the wrong module path.
  - _Evidence:_ packages/docs/package.json name field = "@wafflebase/docs"; doc lines 10,26 say @wafflebase/document
- **[medium] roadmap-shipped** — The Store Abstraction section says 'Future YorkieDocStore will implement the same interface using Yorkie CRDT operations', but YorkieDocStore has shipped as a class implementing DocStore. This also contradicts the doc's own Non-Goals which lists real-time collaboration as shipped.
  - _Evidence:_ packages/frontend/src/app/docs/yorkie-doc-store.ts:505 `export class YorkieDocStore implements DocStore`; doc lines 165-167 say 'Future YorkieDocStore will...'
- **[medium] roadmap-shipped** — Data Model 'Design decisions' claims 'Block type: Currently only "paragraph". The discriminated union allows future extension to "table" | "heading" | "list"'. Those block types have all shipped; BlockType is now a wide union. The section is internally stale versus the doc's own Non-Goals.
  - _Evidence:_ packages/docs/src/model/types.ts:39 `export type BlockType = 'paragraph' | 'title' | 'subtitle' | 'heading' | 'list-item' | 'horizontal-rule' | 'table' | 'page-break'`; doc lines 113-114
- **[low] stale-reference** — The Package Structure tree lists 'doc-container.ts # Scroll management' under src/view/, but no such file exists; scroll handling lives in text-editor.ts and doc-canvas.ts.
  - _Evidence:_ packages/docs/src/view/doc-container.ts does not exist (ls error); scroll logic in packages/docs/src/view/text-editor.ts and doc-canvas.ts; doc line 288

### docs/design/docs/docs-tables.md

> The doc accurately describes the shipped table subsystem — data model, CRDT structure, store ops, navigation, layout, and UI all match the code — with only minor undocumented additions around row-height support.

- **[low] implemented-not-documented** — The doc's TableData interface lists only { rows, columnWidths }, but the shipped type also has an optional rowHeights?: (number | undefined)[] field (row resize support).
  - _Evidence:_ packages/docs/src/model/types.ts:465-469 (TableData with rowHeights?)
- **[low] implemented-not-documented** — The doc shows updateTableAttrs(tableBlockId, attrs: { cols: number[] }), but the shipped DocStore signature is attrs: { cols: number[]; rowHeights?: (number | undefined)[] }.
  - _Evidence:_ packages/docs/src/store/store.ts:69 and packages/frontend/src/app/docs/yorkie-doc-store.ts (updateTableAttrs signature)
- **[low] stale-reference** — The doc names a BlockParentMap type alias (type BlockParentMap = Map<string, BlockCellInfo>), but the code uses Map<string, BlockCellInfo> inline via a _blockParentMap field / blockParentMap getter; no BlockParentMap type is actually exported. Purely a naming nit — BlockCellInfo exists and the map is real.
  - _Evidence:_ packages/docs/src/model/document.ts:67,79,83 (Map<string, BlockCellInfo>, no BlockParentMap alias); packages/docs/src/model/types.ts:479 (BlockCellInfo)

### docs/design/docs/tables/docs-table-row-splitting.md

> The described row-splitting feature is fully shipped and matches the doc's data model, pagination, rendering, and interaction claims; only a couple of cited function names and an unlisted file are slightly off.

- **[low] stale-reference** — Section 3.4 states "`renderSelection` clips selection highlight rectangles to the current page's fragment bounds" as an existing function, and 3.5 states "`scrollIntoView` targets that page's Y offset." Neither symbol exists in packages/docs/src. The split-row selection clipping is actually implemented in selection.ts (computeSelectionRects / SelectionManager, using rowSplitOffset/rowSplitHeight at lines ~388-395 and ~580-620); scroll handling is done via container.scrollTop in text-editor.ts. Behavior is present, only the named symbols are wrong.
  - _Evidence:_ grep found no renderSelection/scrollIntoView symbols; packages/docs/src/view/selection.ts:526 computeSelectionRects, selection.ts:580-625 fragment-clipping logic; packages/docs/src/view/text-editor.ts scrollTop usage
- **[low] stale-reference** — Section 3 lists interaction-layer files as only text-editor.ts and pagination.ts, but the split-aware selection clipping actually lives in an unmentioned file, selection.ts. Minor omission.
  - _Evidence:_ packages/docs/src/view/selection.ts:388,587,620 handle rowSplitOffset/rowSplitHeight
- **[low] stale-reference** — Section 2.5 references `computeTableRangeForPageLine` in the context of doc-canvas.ts/table-renderer.ts; the function is actually defined in table-geometry.ts and imported by both. The doc gives no explicit path so this is only mild imprecision.
  - _Evidence:_ packages/docs/src/view/table-geometry.ts:101 defines computeTableRangeForPageLine; imported at doc-canvas.ts:10 and table-renderer.ts:21

### docs/design/docs/tables/docs-table-copy-paste.md

> The doc matches the shipped clipboard/table-paste implementation almost exactly on file paths, function names, and paste-flow ordering, but its Phase-1 Non-Goal of deferring cell merge (colSpan/rowSpan) has since been implemented, and one "Unchanged" symbol reference is stale.

- **[medium] roadmap-shipped** — The doc repeatedly frames cell merge as out of scope: Non-Goals say 'Copying/pasting cell merge (colSpan/rowSpan) attributes in Phase 1', the risk table says 'Phase 1 skips colSpan/rowSpan — paste treats each cell independently', and Phase 3 Non-Goals say 'colSpan/rowSpan from external HTML (Phase 1 already defers this)'. In the shipped code, merges are fully handled: cloneTableCells explicitly preserves colSpan/rowSpan, pasteTableCells calls normalizeTableMerges after both new-table and in-place paste, and the copy selection is expanded over merges via expandCellRangeForMerges.
  - _Evidence:_ packages/docs/src/view/clipboard.ts:55-56 (cloneTableCells copies colSpan/rowSpan); packages/docs/src/view/text-editor.ts:3634,3666 (normalizeTableMerges in pasteTableCells); packages/docs/src/view/text-editor.ts:1787,1807,2665 + selection.ts:56 (expandCellRangeForMerges); model/types.ts:551 (normalizeTableMerges def)
- **[low] stale-reference** — The 'Unchanged' table claims 'document.ts — existing updateCellBlocks() reused', but no updateCellBlocks symbol exists in the docs package; paste actually persists via doc.updateBlockDirect() (which the doc's own Paste Flow step 5 correctly names). The Unchanged-section reference is dangling.
  - _Evidence:_ grep for updateCellBlocks in packages/docs/src returns nothing; packages/docs/src/model/document.ts:485 defines updateBlockDirect; text-editor.ts:3667 calls this.doc.updateBlockDirect
- **[low] other** — The illustrative cloneTableCells snippet in the doc spreads '...cell' and omits merge fields, whereas the shipped helper explicitly rebuilds style and conditionally forwards colSpan/rowSpan (consistent with the merge-handling drift above). Cosmetic snippet divergence only.
  - _Evidence:_ docs snippet lines 92-105 vs packages/docs/src/view/clipboard.ts:51-65

### docs/design/docs/tables/docs-nested-tables.md

> The nested-tables feature is genuinely shipped and matches the doc's data-model, layout, rendering, CRDT-path, and .docx round-trip descriptions; drift is limited to two named helper APIs the doc invents that don't exist under those names and a minor insertion-mechanism mismatch.

- **[medium] documented-not-implemented** — Section 4 introduces a 'New getTableContext(blockId)' that walks the BlockParentMap chain to return the table hierarchy path [outermostTableId, ..., innermostTableId]. No such symbol exists anywhere in the repo; a repo-wide grep for getTableContext returns nothing. The shipped code identifies target tables via getCellInfo()/blockParentMap.get() and getParentTableBlock() instead — which the doc's own next subsection admits ('No changes needed'), making the proposed API vestigial and unbuilt.
  - _Evidence:_ grep 'getTableContext' across packages/ = 0 hits; packages/docs/src/model/document.ts getParentTableBlock() (~line 214) and packages/docs/src/view/text-editor.ts getCellInfo() are the actual mechanism
- **[low] stale-reference** — Section 5 specifies a 'resolveTreePath(blockId): number[] utility' as the mechanism for converting a blockId to a deeper Yorkie tree path for nested tables. No function named resolveTreePath (or getTableContext) exists. The equivalent functionality IS shipped but via differently-named helpers that walk repeating [r,c,b] triplets — getCellBlock(), setCellBlock(), getCellSubPath(), getBlocksArrayForPath() in yorkie-doc-store.ts. Concept shipped, named utility does not exist.
  - _Evidence:_ grep 'resolveTreePath' across packages/ = 0 hits; packages/frontend/src/app/docs/yorkie-doc-store.ts lines 1207-1266 (getCellBlock/setCellBlock/getBlocksArrayForPath, comment '[r, c, b, r, c, b, ...]')
- **[low] documented-not-implemented** — Section 1 and Section 4 state cell insertion works by removing the nested-table guard in Document.insertTable() so a table is added to cell.blocks 'like any other block' via insertTable(). Actual code adds a dedicated Document.insertTableInCell(blockId, rows, cols) method; Document.insertTable(blockIndex, rows, cols) takes a body block index and has no guard to remove. The editor's insertTable command branches on blockParentMap and calls insertTableInCell for cells. Mechanism differs from the doc's description.
  - _Evidence:_ packages/docs/src/model/document.ts insertTable (line 578, body-only, no guard) and insertTableInCell (line 592); packages/docs/src/view/editor.ts line 3341 calls doc.insertTableInCell

### docs/design/homepage.md

> The homepage doc accurately describes the shipped implementation (file structure, primitives, demo tokens/env vars, theme-sync via postMessage, routing, CSS tokens all match); only stale hardcoded version literals and one hint-text quote have drifted.

- **[low] stale-reference** — Doc's DemoSection footer says it shows the literal 'wafflebase@0.3.7', but the code renders `wafflebase@${__APP_VERSION__}`, which Vite injects from the root package.json version (currently 0.6.2). The rendered value is dynamic, not the doc's frozen 0.3.7.
  - _Evidence:_ packages/frontend/src/app/home/demo-section.tsx:199; packages/frontend/vite.config.ts:238 (rootPkg.version); root package.json version 0.6.2
- **[low] stale-reference** — Doc's Hero eyebrow is quoted as 'v0.3 · Apache-2.0 · Self-hosted', but the code derives the label dynamically from the app version (VERSION_LABEL = v + major.minor of __APP_VERSION__), so it currently renders 'v0.6', not 'v0.3'.
  - _Evidence:_ packages/frontend/src/app/home/hero-section.tsx:8,44; root package.json version 0.6.2
- **[low] stale-reference** — Doc quotes the Slides tab footer hint as 'Tip: arrow keys navigate slides — press F to present.', but the shipped hint reads 'Tip: arrow keys navigate — ⌘/Ctrl+Enter to present.'
  - _Evidence:_ packages/frontend/src/app/home/demo-section.tsx:197
- **[low] stale-reference** — Frontmatter target-version is 0.4.0 while the repo is at 0.6.2, indicating the doc predates the current release; content is otherwise still accurate.
  - _Evidence:_ docs/design/homepage.md:3; packages/frontend/package.json version 0.6.2

### docs/design/harness-engineering.md

> Nearly all concrete file/symbol/lane/config claims verify exactly against the code; the only drift is the stale status framing of the Summary and the "Remaining Work" heading, under which several fully-shipped phases (24-27) sit.

- **[medium] roadmap-shipped** — The Summary (lines 20-27, "As of 2026-03-11 ... phases 1 through 20, 22, and 23 are completed. Remaining work focuses on agent observability.") and the "## Remaining Work" heading frame Phases 24 (Autonomous Contribution Loop), 25 (Local Spec->PR), 26 (Autonomous Issue Hunting Tier 1), and 27 (Panel Feedback Corpus) as not-yet-done, but they are substantially shipped in code. A reader skimming status headers would be misled about what exists. The prose bodies of 26/27 do partially self-correct ("Tier 1 (shipped)", "Done criteria ... (met)", "Not yet built: ..."), so this is staleness rather than a false shipped-claim.
  - _Evidence:_ Shipped: .github/workflows/agent-implement.yml, agent-iterate-ci.yml, agent-review-panel.yml, agent-review-reply.yml, agent-review-on-demand.yml, agent-summarize.yml, agent-loop.yml; scripts/agent/review-panel.mjs, review-scope.mjs, review-state.mjs, set-state.mjs, mark-ready.mjs, novelty.mjs (Phase 24); scripts/agent/spec-to-pr.mjs + .claude/commands/spec-to-pr.md (Phase 25); scripts/agent/hunt*.mjs + .claude/commands/hunt.md (Phase 26); scripts/agent/harvest.mjs + scripts/agent/misses.jsonl (Phase 27) all present.
- **[low] stale-reference** — The section heading "## Completed Phases (1-20, 22)" omits Phase 23, which is listed as Completed in that very table (line 292) and given its own "Phase 23 delivered" subsection. Cosmetic title drift.
  - _Evidence:_ docs/design/harness-engineering.md line 265 heading vs line 292 table row "23 | Docker-based browser test environment ... | Completed".

### docs/design/export-progress.md

> The export-progress feature (onProgress callbacks with 'slides'/'pages'/'images' phases, yieldToPaint macrotask yields, and updateExportToast) is fully shipped exactly as described; only the doc's referenced "import toast" prior art is misdescribed.

- **[medium] stale-reference** — The doc's Summary, Goals, and section C claim the export toast 'mirrors the existing import flow' via a shared helper `updateImportToast` in packages/frontend/src/app/documents/document-list.tsx. No such symbol exists anywhere in the repo, and document-list.tsx contains no import-progress toast. The only toast.loading usage in the frontend is the new updateExportToast in export-utils.ts. The real import progress UX is an upload-queue/upload-panel (packages/frontend/src/app/documents/upload-queue.ts, use-upload-queue.ts, upload-panel.tsx), not a Sonner toast — so the stated design rationale of 'reusing the import toast' points at prior art that does not exist.
  - _Evidence:_ grep 'updateImportToast' across packages/ returns nothing (exit 1); grep 'toast.loading' in packages/frontend/src matches only app/docs/export-utils.ts; import progress lives in packages/frontend/src/app/documents/upload-queue.ts + upload-panel.tsx, and importDocx (app/docs/docx-actions.ts) reports {done,total,fileName} into the upload queue, not a toast.

### docs/design/notes/notes.md

> The notes design doc accurately describes the shipped implementation — engine package, backend/frontend wiring, CLI namespace, and all "shipped" later-phase features exist as claimed; only small file-layout and symbol-name drifts remain in the P1 architecture sketch.

- **[low] stale-reference** — P1 architecture lists engine subdirectories `src/model/` (note data types) and `src/yorkie/` (yorkieSync.ts, remoteSelection.ts, index.ts). Neither directory exists. packages/notes/src has only `view/` and `store/`; the Yorkie/CodeMirror binding lives in `src/view/note-sync.ts` and `src/view/remote-selection.ts`, and data types live in `src/store/store.ts` + `src/types.ts`.
  - _Evidence:_ packages/notes/src/ (no model/ or yorkie/ dir); packages/notes/src/view/note-sync.ts, packages/notes/src/view/remote-selection.ts
- **[low] stale-reference** — Doc names the engine entry `initialize(container, store, theme)` returning `EditorAPI`. Actual export returns `NoteEditorAPI` and takes five params: (container, store, theme, readOnly, viewMode).
  - _Evidence:_ packages/notes/src/view/editor.ts:130 (export function initialize ... : NoteEditorAPI); packages/notes/src/index.ts exports NoteEditorAPI
- **[low] stale-reference** — Doc refers to the seed helper as `initialNoteRoot()` and the presence type as `NotePresence`. The shipped symbols are `initialNotesRoot()` and `NotesPresence` (root type `YorkieNotesRoot` matches).
  - _Evidence:_ packages/frontend/src/types/notes-document.ts:46 (initialNotesRoot), :31 (NotesPresence)

### docs/design/rest-api.md

> The REST API and API-key design is fully shipped and matches the code closely; drift is limited to a stale SDK version, an undocumented image-endpoint family, and a rate-limiting Non-Goal that is actually implemented.

- **[medium] implemented-not-documented** — The doc's Section 5 endpoint list and Section 6 module structure for api/v1/ do not mention any image endpoints, but a fully wired ApiV1ImagesController ships POST/GET/DELETE /api/v1/workspaces/:workspaceId/images, guarded by CombinedAuthGuard + WorkspaceScopeGuard. A reader auditing the v1 surface would miss this endpoint group entirely.
  - _Evidence:_ packages/backend/src/api/v1/images.controller.ts (ApiV1ImagesController, @Controller('api/v1/workspaces/:workspaceId/images'), upload/get/delete); file omitted from doc Section 6 tree which lists only documents/tabs/cells/docs-content controllers + workspace-scope.guard
- **[medium] documented-not-implemented** — Non-Goals explicitly list 'Rate limiting or usage metering', implying the v1 API has none, but rate limiting is implemented and active on the v1 surface: the images controller sets @Throttle({ default: { limit: 600, ttl: 60_000 } }), CLI auth endpoints throttle at 10/min, and app.module registers ThrottlerModule.forRoot with a global ThrottlerGuard.
  - _Evidence:_ packages/backend/src/api/v1/images.controller.ts:25 (@Throttle); packages/backend/src/auth/auth.controller.ts:148,166 (@Throttle); packages/backend/src/app.module.ts:4,91 (ThrottlerModule/ThrottlerGuard)
- **[low] stale-reference** — Section 4 states the backend @yorkie-js/sdk matches 'the version family used by the frontend (@yorkie-js/react 0.6.49)'. Actual pinned version is 0.7.13 on both sides; the 0.6.49 figure is stale (the directional 'matches frontend' claim still holds).
  - _Evidence:_ packages/backend/package.json:42 (@yorkie-js/sdk 0.7.13); packages/frontend/package.json:60,89 (@yorkie-js/react 0.7.13, @yorkie-js/sdk 0.7.13)

### docs/design/sheets/batch-transactions.md

> The batch-transaction design matches shipped code (beginBatch/endBatch, batchOverlay/batchOps, MemStore no-ops, Sheet wrapping), with two drifts: the store's shiftCells/moveCells are now batch-aware despite the doc calling them "unaffected by batch," and a batchOps type annotation is stale.

- **[medium] implemented-not-documented** — The doc states under 'Methods unaffected by batch' that shiftCells()/moveCells() 'Run their own doc.update() outside the batch,' and Non-Goals/Risks frame them as always producing 2 undo steps. But the store methods now branch on `if (this.batchOps)` and buffer their apply function into batchOps, returning early to defer to the single endBatch() doc.update(). So the store-level methods ARE batch-aware, contradicting the doc's 'unaffected' framing (the sheet-level 2-undo-step behavior still holds only because Sheet.shiftCells calls store.shiftCells before beginBatch).
  - _Evidence:_ packages/frontend/src/app/spreadsheet/yorkie-store.ts:504-508 (shiftCells) and 536-540 (moveCells); doc lines 100-101, 28-30, 171-175
- **[low] stale-reference** — The doc declares the batchOps buffer field as `Array<(root: Worksheet) => void>`, but the shipped field type is `Array<(root: SpreadsheetDocument) => void>` (the deferred ops operate on the document root, consistent with the doc's own prose but not its type annotation).
  - _Evidence:_ packages/frontend/src/app/spreadsheet/yorkie-store.ts:77 vs doc line 53

### docs/design/shared-core-extraction.md

> The doc is a well-framed roadmap whose explicit Status note accurately reports what shipped (core with tokens/geometry/url) vs. what is still roadmap (canvas/ooxml/drawingml); only the "Incidental fix" section and geometry redefinition list carry stale details already overtaken by the shipped Phase 0.

- **[low] roadmap-shipped** — The 'Incidental fix' section says packages/docs/package.json lists `@wafflebase/tokens` under devDependencies and proposes promoting it to a dependency (fold into Phase 0). That fix is already done and the package name is obsolete: `@wafflebase/tokens` no longer exists (folded into `@wafflebase/core`), docs/package.json has `@wafflebase/core` under `dependencies` (line 57), and theme.ts imports `@wafflebase/core/tokens` at runtime — so the described bug no longer exists.
  - _Evidence:_ packages/docs/package.json (dependencies: @wafflebase/core workspace:*), packages/docs/src/view/theme.ts (import { palette } from '@wafflebase/core/tokens'); no packages/tokens directory exists
- **[low] stale-reference** — The 'Geometry redefinition sites' list presents slides frame/routing/insert/lasso/image-crop as still redefining geometry, but those five files now import from `@wafflebase/core/geometry` (Phase 0 geometry extraction, which the Status note confirms shipped). The list is accurate only for `packages/sheets/src/view/layout.ts`, which still defines a local `Size = {width,height}`.
  - _Evidence:_ packages/slides/src/model/frame.ts, image-crop.ts, view/canvas/routing.ts, view/editor/interactions/{lasso,insert}.ts all import @wafflebase/core/geometry; packages/sheets/src/view/layout.ts line 36 still `export type Size = { width: number; height: number }`
- **[low] implemented-not-documented** — The package.json `exports` sketch and the proposed src layout omit the shipped `./url` subpath (SAFE_PROTOCOLS/isSafeUrl). The Status note mentions `./url` separately, but the canonical exports/layout diagrams that a reader consults do not include it.
  - _Evidence:_ packages/core/package.json exports include './url'; packages/core/src/url/index.ts exists; doc lines 122-147 sketch omits url

### docs/design/sheets/charts.md

> Phase 1 is fully shipped and the doc matches the code closely; the only drift is that the core types are defined in the @wafflebase/sheets package, not in the frontend path the doc names.

- **[low] stale-reference** — Doc says to extend `ChartType` (and defines `SheetChart`) in `packages/frontend/src/types/worksheet.ts`. That file only RE-EXPORTS both from `@wafflebase/sheets`; the actual definitions live in packages/sheets/src/model/workbook/worksheet-document.ts (ChartType line 14, SheetChart line 16). The type bodies themselves match the doc exactly.
  - _Evidence:_ packages/frontend/src/types/worksheet.ts (re-export from @wafflebase/sheets), packages/sheets/src/model/workbook/worksheet-document.ts:14-32
- **[low] other** — Doc gives the pie builder signature as `buildPieDataset(root, chart)`; the shipped function takes a third `palette?: string` argument used for slice colors. Cosmetic signature drift only.
  - _Evidence:_ packages/frontend/src/app/spreadsheet/chart-utils.ts:278-320 (buildPieDataset), called as buildPieDataset(root, chart, chart.colorPalette) in chart-object-layer.tsx:192

### docs/design/sheets/calculator.md

> The doc accurately describes the shipped calculator recalculation and cross-sheet cycle-detection architecture; only minor drift exists around the evaluation function name and an undocumented spill-evaluation path.

- **[low] stale-reference** — The doc's evaluation step and diagram reference `evaluate(formula, grid)` computing the result, but the calculator's recalculation loop actually calls `evaluateWithSpill(formula, grid)`. A separate `evaluate` function does exist (formula.ts:577), but it is not the one used in calculator.ts.
  - _Evidence:_ packages/sheets/src/model/worksheet/calculator.ts:96 uses evaluateWithSpill; packages/sheets/src/formula/formula.ts:546 (evaluateWithSpill) vs :577 (evaluate)
- **[low] implemented-not-documented** — calculator.ts contains substantial array-spill logic (SpillResult handling, ghost-cell writes, spill-blocker registration via registerSpillBlocker/clearSpillBlockers, spillRows/spillCols, expandUnboundedRanges of open-ended ranges) that the doc omits entirely. The doc describes the evaluate step as a simple single-value write plus a no-op skip.
  - _Evidence:_ packages/sheets/src/model/worksheet/calculator.ts:71-145 (spill ghost clearing, conflict detection, ghost writes); :90 expandUnboundedRanges

### docs/design/sheets/collaboration.md

> The doc accurately describes the shipped module layout, migration command, test suite, and stable-id worksheet model; the only drift is in its self-declared "canonical" type block, which lists a datasources/DatasourceConfig field that does not exist and omits the shipped dataValidations field.

- **[medium] documented-not-implemented** — The 'canonical' SpreadsheetDocument declares `datasources?: { [id: string]: DatasourceConfig }` (see datasource.md). The actual SpreadsheetDocument type has no datasources field, and the type `DatasourceConfig` does not exist anywhere in the codebase; datasource.md also never defines this patch field. Since the block is framed as the authoritative current shape, a reader would expect datasource config to live on the Yorkie document, which it does not.
  - _Evidence:_ packages/sheets/src/model/workbook/worksheet-document.ts (SpreadsheetDocument at line 115-119 has only tabs/tabOrder/sheets); grep for 'DatasourceConfig' across packages/ (excluding node_modules/dist) returns zero matches; docs/design/sheets/datasource.md has no `datasources`/`DatasourceConfig` mention
- **[medium] implemented-not-documented** — The Worksheet type ships `dataValidations?: DataValidationRule[]` (seeded to [] in createWorksheet and remapped in the backend migration), but the doc's canonical Worksheet block—explicitly billed as the single source of truth that other docs must patch against—omits this field entirely.
  - _Evidence:_ packages/sheets/src/model/workbook/worksheet-document.ts:81 (`dataValidations?: DataValidationRule[]`) and :136 (seeded in createWorksheet); type defined at packages/sheets/src/model/core/types.ts:182
- **[low] stale-reference** — The canonical block types the comments field as `comments?: CommentsCollection`, but the type `CommentsCollection` does not exist; the shipped Worksheet uses `comments?: { [threadId: string]: Thread }`. This field is owned by comments.md per the doc's own note, so the impact is cosmetic.
  - _Evidence:_ packages/sheets/src/model/workbook/worksheet-document.ts:94-96 (`comments?: { [threadId: string]: Thread }`); grep for 'CommentsCollection' across packages/ returns zero matches

### docs/design/sheets/file-import.md

> The doc's shipped-XLSX and unused-papaparse claims are accurate, but it repeatedly names the frontend import action pickAndImportXlsx, which does not exist — the actual export is importXlsx.

- **[medium] stale-reference** — The doc states the shipped frontend entry point is `pickAndImportXlsx` in xlsx-actions.ts (Current-state table and §2). No such symbol exists anywhere in the repo; the actual exported action is `importXlsx(file: File)`, which takes a File directly and does no file-picking. A reader searching for pickAndImportXlsx finds nothing.
  - _Evidence:_ packages/frontend/src/app/spreadsheet/xlsx-actions.ts (exports `importXlsx` and `createSpreadsheetDocumentFromImportedXlsxSheets`; grep for `pickAndImportXlsx` across packages/*/src returns nothing)

### docs/design/sheets/data-validation.md

> The phase-by-phase "as shipped" sections accurately match the implementation (all five kinds — checkbox/list/date/number/text — with the operator+values model, Store methods, render pass, interaction, and side panel all present), but the doc's original top-of-document sections (Summary, Goals, Data model, Testing) still frame the feature as three kinds with dateMin/dateMax fields that the later phases removed.

- **[low] stale-reference** — The 'Data model' section (lines 82-101) presents the DataValidationRule type with `dateMin?`/`dateMax?` fields and only three kinds (checkbox/list/date). The shipped type in code has no dateMin/dateMax (replaced by generic `operator?: DataValidationOperator` + `values?: string[]`) and five kinds (adds number/text). Phase 4/5 of the same doc explicitly document this replacement ('dateMin/dateMax are removed (dead)'), so the top section is superseded rather than contradicted, but reads stale in isolation.
  - _Evidence:_ packages/sheets/src/model/core/types.ts:138-199 (DataValidationKind union has checkbox|list|date|number|text; DataValidationRule has operator/values, no dateMin/dateMax) vs doc lines 82-101
- **[low] stale-reference** — Goals lists 'Three control kinds: checkbox, list, date' and Non-Goals implies number/text are not in scope, but number and text kinds shipped end-to-end (validation logic, render marker, panel criteria). This is reconciled only in the later Phase 5 'as shipped' section.
  - _Evidence:_ packages/sheets/src/model/worksheet/data-validation.ts:378-451 (isValidNumberValue/isValidTextValue); packages/frontend/src/app/spreadsheet/data-validation-panel.tsx:126-133 (Number/Text criteria) vs doc lines 52, 45-72
- **[low] stale-reference** — The Testing 'Scope note' (lines 638-640) says the feature is the 'full feature (all three kinds)' and 'Phase 4 (above) adds date', omitting that Phase 5 (number/text) also shipped. Minor staleness relative to the Phase 5 'as shipped' content below it.
  - _Evidence:_ doc lines 636-640 vs shipped number/text in packages/sheets/src/model/worksheet/data-validation.ts and panel

### docs/design/sheets/mysql-connector.md

> A forward-looking MySQL-connector proposal whose "existing PostgreSQL datasource spine" claims are all accurate and whose MySQL parts are correctly framed as unbuilt; only stale point is that the mysql2 dependency it proposes adding is already present (for a different feature).

- **[low] roadmap-shipped** — Proposal step 2 says "Add `mysql2` to `packages/backend` dependencies" as a future step, but mysql2 ^3.23.0 is already a dependency in packages/backend/package.json. It is used by the analytics warehouse service (StarRocks/MySQL protocol), not by the datasource connector, so the connector itself is still unbuilt — but the dependency-add step is already incidentally satisfied.
  - _Evidence:_ packages/backend/package.json line 51 ("mysql2": "^3.23.0"); packages/backend/src/analytics/analytics-warehouse.service.ts imports mysql2/promise; no mysql reference in packages/backend/src/datasource/*

### docs/design/sheets/pivot-table.md

> Phase 1 is accurately described as shipped — data model, pivot engine, store methods, sheet protection, and Yorkie persistence all match the code — but the frontend Component Structure list is stale (4 of 6 named files don't exist).

- **[medium] documented-not-implemented** — Section 7 'Component Structure' lists 6 files under packages/frontend/src/app/spreadsheet/pivot/ (pivot-editor-panel.tsx, pivot-field-list.tsx, pivot-field-item.tsx, pivot-section.tsx, pivot-actions.tsx, use-pivot-table.ts). Only pivot-editor-panel.tsx and use-pivot-table.ts actually exist; the field-list, field-item, section, and actions components were never created as separate files (consolidated into the 452-line pivot-editor-panel.tsx). Since the doc frames Phase 1 as shipped, a reader looking for these files would be misled.
  - _Evidence:_ packages/frontend/src/app/spreadsheet/pivot/ contains only pivot-editor-panel.tsx and use-pivot-table.ts; find for pivot-field*/pivot-section*/pivot-actions* returns nothing
- **[low] stale-reference** — The Architecture Overview diagram (Section 1) labels the sheet-engine and frontend components as 'PivotCalculator ─── PivotMaterializer' and 'PivotEditorPanel ─── usePivotTable hook'. The engine is implemented as plain functions calculatePivot() and materialize() (not classes named PivotCalculator/PivotMaterializer); this is a conceptual diagram so impact is cosmetic.
  - _Evidence:_ packages/sheets/src/model/pivot/calculate.ts exports calculatePivot(); materialize.ts exports materialize(); no PivotCalculator/PivotMaterializer symbols exist

### docs/design/sheets/formula-coverage.md

> The doc's core claims (aliases, higher-order array functions, most niche functions, byte-variant text) match the code, but the total function count is understated, ISBETWEEN is wrongly listed as not-implemented, and the "implement here" path points at an aggregator rather than the split implementation files.

- **[medium] roadmap-shipped** — The doc lists ISBETWEEN under 'Not implemented — niche' (Operator), but it is fully implemented and cataloged.
  - _Evidence:_ packages/sheets/src/formula/functions-operator.ts:315 registers ['ISBETWEEN', isbetweenFunc] (impl at :229); function-catalog.ts:2430 has its catalog entry with 5 args.
- **[medium] implemented-not-documented** — The doc states 447 function entries (434 unique + 13 aliases), ~434/~500 = 87%. The actual FunctionMap has 463 distinct registered functions (all unique names), so coverage is understated by ~29 functions (~92%). Per-file counts also exceed the doc's category numbers (e.g. statistical file 121 vs doc 103; engineering 50 vs 42).
  - _Evidence:_ packages/sheets/src/formula/functions.ts assembles 11 *Entries arrays; grep of ['NAME', func] across functions-*.ts yields 463 entries (math 75, statistical 121, engineering 50, lookup 34, info 23, financial 49, text 45, date 25, logical 12, database 12, operator 17); function-catalog.ts has 462 name entries.
- **[low] stale-reference** — The 'Adding a new function' steps say to implement in packages/sheets/src/formula/functions.ts and register in FunctionMap, but functions.ts is now only a 29-line aggregator; implementations and per-category entry arrays live in functions-<category>.ts files (functions-math.ts, functions-statistical.ts, etc.).
  - _Evidence:_ packages/sheets/src/formula/functions.ts (29 lines) only spreads mathEntries...operatorEntries into FunctionMap; actual impls in functions-math.ts, functions-statistical.ts, functions-operator.ts, etc.
- **[low] other** — Frontmatter target-version is 0.2.0 while the sheets package is at 0.6.2, indicating the doc predates substantial coverage growth (consistent with the understated counts above).
  - _Evidence:_ docs/design/sheets/formula-coverage.md frontmatter target-version: 0.2.0 vs packages/sheets/package.json version 0.6.2.

### docs/design/sheets/sheet.md

> The doc matches the shipped @wafflebase/sheets engine almost exactly — all major files, classes, Store methods, filter/merge/freeze/move APIs, and view components verify — with only a few low-severity numeric/factual drifts.

- **[low] other** — Doc states DimensionIndex default sizes are '24px row height, 100px column width'. Column width (100) matches, but the default row height in code is 23px, not 24px.
  - _Evidence:_ packages/sheets/src/view/layout.ts:6 (DefaultCellHeight = 23); packages/sheets/src/view/worksheet.ts:280 (new DimensionIndex(DefaultCellHeight))
- **[low] other** — Doc says ReadOnlyStore 'populates row 0 with bold column headers and subsequent rows with data'. Coordinates are 1-based; code populates row 1 with headers and rows 2+ with data (no row 0).
  - _Evidence:_ packages/sheets/src/store/readonly.ts:49,58,60 (comment 'Row 1 contains column headers', toSref({ r: 1, c: c + 1 }))
- **[low] stale-reference** — Formula Engine section says '~430 built-in functions'. Actual FunctionMap has 463 entries; the authoritative formula-coverage.md states 447 entries / 434 unique functions. The '~' hedge makes it near-accurate but slightly understated.
  - _Evidence:_ packages/sheets/src/formula/functions.ts FunctionMap (463 registered keys); docs/design/sheets/formula-coverage.md:11-16 (447 entries / 434 unique)

### docs/design/slides/slides-collaboration.md

> The doc's core claims about Slides collaboration (notes/text LWW-on-blur, peer selection rings shipped, live drag-frames/guides and text carets not yet broadcast) all match the code; only a shipped table-cell presence feature is omitted and two task-file links are stale.

- **[medium] implemented-not-documented** — The doc (Gap 3) enumerates SlidesPresence as only activeSlideId/selectedElementIds/activeFrames/draggingGuide and lists only element selection rings + name tags as 'Closed'. In reality a fifth presence field `selectedTableCells` (table cell-range) is fully wired: broadcast in slides-view.tsx (store.updatePresence with selectedTableCells) and rendered as PeerCellRect via computePeerOverlays. A reader treating this doc as 'single source of truth for what works concurrently today' would miss shipped table-cell peer feedback.
  - _Evidence:_ packages/frontend/src/types/users.ts:74 (selectedTableCells field); packages/frontend/src/app/slides/slides-view.tsx:1082 (broadcast); packages/slides/src/view/editor/peers.ts:74 PeerCellRect & :141 computePeerOverlays handling selectedTableCells; packages/frontend/src/app/slides/peer-view.ts:38
- **[low] stale-reference** — Both TODO links point to ../../tasks/active/ but the files have been moved to docs/tasks/archive/2026/06/, so the links (20260620-slides-notes-live-sync-todo.md and 20260621-slides-live-presence-todo.md) are broken.
  - _Evidence:_ docs/tasks/archive/2026/06/20260620-slides-notes-live-sync-todo.md and docs/tasks/archive/2026/06/20260621-slides-live-presence-todo.md exist; docs/tasks/active/ contains neither

### docs/design/slides/slides-charts.md

> The doc's Phase 1 design is fully shipped and its technical claims match the code; the only drift is proposal-tense framing for an already-built feature plus stale line-number/motivation references.

- **[medium] roadmap-shipped** — The doc is written as a forward-looking proposal (Summary says charts are dropped "silently" today; Goals say "Add a native ChartElement", "New ChartElement", "New packages/slides/src/import/pptx/chart.ts"), but the entire Phase 1 is already implemented and wired up. A reader would think this is an unbuilt plan when it ships in current code.
  - _Evidence:_ packages/slides/src/model/element.ts:592 (ChartElement, type:'chart', in Element union :619 and ElementInit :631); packages/slides/src/import/pptx/chart.ts exists; packages/slides/src/import/pptx/shape.ts:416 dispatches CHART_URI to parseChartFrame; packages/slides/src/view/canvas/chart-renderer.ts + element-renderer.ts:365 drawChart; packages/slides/src/import/pptx/report.ts:18,26 importedCharts/unsupportedCharts
- **[low] stale-reference** — The Summary's present-tense motivation ("Today every <p:graphicFrame> is routed unconditionally to the table parser (shape.ts:383 -> parseTable)") is no longer true: dispatch now branches on graphicData URI to parseChartFrame before falling through to parseTable. Cited line numbers have also drifted (Element union claimed at element.ts:560 / ElementInit :571 vs actual 612/624; dispatch claimed at shape.ts:383 vs actual ~414-417).
  - _Evidence:_ packages/slides/src/import/pptx/shape.ts:414-422 (URI branch to parseChartFrame, tbl->parseTable, else placeholder); packages/slides/src/model/element.ts:612 (Element union) and :624 (ElementInit)

### docs/design/slides/slides-gradient-fill.md

> The doc accurately describes the shipped linear-gradient fill feature across model, importer, renderer, and PPTX export; only the type snippet is slightly simplified.

- **[low] implemented-not-documented** — The doc's GradientFill type is shown as `{ kind: 'gradient'; angle: number; stops: GradientStop[] }`, but the actual type also carries `type: 'linear' | 'radial'` and an optional `center?: { x: number; y: number }` field. These support the radial case the doc frames as deferred; the snippet omits them.
  - _Evidence:_ packages/slides/src/model/theme.ts:76-82 (GradientFill has type and center fields); doc lines 37-39

### docs/design/slides/slides-multi-select-resize.md

> The doc's technical content matches the shipped code almost exactly, but it is written in forward-looking proposal tense while the entire resize-multi-select + ghost-preview unification has actually shipped.

- **[medium] roadmap-shipped** — The doc frames the multi-select resize feature and the ghost-preview unification as an unbuilt proposal ('This proposal wires...', 'This design retires paintLiveScoped', 'new resizeMultiFrames', Summary states startResize 'bails out for selectedIds.length !== 1'). In reality it is fully shipped: resizeMultiFrames/MultiResizeStart/ElementSnapshot/MultiResizeResult exist with matching signatures, editor.ts has the length>1 branch wired end-to-end (resizeMultiFrames call + batched frames/connectorEndpoints commit), paintGhostPreview exists, and paintMoveGhost/paintLiveScoped/patchElementFrames are deleted. A reader would think none of this is built.
  - _Evidence:_ packages/slides/src/view/editor/interactions/resize.ts:172-253 (ElementSnapshot, MultiResizeStart, resizeMultiFrames, MultiResizeResult); packages/slides/src/view/editor/editor.ts:6292,6327,6342 (multi-resize wiring); editor.ts:5282 paintGhostPreview; grep for paintMoveGhost/paintLiveScoped/patchElementFrames returns 0 hits
- **[low] documented-not-implemented** — §4 refers to 'the existing snapAngle helper exported from interactions/rotate.ts'. snapAngle exists but is module-private; only applyRotate and snapToCardinal are exported. This is inside the deferred rotateMultiFrames section.
  - _Evidence:_ packages/slides/src/view/editor/interactions/rotate.ts:33 (function snapAngle, no export); exports are applyRotate (22) and snapToCardinal (37)
- **[low] roadmap-shipped** — Design frames rotateMultiFrames extraction as deferred; this is accurate (function absent), but the ghost-rename half of the same §8 rotate bullet ('paintMoveGhost -> paintGhostPreview') has shipped, so the section mixes shipped and deferred items under a 'deferred' heading.
  - _Evidence:_ grep rotateMultiFrames = 0 hits (deferred, correct); paintGhostPreview present in editor.ts startRotate path at 5984

### docs/design/slides/slides-layout-change.md

> The layout-change feature is fully implemented and matches the doc; the only notable drift is a stale aside claiming presentation mode isn't built (it is), plus several low-severity signature/path staleness items.

- **[medium] roadmap-shipped** — The doc states 'Presentation mode is not yet built (Phase 5b-2). When it lands, it gates its own renderer flag and skips the hint entirely so ghost text never reaches the audience.' Presentation mode IS shipped and wired, so a reader is misled about its existence. Additionally the promised hint-suppression flag does not exist: element-renderer.ts always paints the ghost hint for empty ref-bearing placeholders (no SlideRendererOptions flag gates it), and the presenter renders via the same SlideRenderer, so the described audience-protection is absent.
  - _Evidence:_ packages/slides/src/view/present/presenter.ts (startPresenter/Presenter), packages/slides/src/view/present/index.ts and packages/slides/src/index.ts:233 export startPresenter, packages/frontend/src/app/slides/slides-presentation-mode.tsx:38 calls startPresenter; no hint flag in packages/slides/src/view/canvas/slide-renderer.ts SlideRendererOptions; hint unconditionally painted at packages/slides/src/view/canvas/element-renderer.ts:297-319
- **[low] stale-reference** — Doc documents drawText's new parameter as 'placeholderHint?: string', but the implemented parameter is an object 'placeholderHint?: { text: string; style: PlaceholderStyle }'.
  - _Evidence:_ packages/slides/src/view/canvas/text-renderer.ts:88-94
- **[low] stale-reference** — Doc gives applyLayoutToSlide signature as '(slide, newLayout): void', omitting the actual optional third parameter 'context?: { master: Master; theme: Theme }' used to seed placeholder typography.
  - _Evidence:_ packages/slides/src/model/layout.ts:344-348
- **[low] stale-reference** — Doc's showLayoutPicker is declared to return void, but the implementation returns a close handle '() => void' and LayoutPickerOptions includes an undocumented 'trigger?: HTMLElement | null' field.
  - _Evidence:_ packages/slides/src/view/editor/layout-picker.ts:14-46
- **[low] stale-reference** — Doc pins YorkieSlidesStore.applyLayout to yorkie-slides-store.ts:559, but applyLayout is actually near line 1217; the thumbnail-panel:120 addSlide('blank') anchor is likewise a fixed line number likely drifted.
  - _Evidence:_ packages/frontend/src/app/slides/yorkie-slides-store.ts applyLayout at ~1217; addSlide at ~675
- **[low] stale-reference** — Doc describes the preview cache key as '${themeId}:${masterId}:${layoutId}:${w}x${h}', but the implemented key additionally includes device-pixel-ratio and a JSON content signature (colors/fonts/background/placeholders/staticElements) suffix.
  - _Evidence:_ packages/slides/src/view/canvas/layout-preview.ts:27-43 (previewKey)

### docs/design/slides/slides-presentation-mode.md

> The doc accurately describes the shipped presenter (API surface, keyboard/click/cursor/fullscreen behavior, remote-change handling, split-button entry, and the now-shipped transition/animation playback); only two low-severity path/attribution details are stale.

- **[low] stale-reference** — The Code-layout table says slides-view.tsx 'Wires onStartPresentation to local state (presentingFrom) and conditionally mounts <SlidesPresentationMode />'. In reality slides-view.tsx only declares/forwards the onStartPresentation prop (line 65, 676); the presentingFrom state and the <SlidesPresentationMode> mount both live in slides-detail.tsx (presentingFrom at lines 170/528, mount at lines 471/807). The doc attributes slides-detail.tsx only the split-button.
  - _Evidence:_ packages/frontend/src/app/slides/slides-view.tsx (grep: 0 hits for presentingFrom/SlidesPresentationMode); packages/frontend/src/app/slides/slides-detail.tsx:170,471,528,807
- **[low] stale-reference** — The Testing section cites 'Vitest + jsdom in packages/slides/src/view/present/presenter.test.ts' and 'The presenter's 50 unit tests'. The test file is actually at packages/slides/test/view/present/presenter.test.ts (not under src/), and it contains ~55 it/test cases, not 50.
  - _Evidence:_ packages/slides/test/view/present/presenter.test.ts (55 it()/test() matches); no packages/slides/src/view/present/*.test.ts exists

### docs/design/slides/slides-pptx-export.md

> The technical design is fully and faithfully implemented in shipped code; the only drift is that the doc is written as an unbuilt forward-looking proposal (Risks/Mitigation, "New directory", per-module "lands with its own test", target-version 0.5.0) even though the entire feature is shipped.

- **[low] roadmap-shipped** — The doc is framed as an unbuilt design proposal — §1 says "New directory packages/slides/src/export/pptx/", it targets ~2,000-3,000 LOC to be written, and the Risks/Mitigation section discusses single-PR scope and modules that will "land with their own unit test." In fact the entire feature is already shipped: the export/pptx directory exists with all 20 modules the doc enumerates (index, zip, xml, units, color, text, shape, freeform, image, table, connector, group, effects, animation, slide, theme, master, layout, presentation, templates), plus a full test tier (test/export/pptx/round-trip.test.ts and per-module tests). A reader would think this is planned work when it is complete.
  - _Evidence:_ packages/slides/src/export/pptx/ (all 20 modules present); packages/slides/src/export/pptx/index.ts:130 exports async exportPptx; packages/slides/test/export/pptx/round-trip.test.ts + per-module tests

### docs/design/slides/slides-smart-guides.md

> The smart-guides feature is fully shipped and matches the doc's data model, module layout, type signatures, detection logic, and wiring almost exactly; only a few overlay/implementation details have drifted.

- **[medium] documented-not-implemented** — The overlay section says the numeric distance label is a "white pill with the same red border". The actual label (makeSmartGuideLabel) is a dark pill: background rgba(0,0,0,0.75), white text (#fff), rounded corners, and no border at all.
  - _Evidence:_ packages/slides/src/view/editor/overlay.ts:1073-1092 (makeSmartGuideLabel: color #fff, background rgba(0,0,0,0.75), borderRadius 3px, no border)
- **[low] stale-reference** — The Performance table claims smart-guides.ts "uses the same constant from the same source" as snap.ts's SNAP_THRESHOLD so a zoom-aware change applies to both. In reality SNAP_THRESHOLD is a non-exported const in snap.ts and smart-guides.ts defines its own duplicated literal `const THRESHOLD = 8`; they are not a shared source.
  - _Evidence:_ packages/slides/src/view/editor/snap.ts:4 (const SNAP_THRESHOLD = 8, not exported); packages/slides/src/view/editor/smart-guides.ts:39 (const THRESHOLD = 8)
- **[low] stale-reference** — The overlay section names a single new function `makeSmartGuide` that builds the DIVs. The implementation instead splits this into makeSmartGuideArrows, makeSmartGuideOutlines, and makeSmartGuideLabel; there is no makeSmartGuide.
  - _Evidence:_ packages/slides/src/view/editor/overlay.ts:1019 makeSmartGuideArrows, :1158 makeSmartGuideOutlines, :1073 makeSmartGuideLabel

### docs/design/slides/slides-text-autofit.md

> The autofit feature (AutofitMode field, shrink engine, renderer/editor wiring, toggle UI, seeding, PPTX import, Yorkie persistence) is fully shipped and matches the doc; the only drift is one documented export that was never implemented.

- **[low] documented-not-implemented** — The 'Shrink engine' section lists three exports for packages/slides/src/model/autofit.ts including `export function computeAutofitHeight(blocks, measurer, frameW, padding): number` ('Content height for grow callers'). The actual module only exports `scaleBlocks` and `computeAutofitScale`; `computeAutofitHeight` does not exist anywhere in packages/ (grow height instead comes from docs computeLayout's `layout.totalHeight` via onContentHeightChange).
  - _Evidence:_ packages/slides/src/model/autofit.ts exports only scaleBlocks (line 30) and computeAutofitScale (line 68); grep for computeAutofitHeight across packages/*/src returns nothing

### docs/design/slides/slides-toolbar-redesign.md

> The core redesign (morphing toolbar, shared text-formatting extraction, new SlidesEditor getters, stroke.dash model, Tier-1 controls) shipped as documented, but the implemented ToolbarState went beyond the doc's four-way selectionType and the component map has minor stale references.

- **[medium] implemented-not-documented** — The doc's State enumeration lists selectionType as only 'shape' | 'image' | 'text-element' | 'mixed'. The shipped ToolbarState adds 'connector' and 'table', plus a cellRange field for table cell-range selection, with a dedicated table-controls.tsx and connector routing (ShapeControls). A reader relying on the doc's state model would not know tables/connectors are handled as distinct object states.
  - _Evidence:_ packages/frontend/src/app/slides/toolbar/state.ts:7 (selectionType union includes 'connector' | 'table'), state.ts:16-22 (cellRange), state.ts:60-70; object-section.tsx imports/routes TableControls and treats connector via showShapeControls; packages/frontend/src/app/slides/toolbar/table-controls.tsx exists (not in doc).
- **[low] stale-reference** — Doc says 'Derivation lives in slides-toolbar/index.tsx' and shows getToolbarState there; the derivation actually lives in toolbar/state.ts. Also the ToolbarState.textEditor is typed SlidesTextBoxEditor, not the doc's 'EditorAPI'.
  - _Evidence:_ packages/frontend/src/app/slides/toolbar/state.ts:24-26 (getToolbarState defined here); toolbar/index.tsx imports it from './state'.
- **[low] stale-reference** — The component-layout sketch lists an object-section/ subfolder with a mixed-controls.tsx, and lists alignment-dropdown.tsx inside components/text-formatting/. In reality the toolbar files are flat (no object-section/ subfolder, no mixed-controls.tsx), and text-formatting/ has no alignment-dropdown.tsx (paragraph alignment lives in text-paragraph-group.tsx).
  - _Evidence:_ packages/frontend/src/app/slides/toolbar/ is flat (shape-controls.tsx, image-controls.tsx, text-element-controls.tsx, table-controls.tsx, no mixed-controls.tsx); packages/frontend/src/components/text-formatting/ listing has no alignment-dropdown.tsx.

### docs/design/yorkie-auth-webhook.md

> The doc's technical description matches the code precisely, but it is framed as a not-yet-built proposal/rollout while the entire feature (webhook endpoint, token endpoints, token-type guard, rawBody scoping, frontend injectors, shadow/enforce flag) is fully shipped and wired.

- **[medium] roadmap-shipped** — The 'Proposal Details' and 'Rollout' sections frame the work as future ('Ship the endpoint + token endpoint + frontend injector', 'extend it to also cover /internal/yorkie/auth', 'Add it in both mount points'), but the whole feature is already implemented and wired. The auth webhook controller exists and is registered, the two token endpoints exist, verifyYorkieToken/issueYorkieUserToken/issueYorkieShareToken exist, JwtStrategy already requires tokenType==='access', main.ts already scopes rawBody to the /internal/yorkie/ prefix (covering both events and auth), the shadow/enforce gate via YORKIE_AUTH_WEBHOOK_ENFORCE is live, and both YorkieProvider mount points inject the token. A reader would think none of this is built yet.
  - _Evidence:_ packages/backend/src/document/yorkie-auth.controller.ts (POST internal/yorkie/auth, DetachDocument always-allow, YORKIE_AUTH_WEBHOOK_ENFORCE shadow gate); registered in packages/backend/src/document/document.module.ts:22; packages/backend/src/auth/auth.controller.ts (@Get yorkie-token, @Post yorkie-token/share); packages/backend/src/auth/auth.service.ts (issueYorkieUserToken/issueYorkieShareToken/verifyYorkieToken, YorkieTokenPayload typ 'yorkie'|'yorkie-share'); packages/backend/src/auth/jwt.strategy.ts:30 (tokenType==='access'); packages/backend/src/main.ts:28 (YORKIE_WEBHOOK_PATH_PREFIX='/internal/yorkie/'); packages/frontend/src/PrivateRoute.tsx:27 and packages/frontend/src/app/shared/shared-document.tsx:659,760 (authTokenInjector wired); packages/backend/README.md documents shadow/enforce rollout
- **[low] stale-reference** — The frontend wiring snippet shows the anonymous-share case as fetchYorkieToken(resolved.token) — an overloaded single function. The shipped code instead exposes two distinct functions: fetchYorkieToken() (GET) and fetchYorkieShareToken(token) (POST /auth/yorkie-token/share), the latter being what shared-document.tsx actually calls.
  - _Evidence:_ packages/frontend/src/api/auth.ts:171 fetchYorkieToken and :187 fetchYorkieShareToken; packages/frontend/src/app/shared/shared-document.tsx:659,760 use fetchYorkieShareToken(token)

### docs/design/slides/slides.md

> The doc is highly accurate and self-aware; the only notable drift is a "Presence" implementation-status note that has itself gone stale — peer cursors/rings and live drag-frame broadcast have since shipped.

- **[medium] roadmap-shipped** — The Presence "Implementation status" note (lines 379-381) claims presence broadcasts ONLY activeSlideId + selectedElementIds, that textCursor/live drag frames are not broadcast, and that "no peer cursors or selection rings render yet." All three are now false: the shipped SlidesPresence type broadcasts activeFrames (live world-space drag frames) and per-cell text carets, and a full peer-overlay renderer (computePeerOverlays, PeerRing, PeerLabel) is wired via editor.setPeers().
  - _Evidence:_ packages/frontend/src/types/users.ts:36-71 (SlidesPresence has activeFrames[] + table cell cursors); packages/slides/src/view/editor/peers.ts (PeerRing/PeerLabel/computePeerOverlays); packages/slides/src/view/editor/editor.ts:334 setPeers(); packages/frontend/src/app/slides/slides-view.tsx:1046-1047 editor.setPeers(mapPresenceToPeerView(...)); packages/frontend/src/app/slides/peer-view.ts:30-31 maps selectedElementIds + activeFrames
- **[low] stale-reference** — Integration points states "slides import is intentionally absent in v1 (PPTX is out of scope...)", but PPTX import shipped (acknowledged in Non-Goals) and the CLI now exposes an `import <file>` subcommand backed by a pptx-import module. The v1-historical framing reads as current absence.
  - _Evidence:_ packages/cli/src/commands/slides.ts:220 .command('import <file>'); packages/cli/src/slides/pptx-import.ts, packages/cli/src/slides/import.ts exist
- **[low] stale-reference** — The package-layout diagram names files that do not exist under those names: `view/editor/text-bridge.ts` (actual: text-box-editor.ts) and frontend `editor-shell.tsx` / `contextual-toolbar.tsx` / `thumbnail-panel.tsx` / `presentation-mode.tsx` (actual: toolbar/ dir, slides-presentation-mode.tsx; the thumbnail panel lives in the slides package as view/editor/thumbnail-panel.ts). This is an illustrative v1 sketch, so drift is cosmetic.
  - _Evidence:_ no packages/slides/**/text-bridge.* (found 0); no editor-shell/contextual-toolbar/thumbnail-panel/presentation-mode.tsx under packages/frontend/src/app/slides; actual: packages/slides/src/view/editor/text-box-editor.ts, packages/frontend/src/app/slides/toolbar/, slides-presentation-mode.tsx


## accurate (16)

### docs/design/docs/docs-context-menu.md

> Every load-bearing claim (DocsContextMenu overlay, EditorAPI primitives, clipboard/paste path, table-menu split, native-menu suppression, empty-group bail) matches the shipped code.

_No discrepancies._

### docs/design/docs/docs-ime-composing-underline.md

> The doc's described design is fully implemented as written: the view-local composing marker, injection return shape, run tagging, and paint-time underline all match the code exactly.

_No discrepancies._

### docs/design/docs/docs-header-footer.md

> The header/footer design is fully shipped and matches the doc; every named type, symbol, file, and behavioral nuance was found in code, with one cosmetic method-name drift in an illustrative snippet.

- **[low] stale-reference** — The doc's Active Block Array example defines a method `getActiveBlocks(): Block[]`. The actual implementation is the same logic but the method is named `getContextBlocks()`.
  - _Evidence:_ packages/docs/src/model/document.ts:97 defines `getContextBlocks()` (lines 97-101); grep for `getActiveBlocks` across packages/docs/src returns no matches.

### docs/design/docs/docs-image-editing.md

> Phase 1 image editing (data model, EditorAPI, selection/resize overlay, toolbar insert + upload/URL/DnD/paste) is faithfully shipped, and the items the doc frames as Planned (context bar, options panel, rotation/crop rendering, crop mode) are genuinely not yet built.

- **[low] documented-not-implemented** — The Editor API code block shows insertImage's opts as { alt?, originalWidth?, originalHeight? }, but the real signature also accepts position?: { blockId; offset }. The doc's note that 'non-collapsed selection replacement is not yet implemented / inserts at focus offset' understates that an explicit insert position is now supported.
  - _Evidence:_ packages/docs/src/view/editor.ts:283-288 (insertImage signature includes position?)
- **[low] implemented-not-documented** — The EditorAPI listing enumerates insertImage/updateSelectedImage/getSelectedImage/selectImageAt but omits clearImageSelection() and onImageFileDrop(cb) which are shipped and are the actual mechanism the DnD/paste flows rely on.
  - _Evidence:_ packages/docs/src/view/editor.ts:296-317; wired via packages/frontend/src/app/docs/docs-view.tsx:432 editor.onImageFileDrop(...)
- **[low] other** — Insert Flows describes 'DocCanvas listens for dragover/drop ... upload and insert' as if the docs package performs the upload; actually the docs package stays upload-agnostic and forwards the raw File via the onImageFileDrop callback, with the frontend (insertImageFromFile) doing the /images upload.
  - _Evidence:_ packages/frontend/src/app/docs/image-insert.ts:55 insertImageFromFile; editor.ts:307-317 onImageFileDrop contract

### docs/design/docs/docs-rendering-optimization.md

> All five optimizations described in the doc are shipped and wired up as documented; only minor pseudocode-vs-reality abstraction differences remain.

- **[low] stale-reference** — The doc's pseudocode for cachedMeasureText/computeLayout takes a raw `ctx: CanvasRenderingContext2D` and calls `ctx.measureText(...)`/`ctx.font`. The shipped code instead threads a `TextMeasurer` abstraction (measurer.ts / canvas-measurer.ts): `cachedMeasureText(measurer, text, font)` calls `measurer.measureWidth(...)`, and `computeLayout(blocks, measurer, ...)`. Behavior (font\ttext-keyed cache) is unchanged; only the surface API differs.
  - _Evidence:_ packages/docs/src/view/layout.ts:63-74 (cachedMeasureText uses measurer.measureWidth), layout.ts:361-369 (computeLayout second param is measurer:TextMeasurer)
- **[low] implemented-not-documented** — Shipped computeLayout has two extra trailing params not in the doc's signature (composingContext?, docStyles?), and the LayoutCache interface has an undocumented named-style fingerprint field beyond {blocks, contentWidth}. These are additive and consistent with the design's intent.
  - _Evidence:_ packages/docs/src/view/layout.ts:361-369 (extra params), layout.ts:237-246 (LayoutCache with namedStyles fingerprint field)

### docs/design/documents-last-modified.md

> Every load-bearing claim in the doc (data model, migration backfill, webhook endpoint, HMAC guard, monotonic touchUpdatedAt, clock-skew clamp, read-path, rename bump) matches the shipped backend code exactly.

_No discrepancies._

### docs/design/image-viewer.md

> The image-viewer design doc matches the shipped implementation almost exactly; only two low-severity component-location drifts exist.

- **[low] stale-reference** — The doc attributes assertFileIdAllowed() to packages/backend/src/document/document.controller.ts ('Widen it to allow fileId on pdf or image'). The function is actually defined in a separate module, packages/backend/src/document/document-file-id.util.ts, and imported into the controller. It correctly allows pdf+image (FILE_ID_TYPES = new Set(['pdf','image'])), so behavior matches; only the file location is off.
  - _Evidence:_ packages/backend/src/document/document-file-id.util.ts (defines assertFileIdAllowed + FILE_ID_TYPES); packages/backend/src/document/document.controller.ts:36 imports it from './document-file-id.util'
- **[low] stale-reference** — The Viewer section says prev/next navigation lives in FileDetail ('FileDetail fetches the current workspace's documents, filters to type==="image"... Left/right chevron buttons and keyboard ←/→'). In shipped code this logic (sibling filtering by workspaceId+type==='image', prevId/nextId, ChevronLeft/Right, ArrowLeft/ArrowRight keydown) lives inside image-viewer.tsx, not file-detail.tsx. The feature is fully shipped, just in a different component than documented.
  - _Evidence:_ packages/frontend/src/app/files/image-viewer.tsx:61-108,125-144 (siblings/prevId/nextId/keydown/chevrons); no prev/next code in packages/frontend/src/app/files/file-detail.tsx

### docs/design/sheets/axis-id-selection.md

> The axis-ID selection/presence design is fully implemented and matches the shipped code across sheets and frontend; only a trivial function-signature omission diverges.

- **[low] other** — The 'Coordinate Conversion Layer' table lists rangeAnchorToRange's inputs as (RangeAnchor, rowOrder, colOrder), but the shipped function has an additional optional 4th parameter `dimension?: { rows: number; columns: number }` used to compute the max row/col bounds for null (entire-row/col/select-all) fields.
  - _Evidence:_ packages/sheets/src/model/workbook/anchor-conversion.ts:42-49 (rangeAnchorToRange signature with `dimension?` param) vs doc table row for rangeAnchorToRange

### docs/design/sheets/bigquery-connector.md

> A forward-looking proposal (v0.5.0) for a BigQuery connector, correctly framed as unbuilt, whose claims about the existing datasource spine it reuses all check out against the code.

_No discrepancies._

### docs/design/share-link-analytics.md

> The doc matches the shipped implementation closely across backend module/routes/schema, docker analytics profile, frontend dashboards, and v2 visualization/dwell fixes; only trivial undocumented helpers exist.

- **[low] implemented-not-documented** — The controller exposes a GET analytics/enabled endpoint used to drive the 'analytics disabled' UI state. The doc describes the disabled/no-op behavior conceptually but never names this endpoint.
  - _Evidence:_ packages/backend/src/analytics/analytics.controller.ts:148 (@Get('analytics/enabled'))
- **[low] stale-reference** — Doc frames the beacon 'hook' as living in shared-document.tsx and describes tabchange as not-yet-implemented in the hook. In reality the hook is defined in hooks/use-view-analytics.ts (merely mounted in shared-document.tsx) and already contains full tabchange emission logic gated on a `target` prop; shared-document.tsx just doesn't pass `target`, so observable behavior (no tabchange emitted) still matches the doc.
  - _Evidence:_ packages/frontend/src/hooks/use-view-analytics.ts:64-76 (tabchange useEffect); packages/frontend/src/app/shared/shared-document.tsx:714 (mounts hook without target)

### docs/design/sheets/lakehouse-connected-sheet.md

> A forward-looking roadmap doc (target 0.5.0, phased Phase 0-4) whose reused-infrastructure claims all match the datasource code and whose lakehouse feature is genuinely unbuilt and correctly framed as future.

_No discrepancies._

### docs/design/sheets/formula.md

> The formula-engine design doc matches the shipped @wafflebase/sheets code on every load-bearing claim (grammar, pipeline, helpers, EvalNode types, resolvers, cross-sheet shifting, unbounded-range expansion); only a cosmetic in-doc table artifact was found.

- **[low] other** — In the 'Built-in Functions' category table the doc says it is 'a category sketch only', yet the last six rows (Text, Lookup, Date, Info, Database, Logical) contain a stray leftover count column (38, 32, 25, 21, 12, 12) wedged between the category name and the examples, while the first four rows (Math, Statistical, Engineering, Financial) do not. This is an internal doc formatting artifact from a prior count-bearing version; it does not correspond to any code claim (counts are explicitly deferred to formula-coverage.md) but renders the table inconsistent for a reader.
  - _Evidence:_ docs/design/sheets/formula.md lines 215-226 (Built-in Functions table); code side is consistent: packages/sheets/src/formula/function-catalog.ts:3940 exports FunctionCatalog, packages/sheets/src/formula/functions.ts defines FunctionMap

### docs/design/sheets/scroll-and-rendering.md

> The doc accurately describes the shipped scroll-remapping and viewport-Canvas rendering implementation; all named paths, symbols, constants, and the remapping formula match the current code.

_No discrepancies._

### docs/design/sheets/sheet-style.md

> The doc accurately describes the shipped style model, write/merge semantics, range-patch lifecycle, border-seam handling, conditional formatting, number formatting, and UI wiring; all named types, methods, and symbols exist and are wired as described.

_No discrepancies._

### docs/design/slides/slides-font-ooxml-parity.md

> The doc's staged-roadmap framing precisely matches the code: shipped Phase A (super/subscript + hyperlink export) and Phase B.1/B.2/B.4 model+import+export are all present, and every item framed as deferred (caps, gradient/outline/effects, EA/CS faces, toolbar exposure) is genuinely absent.

_No discrepancies._

### docs/design/workspace-folders.md

> The doc accurately describes the shipped implementation; schema, backend folder/document controllers, DTOs, bulk move/delete endpoints, and all named frontend modules exist and are wired up as documented.

_No discrepancies._


