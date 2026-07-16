# Notes CLI — todo

Add first-class `notes` support to the `wafflebase` CLI, at parity with the
`slides` / `docs` namespaces. Notes shipped in v0.6.0 as a collaborative
markdown document type (`type: 'note'`, docKey `note-<id>`), whose entire
content is a single Yorkie `Text` CRDT at `root.content`. The CLI talks only
to REST v1, so the backend needs a note content read/write path first.

## Scope (confirmed)

- **Full parity CLI**: `list / create / get / rename / delete / content /
  import / export`.
- **Export = Markdown only** (a note's content *is* markdown; PDF/HTML deferred
  to a later P2 pass).
- **Backend**: extend the existing content controller with a `note` branch
  (no separate controller) + a tiny `note-content.ts` Text reader/writer.

## Backend

- [x] `api/v1/documents.controller.ts` — allow `type: 'note'` in the `create`
      coercion (currently silently downgrades `note` → `sheet`).
- [x] New `yorkie/note-content.ts` — `NoteDocument = { content: string }`,
      `NoteYorkieRoot`, `readNoteRoot` (`content?.toString() ?? ''`),
      `writeNoteRoot` (create `new Text()` if missing, then
      `edit(0, length, content)`).
- [x] `api/v1/docs-content.controller.ts` — add `note` arm:
  - [x] `loadContentType` returns `'doc' | 'slides' | 'note'`.
  - [x] GET → `readNoteRoot` with `note-` prefix, `syncMode: 'readonly'`.
  - [x] `sniffBodyShape` → `'note'` when `typeof body.content === 'string'`
        (checked after `slides`/`blocks`).
  - [x] `assertValidNoteBody` (content must be a string; defensive — sniff
        already guarantees string).
  - [x] PUT → `writeNoteRoot` with `note-` prefix; echo body back.
- [x] Backend spec: `note-content.spec.ts` (read/write round-trip on a
      fake-Text Yorkie root) + extended `docs-content.controller.spec.ts`
      type dispatch (GET note, PUT note, shape-mismatch, non-string content).

## CLI

- [x] `client/http-client.ts` — `createDocument` type union `+ 'note'`;
      `getNoteContent(id)` / `putNoteContent(id, {content})`; `NoteContent` type.
- [x] New `commands/notes.ts` — `registerNotesCommand` mirroring `slides.ts`
      (`note` / `notes` aliases): list/create/get/rename/delete/content/
      export/import.
- [x] New `notes/content.ts` — `parseNotesContentFormat` (`json|md|text`),
      `runNotesContent` + `NotesContentIO` (json → `{content}`, md/text → raw
      markdown), `--out`/`--force`.
- [x] New `notes/import.ts` — `runNotesImport` (read `.md`/text file or stdin →
      create-or-`--replace` → PUT content), `--title`/`--replace`/`--yes`.
- [x] `commands/notes.ts` export — `notes export <id> <file.md>` → GET content,
      write markdown (markdown-only; reject non-md `--format`).
- [x] `bin.ts` — `registerNotesCommand(program)`.
- [x] `schema/registry.ts` — `notes.*` entries + `note.*` aliases.

## Tests

- [x] `cli/test/namespaces.test.ts` — assert `notes` namespace + aliases +
      subcommands.
- [x] `cli/test/notes-content.test.ts` — json/md/text + `--out`.
- [x] `cli/test/notes-import.test.ts` — create + `--replace` + confirm gate +
      `--dry-run`.
- [x] `backend/test/notes-cli-roundtrip.e2e-spec.ts` — live Yorkie round-trip
      exercising `writeNoteRoot`'s **create branch** (fresh-note import →
      content read-back → export → `--replace`). Gated on
      `RUN_YORKIE_INTEGRATION_TESTS`; verified passing locally against docker
      Yorkie's default project.

## Docs

- [x] `docs/design/cli.md` — added `notes` to the command tree + a "Notes
      content internals" note + schema safety table rows + project structure.
- [x] `docs/design/notes/notes.md` — folded in a "CLI (shipped)" subsection.
- [ ] `packages/backend/README.md` — skipped (README v1 table doesn't
      enumerate document `type` values; nothing to change).

## Verify

- [x] `pnpm verify:fast` green; CLI + backend builds + CLI `tsc --noEmit` clean.
- [x] Smoke: `notes --help` + `schema notes.content` list the wired commands.
- [ ] Manual smoke against `pnpm dev`: create note, import `.md`, read content,
      export `.md`, round-trip in the editor.

## Review

High-effort workflow code review (14 agents) surfaced 6 findings:

| # | Finding | Verdict | Action |
| - | ------- | ------- | ------ |
| F1 | `notes export <id> -` blocked by the `.md` extension guard (schema advertises `-` for stdout) | CONFIRMED | **Fixed** — skip extension check when `file === '-'` |
| F2 | `readNoteRoot` guarded on `toString` (true for every object), leaking `"[object Object]"` for a mis-materialized `Text` | CONFIRMED | **Fixed** — guard on `.edit` like `writeNoteRoot`/frontend `ensureText` + unit test |
| F3 | `runNotesContent` deref'd `note.content` without null-guarding a 2xx empty body | PLAUSIBLE | **Fixed** — tolerate `null`/`undefined` note → empty + unit test |
| F4 | `writeNoteRoot` create branch (fresh-note import) untested | CONFIRMED | **Fixed** — added live-Yorkie `notes-cli-roundtrip.e2e-spec.ts`, verified passing |
| F5 | `NotesContentIO` triplicates docs/slides content IO | cleanup | **Known limitation** (follow-up) — this is the established per-type duplication pattern; extracting a shared helper touches docs+slides and is out of scope for this PR |
| F6 | `NotesImportIO` duplicates `SlidesImportIO` stdin/confirm | cleanup | **Known limitation** (follow-up) — same rationale as F5 |

Two findings were correctly refuted by the verify pass (global `--format`
value into `parseNotesContentFormat`; `--replace -` stdin double-drain).

**Follow-up (non-blocking):** extract a shared `content-io` +
`import-io` helper used by docs/slides/notes to collapse F5/F6 duplication.
Tracked as a design-system / CLI-internals cleanup, batched with other
CLI refactors rather than shipped piecemeal here.

## Manual smoke

- `notes --help`, `schema notes.content` — commands wired.
- Live e2e round-trip (create branch) passes against docker Yorkie.
- `pnpm verify:fast` green; CLI + backend builds + CLI `tsc --noEmit` clean.
