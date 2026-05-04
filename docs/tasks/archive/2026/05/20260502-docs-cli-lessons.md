---
title: Lessons — Docs CLI support and namespace restructure
date: 2026-05-02
related: 20260502-docs-cli-todo.md
---

# Lessons

Reusable rules and reminders pulled from the v0.3.7 CLI work. Each
entry leads with the rule, then the incident that produced it.

## Commander: never re-declare a flag name across global + subcommand

**Rule.** Subcommand `.option('--format <fmt>')` calls collide with a
global `program.option('--format <fmt>')` of the same name. Commander
funnels the user's value to the **earliest** parent that owns the
flag, so the subcommand's `cmd.opts().format` stays at its declared
default while `getGlobalOpts(cmd).format` (the merged
`optsWithGlobals()` view) holds the user input. Read flags from
`opts.format` (the merged form) when there's any chance of collision,
and validate them at the action site against the per-command
vocabulary.

**Incident.** `docs content --format md` and `docs export --format
docx` silently rendered as the JSON default for hours of integration
testing because the per-command `--format` declarations were
shadowed by `createProgram()`'s global. Unit tests passed because
they called `runDocsContent` / `exportPdf` / `exportDocx` directly
with explicit format args, never going through commander. Caught by
Phase 10's spawn-the-CLI integration test, fixed by routing both
actions through `opts.format` (`docs export` adds an extra
"`'json'` means no override" check since pdf/docx/json all share the
same flag).

## Workspace dist is the runtime — keep `node.ts` in sync with `index.ts`

**Rule.** When tsconfig path-mapping resolves `@wafflebase/docs` to
`packages/docs/src/node.ts` for type-checks but the runtime resolves
to `packages/docs/dist/node.js` (built from the same source), every
new export in the browser-side `index.ts` needs a matching entry in
`node.ts` AND a fresh `pnpm --filter @wafflebase/docs build`. The
dist `node.js` only ships symbols re-exported from `node.ts`; missing
ones become `undefined` at runtime, with no compile-time warning.

**Incident.** Phase 6 added `serializeJson/Markdown/Text` to
`src/index.ts` and the CLI typecheck passed (TypeScript resolved
through the `node` exports condition to `dist/node.d.ts`, which the
build had refreshed earlier). Test suite still failed at runtime
with "serializeText is not a function" because the runtime
condition pointed at `dist/node.js`, which only re-exported model
types. Resolution: also add the symbol to `src/node.ts` (DOM-free
audit per its top-of-file rule), rebuild the docs package, retest.

## ts-jest can't always import `@wafflebase/docs` — pre-bake fixtures

**Rule.** `ts-jest` with `module: commonjs` compiles
`import JSZip from 'jszip'` to `jszip_1.default(...)`, which crashes
because JSZip exports the constructor directly (no `.default`).
That bites any backend-side test that imports `@wafflebase/docs`'s
`DocxExporter` or `DocxImporter` because both pull JSZip
transitively. Workaround: pre-generate any `.docx` fixture through
a `tsx`-run script (vite/esbuild interop is fine) and commit the
bytes; the test reads the file directly without re-importing the
docs package.

**Incident.** The Phase 10 integration spec's
`makeSampleDocx()` helper imported `DocxExporter` from
`@wafflebase/docs` and crashed before any HTTP call was made.
Replaced with `packages/cli/scripts/gen-sample-docx.mjs` (one-shot
tsx script) that writes
`packages/backend/test/fixtures/docs-cli-sample.docx`; the test now
reads bytes via `readFileSync`.

## CLI uses base64 image inlining only because the upload endpoint isn't ready yet

**Rule.** Treat the `inlineBase64Uploader` in
`packages/cli/src/docs/docx-import.ts` as a deliberate placeholder.
For documents with many or large images, the imported JSON balloons
because every image becomes a `data:` URL. When a real `/images`
upload endpoint lands, the CLI should switch by default and only
fall back to inline when the user opts in (e.g.,
`--inline-images-on-import`).

**Incident.** Phase 8.2 chose inline base64 because the design's
"no external upload yet" footnote made it the lowest-risk first
pass. The trade-off is documented here (and in the import skill)
so a future round-trip-of-image-heavy-docs reviewer doesn't read
the `data:` URLs and assume it's a permanent contract.

