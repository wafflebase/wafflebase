# Homepage & documentation staleness audit

Audited 2026-09-03 against `a95eeb6c4`. Five parallel read-only audits covering
the marketing homepage (`packages/frontend/src/app/home/`), the whole
documentation site (`packages/documentation/`), and the root `README.md` /
`CONTRIBUTING.md`. No code was changed.

**Verdict.** The homepage describes roughly the v0.5 product — a three-app
suite — while the app ships eight document types at v0.6.8. The docs site is
in better shape per-page but has four pages instructing users to click menu
items that no longer exist, and three shipped subsystems with no page at all.
`developers/rest-api.md` documents 14 routes against ~44 served.

The healthy outlier is `developers/design-editor.md`: the commit that last
touched `scripts/design.mjs` (`5b0edd169`) also updated the doc, and it needs
one string fix. Every stale page in this report was updated by a *different*
commit than the code it describes.

---

## Status

**P0 is complete** — all seven items landed on `fix/homepage-docs-p0-staleness`
as one commit each (`696c197b0` … `13163b64e`). P1–P3 below are untouched.

The datasource item was resolved by **documenting the real behavior**, per the
decision recorded in P0 #3. The authorization model itself is unchanged and is
listed under "Follow-ups" at the end of this file.

---

## P0 — Factually wrong, user-visible

### 1. The homepage claims a feature that does not exist

`packages/frontend/src/app/home/use-cases-section.tsx:26` —
"Wafflebase Docs reference Sheets cells inline — your launch plan reads
$18,799 today and updates itself tomorrow."

`packages/docs/src/model/types.ts:39` enumerates the complete block
vocabulary: `paragraph | title | subtitle | heading | list-item |
horizontal-rule | table | page-break`. No embed, link, or cross-document
block. No design doc under `docs/design/docs/` proposes one. A repo-wide
search for any cross-app cell reference returns this marketing line as the
only hit.

The card's headline ("Pull live formulas into the doc your team already
writes") and the section subtitle rest on the same claim, and the card links
to `/docs/docs-editor/writing-a-document`, which does not describe it either.

- [ ] Rewrite or remove the use case. This is a quantified capability claim
      with nothing behind it.

### 2. Four doc pages tell users to click menu items that were deleted

The **New** menu is: New Document / New Sheet / New Presentation / New Note /
New Board (`document-list.tsx:264-270`), plus New from template / New folder
(`:1358-1366`), plus a single **Upload files…** (`:326`) and **Import from
Miro…** (`:337`). The per-format pickers were deliberately collapsed into one
door — see the comment at `document-list.tsx:299-310`.

Pages still naming the removed items:

- `guide/getting-started.md:18-19` — "Import XLSX / DOCX / PPTX", "Upload PDF"
- `guide/import-export.md:25`, `:33` — "Import XLSX", "Upload PDF"
- `pdf/viewing-pdfs.md:12` — "Select **Upload PDF**"
- `pdf/viewing-images.md:14` — "Select **Upload Image**"

Verified: none of these strings exist anywhere in `packages/frontend/src`.

- [ ] Fix all four pages to the single "Upload files…" flow.

### 3. The datasource security model is documented backwards

`sheets/datasources.md:45-46` — "The connection belongs to the person who
created it. Collaborators can see the query and its last results, but run
their own connection to execute it."

Both halves are false, verified directly:

- **Credentials are workspace-shared.** `datasource.controller.ts:151-163`
  (`executeQuery`) checks only `assertMember(ds.workspaceId, …)`; `authorID`
  is written at creation (`datasource.service.ts:94`) and never read for
  authorization anywhere. `datasource.service.ts:265` then builds the client
  with `plaintextPassword: decrypt(ds.password)` — the creator's stored
  credential. Any workspace member can also edit or delete another member's
  connection (controller `:111-149`).
- **Results are never shared.** `datasource-view.tsx:95-99` persists only the
  `query` string to Yorkie; results live in local React state (`:35`), and
  `TabMeta` (`worksheet-document.ts:122-131`) has no results field.

The doc reads as materially *safer* than the implementation. Either the doc
or the authorization model should change; that is a product decision, not a
doc edit.

- [ ] Decide: document the real shared-credential model, or tighten
      authorization to match the doc.

### 4. Share links never expire by default, while the doc advises expirations

