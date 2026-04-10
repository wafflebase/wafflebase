import JSZip from 'jszip';
import type { Document, Block, TableData, TableRow, TableCell, HeaderFooter, PageSetup } from '../model/types.js';
import { generateBlockId, DEFAULT_BLOCK_STYLE, DEFAULT_CELL_STYLE, DEFAULT_HEADER_MARGIN_FROM_EDGE } from '../model/types.js';
import { parseRelationships, parseParagraph, parsePageSetup, type RelEntry } from './docx-parser.js';
import { mapTableCellProperties } from './docx-style-map.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export type ImageUploader = (blob: Blob, filename: string) => Promise<string>;

type ResolvedImage = { src: string; width: number; height: number };

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

    // Parse relationships
    const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
    const rels = relsXml ? parseRelationships(relsXml) : new Map<string, RelEntry>();

    // Parse document.xml
    const docXml = await zip.file('word/document.xml')?.async('string');
    if (!docXml) throw new Error('Invalid .docx: missing word/document.xml');
    const xmlDoc = new DOMParser().parseFromString(docXml, 'text/xml');
    const body = xmlDoc.getElementsByTagNameNS(W, 'body')[0];
    if (!body) throw new Error('Invalid .docx: missing w:body');

    // Upload images
    const imageUrls = new Map<string, ResolvedImage>();
    if (imageUploader) {
      await DocxImporter.uploadImages(zip, rels, imageUploader, imageUrls);
    }

    // Walk body children
    const blocks: Block[] = [];
    let pageSetup: PageSetup | undefined;
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
      }
    }

    // Parse headers and footers
    const header = await DocxImporter.parseHeaderFooter(zip, rels, 'header', imageUrls);
    const footer = await DocxImporter.parseHeaderFooter(zip, rels, 'footer', imageUrls);

    return { blocks, pageSetup, header, footer };
  }

  private static convertParagraph(
    pEl: Element,
    imageUrls: Map<string, ResolvedImage>,
  ): Block {
    const { inlines, blockStyle, blockType, headingLevel } = parseParagraph(pEl);

    // Resolve pending image references
    const resolvedInlines = inlines.map((inline) => {
      if (inline.style.image?.src.startsWith('__pending__:')) {
        const rId = inline.style.image.src.replace('__pending__:', '');
        const img = imageUrls.get(rId);
        if (img) {
          return {
            text: inline.text,
            style: { ...inline.style, image: img },
          };
        }
      }
      return inline;
    });

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
    // If nested, flatten to a paragraph with text content
    if (isNested) {
      const texts: string[] = [];
      const trs = tblEl.getElementsByTagNameNS(W, 'tr');
      for (let r = 0; r < trs.length; r++) {
        const rowTexts: string[] = [];
        const tcs = trs[r].getElementsByTagNameNS(W, 'tc');
        for (let c = 0; c < tcs.length; c++) {
          const cellText = DocxImporter.extractText(tcs[c]);
          rowTexts.push(cellText);
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
    const vMergeTracker: Map<number, { startRow: number; count: number }> = new Map();

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

    // Resolve vMerge rowSpan values
    for (const [colIdx, tracker] of vMergeTracker) {
      if (tracker.count > 1 && rows[tracker.startRow]) {
        const cell = rows[tracker.startRow].cells[colIdx];
        if (cell) cell.rowSpan = tracker.count;
      }
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

  private static async uploadImages(
    zip: JSZip,
    rels: Map<string, RelEntry>,
    uploader: ImageUploader,
    imageUrls: Map<string, ResolvedImage>,
  ): Promise<void> {
    for (const [rId, rel] of rels) {
      if (rel.type !== 'image') continue;
      const path = `word/${rel.target}`;
      const file = zip.file(path);
      if (!file) continue;

      const data = await file.async('blob');
      const ext = rel.target.split('.').pop() || 'png';
      const filename = `${rId}.${ext}`;
      const url = await uploader(data, filename);

      // We'll set dimensions later when resolving
      imageUrls.set(rId, { src: url, width: 0, height: 0 });
    }
  }

  private static async parseHeaderFooter(
    zip: JSZip,
    rels: Map<string, RelEntry>,
    type: 'header' | 'footer',
    imageUrls: Map<string, ResolvedImage>,
  ): Promise<HeaderFooter | undefined> {
    // Find the default (type 2, "default") header/footer relationship
    let targetFile: string | undefined;
    for (const [, rel] of rels) {
      if (rel.type === type) {
        targetFile = rel.target;
        break;
      }
    }
    if (!targetFile) return undefined;

    const xml = await zip.file(`word/${targetFile}`)?.async('string');
    if (!xml) return undefined;

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
        blocks.push(DocxImporter.convertParagraph(el, imageUrls));
      }
    }

    if (blocks.length === 0) return undefined;

    return { blocks, marginFromEdge: DEFAULT_HEADER_MARGIN_FROM_EDGE };
  }
}