## Always read commander option default behavior — don't assume

**Rule.** Commander reports an option's `defaultValue` only when the
option was *registered* with a default; an option declared with
`.option('--type <type>')` (no default) returns `undefined` for
`opts.type` when the user omits the flag. Don't write code that
depends on a `local.x ?? ''` empty-string fallback unless you've
confirmed commander gave you that empty string explicitly.

**Incident.** The `docs.list --type` test asserted "no default"
specifically because the schema registry needs `default` to be
absent (so agents know the flag is purely a filter). Initial
implementation set the default explicitly to `''`; corrected to
omit the third arg, which makes commander leave the value
`undefined` and the schema entry's `default` field absent.

## Spawn-the-CLI integration tests need an in-tree binary path

**Rule.** Don't try to spawn the CLI through global `tsx` or
`pnpm --filter @wafflebase/cli dev` from inside a Jest e2e — both
break tsx ESM resolution from the test's CWD. Resolve the local
`packages/cli/node_modules/.bin/tsx` and pass `packages/cli/src/bin.ts`
explicitly. Set `WAFFLEBASE_CONFIG` to a per-test temp file so the
spawned CLI doesn't touch the developer's real
`~/.wafflebase/config.yaml`.

**Incident.** First spawn attempts surfaced
`ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'` because the test
ran from the backend's CWD and `tsx`'s ESM resolver couldn't find
itself. Resolved by joining absolute paths — the binary at
`packages/cli/node_modules/.bin/tsx`, the entry at
`packages/cli/src/bin.ts`, and the per-test config under
`mkdtempSync(...)`.

## Version bumps: alias-preserving changes don't justify a major minor

**Rule.** When breaking changes ship with full back-compat aliases
(singular `cell.get` still resolves to `sheets.cells.get`, singular
`api-key.create` to `api-keys.create`), bump to the next patch in
the current minor (e.g., 0.3.6 → 0.3.7), not to the next minor
(0.4.0). Save the minor bump for a release that actually drops
older surface or changes user-visible default behavior.

**Incident.** The original plan called for v0.4.0 because the
namespace restructure looked breaking on its face. The user pushed
back: aliases are preserved end-to-end, no v0.3.6 script needs
updating to keep working — that's a 0.3.7 patch, not a 0.4.0 minor.
All `target-version` frontmatter, the `Breaking changes` table
header, the design notes, the README, and the demo footer were
re-aligned to 0.3.7 in a single follow-up.

## `outputError` must propagate the `code` field on Error subclasses

**Rule.** When a typed error class declares `readonly code = '…'` (e.g.,
`InvalidDocxError`), the central error formatter must surface that
`code` to stderr — not flatten every failure to `'ERROR'`. Skill files
document the codes so AI agents can branch on them; if the formatter
swallows them, the documented contract silently breaks.

**Incident.** Code review on PR #183 caught that `outputError` in
`packages/cli/src/output/formatter.ts` always emitted
`{ error: { code: 'ERROR', message } }`, even when the thrown value
was an `InvalidDocxError`. The skill at `skills/docs-import-docx.md`
had told agents to look for `INVALID_DOCX`. Fix: inspect a string
`code` field on `Error` subclasses and emit it; fall back to `ERROR`
otherwise. Add unit tests for both branches plus the quiet path so a
future refactor can't undo this.

## Express body limit defaults bite any API that accepts large JSON

**Rule.** NestJS over Express defaults to a 100kB JSON body. Any
endpoint that accepts inline-base64 images, large CRDT documents, or
batch operations needs an explicit
`app.use(bodyParser.json({ limit: '<X>mb' }))` at bootstrap. The
default fails *silently* in many configurations — the request is
rejected with a generic 413/400 before any controller is invoked, so
the missing limit doesn't show up in unit tests, only in real-world
use.

**Incident.** Code review flagged that `PUT
/api/v1/.../documents/:id/content` would 413 on real-world docx
imports because `inlineBase64Uploader` embeds every image as a
`data:` URL inside the request body. The integration fixture is 3.8kB
so the e2e never tripped this. Fix: add `bodyParser.json({ limit })`
in `packages/backend/src/main.ts` defaulting to `'25mb'`, with a
`BACKEND_JSON_BODY_LIMIT` env var for installs that need more
headroom.
