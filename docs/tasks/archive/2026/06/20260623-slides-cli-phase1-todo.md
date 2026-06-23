# Slides CLI — Phase 1 (read / metadata / content)

## Context

The CLI already supports `wafflebase slides import <file.pptx>` (PPTX →
new/replacement deck) and the backend `/content` endpoint already serves
**both** `doc` and `slides` documents (type-dispatched, `slides-` Yorkie
key prefix). What is missing is the **read** side: there is no
`getSlidesContent()` HTTP method and no `slides content` / metadata
commands. Phase 1 closes that gap.

Out of scope (deferred): `slides export pdf` (Canvas/raster, needs a
node canvas lib), `slides export pptx` (no PPTX export engine exists).

## Goals

- `wafflebase slides list|create|get|rename|delete` — metadata CRUD,
  symmetric with `docs …`, filtered/typed to `slides`.
- `wafflebase slides content <doc-id> [--format json|md|text]` — read a
  deck and serialize:
  - `json` (default): raw `SlidesDocument` JSON (faithful).
  - `md` / `text`: per-slide text extraction (walk elements, reuse
    `@wafflebase/docs` `serializeMarkdown` / `serializeText` over each
    `TextBody.blocks`).
- `HttpClient.getSlidesContent()`.
- Schema registry entries (`slides.*`) + aliases + safety.
- Bundled skill markdown.
- Update `docs/design/cli.md`.

## Plan / Checklist

- [x] `http-client.ts`: add `getSlidesContent(docId)` (GET `/documents/:id/content`).
- [x] `slides/content.ts`: `runSlidesContent` orchestrator + `parseSlidesContentFormat`.
  - [x] json → `JSON.stringify(deck)`.
  - [x] text/md → iterate slides, per-slide header, walk `flattenElements`,
        extract `TextBody.blocks` from text/shape/table elements, serialize
        via docs serializers on a synthetic `{ blocks }` Document.
  - [x] `--notes` flag to include speaker notes (`Slide.notes`).
  - [x] injectable `SlidesContentIO` (stdout/stderr/writeFile), `--out`/`--force`.
- [x] `commands/slides.ts`: register `list/create/get/rename/delete/content`
      (thin actions delegating to client + `runSlidesContent`).
- [x] `schema/registry.ts`: `slides.list/create/get/rename/delete/content/import`
      with `slide.*`/`deck.*` aliases + safety levels.
- [x] Tests (`test/slides-content.test.ts` — 22 cases; extended `test/namespaces.test.ts`).
- [x] `skills/slides-*.md` (manage + read-content + import-pptx) + SKILL.md index.
- [x] Update `docs/design/cli.md` command tree + schema tables + project structure.
- [x] `pnpm verify:fast` green (modulo the known pre-existing slides `.at()` typecheck gap).

## Review

**Shipped.** `wafflebase slides {list,create,get,rename,delete,content,import}`.
The backend `/content` endpoint and `slides import` already existed; this PR
adds the read side: `getSlidesContent()` + the `slides content` serializer
(`json` lossless; `md`/`text` text-only via per-slide `## Slide N` sections,
reusing the docs `serializeMarkdown`/`serializeText` over each `TextBody.blocks`).

**Verification:** CLI suite 206 → 228 tests pass; CLI + docs typecheck clean;
slides/sheets/docs unit suites green. Smoke-tested `slides --help` and
`schema slides.content` (alias resolution works). `verify:fast` halts only at
the unrelated pre-existing `packages/slides/test/anim/player.test.ts` `.at()`
typecheck error (CI never runs it; see project memory).

**Self code-review** (medium effort, 2 finder angles + verify): no confirmed
bugs. Refuted: `slides.list` type-filter "inconsistency" (Prisma `type` is
non-null, so `=== 'slides'` never misses a deck); `import` alias collision (used
`slide.*`/`deck.*` only); `{ blocks } as Document` cast (serializers read only
`.blocks`/`.header`/`.footer`).

**Deferred (Phase 2):** `slides export pdf` (Canvas/raster — needs a node canvas
lib, the docs CLI deliberately avoids native deps). Net-new work, not gap-filling.
