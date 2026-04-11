import JSZip from 'jszip';
import type { Document, Block, Inline, TableData, TableRow, TableCell, HeaderFooter, PageSetup } from '../model/types.js';
import { generateBlockId, DEFAULT_BLOCK_STYLE, DEFAULT_CELL_STYLE, DEFAULT_HEADER_MARGIN_FROM_EDGE } from '../model/types.js';
import { parseRelationships, parseParagraph, parsePageSetup, type RelEntry } from './docx-parser.js';
import { mapTableCellProperties } from './docx-style-map.js';
import { emusToPx } from './units.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * MIME types the backend image endpoint accepts, keyed by the lowercase
 * file extension recorded in a .docx .rels target. Used by `uploadImages`
 * to repackage JSZip's untyped blob before posting to `/images`.
 */
const EXT_TO_IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export type ImageUploader = (blob: Blob, filename: string) => Promise<string>;

type ResolvedImage = { src: string; width: number; height: number };

/**
 * Directory for a .rels file. Relationship targets are resolved relative to
 * the parent directory of the file the rels belong to:
 *   - word/_rels/document.xml.rels → word/
 *   - word/_rels/header1.xml.rels  → word/
 * Pre-computing this makes it easier to read image bytes from the zip.
 */
function relsDirFor(partPath: string): string {
  const idx = partPath.lastIndexOf('/');
  return idx >= 0 ? partPath.slice(0, idx + 1) : '';
}

/**
 * Build a placeholder "covered" cell for a grid position absorbed by a
 * horizontal or vertical merge. Downstream code expects the row's cells
 * array to be aligned with the table's grid column count and uses
 * `colSpan === 0` to distinguish placeholders from real owners.
 */