`guide/collaboration.md:12` lists four expiration options. `share-dialog.tsx:41-47`
has **five**, the first being `No limit`, and it is the default
(`useState("none")` at `:69`, sending `null` at `:121`). The same page at
`:127` advises "For sensitive data, use short expirations" — advice the
default silently defeats.

Also undocumented: the Editor option is disabled unless `canCreateEditorLink`
(`share-dialog.tsx:189-202`), enforced at `share-link.service.ts:86`. A plain
workspace member reading `collaboration.md:9-11` will expect a link they
cannot create. Role labels are "Viewer"/"Editor" under "Permission", not
"View"/"Edit".

- [ ] Fix the options list, state the default, document the editor-link gate.

### 5. Self-hosting: a non-localhost deployment cannot work as written

`developers/self-hosting.md` documents **zero** of the 8 frontend `VITE_*`
variables. A self-hoster on any host but localhost must rebuild the frontend
with `VITE_BACKEND_API_URL` (55 uses) and `VITE_YORKIE_RPC_ADDR`.
`packages/frontend/.env:1-4` is checked in with hardcoded localhost values,
which is why the quick start appears to work and a real deployment silently
talks to `localhost:3000`.

Compounding, in the same page:

- `:9` "Node.js 18+" contradicts `.nvmrc` (22), `Dockerfile:4`/`:58`,
  `ci.yml:144`, and `README.md:89`. Root `package.json` has no `engines`
  field, so nothing enforces it.
- `:21` "`docker compose up -d` starts PostgreSQL + Yorkie" — `minio`
  (`docker-compose.yaml:20`) and `azurite` (`:41`) carry no `profiles:` key,
  so the default stack is four services binding 9000/9001/10000 as well.
- `:22` and `README.md:138` — `pnpm backend migrate` runs
  `prisma migrate dev --name init` (`packages/backend/package.json:26`)
  against what a self-hoster will point at production. The production path is
  `prisma migrate deploy`, which `Dockerfile:86` itself uses.
- `:23` "`pnpm dev` starts frontend + backend" — root `package.json:7` starts
  a third server (vitepress :5174), and `vite.config.ts:297-304` proxies
  `/docs` to it, so the frontend's `/docs` route 502s without it.
- 35 backend env vars read by code are undocumented, including
  `DATASOURCE_ENCRYPTION_KEY`, all ten `LAKEHOUSE_*`, all five `YORKIE_*`,
  and `BACKEND_TRUST_PROXY` — which the page's own TLS-proxy section
  (`:137-143`) describes the deployment for.
- **No Yorkie auth webhook section.** Without registering it, per-document
  access control does not exist at the Yorkie layer. The page's "Data
  Ownership" section (`:160-168`) reads as though it did.

`packages/backend/src/auth/oauth-state.ts:219-223` names this page as the
historical cause of a dead login: the shipped image sets `NODE_ENV=production`
(`Dockerfile:106`) while the doc hands out an `http://` callback URL (`:42`).
The code now resolves it, but the doc never mentions the interaction.

- [ ] `self-hosting.md` needs a rewrite, not edits.

### 6. `developers/rest-api.md` documents 14 routes; the code serves ~44

Last touched `2026-06-29`; `packages/backend/src/api/v1/` last touched
`2026-08-30`. Wrong claims:

- `:7` "All API requests require authentication via an API key" — every v1
  controller mounts `CombinedAuthGuard`, which falls through to JWT-cookie
  auth (`combined-auth.guard.ts:20-25`). The CLI's OAuth login depends on it.
- `:45`, `:174` the `409 TYPE_MISMATCH` contract — that code exists only in
  `docs-content.controller.ts:49-54`. Tabs throw **400**
  (`tabs.controller.ts:45-49`); cells do **no type check at all**, so a doc
  yields 404 "Tab not found" (`cells.controller.ts:60`).
- `:35`, `:94` "three kinds of documents" — eight
  (`yorkie-doc-key.ts:22-34`).
- `:239-242` `PUT` cell body omits `style`, which `cells.controller.ts:115`
  accepts and every read returns.
- The **`write` scope requirement is never mentioned** — enforced
  controller-wide by `api-key-write-scope.guard.ts:35-49` (403).

Undocumented route families: files upload/download, tab create/rename,
clear/insert/delete/move, freeze/hidden/merges, range-styles/sheet-style,
column-styles/row-styles/column-widths/row-heights, conditional-formats,
data-validations, charts, filter, pivot.

- [ ] Rewrite `rest-api.md`.

