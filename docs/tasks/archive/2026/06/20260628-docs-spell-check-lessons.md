# Docs Spell Check — Lessons

Running log of corrections and patterns discovered while implementing 6.3.

1. **Vendor the dict; do not npm-import it.** `dictionary-en` (npm) is
   a Node-only package whose `exports` map blocks direct subpath access
   (`dictionary-en/index.aff`) in Vite/Rollup bundlers. The only
   reliable browser path is to copy the raw `.aff` / `.dic` files into
   `src/spell/dict/` and load them with `import('./dict/en_US.dic?raw')`.
   Vite then splits each file into its own lazy chunk rather than
   inlining it into the main entry.

2. **Each lazy `?raw` import creates a separate chunk — budget accordingly.**
   The `.dic` + `.aff` raw imports add 2 chunks to the frontend build.
   If `maxChunkCount` in `harness.config.json` is not bumped before
   `verify:self`, the chunk-gate fails. Always update the count and add
   a `maxChunkCountReason` entry at the same time.

3. **The tokenizer prescan must exclude URLs and email addresses.**
   A naive word-boundary split flags URL hostnames and email local-parts
   as misspelled. Add a prescan regex pass that marks URL/email spans as
   skip zones before the word-range loop runs.

4. **The docs editor is closure-style; `render()` takes a long positional
   arg list.** Adding a new trailing parameter (e.g. `spellErrorRects`)
   must align exactly with every call site. Missing one call site silently
   passes `undefined` and renders no squiggles with no error thrown.
