# Documentation Site Update for v0.6.0

**Goal:** Bring the `packages/documentation` VitePress site current with the
v0.6.0 release. The site was last meaningfully refreshed around v0.4.9; three
releases since (v0.5.0, v0.5.1, v0.6.0) added user-facing surface that is
entirely absent from the docs: the **Notes** markdown document type, the **PDF**
viewer document type (upload + view + Phase 2 comments/presence), and **Sheets
data validation** (checkboxes, dropdowns, date/number/text criteria).

**Scope:** User-facing guide content only. Developer API namespaces added
*after* the v0.6.0 tag (notes CLI namespace #483) are out of scope.

## Product facts (verified against the frontend as of v0.6.0)

- **New menu** (`document-list.tsx`): New Sheet, New Document, **New Note**,
  New Presentation, Import XLSX, Import DOCX, Import PPTX, **Upload PDF**.
- **Notes** (`/n/:id`): CodeMirror 6 source + live preview. Toolbar: view-mode
  toggle (Editor / Split / Preview, default Split), Bold/Italic/Strikethrough/
  Link/Insert-table, keyboard-mode (Default / Vim). Preview: GFM tables, code
  fences w/ highlight.js + copy button, task-list checkboxes, KaTeX math,
  sanitized (no raw HTML). Real-time via Yorkie with remote carets. No
  import/export.
- **PDF** (`/f/:id`): upload a `.pdf`, read-only continuous fit-to-width viewer
  (scroll nav, no zoom/page controls), rename in header. Phase 2: draw page
  region → comment, comments side panel (Page N threads, reply/resolve/edit/
  delete), share links (anonymous `/shared/:token` viewer), presence
  (per-viewer active page). View-only, no re-export.
- **Data validation** (Sheets): opened from toolbar "Data validation" icon,
  Insert menu, or cell right-click. Right-docked panel; add rules, pick
  criteria, apply-to-range, invalid behavior (warning vs reject). Criteria:
  Dropdown (list, show-arrow switch), Checkbox (TRUE/FALSE), Date (8 operators
  + calendar picker on double-click), Number (9 operators), Text (contains /
  email / URL etc). In-cell: checkbox glyph + Space toggle, dropdown arrow +
  Alt+Down, date calendar popover.

## File plan

### New files
- [x] `notes/writing-a-note.md` — Notes editor guide
- [x] `pdf/viewing-pdfs.md` — PDF upload/view/comment guide
- [x] `sheets/data-validation.md` — Data validation guide

### Modified files
- [x] `.vitepress/config.ts` — add Notes (nav + sidebar) and PDF (sidebar)
      sections; add Data Validation under Sheets
- [x] `README.md` — add Notes / PDF / Data Validation to content tables
- [x] `guide/getting-started.md` — New menu list (New Note + Upload PDF),
      "Try a Note" subsection, What's Next links
- [x] `guide/import-export.md` — add PDF upload; note Notes have no import/export
- [x] `guide/collaboration.md` — PDF page-region comments + presence; notes sync
- [x] `developers/self-hosting.md` — FILE_STORAGE_* env vars + PDF/image blob
      storage note (self-hosters running PDF uploads)

### Considered, out of scope
- `developers/cli.md`, `developers/rest-api.md` — notes namespace / content
  endpoint landed post-tag (#483). Leave as-is.
- `developers/self-hosting.md` — FILE_STORAGE_* (PDF blobs) + Yorkie
  auth-webhook env vars. Add a short optional note (self-hosters running PDF
  uploads need blob storage).

## Steps
- [x] Write the three new pages
- [x] Wire config.ts sidebar + nav
- [x] Update getting-started, import-export, collaboration
- [x] Update README content tables
- [x] Optional self-hosting env note
- [x] `pnpm --filter @wafflebase/documentation build` — site builds, no dead links
- [x] `pnpm verify:fast` — green (initial failure was missing `node_modules`;
      `pnpm install` fixed it, then lint + unit all pass)
- [x] High-effort `/code-review` — 2 confirmed doc-accuracy findings, both
      fixed (see Review); PR #485 opened

## Review

Brought the documentation site current with v0.6.0. The site had drifted to the
v0.4.9 feature set; three releases since added user-facing surface absent from
the docs.

**Added (3 new pages):**
- **Notes** (`notes/writing-a-note.md`) — new nav + sidebar section covering the
  Markdown source/preview editor, view modes, formatting toolbar, GFM/KaTeX/
  code-copy preview features, Vim mode, and real-time collaboration.
- **PDF** (`pdf/viewing-pdfs.md`) — new sidebar section covering upload,
  view-only continuous rendering, rename, page-region comments, the comments
  panel, presence, and share links.
- **Data Validation** (`sheets/data-validation.md`) — checkbox / dropdown /
  date / number / text criteria, in-cell controls, and warning-vs-reject
  behavior, linked under Sheets.

**Updated:** getting-started (New menu now lists New Note + Upload PDF, added a
"Try a Note" walkthrough and What's Next links), import-export (PDF upload row,
Notes have no file I/O), collaboration (PDF page-region comments + presence,
notes sync), README content tables, and self-hosting (`FILE_STORAGE_*` env vars
+ blob-storage note for PDF/image uploads).

**Verification:** `pnpm --filter @wafflebase/documentation build` succeeds
(VitePress fails on dead links by default, so all internal links resolve).
`pnpm verify:fast` green.

**Accuracy:** All content verified against the frontend (`document-list.tsx`
New menu, `notes-toolbar.tsx`, `pdf-collab.tsx`, `data-validation-panel.tsx`) as
of v0.6.0.

**Out of scope:** The notes CLI namespace + backend note content endpoint
(#483) landed *after* the v0.6.0 tag, so `developers/cli.md` and
`developers/rest-api.md` are left unchanged per the "based on 0.6.0" scope.

**Code review (high effort):** Two confirmed doc-accuracy findings, both fixed:
1. `self-hosting.md` claimed embedded images use `FILE_STORAGE_*`, but the
   backend reads images from a separate `IMAGE_STORAGE_*` config (bucket
   `wafflebase-images`). Documented both buckets.
2. `data-validation.md` listed a nonexistent toolbar "Insert" menu as an entry
   point. Replaced with the real paths (toolbar icon, right-click, mobile
   overflow menu).

**PR:** #485 — https://github.com/wafflebase/wafflebase/pull/485

## Audit closure (2026-07-17, second pass)

Archived by the active-tasks audit after pulling `main`. Verified shipped: merged
PR #485 (`d7cf8d5c2`) — 3 new documentation pages (`notes/writing-a-note.md`,
`pdf/viewing-pdfs.md`, `sheets/data-validation.md`) plus nav/sidebar wiring, bringing
the docs site from v0.4.9 to v0.6.0 feature parity. All 17 boxes already checked.