### 7. `developers/cli.md` is missing two namespaces and ~40 subcommands

- **`images`** — absent entirely, including from the namespace list at `:124-130`.
  `images.ts:57` upload, `:132` get, `:186` delete.
- **`notes`** — listed at `:128` but has no section, unlike every other
  namespace. Ships `list/create/get/rename/delete/content/export/import`
  (`notes.ts:39-244`).
- The whole `sheets` structural/formatting surface: `clear|insert|delete|move`
  (`sheets-structure.ts`), `styles|sheet-style|column-styles|row-styles`
  (`sheets-styles.ts`), `column-widths|row-heights` (`sheets-dimensions.ts`),
  `freeze|hidden|merges` (`sheets-view.ts`), `conditional-formats|data-validations`
  (`sheets-rules.ts`), `charts` (`sheets-charts.ts`), `filter|pivot`
  (`sheets-analysis.ts`).
- `set-content` on docs/slides/notes — destructive, in the agent-facing schema
  registry (`registry.ts:197`, `:307`, `:414`).
- `:115` `--format` omits `yaml` (`formatter.ts:12`).

---

## P1 — Whole shipped features that are invisible

Absent from **both** the homepage and the docs site:

| Feature | PR | Implementation |
|---|---|---|
| **Version history** on all 5 CRDT types | #1010 | `components/history/history-panel.tsx`, wired into all five detail views |
| **Template gallery** — publish, browse, use, review | #1000/1001/1005/1009 | `app/templates/`, `backend/src/template/`, 4 routes |
| **Notifications** bell + SSE | #764 | `components/notifications/`, `site-header.tsx:113` |
| **Sync status chip** | #967 | `components/sync-status/sync-status-chip.tsx` |
| **Lakehouse** — Iceberg/Delta + time travel | #868 | `lakehouse-view.tsx`, `time-travel-slider.tsx`, `backend/src/lakehouse/` |
| **Conditional formatting** | — | `conditional-format-panel.tsx`, `formatting-toolbar.tsx:805` |
| **Workspaces / members / invites** | — | `workspace-settings.tsx:347-405` — *no page anywhere describes membership*, yet `collaboration.md:99` depends on the concept |
| **Mermaid diagrams in Notes** | #632 | `notes/src/view/mermaid.ts` (644 lines) |
| **Notes blame gutter** | #924 | `notes/src/view/blame-gutter.ts` — note it writes your display name into shared content |
| **Generic file documents** (any extension) | #698 | `upload-kind.ts:38-43`, `generic-file-view.tsx` |
| **"Make a copy"** | #812 | `document-list.tsx:998`, `:1219` |
| **Settings page** + date format | #809 | `app/settings/page.tsx` |
| **View analytics dashboard** | — | `app/analytics/document-analytics.tsx` |

Version history and the template gallery are the two that matter most:
the first is the answer to "can I get my document back", the second is what
v0.6.8 was cut for.

Homepage additionally omits, as product surfaces: **Notes**, **Board**,
**PDF**, **Images**, **folders**.

- [ ] New page `guide/version-history.md`
- [ ] New page `guide/templates.md`
- [ ] New page `sheets/conditional-formatting.md`
- [ ] New page `sheets/lakehouse.md`
- [ ] New page `guide/workspaces.md` (membership, roles, invites)
- [ ] `guide/collaboration.md` — add Notifications + sync status sections
- [ ] `notes/writing-a-note.md` — add Mermaid to the preview list (`:106`),
      add a blame-gutter section
- [ ] Homepage — feature cards for Notes, Board, version history, templates;
      widen the "Sheets, Docs & Slides" phrasing at `why-section.tsx:47`,
      `hero-section.tsx:60`, `footer.tsx:62-64`, `page.tsx:19`

---

## P2 — Wrong details within otherwise-good pages

### Slides

- `slides/keyboard-shortcuts.md:48-51` — z-order shortcuts documented as
  `⌘+Shift+]` etc. do not exist. Real bindings are `⌘+↑/↓/Shift+↑/↓`
  (`keyboard.ts:403-414`). Inside a text box the documented keys **outdent /
  indent** instead (`text-editor.ts:1294`, `:1300`).
- `:42` — "Paste without formatting `⌘+Shift+V`" has no `shiftKey` guard on
  canvas (`keyboard.ts:338-342`); it is a text-editing shortcut only.
