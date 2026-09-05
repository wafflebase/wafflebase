/**
 * Static OOXML boilerplate templates for .docx export.
 */

export const CONTENT_TYPES = (extras: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="gif" ContentType="image/gif"/>
  <Default Extension="webp" ContentType="image/webp"/>
  <Default Extension="bmp" ContentType="image/bmp"/>
  <Default Extension="bin" ContentType="application/octet-stream"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
${extras}</Types>`;

export const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/**
 * `word/styles.xml`.
 *
 * `ListParagraph` exists for one reason: to give exported list items a
 * paragraph style **distinct from body paragraphs**, which is the precondition
 * for `<w:contextualSpacing/>` to mean what the editor paints. ECMA-376
 * §17.3.1.9 scopes that element to paragraphs "of the same style" — so with
 * every `<w:p>` in the file unstyled (i.e. `Normal`), a list item's
 * `<w:contextualSpacing/>` suppresses its space-after against the *plain
 * paragraph that follows the list* as well as against the next bullet. The
 * editor's own rule zeroes the gap only between adjacent `list-item` blocks, so
 * without this style the two disagree: 8 px on screen, 0 in Word.
 *
 * It is written out explicitly rather than left to Word's latent built-ins for
 * two reasons. Word would resolve the built-in `List Paragraph` from its own
 * gallery and apply its `w:ind w:left="720"`, indenting exported items by half
 * an inch that the editor never painted; and consumers with no built-in gallery
 * (LibreOffice, Google Docs, this package's own importer) would resolve the
 * dangling `w:val` to the default style, which is exactly the collision the
 * style exists to avoid. `basedOn="Normal"` with nothing but
 * `<w:contextualSpacing/>` therefore makes the style a pure *identity* — it
 * changes no metric, it only lets Word tell a bullet from a paragraph.
 *
 * (Word's UI writes `<w:contextualSpacing/>` onto the paragraph; this package
 * emits it in both places. Belt and braces: direct paragraph formatting is what
 * Word round-trips through its own checkbox, and the style-level copy is what a
 * consumer that ignores direct formatting still sees.)
 *
 * Child order inside `w:style` follows `CT_Style`'s sequence — name, basedOn,
 * qFormat, pPr — because unlike `w:pPr` this part has no legacy tolerance
 * established by files this exporter already shipped.
 */
export const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:contextualSpacing/></w:pPr>
  </w:style>
</w:styles>`;

/**
 * The `w:styleId` exported list items carry. Shared with `docx-style-map.ts`
 * (which writes the `<w:pStyle w:val>`) so the reference and the definition
 * cannot drift apart — a `pStyle` naming a style `styles.xml` does not define
 * silently resolves to the default style, which reinstates the very bug
 * `ListParagraph` was added to fix and would show up as nothing at all in the
 * emitted XML.
 */
export const LIST_PARAGRAPH_STYLE_ID = 'ListParagraph';

export const DOC_RELS = (extras: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${extras}</Relationships>`;
