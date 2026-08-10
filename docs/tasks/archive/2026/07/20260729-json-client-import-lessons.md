# Lessons — Small client-side JSON import

## Notes

- File importers should return a format-neutral `ImportedSheet`; parser-specific
  types otherwise leak into the document builder and upload queue.
- JSON value coercion must share the normal sheet input-to-cell helper. Reusing
  only `inferInput` would still duplicate formula normalization, boolean
  storage, and inferred number-format styles.
- `File.text()` is not present in the repository's jsdom File implementation.
  Decoding `File.arrayBuffer()` with `TextDecoder` works in both tests and
  browsers and keeps XLSX/JSON file reads structurally similar.
- Parse before creating backend metadata. This makes malformed or empty JSON a
  local queue error and avoids orphan cleanup for failures that never needed a
  remote document.
- Auto mode can first parse whole JSON and fall back to non-empty NDJSON lines;
  explicit `.jsonl`/`.ndjson` mode gives deterministic line-numbered errors.
- In this Codex environment, the pinned pnpm version selection can fail before
  scripts run when release-signature lookup is unavailable. Directly executing
  the installed package binaries gives an equivalent verification path without
  reinstalling or purging `node_modules`.