- `slides/build-a-deck.md:30`, `themes-and-layouts.md:52` — there is no
  "Layout" split-button. The toolbar control is **Add slide** and its picker
  *creates a new slide* (`slide-group.tsx:64-66`, `:84`, `:99`). Re-laying-out
  the current slide is context-menu only, labelled "Change layout…"
  (`thumbnail-panel.ts:330`).
- `themes-and-layouts.md:27` — new decks seed **Simple Dark** in dark mode
  (`yorkie-slides-store.ts:224-227`).
- `themes-and-layouts.md:36-48` — Blank is listed last; the catalog puts it
  first (`layout.ts:66`).
- Undocumented, large: speaker notes, Format options panel, slide background
  panel, rulers/guides, smart guides, image crop, gradient editor, theme
  Customize/builder, Arrange menu, format painter, multi-select
  resize+rotate, mobile view.
- Worth documenting as a limitation: PPTX-imported charts render but cannot be
  inserted or edited, and **PPTX export silently drops them**
  (`export/pptx/group.ts:74-77`).

### Docs editor

- `writing-a-document.md:101` — "Arrow keys nudge the image" is backwards:
  arrows **deselect the image and move the caret** (`editor.ts:2593-2617`).
  No image-move path exists.
- `:48` — no Strikethrough button; the toolbar passes
  `showStrikethrough={false}` (`docs-formatting-toolbar.tsx:784`). The
  `⌘+Shift+X` shortcut in the same row *is* real.
- `:79` — cells cannot be "split"; the menu offers Merge / **Unmerge**
  (`docs-table-context-menu.tsx:196-213`).
- `:35` — paste is far richer than "each line a paragraph": native → HTML with
  formatting → plain text, and markdown pipe-tables become real tables
  (`clipboard.ts:732`, `:853`).
- `:70-72` — **Justify** ships (`text-editor.ts:1287-1292`).
- The page covers roughly a third of the editor. Undocumented: named styles,
  comments, find & replace, links, font family/size pickers, line spacing,
  highlight color, lists/indent, super/subscript, page break, horizontal
  rule, unified context menu, rulers, shortcuts dialog.
- `docs-editor/keyboard-shortcuts.md` — every documented row is real, but it
  covers about a third of `shortcuts-catalog.ts:38-94`. `Home`/`End` are
  listed Windows-only; they bind on every platform
  (`text-editor.ts:1144-1158`).

### Sheets

- `sheets/keyboard-shortcuts.md:11` `Ctrl+Home` and `:28` `F2` — **no
  handlers exist**. Editing opens on Enter (`worksheet.ts:5009`) or
  double-click.
- `:20` `Ctrl+Shift+Arrow` — `worksheet.ts:4947-4951` tests `shiftKey`
  *before* the mod key, so it degrades to a one-cell extend. No
  "resize to edge" API exists.
- `:12-13` Enter/Shift+Enter are not pure navigation — on a single-cell
  selection Enter **opens the editor** (`worksheet.ts:4999-5010`).
- `sheets/charts.md:10`, `:50` — there is **no Insert menu**. Chart is a
  toolbar icon (`formatting-toolbar.tsx:763-769`); pivot is right-click only
  (`sheet-context-menu.tsx:229-231`).
- `charts.md:55` — pivot fields are added via a dropdown, not drag-and-drop
  (`pivot-editor-panel.tsx:192-201`). `:60` — the Filters area sets
  `hiddenValues: []` and nothing ever writes it, so it filters nothing today.
- `sheets/formulas.md:84-95` — Text 38→**45**, Lookup 32→**31**, Logical
  10→**12**, and an entire **Operator (17)** row is missing. Total 437 →
  **462** (`function-catalog.ts:3923`). Do not copy the table from
  `docs/design/sheets/formula-coverage.md` — it is internally inconsistent.
- `sheets/datasources.md:3`, `:44` — not PostgreSQL-only; the tab-bar `+`
  offers **New Lakehouse** (`tab-bar.tsx:296`).
- `sheets/data-validation.md:56-62` — all six date operators carry a `date `
  prefix in the UI (`data-validation-panel.tsx:74-83`).
- `:90-91` — the red corner marker is **not** warning-only; neither render
  site checks `onInvalid` (`gridcanvas.ts:722-737`, `:1155-1160`).
- Undocumented: sheet images, shortcuts help modal (`Mod+/`), ~15 shipped
  shortcuts, array/regex/LAMBDA function families.

### PDF / images / folders

