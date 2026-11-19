# Docs Site Content Overhaul — Todo

Improve the content of the VitePress docs site (`packages/documentation`) by
benchmarking it against mature help centers and developer docs, then
auditing, rewriting and fact-checking it with parallel agents.

Decisions (2026-11-19): scope = whole site (user + developer docs);
screenshots included; English only; information architecture may change
substantially (add redirects for moved URLs).

## Baseline

- 27 pages, ~6,700 lines. `developers/` (cli, rest-api, self-hosting) is
  ~3,000 of them; product pages are 70–320 lines each.
- 3 screenshots, all in Sheets pages. Docs, Slides, Board have none.
- Missing or thin: board sketching/sections/voting (#1172), docs editor
  (2 pages for tables, header/footer, comments, spell check, named
  styles), mobile (#1170, #1173), trash (one paragraph).
- Tutorials, how-tos and references share one undifferentiated sidebar;
  `index.md` is a bare redirect.

## Plan

- [x] Phase 1 — Benchmark research (3 parallel, read-only): office help
      (Google Workspace, Microsoft Support), modern product help (Notion,
      Figma/FigJam, Miro), developer docs (Stripe, Supabase, Vercel).
      Output: patterns + scoring rubric.
- [x] Phase 2 — Style guide (`packages/documentation/STYLE.md`) from the
      rubric; excluded from the build.
- [x] Phase 3 — Audit (6 parallel, read-only): Guide / Sheets / Docs /
      Slides / Notes·Board·PDF / Developers. Accuracy against source code
      (not design docs), shipped-but-undocumented features, rubric score.
- [x] Phase 4 — Consolidate: new IA (sidebar, landing page, redirects) +
      prioritized backlog (wrong → missing → structure → polish).
      **Check in with the user.**
- [x] Phase 5 — Write (parallel, disjoint file ownership per agent; shared
      files `config.ts` / `README.md` edited by the coordinator only).
      Screenshot lane: Playwright against `pnpm dev`, desktop + 393×659.
- [x] Phase 6 — Verify: cross fact-check by a different agent per section,
      VitePress build + dead-link check, `pnpm verify:fast`,
      `/self-review` (≤3 rounds).
- [ ] Phase 7 — One PR for the whole overhaul (user decision 2026-11-19,
      replacing the 4-PR split below).

## Phase 1–3 results (2026-11-19)

Workflow `wf_81db1707-9c4`, 10 agents. 195 findings: 49 wrong, 70 missing,
41 structure, 35 polish. Raw result kept in the session scratchpad
(`audit.json`); style guide draft → `packages/documentation/STYLE.md`.

The audits proposed ~130 pages. That over-splits; the consolidated IA
below targets ~80 pages: one global phone page and one global
troubleshooting page with per-editor anchors instead of one of each per
editor, and one function reference page instead of one per category.

## IA (approved 2026-11-19)

- **Landing** `index.md` — goal cards, per-editor row, troubleshooting link.
- **Get started** `start/` — getting-started, concepts, phone,
  troubleshooting.
- **Collaborate & organize** `collaborate/` — workspaces-and-roles, share,
  edit-together (presence + saved status), comments (mentions +
  notifications), version-history, templates, folders, trash.
- **Files** `files/` — upload, pdfs (read + comment), images,
  import-export (format × direction × fidelity matrix, Miro).
- **Sheets** — index, build-a-budget, edit-and-format, rows-columns-tabs,
  sort-and-filter, formulas, functions (reference), charts, pivot-tables,
  data-validation, conditional-formatting, connect-a-database, lakehouse,
  keyboard-shortcuts.
- **Docs** — index, write-a-proposal (tutorial), format-text (styles,
  links), lists-and-indents, tables, images, page-layout (setup,
  header/footer), find-and-spelling, paste-from-other-apps,
  keyboard-shortcuts.
- **Slides** — index, build-a-deck, add-content, style-and-arrange,
  themes-and-layouts, animations, present, keyboard-shortcuts.
- **Notes** — index, write-and-format, markdown-reference,
  keyboard-shortcuts.
- **Board** — index, run-a-retro, stickies-shapes-connectors, draw,
  sections, facilitate-a-session, export-and-import, keyboard-shortcuts.
- **Developers** — index; `cli/` quickstart + 5 reference pages;
  `api/` quickstart + overview (auth, errors) + 4 resource pages;
  claude-code-plugin; `self-hosting/` quick-start, configuration (env
  reference), sign-in-and-access, optional-features, operations,
  troubleshooting.
- Old URLs → meta-refresh stubs (same mechanism `index.md` uses today).

## PR split (superseded: shipped as one PR)

1. Foundation: STYLE.md, new sidebar/nav, landing, redirects, Get started,
   Collaborate, Files.
2. Sheets + Docs.
3. Slides + Notes + Board.
4. Developers.

Each PR: writers own disjoint files → screenshot lane → a different agent
fact-checks against code → build + dead links + `verify:fast` →
`/self-review`. All `wrong` findings in a PR's sections are fixed in it.

## Review

Three workflows, 45 agents:

| Workflow | Agents | Output |
|---|---|---|
| `wf_81db1707-9c4` benchmark + audit | 10 | rubric, STYLE.md draft, 195 findings |
| `wf_8ad81c4b-70c` write + fact-check | 24 | 82 pages; 1,786 claims checked, 136 corrected |
| `wf_5e68e1fe-b23` screenshots + integrate | 11 | 91 captures (2 dropped), troubleshooting entries, phone matrix |

Coordinator-owned work: sidebar/nav (two sidebars), verb-first how-to
titles with sidebar labels synced to H1s, 16 moved-page stubs, package
README table of contents, `docs/design/docs-site.md`, homepage links in
`packages/frontend/src/app/home/*`, `--desktop`/`--width` for
`capture-before-after.mjs`, and removal of the obsolete
`docs:screenshots` harness (its three root PNGs were no longer referenced).

Verification: VitePress build (dead links) clean; a script over the built
HTML found no broken cross-page anchors and no missing images;
`pnpm verify:fast` green; frontend `tsc` has no errors in touched files.

Dropped captures: `sheets/lakehouse-time-travel.png` (local backend refuses
the MinIO endpoint without `LAKEHOUSE_ALLOWED_ENDPOINTS`),
`developers/self-hosting/workspace-analytics.png` (no Kafka/StarRocks).

### Product issues found while writing and capturing (follow-ups, not fixed here)

- Docs: Mac `⌘+Option+<key>` shortcuts are matched on `e.key`, which Option
  changes — may not fire (text-editor.ts handleKeyDown, docs-view.tsx:630).
- Docs: inline image paints a few px into the block above (erases a table's
  bottom border); ruler first-line marker ignores `marginLeft`; toolbar does
  not refresh on image selection; no keep-with-next for headings; Comments
  panel overlaps the page instead of reflowing it.
- Sheets: `TabBar` takes no `readOnly`, so viewers see Rename/Delete; tab
  delete is outside undo; formulas written through `/api/v1` cells stay blank
  until a precedent changes; a sheet created through the API has no tabs until
  first opened in the editor; text in arithmetic counts as 0, not `#VALUE!`.
- Share links: a signed-in user on an editor link shows as "Anonymous"
  (presence built before `fetchMeOptional` resolves, shared-document.tsx);
  shared PDF page has no download button; share-link slides editors get no
  Slideshow/Export/Background.
- Slides: Motion panel lists raw ids (`fadeIn → feeeb252`,
  animation-section.tsx:215); Present menu items misaligned.
- Board (phone): Map toggle covers the end of the tool dock (still true after
  #1175); section title pills cover stickies at Fit zoom.
- Board (#1175): a selected sticky's rotation handle now draws over the top
  `+` quick-connect handle (selection overlay z-index in board-view.tsx).
- Folders: Move dialog lists folders flat with no path.
- CLI: `files delete` help says bytes are removed (it trashes); `files
  upload` hints `sheets import` for `.xlsx` (CSV/JSON only); skills are not in
  the npm tarball though docs said so.
- `docs/design/docs/docs-header-footer.md` still says header/footer tables
  can't be edited (contradicts #417).
