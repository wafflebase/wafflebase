# Notes Mermaid preview — lessons

## The chunk budget had zero headroom, and only a build could tell me

`harness.config.json`'s `maxChunkCount` was 147 and the frontend built
**exactly** 147 chunks on `main` — so any dependency that code-splits itself
fails the gate. `mermaid` splits per diagram type (36 `import()`s plus shared
cytoscape/d3/dagre/katex chunks) → 213 chunks measured. There is no way to
guess that number: I built the frontend twice (`git stash -u` for the
baseline) and diffed both the count and `notes-view-*.js` (1297.18 → 1299.43
kB, which is the proof the engine really is deferred). Any future heavy dep
should budget for that same two-build measurement.

## Folding a self-splitting vendor into one chunk is a trap

The tempting fix for the count bump is a `manualChunks` `vendor-mermaid`
rule. It backfires twice: a flowchart-only note would download the whole
~2.5 MB engine instead of `mermaid.core` + one diagram module, and matching
its shared deps by path (`node_modules/katex`, `node_modules/d3-*`) would
pull modules that *other* routes import statically into the mermaid chunk —
making the 2.5 MB eager on the notes route (katex already ships inside
`notes-view`) or on the analytics route (recharts' d3). Keeping upstream's
splitting and bumping the documented count was the smaller lie.

## Staleness: prefer `root.contains(el)` over `el.isConnected`

The async render pass has to skip placeholders that a newer `render()` has
already replaced. `el.isConnected` reads naturally but is false for a preview
that is not mounted in a document — which is exactly the state in unit tests,
so every test silently rendered nothing. `root.contains(el)` asks the real
question ("is this still the DOM I was handed?") and works detached.

## Cache the failures too

Split mode re-renders on every keystroke, and a diagram is *unparseable for
most of the time it is being typed*. Caching only successful SVG means the
mermaid parser runs on every keystroke while the user types a diagram. The
cache key is `theme + source` because mermaid bakes its palette into the SVG.

## Local hooks are heavier than this run's budget

`.githooks/pre-commit` runs `verify:fast` and `pre-push` runs `verify:self`.
`verify:fast` also needs sibling packages' `dist/` present (slides typecheck
imports `@wafflebase/docs`, cli imports `@wafflebase/slides/node`), so a
fresh checkout must `pnpm --filter @wafflebase/docs build` and
`pnpm slides build` before the first commit will pass. Every commit ran
`verify:fast` green. The push itself used `--no-verify`
(`docs/design/harness-engineering.md:163` — the hook's sanctioned bypass for a
run that cannot sit through `verify:self`'s several minutes), disclosed on the
PR; CI then ran the full `verify:self` lanes on the pushed branch. This is a
bypass, not a default: skipping the hook is only defensible because the same
lanes are mandatory on the PR, and the pre-commit gate was never skipped.

## An untrusted-content `innerHTML` needs a local sanitizer, not a config flag

The first cut set `securityLevel: 'strict'` and treated the question as
settled. It isn't: `strict` protects a small `secure` key list, so a note's own
`%%{init: {"themeCSS": ...}}%%` directive (or `config:` front matter) still
reaches the `<style>` element mermaid emits *inside* the SVG — document-scoped
CSS authored by whoever wrote the note. Notes are multi-writer (share links
grant editor roles), so "the author is the reader" never holds. Two fixes were
needed beyond the flag: strip the config carriers from the fence body, and
re-parse the engine's output in an inert `<template>` to drop scripts /
`on*` / off-page URLs before it is assigned. `securityLevel: 'sandbox'` is the
upstream advice but iframes each diagram, which costs sizing, selection and
theming — a local sanitize pass buys the same property without that.

## "Cache it" and "call it on every keystroke" need a queue between them

Per-keystroke `render()` plus a fired-and-forgotten async pass plus a
*process-global* engine is a race, not a cache: two passes can sit in
`mermaid.render()` at once, and pass B's `initialize({theme})` lands between
pass A's initialize and its render — so a diagram gets one palette and is
cached under the other's key, permanently. Serializing every pass on one
promise chain and giving each pass a generation to check turned out to be
strictly simpler than a debounce, and it also makes the cache correct: a
failure is then a deterministic property of the source rather than a
concurrency artifact, which is what makes caching failures safe.

## A bounded cache read on every keystroke must be LRU, not FIFO

`Map` insertion order made the 40-entry cache evict the *oldest inserted*
entry, and typing a second diagram inserts a new throwaway source per
keystroke. After ~40 keystrokes the stable diagram above it aged out and
flashed back to source mid-typing. A cache whose hit rate depends on
long-lived entries surviving short-lived ones has to re-insert on read.
