# Lessons — PPTX title alignment inheritance

## What made this tricky

- The symptom ("title not centered") looked like a rendering bug, but the
  center alignment was never in the slide's own paragraph — it lives in the
  **OOXML placeholder style-inheritance chain**: slide `<a:pPr algn>` →
  layout placeholder `<a:lstStyle><a:lvl1pPr algn>` → master `<p:txStyles>`
  slot `<a:lvl1pPr algn>`. Always confirm which link of the chain carries a
  property before assuming the importer "lost" it.
- Verifying against the actual deck XML (unzip → grep the title `<p:sp>`,
  its layout rel, and the master) was faster and more certain than reasoning
  from the code alone. `ls` was swallowed by an rtk hook; `find` worked.

## Pattern reused

- The importer already resolves **font size** through the same layout
  `lstStyle` (`placeholderSizes`) and **bullet markers** through master
  `txStyles` (`txStylesMarkers`). The fix mirrored both paths exactly rather
  than inventing new plumbing — `placeholderAlignments` + `txStylesAlignments`
  threaded through `ImportedLayout`/`ImportedMaster` → `SlideParseContext` →
  `buildTextBody` → `TextParseContext.defaultAlignment`.
- Gate: a paragraph with **no `<a:pPr>` at all** (the common title shape) must
  still pick up the inherited default — apply it before the `!pPr` early
  return, then let the paragraph's own `algn` override.
- Scoped master-`txStyles` alignment to **placeholders only** (not plain text
  boxes), unlike markers, so bare text boxes keep the docs left default.
