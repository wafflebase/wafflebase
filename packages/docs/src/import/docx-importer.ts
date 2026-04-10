import JSZip from 'jszip';
import type { Document, Block, Inline, TableData, TableRow, TableCell, HeaderFooter, PageSetup } from '../model/types.js';
import { generateBlockId, DEFAULT_BLOCK_STYLE, DEFAULT_CELL_STYLE, DEFAULT_HEADER_MARGIN_FROM_EDGE } from '../model/types.js';
import { parseRelationships, parseParagraph, parsePageSetup, type RelEntry } from './docx-parser.js';
import { mapTableCellProperties } from './docx-style-map.js';
import { emusToPx } from './units.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

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

    // Parse grid columns for widths
    const gridCols = tblEl.getElementsByTagNameNS(W, 'gridCol');
    const colWidthsRaw: number[] = [];
    for (let i = 0; i < gridCols.length; i++) {
      const w = gridCols[i].getAttributeNS(W, 'w') || gridCols[i].getAttribute('w:w');
      colWidthsRaw.push(w ? parseInt(w, 10) : 1);
    }
    const totalWidth = colWidthsRaw.reduce((a, b) => a + b, 0) || 1;
    const columnWidths = colWidthsRaw.map((w) => w / totalWidth);

    // Parse rows — only direct child <w:tr> elements
    const rows: TableRow[] = [];
    // Track the currently-open vMerge group per column. Each group is
    // resolved (its rowSpan written) either when the column starts a new
    // group or at the end after all rows are walked. This handles multiple
    // stacked vMerge groups in the same column without overwriting earlier
    // trackers.
    const vMergeTracker: Map<number, { startRow: number; count: number }> = new Map();
    const resolveVMergeGroup = (
      colIdx: number,
      tracker: { startRow: number; count: number },
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

      const cells: TableCell[] = [];
      let colIdx = 0;
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

        // Handle vertical merge tracking
        if (vMerge === 'restart') {
          // If a previous group is still open for this column, close it
          // before starting a new one.
          const existing = vMergeTracker.get(colIdx);
          if (existing) resolveVMergeGroup(colIdx, existing);
          vMergeTracker.set(colIdx, { startRow: rows.length, count: 1 });
        } else if (vMerge === 'continue') {
          const tracker = vMergeTracker.get(colIdx);
          if (tracker) tracker.count++;
          // Mark as covered cell
          cells.push({
            blocks: [{ id: generateBlockId(), type: 'paragraph', inlines: [{ text: '', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }],
            style: { ...DEFAULT_CELL_STYLE },
            colSpan: 0, // Covered
          });
          colIdx += colSpan;
          continue;
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
        colIdx += colSpan;
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

      const data = await file.async('blob');
      const ext = rel.target.split('.').pop() || 'png';
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