function makeCoveredCell(): TableCell {
  return {
    blocks: [{
      id: generateBlockId(),
      type: 'paragraph',
      inlines: [{ text: '', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE },
    }],
    style: { ...DEFAULT_CELL_STYLE },
    colSpan: 0,
  };
}

export class DocxImporter {
  /**
   * Import a .docx ArrayBuffer into a Document.
   *
   * @param buffer - The .docx file as an ArrayBuffer.
   * @param imageUploader - Optional callback to upload images. If not provided,
   *   images are skipped.
   */
  static async import(
    buffer: ArrayBuffer,
    imageUploader?: ImageUploader,
  ): Promise<Document> {
    const zip = await JSZip.loadAsync(buffer);

    // Parse document.xml.rels (scoped to the document part).
    const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
    const rels = relsXml ? parseRelationships(relsXml) : new Map<string, RelEntry>();

    // Parse document.xml
    const docXml = await zip.file('word/document.xml')?.async('string');
    if (!docXml) throw new Error('Invalid .docx: missing word/document.xml');
    const xmlDoc = new DOMParser().parseFromString(docXml, 'text/xml');
    const body = xmlDoc.getElementsByTagNameNS(W, 'body')[0];
    if (!body) throw new Error('Invalid .docx: missing w:body');

    // Upload images referenced from the document part. Image rIds are
    // scoped per rels file, so header/footer parts keep their own maps.
    const imageUrls = new Map<string, ResolvedImage>();
    if (imageUploader) {
      await DocxImporter.uploadImages(zip, rels, 'word/', imageUploader, imageUrls);
    }

    // Walk body children
    const blocks: Block[] = [];
    let pageSetup: PageSetup | undefined;
    let sectPrEl: Element | undefined;
    for (let i = 0; i < body.childNodes.length; i++) {
      const node = body.childNodes[i];
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      if (el.localName === 'p') {
        blocks.push(DocxImporter.convertParagraph(el, imageUrls));
      } else if (el.localName === 'tbl') {
        blocks.push(DocxImporter.convertTable(el, imageUrls, false));
      } else if (el.localName === 'sectPr') {
        pageSetup = parsePageSetup(el);
        sectPrEl = el;
      }
    }

    // Resolve the active header/footer parts via the sectPr references
    // rather than picking the first matching rel in iteration order.
    const headerTarget = sectPrEl
      ? DocxImporter.resolveHeaderFooterTarget(sectPrEl, rels, 'header')
      : undefined;
    const footerTarget = sectPrEl
      ? DocxImporter.resolveHeaderFooterTarget(sectPrEl, rels, 'footer')
      : undefined;

    const header = await DocxImporter.parseHeaderFooter(
      zip, 'header', headerTarget, imageUploader,
    );
    const footer = await DocxImporter.parseHeaderFooter(
      zip, 'footer', footerTarget, imageUploader,
    );

    return { blocks, pageSetup, header, footer };
  }

  /**
   * Look up the default header/footer part target referenced from a
   * <w:sectPr>. Prefers w:type="default", then falls back to the first
   * reference of the requested kind. Returns the zip-relative target path
   * (e.g. "word/header1.xml") or undefined when none is referenced.
   */
  private static resolveHeaderFooterTarget(
    sectPr: Element,
    rels: Map<string, RelEntry>,
    type: 'header' | 'footer',
  ): string | undefined {
    const refTag = type === 'header' ? 'headerReference' : 'footerReference';
    const refs = sectPr.getElementsByTagNameNS(W, refTag);
    if (refs.length === 0) return undefined;

    const pickRef = (): Element | undefined => {
      for (let i = 0; i < refs.length; i++) {
        const ref = refs[i];
        const t = ref.getAttributeNS(W, 'type') || ref.getAttribute('w:type');
        if (t === 'default') return ref;
      }
      return refs[0];
    };

    const ref = pickRef();
    if (!ref) return undefined;
    const rId = ref.getAttributeNS(R_NS, 'id') || ref.getAttribute('r:id');
    if (!rId) return undefined;
    const rel = rels.get(rId);
    if (!rel || rel.type !== type) return undefined;
    // document.xml's rels are scoped to word/, so header1.xml lives at word/header1.xml.
    return `word/${rel.target}`;
  }

  private static convertParagraph(
    pEl: Element,
    imageUrls: Map<string, ResolvedImage>,
  ): Block {
    const { inlines, blockStyle, blockType, headingLevel, imageRefs } = parseParagraph(pEl);

    // Resolve pending image references. Each pending placeholder inline is
    // matched in order against imageRefs from the same paragraph so that the
    // EMU extent parsed from <w:drawing> is preserved as CSS pixel dimensions.
    // Unresolved placeholders (e.g. when no uploader was supplied or when
    // the image belongs to a rels file we didn't walk) are dropped to avoid
    // leaving `__pending__:*` sources in the returned document.
    let refIdx = 0;
    const resolvedInlines: Inline[] = [];
    for (const inline of inlines) {
      if (inline.style.image?.src.startsWith('__pending__:')) {
        const rId = inline.style.image.src.replace('__pending__:', '');
        const uploaded = imageUrls.get(rId);
        const ref = imageRefs[refIdx++];
        if (uploaded) {
          const width = ref && ref.cx > 0 ? Math.round(emusToPx(ref.cx)) : uploaded.width;
          const height = ref && ref.cy > 0 ? Math.round(emusToPx(ref.cy)) : uploaded.height;
          resolvedInlines.push({
            text: inline.text,
            style: {
              ...inline.style,
              image: { src: uploaded.src, width, height },
            },
          });
        }
        // else: drop the pending inline (no uploader or rId not in scope).
        continue;
      }
      resolvedInlines.push(inline);
    }

    // Ensure the paragraph always has at least one inline so downstream
    // layout/rendering can assume a non-empty inlines array.
    if (resolvedInlines.length === 0) {
      resolvedInlines.push({ text: '', style: {} });
    }
    const block: Block = {
      id: generateBlockId(),
      type: blockType as Block['type'],
      inlines: resolvedInlines,
      style: blockStyle,
    };
    if (headingLevel) block.headingLevel = headingLevel as Block['headingLevel'];
    return block;
  }

  private static convertTable(
    tblEl: Element,
    imageUrls: Map<string, ResolvedImage>,
    isNested: boolean,
  ): Block {
    // If nested, flatten to a paragraph with text content. Walk only direct
    // child <w:tr> / <w:tc> so that deeply nested tables don't bleed their
    // rows/cells into the outer flattened text.
    if (isNested) {
      const texts: string[] = [];
      for (let i = 0; i < tblEl.childNodes.length; i++) {
        const trNode = tblEl.childNodes[i];
        if (trNode.nodeType !== 1 || (trNode as Element).localName !== 'tr') continue;
        const trEl = trNode as Element;
        const rowTexts: string[] = [];
        for (let j = 0; j < trEl.childNodes.length; j++) {
          const tcNode = trEl.childNodes[j];
          if (tcNode.nodeType !== 1 || (tcNode as Element).localName !== 'tc') continue;
          rowTexts.push(DocxImporter.extractText(tcNode as Element));
        }
        texts.push(rowTexts.join(' | '));
      }
      return {
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: texts.join('\n'), style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
    }

    // Parse grid columns for widths. The walk is direct-child only:
    // getElementsByTagNameNS recurses into nested tables, which used to
    // inflate the outer column count with the nested grids (a 1-col
    // outer table wrapping a 5-col nested table would have collapsed
    // to 1/6 of the content width in the real-world form.docx case).
    // The row walk below is also direct-child only, so keeping the
    // grid lookup symmetric avoids that class of leak.
    const colWidthsRaw: number[] = [];
    const tblGrid = DocxImporter.findDirectChild(tblEl, 'tblGrid');
    if (tblGrid) {
      for (let i = 0; i < tblGrid.childNodes.length; i++) {
        const n = tblGrid.childNodes[i];
        if (n.nodeType !== 1 || (n as Element).localName !== 'gridCol') continue;
        const el = n as Element;
        const w = el.getAttributeNS(W, 'w') || el.getAttribute('w:w');
        // Guard against missing or non-numeric w:w (parseInt('') / parseInt('auto')
        // return NaN, which would then propagate into columnWidths and silently
        // collapse the layout). Fall back to a unit weight so the column still
        // renders at the even share and malformed input degrades gracefully.
        const parsed = w ? parseInt(w, 10) : NaN;
        colWidthsRaw.push(Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
      }
    }
    const totalWidth = colWidthsRaw.reduce((a, b) => a + b, 0) || 1;
    const columnWidths = colWidthsRaw.map((w) => w / totalWidth);
    // Row-cell clamp target. When tblGrid is missing we cannot clamp
    // (we do not yet know how many columns exist), so numCols stays 0
    // and the clamp is effectively disabled.
    const numCols = columnWidths.length;

    // Parse rows — only direct child <w:tr> elements
    const rows: TableRow[] = [];
    // Track the currently-open vMerge group per column. Each group is
    // resolved (its rowSpan written) either when the column starts a new
    // group or at the end after all rows are walked. This handles multiple
    // stacked vMerge groups in the same column without overwriting earlier
    // trackers. `colSpan` records the owner's horizontal span so that a
    // subsequent continue cell whose gridSpan disagrees with the owner
    // still covers the full merged range.
    const vMergeTracker: Map<
      number,
      { startRow: number; count: number; colSpan: number }
    > = new Map();
    const resolveVMergeGroup = (
      colIdx: number,
      tracker: { startRow: number; count: number; colSpan: number },
    ) => {
      if (tracker.count > 1 && rows[tracker.startRow]) {
        const cell = rows[tracker.startRow].cells[colIdx];
        if (cell) cell.rowSpan = tracker.count;
      }
    };

    for (let i = 0; i < tblEl.childNodes.length; i++) {
      const node = tblEl.childNodes[i];
      if (node.nodeType !== 1 || (node as Element).localName !== 'tr') continue;
      const trEl = node as Element;

      // <w:trPr> can declare w:gridBefore / w:gridAfter to leave N leading or
      // trailing grid columns empty. These rows ship fewer <w:tc> children
      // than the table has grid columns; without padding we would end up
      // with cells.length < numCols and click/layout would misalign. The
      // absorbed positions must be emitted as covered placeholders so every
      // row still has one entry per grid column.
      //
      // The skip markers are only meaningful when we know the grid
      // width: without a <w:tblGrid> (numCols === 0) we have no target
      // length to align to, and injecting covered cells from the skip
      // markers alone would change the row shape for the legacy
      // gridless path. Gate parsing on numCols > 0 to stay consistent
      // with the clamp and the final normalize below.
      const trPr = DocxImporter.findDirectChild(trEl, 'trPr');
      const gridBefore =
        numCols > 0 && trPr ? DocxImporter.readGridSkip(trPr, 'gridBefore') : 0;
      const gridAfter =
        numCols > 0 && trPr ? DocxImporter.readGridSkip(trPr, 'gridAfter') : 0;

      const cells: TableCell[] = [];
      for (let s = 0; s < gridBefore; s++) cells.push(makeCoveredCell());
      let colIdx = gridBefore;
      for (let j = 0; j < trEl.childNodes.length; j++) {
        const tcNode = trEl.childNodes[j];
        if (tcNode.nodeType !== 1 || (tcNode as Element).localName !== 'tc') continue;
        const tcEl = tcNode as Element;

        // Parse cell properties
        const tcPr = tcEl.getElementsByTagNameNS(W, 'tcPr')[0];
        let colSpan = 1;
        let vMerge: 'restart' | 'continue' | undefined;
        let cellProps: ReturnType<typeof mapTableCellProperties> = {};
        if (tcPr) {
          cellProps = mapTableCellProperties(tcPr);
          if (cellProps.colSpan) colSpan = cellProps.colSpan;
          vMerge = cellProps.vMerge;
        }

        // Clamp colSpan to the remaining grid room. A malformed or
        // partially-edited docx can declare a gridSpan that overruns
        // numCols; without clamping, colIdx walks past the grid and
        // the row ends up longer than every other row. When tblGrid
        // is missing numCols is 0 and we leave the span alone.
        if (numCols > 0 && colIdx + colSpan > numCols) {
          colSpan = Math.max(1, numCols - colIdx);
        }

        // Handle vertical merge tracking
        if (vMerge === 'restart') {
          // If a previous group is still open for this column, close it
          // before starting a new one.
          const existing = vMergeTracker.get(colIdx);
          if (existing) resolveVMergeGroup(colIdx, existing);
          vMergeTracker.set(colIdx, {
            startRow: rows.length,
            count: 1,
            colSpan,
          });
        } else if (vMerge === 'continue') {
          const tracker = vMergeTracker.get(colIdx);
          if (tracker) {
            tracker.count++;
            // Mark as covered cells. A vMerge=continue tc can also have
            // gridSpan > 1, in which case every grid column it covers
            // must get its own placeholder so the row's cells array
            // stays aligned with numCols. If the continue cell
            // disagrees with the owner's span (Word can emit this when
            // the author edits a merged range without touching the
            // continuation), widen the placeholder count to the
            // owner's colSpan so the row still covers every merged
            // grid position — then clamp to the remaining grid room.
            let effectiveSpan = Math.max(colSpan, tracker.colSpan);
            if (numCols > 0 && colIdx + effectiveSpan > numCols) {
              effectiveSpan = Math.max(1, numCols - colIdx);
            }
            for (let s = 0; s < effectiveSpan; s++) {
              cells.push(makeCoveredCell());
            }
            colIdx += effectiveSpan;
            continue;
          }
          // Orphan continue: the column never saw a restart. Some
          // writers leave continuation cells behind when the anchor row
          // is deleted; fall through and treat the tc as a standalone
          // owner so its grid positions stay reachable instead of
          // becoming unclaimed covered placeholders.
        }

        // Parse cell content blocks
        const cellBlocks: Block[] = [];
        for (let k = 0; k < tcEl.childNodes.length; k++) {
          const childNode = tcEl.childNodes[k];
          if (childNode.nodeType !== 1) continue;
          const childEl = childNode as Element;
          if (childEl.localName === 'p') {
            cellBlocks.push(DocxImporter.convertParagraph(childEl, imageUrls));
          } else if (childEl.localName === 'tbl') {
            // Nested table → flatten to text
            cellBlocks.push(DocxImporter.convertTable(childEl, imageUrls, true));
          }
        }
        if (cellBlocks.length === 0) {
          cellBlocks.push({
            id: generateBlockId(),
            type: 'paragraph',
            inlines: [{ text: '', style: {} }],
            style: { ...DEFAULT_BLOCK_STYLE },
          });
        }

        cells.push({
          blocks: cellBlocks,
          style: {
            ...DEFAULT_CELL_STYLE,
            backgroundColor: cellProps.backgroundColor,
            borderTop: cellProps.borderTop,
            borderBottom: cellProps.borderBottom,
            borderLeft: cellProps.borderLeft,
            borderRight: cellProps.borderRight,
          },
          colSpan: colSpan > 1 ? colSpan : undefined,
        });
        // Pad placeholders for horizontal merge so cells.length === numCols.
        // Downstream layout, rendering, and click handling all index
        // row.cells[c] by grid column and rely on `colSpan === 0` to mark
        // covered positions; without this, clicks on the right part of a
        // merged cell resolve to an undefined entry and the cursor cannot
        // land inside the merged cell.
        for (let s = 1; s < colSpan; s++) {
          cells.push(makeCoveredCell());
        }
        colIdx += colSpan;
      }
      for (let s = 0; s < gridAfter; s++) cells.push(makeCoveredCell());
      // Safety net: after honoring gridBefore/gridAfter and clamping
      // each owner span, the row should already be numCols long. If
      // upstream markup disagrees (short row with no gridAfter, extra
      // tcs that ran off the end, partially-edited fixtures), force
      // the row back to numCols so downstream layout and rendering
      // can trust cells.length === columnWidths.length.
      if (numCols > 0) {
        while (cells.length < numCols) cells.push(makeCoveredCell());
        if (cells.length > numCols) cells.length = numCols;
      }
      rows.push({ cells });
    }

    // Resolve any still-open vMerge groups at end of table.
    for (const [colIdx, tracker] of vMergeTracker) {
      resolveVMergeGroup(colIdx, tracker);
    }

    const tableData: TableData = { rows, columnWidths };

    return {
      id: generateBlockId(),
      type: 'table',
      inlines: [],
      style: { ...DEFAULT_BLOCK_STYLE },
      tableData,
    };
  }

  /**
   * Read the integer value of a <w:trPr> skip marker such as
   * <w:gridBefore w:val="2"/> or <w:gridAfter w:val="2"/>. A missing
   * element, missing w:val, or non-positive parse returns 0 so callers
   * can add the result unconditionally to the cells array length.
   */
  private static readGridSkip(trPr: Element, localName: string): number {
    const el = DocxImporter.findDirectChild(trPr, localName);
    if (!el) return 0;
    const val = el.getAttributeNS(W, 'val') || el.getAttribute('w:val');
    if (!val) return 0;
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  /**
   * Return the first direct-child element with the given local name, or
   * null. Unlike getElementsByTagNameNS this does not recurse, which is
   * what we want for table structure lookups where nested tables must
   * stay fully scoped to their own walk.
   */
  private static findDirectChild(parent: Element, localName: string): Element | null {
    for (let i = 0; i < parent.childNodes.length; i++) {
      const n = parent.childNodes[i];
      if (n.nodeType === 1 && (n as Element).localName === localName) {
        return n as Element;
      }
    }
    return null;
  }

  private static extractText(el: Element): string {
    const texts: string[] = [];
    const tEls = el.getElementsByTagNameNS(W, 't');
    for (let i = 0; i < tEls.length; i++) {
      texts.push(tEls[i].textContent || '');
    }
    return texts.join('');
  }

  /**
   * Walk the image relationships of a single .rels file and upload each
   * referenced image via the caller-supplied uploader. Image relationship
   * targets are resolved relative to the parent directory of the owning
   * part (e.g. word/_rels/header1.xml.rels → word/media/image1.png).
   *
   * imageUrls is a map scoped to the same rels file because OOXML rIds
   * are only unique within a given .rels document; collisions between
   * document.xml.rels and header1.xml.rels are legal.
   */
  private static async uploadImages(
    zip: JSZip,
    rels: Map<string, RelEntry>,
    baseDir: string,
    uploader: ImageUploader,
    imageUrls: Map<string, ResolvedImage>,
  ): Promise<void> {
    for (const [rId, rel] of rels) {
      if (rel.type !== 'image') continue;
      const path = `${baseDir}${rel.target}`;
      const file = zip.file(path);
      if (!file) continue;

      // JSZip returns a Blob with an empty `type`. When posted via FormData
      // the multipart Content-Type defaults to application/octet-stream,
      // which the backend image endpoint rejects with 400. Repackage the
      // bytes with a MIME derived from the .rels target extension so the
      // upload carries a concrete image/* type.
      const raw = await file.async('blob');
      const ext = (rel.target.split('.').pop() || 'png').toLowerCase();
      const mime = EXT_TO_IMAGE_MIME[ext];
      const data = mime ? new Blob([raw], { type: mime }) : raw;
      const filename = `${rId}.${ext}`;
      const url = await uploader(data, filename);

      // Dimensions are filled per-reference in convertParagraph using the
      // <wp:extent> cx/cy values returned by parseParagraph.
      imageUrls.set(rId, { src: url, width: 0, height: 0 });
    }
  }

  /**
   * Parse a specific header/footer part and return its blocks. The caller
   * resolves the part path from the active <w:sectPr> so that real Word
   * documents — which may have multiple unused header/footer rels — land
   * on the actual referenced part rather than the first match in
   * iteration order.
   *
   * This also parses the part-local .rels file and uploads any images
   * referenced from the header/footer into a scoped imageUrls map so that
   * rId collisions with document.xml.rels do not bleed across parts.
   */
  private static async parseHeaderFooter(
    zip: JSZip,
    type: 'header' | 'footer',
    targetFile: string | undefined,
    imageUploader: ImageUploader | undefined,
  ): Promise<HeaderFooter | undefined> {
    if (!targetFile) return undefined;

    const xml = await zip.file(targetFile)?.async('string');
    if (!xml) return undefined;

    // Load the part-scoped rels file and upload any referenced images.
    // Example: targetFile = "word/header1.xml" →
    //          relsPath   = "word/_rels/header1.xml.rels"
    const baseDir = relsDirFor(targetFile);
    const partFilename = targetFile.slice(baseDir.length);
    const relsPath = `${baseDir}_rels/${partFilename}.rels`;
    const relsXml = await zip.file(relsPath)?.async('string');
    const partRels = relsXml ? parseRelationships(relsXml) : new Map<string, RelEntry>();

    const partImageUrls = new Map<string, ResolvedImage>();
    if (imageUploader) {
      await DocxImporter.uploadImages(zip, partRels, baseDir, imageUploader, partImageUrls);
    }

    const xmlDoc = new DOMParser().parseFromString(xml, 'text/xml');
    const rootTag = type === 'header' ? 'hdr' : 'ftr';
    const root = xmlDoc.getElementsByTagNameNS(W, rootTag)[0];
    if (!root) return undefined;

    const blocks: Block[] = [];
    for (let i = 0; i < root.childNodes.length; i++) {
      const node = root.childNodes[i];
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      if (el.localName === 'p') {
        blocks.push(DocxImporter.convertParagraph(el, partImageUrls));
      }
    }

    if (blocks.length === 0) return undefined;

    return { blocks, marginFromEdge: DEFAULT_HEADER_MARGIN_FROM_EDGE };
  }
}
