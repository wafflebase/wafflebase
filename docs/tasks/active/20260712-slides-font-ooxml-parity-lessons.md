# Slides Font OOXML Parity — Lessons

Paired with
[20260712-slides-font-ooxml-parity-todo.md](20260712-slides-font-ooxml-parity-todo.md).

## Tooling

- **`rtk` proxy corrupts search output.** `grep`/`find`/`rg` are rewritten
  by a Claude-Code hook (`git status` → `rtk git status`, `find` → `bfs`).
  During this task `find` errored on a directory that existed, and `rg`
  reported 0 matches for a term present in a just-read file. It made an
  early exploration report claim `superscript` was "not modeled" when it
  was in `InlineStyle` all along. Fix: run search binaries by absolute
  path (`/usr/bin/grep -rn …`) to bypass the rewrite. Also watch for
  self-inflicted false negatives — a `grep -v "type"` filter silently
  drops every hit whose path contains `types.ts`.
- **Verify exploration-agent claims with a reliable tool before acting.**
  The "modeled but not rendered" question was load-bearing (a toolbar
  toggle with no visual effect is a broken feature). Confirming the
  renderer actually paints super/subscript (`layout.ts`,
  `paint-layout.ts`) needed a trustworthy grep, not the agent's summary.

## Environment

- **A red `verify:fast` may be a stale generated artifact, not your diff.**
  The pre-commit gate failed on backend Prisma `updatedAt` TS errors for a
  docs-only commit. Root cause: the Prisma client was not regenerated after
  a schema change on `main` (`prisma generate` fixed it). Investigate the
  actual failing lines before reaching for `--no-verify`.

## Design

- **Import and export href policies serve different threat models — do not
  share the allowlist.** The importer's `isSafeHref` is an allowlist that
  defends the web renderer from untrusted PPTX, so relative/scheme-less
  URLs pass (they resolve under our origin). The exporter needs the
  opposite emphasis: a scheme-less target becomes a broken
  `TargetMode="External"` relative path in PowerPoint, so export must
  *require* a scheme and only block executable/local schemes
  (`javascript`/`data`/`vbscript`/`file`). Copying the import guard
  verbatim was both too strict (dropped `tel:`/`sms:`/`ftp:`) and too
  loose (emitted broken relative rels). Two functions, two policies.
- **Thread new per-slide serialization context through the existing
  `ElementXmlCtx`.** Hyperlink rels reused the same hook images use
  (`resolveImageRId`); adding `resolveHyperlinkRId` beside it kept the
  change localized to the dispatcher + text-bearing serializers instead
  of plumbing a new parameter everywhere.
- **Making an `ElementXmlCtx` field required breaks test mocks.** Adding a
  required field to the shared ctx type surfaced two stub objects in tests
  that had to gain the field. Prefer required (the orchestrator always
  supplies it, matching `resolveImageRId`) and update the stubs.

## Process

- **Keep model/export functionality separable from UI exposure.** Phase A
  prototyped both the export round-trip fixes (super/subscript `@baseline`,
  hyperlink `<a:hlinkClick>`) *and* new slides toolbar controls. The
  toolbar exposure was then reverted as a product call — but because the
  export fixes live entirely in `packages/slides/src/export/pptx/` and the
  toolbar wiring was isolated to a few `packages/frontend` files, dropping
  the UI was a clean `git checkout -- <3 files>` with zero impact on the
  shipped functionality. Structure work so a "defer the UI" decision never
  forces unwinding the durable engine change.
- **Round-trip fidelity is worth shipping even with no authoring UI.** The
  `@baseline` export has value purely for import → export fidelity: PPTX
  content with super/subscript survives a Wafflebase round trip even
  though no slides control (and no slides keybinding) can author it yet.
- **Branch not yet pushed → rebuild, don't pile on revert commits.** A
  `git reset --mixed origin-tip` + `git checkout -- <reverted files>` +
  re-commit produced clean history (functionality only) instead of an
  add-then-remove-the-toolbar noise pair. Only safe pre-push.
