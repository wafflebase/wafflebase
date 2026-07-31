# Lessons — DOCX inline `<w:sdt>` text import

## What broke

A Google-Docs-exported `.docx` imported with no visible body text. The
paragraph parser only kept runs whose direct parent was the paragraph or a
`<w:hyperlink>`; Google Docs wraps most body runs in inline content controls
(`<w:p><w:sdt><w:sdtContent><w:r>`), so 63% of the text was silently dropped.

## Lessons

- **OOXML wrappers are not all transparent — classify them.** Once you descend
  through inline wrappers, you inherit every wrapper, including ones whose
  content must *not* import: tracked deletions (`w:del`), tracked-move source
  (`w:moveFrom`), and ruby phonetic guides (`w:rt`). Broadening a "keep this
  run" guard silently reverses a bunch of implicit filters. Enumerate the
  wrappers you now let through and decide keep-vs-drop for each, rather than
  assuming "inside the paragraph" means "visible text."

- **`getElementsByTagNameNS(..)[0]` is a latent nested-content trap.** It
  matches the first *descendant*, not the first child. `<w:pPr>`/`<w:rPr>` are
  first children by schema, so it usually works — until a paragraph nests
  another paragraph (drawing textbox) and the outer element has no property of
  its own, at which point it adopts the nested one's style. Use a direct-child
  scan for property lookups.

- **A `<w:p>` *can* contain another `<w:p>`.** Not directly, but via
  `<w:drawing><wps:txbx><w:txbxContent><w:p>`. The "a paragraph can't nest a
  paragraph" intuition is wrong; the nested-block floor that stops the ancestor
  walk is load-bearing (it keeps textbox runs out of the body), not defensive.

- **Fixing the inline case leaves the block-level twin broken.** Inline
  `<w:sdt>` lives inside a paragraph; block-level `<w:sdt>` wraps whole
  paragraphs/tables at the body/cell/header level. The body/cell/header walks
  matched only direct-child `w:p`/`w:tbl`, so block-wrapped content still
  imported empty. Same root cause (sdt ignored), different enumeration site —
  fix both, via one shared unwrapping helper.

- **Reproduce against the real artifact, not just synthetic XML.** The
  synthetic unit test proved the guard logic; running the actual 103-run report
  file end-to-end (0 → 85 non-empty lines) proved the fix mattered and later
  confirmed the review follow-ups dropped no legitimate content.