- `pdf/viewing-pdfs.md:67-68` — presence avatars do **not** follow anyone to a
  page. `activePage` is published (`pdf-collab.tsx:129`) but never read, and
  `<UserPresence />` mounts with no `onSelectPeer`, so `canJump` is
  permanently false (`user-presence.tsx:100`).
- `pdf/viewing-images.md:37` — no progress bar; a plain `Loading…`
  (`image-viewer.tsx:179`). The PDF viewer does have one.
- `:30-36` — only zoom is in the toolbar. Prev/Next are floating side buttons
  **absent for anonymous share-link viewers** (`:100`, `:116`); Download is a
  header button.
- `pdf/organizing-with-folders.md:7-8` — the type list omits `board` and `file`.
- Undocumented: drag-onto-folder to move (`document-list.tsx:1417-1453`),
  folder delete is manager-only while rename is any member
  (`folder.controller.ts:106-118`), image keyboard nav, image sharing.

### Notes

- `writing-a-note.md:122-123` "does not render raw HTML" contradicts the
  page's own Foldout row at `:95`. Truth: `html: false` with no sanitizer
  (`preview.ts:28`) **plus two allowlist plugins** — `<details>`/`<summary>`
  (`details-plugin.ts:36-38`) and `<img>` limited to src/alt/width/height
  (`img-plugin.ts:110-118`). Tests pin both (`preview.test.ts:433`, `:461`).
- Undocumented: `breaks: true` makes a single newline a `<br>`
  (`preview.ts:31`); split-divider drag + synced scrolling; CodeMirror search
  / folding / autocompletion; the mobile caveat that Split is removed and a
  phone-picked mode is deliberately not persisted (`notes-detail.tsx:119-136`).

### Board

`board/using-the-board.md:26-33` presents four tools; the toolbar is about
twice that. Missing: Shape ▾ (137 entries), Line ▾ incl. Scribble, Grid ▾ +
snap, undo/redo, Zoom ▾ with Fit, selection-contextual fill/border/text/Arrange,
canvas right-click menu, Miro import (reached from the workspace New menu, not
the board), version history, Ctrl+wheel zoom / space-drag pan, minimap toggle,
peer selections, auto fit-to-content on open.

---

## P3 — Housekeeping

- `README.md:8-10` still says "Early development … not yet production-ready.
  We are actively working on DataSource integration" — datasources shipped.
- `README.md:24-25` lists datasources as *(coming soon)* and names **MySQL**,
  which does not exist: `datasource.dto.ts:12-41` has no engine
  discriminator. `mysql2` in the backend speaks only to StarRocks.
- `README.md:40` "5 built-in themes" — 23 (`slides/src/themes/index.ts:38`).
  The 11 layouts figure is correct.
- `README.md:44` — PPTX **export** also ships (`slides/src/export/pptx/`).
- `README.md:152-153` / `CONTRIBUTING.md:124` — `verify:self` runs **no**
  visual lane (`scripts/verify-self.mjs` ends at chunks + entropy).
- `features-section.tsx:81` "55+ shapes" — **149** `ShapeKind` values
  (`slides/src/model/element.ts:54-127`).
- `features-section.tsx:55` names 3 of 462 formula functions;
  `:61` says datasources are PostgreSQL-only.
- `demo-section.tsx:92` "Both panes" — three tabs render (`:112-141`).
- `hero-section.tsx:7` — stale comment frozen at 0.4; the logic is correct.
- `interop-section.tsx:18-22` — import list has 3 of ~15 formats. **Do not add
  XLSX or HTML export** (`:24-28`): `packages/sheets/src` has no `export/`
  directory and no export menu exists in the grid editor. `import-export.md:71`
  correctly calls it roadmap.
- `packages/documentation/README.md:41-52`, `:77` — content tables omit three
  pages; "Notes" / "PDF" should be "Notes & Board" / "PDF & Files"
  (`.vitepress/config.ts:129-146`). The README also builds as an orphan page
  at `/docs/README.html` (no `srcExclude`).
- `.vitepress/config.ts:67-74` — top nav has no entry reaching "PDF & Files".
- `guide/getting-started.md:68-88` "What's Next" omits Slides, Board, Images,
  Folders, Datasources, Import & Export.
- `developers/design-editor.md:47` — quoted output "✓ editor shell built";
  `scripts/design.mjs:150` prints `editor built`.
- `CLAUDE.md` Pitfalls writes `pnpm sheet build:formula`; the script is
  `sheets` (root `package.json:41`). `CONTRIBUTING.md:276` has it right.

---

## Code-level issues surfaced incidentally (not doc bugs)

- **Image upload cap disagrees between two modules.**
  `file.constants.ts:13` `MAX_IMAGE_UPLOAD_BYTES` is 25 MB (applied at
  `file.service.ts:105`), while the image module caps at 10 MB
  (`image.config.ts:23`, `images.controller.ts:36`). Needs a source-of-truth
  decision before either number is documented.
- **`OAUTH_STATE_SECRET` is read by no code.** Documented at
  `packages/backend/README.md:25` and `docs/design/backend.md:757`; there is
  no HKDF derivation anywhere in `packages/backend/src`.
- **BigQuery is backend-only.** `backend/src/bigquery/` is registered at
  `app.module.ts:109`, but `bigquery` has zero matches in
  `packages/frontend/src`. Not user-reachable — **do not document it**.
- **Dropdown-arrow hit region ignores `showArrow`** — `worksheet.ts:1486-1505`
  and `:3534-3544` key off `kind === 'list'` alone, so the invisible corner
  still opens the picker.
- **Pivot grand-totals default disagrees across surfaces** — UI creates with
  `showTotals: {rows: true, columns: true}` (`document-detail.tsx:377`); the
  backend normalizer defaults both to `false`
  (`worksheet-filter-pivot.ts:144-145`).
- **A dropped `.md` becomes a generic blob, not a note.** `md`/`markdown` is
  absent from `EXT_TO_KIND` and `note` is not a `UploadKind` member
  (`upload-kind.ts:11-36`). Markdown → note import is CLI-only
  (`notes.ts:242-248`).
- **`packages/frontend/.env:1-4` is checked in** with hardcoded localhost
  values — the mechanism behind the self-hosting `VITE_*` gap.

---

## Follow-ups surfaced while fixing P0

Code changes, not doc changes. None were made.

- **Any workspace member can delete or edit another member's datasource
  connection**, and execute against its stored credential. Every handler in
  `datasource.controller.ts` gates on `assertMember` alone; `authorID` is
  written at creation and never read for authorization. The docs now describe
  this accurately, so nobody is misled — but if the intent was per-creator
  ownership, the guard is the thing to change.
- **`packages/frontend/.env` is git-tracked** despite `.gitignore:80` listing
  `.env`. It carries hardcoded localhost values, which is the mechanism that
  makes a broken self-hosted deployment look like a working one. Should be
  `.env.example`.
- **`OAUTH_STATE_SECRET` is read by no code**, while
  `packages/backend/README.md:25` and `docs/design/backend.md:757` document it
  and describe an HKDF derivation that does not exist. Deliberately not carried
  into the self-hosting page.
- **No `notes-*` or `images-*` CLI skill** exists in `packages/cli/skills/`,
  though both namespaces ship 18 subcommands between them. An agent working
  from skills alone cannot discover either. `developers/cli.md` states the gap
  rather than papering over it.
- **Root `package.json` has no `engines` field**, so nothing enforces the
  Node 22 floor that `.nvmrc`, both Dockerfile stages and every CI job assume.
- **`packages/backend/package.json`'s `migrate` script runs
  `prisma migrate dev --name init`** — a dev-only command that `README.md:138`
  and, until now, the self-hosting guide pointed production readers at.
  Consider renaming it `migrate:dev`.
- **`docker-compose.yaml:60` and `packages/backend/README.md`** both describe
  the default stack as postgres/yorkie/minio, omitting `azurite`, which has no
  `profiles:` key and does start by default.
- **`packages/frontend/README.md:28-30` documents 3 of 8 `VITE_*` vars**,
  missing `VITE_YORKIE_RPC_ADDR` — required for any non-localhost deployment.

## Unverified

No runtime or browser verification was performed anywhere in this audit; all
findings are static reads. Specifically unresolved: whether
`pnpm design-pr --dry-run` forwards the flag without `--`
(`design-editor.md:129` vs `scripts/design-pr.mjs:26-27`); whether
`@wafflebase/design-editor` is on the npm registry
(`design-editor.md:234` asserts it is not, but the package carries
`publishConfig.access: public` and no `"private": true`); request/response
shapes of the ~30 undocumented worksheet routes beyond their decorators;
`self-hosting.md:10`'s "PostgreSQL 14+" (nothing in the repo corroborates 14;
compose and CI pin 16).
