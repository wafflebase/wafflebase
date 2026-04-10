import JSZip from 'jszip';
import type { Document, Block, Inline, TableData, PageSetup, HeaderFooter } from '../model/types.js';
import { DEFAULT_PAGE_SETUP } from '../model/types.js';
import { buildRunPropertiesXml, buildParagraphPropertiesXml } from './docx-style-map.js';
import { pxToTwips, pxToEmus } from '../import/units.js';
import { CONTENT_TYPES, ROOT_RELS, STYLES, DOC_RELS } from './docx-templates.js';

export type ImageFetcher = (url: string) => Promise<Blob>;

type ImageEntry = { rId: string; path: string; ext: string; src: string };

export class DocxExporter {
  /**
   * Export a Document to a .docx Blob.
   */
  static async export(
    doc: Document,
    imageFetcher?: ImageFetcher,
  ): Promise<Blob> {
    const zip = new JSZip();
    const imageEntries: ImageEntry[] = [];
    let rIdCounter = 10; // Start after reserved IDs

    // Collect and fetch images
    if (imageFetcher) {
      for (const block of doc.blocks) {
        await DocxExporter.collectImages(block, imageFetcher, zip, imageEntries, () => `rId${rIdCounter++}`);
      }
    }

    // Build header/footer
    const hfRels: string[] = [];
    const hfContentTypes: string[] = [];
    let headerRId: string | undefined;
    let footerRId: string | undefined;

    if (doc.header && doc.header.blocks.length > 0) {
      headerRId = `rId${rIdCounter++}`;
      const headerXml = DocxExporter.buildHeaderFooterXml(doc.header, 'header');
      zip.file('word/header1.xml', headerXml);
      hfRels.push(`  <Relationship Id="${headerRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>`);
      hfContentTypes.push(`  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`);
    }
    if (doc.footer && doc.footer.blocks.length > 0) {
      footerRId = `rId${rIdCounter++}`;
      const footerXml = DocxExporter.buildHeaderFooterXml(doc.footer, 'footer');
      zip.file('word/footer1.xml', footerXml);
      hfRels.push(`  <Relationship Id="${footerRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`);
      hfContentTypes.push(`  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`);
    }

    // Build document.xml
    const bodyXml = doc.blocks.map((b) => DocxExporter.blockToXml(b, imageEntries)).join('\n');
    const sectPr = DocxExporter.buildSectPrXml(doc.pageSetup ?? DEFAULT_PAGE_SETUP, headerRId, footerRId);
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
${bodyXml}
    ${sectPr}
  </w:body>
</w:document>`;

    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', STYLES);

    // Relationships
    const imageRels = imageEntries.map((e) =>
      `  <Relationship Id="${e.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${e.path}"/>`
    );
    zip.file('word/_rels/document.xml.rels', DOC_RELS([...imageRels, ...hfRels].join('\n')));
    zip.file('_rels/.rels', ROOT_RELS);
    zip.file('[Content_Types].xml', CONTENT_TYPES(hfContentTypes.join('\n')));

    // Generate as an ArrayBuffer first, then wrap in a Blob. This avoids
    // environment-specific issues where a JSZip-produced Blob may not
    // implement Blob.prototype.arrayBuffer (notably in jsdom).
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    return new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  private static blockToXml(
    block: Block,
    imageEntries: ImageEntry[],
  ): string {
    if (block.type === 'table' && block.tableData) {
      return DocxExporter.tableToXml(block.tableData, imageEntries);
    }
    if (block.type === 'page-break') {
      return `    <w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
    }
    if (block.type === 'horizontal-rule') {
      return `    <w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>`;
    }

    const pPr = buildParagraphPropertiesXml(
      block.style,
      block.type === 'heading' ? block.headingLevel : undefined,
    );
    const runs = block.inlines.map((inline) => DocxExporter.inlineToXml(inline, imageEntries)).join('');
    return `    <w:p>${pPr}${runs}</w:p>`;
  }

  private static inlineToXml(
    inline: Inline,
    imageEntries: ImageEntry[],
  ): string {
    // Image inline
    if (inline.style.image) {
      const entry = imageEntries.find((e) => e.src === inline.style.image!.src);
      if (entry) {
        const cx = pxToEmus(inline.style.image.width);
        const cy = pxToEmus(inline.style.image.height);
        return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
          <wp:extent cx="${cx}" cy="${cy}"/>
          <wp:docPr id="1" name="Image"/>
          <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Image"/><pic:cNvPicPr/></pic:nvPicPr>
            <pic:blipFill><a:blip r:embed="${entry.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
            <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>
          </a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
      }
    }

    // Regular text run
    const rPr = buildRunPropertiesXml(inline.style);
    const escapedText = inline.text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<w:r>${rPr}<w:t xml:space="preserve">${escapedText}</w:t></w:r>`;
  }

  private static tableToXml(
    tableData: TableData,
    imageEntries: ImageEntry[],
  ): string {
    // Compute grid col widths in twips (assume total page width ~9000 twips)
    const totalTwips = 9000;
    const gridCols = tableData.columnWidths
      .map((w) => `<w:gridCol w:w="${Math.round(w * totalTwips)}"/>`)
      .join('');

    const rows = tableData.rows.map((row) => {
      const cells = row.cells.map((cell) => {
        if (cell.colSpan === 0) {
          // Covered cell (vMerge continue)
          return `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`;
        }

        const tcPrParts: string[] = [];
        if (cell.colSpan && cell.colSpan > 1) tcPrParts.push(`<w:gridSpan w:val="${cell.colSpan}"/>`);
        if (cell.rowSpan && cell.rowSpan > 1) tcPrParts.push(`<w:vMerge w:val="restart"/>`);
        if (cell.style.backgroundColor) {
          const hex = cell.style.backgroundColor.replace('#', '');
          tcPrParts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex}"/>`);
        }
        const tcPr = tcPrParts.length > 0 ? `<w:tcPr>${tcPrParts.join('')}</w:tcPr>` : '';

        const cellContent = cell.blocks
          .map((b) => DocxExporter.blockToXml(b, imageEntries))
          .join('');
        return `<w:tc>${tcPr}${cellContent || '<w:p/>'}</w:tc>`;
      }).join('');
      return `<w:tr>${cells}</w:tr>`;
    }).join('');

    return `    <w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${gridCols}</w:tblGrid>${rows}</w:tbl>`;
  }

  private static buildSectPrXml(
    setup: PageSetup,
    headerRId?: string,
    footerRId?: string,
  ): string {
    const w = pxToTwips(setup.paperSize.width);
    const h = pxToTwips(setup.paperSize.height);
    const orient = setup.orientation === 'landscape' ? ' w:orient="landscape"' : '';
    const pgSz = `<w:pgSz w:w="${w}" w:h="${h}"${orient}/>`;
    const pgMar = `<w:pgMar w:top="${pxToTwips(setup.margins.top)}" w:right="${pxToTwips(setup.margins.right)}" w:bottom="${pxToTwips(setup.margins.bottom)}" w:left="${pxToTwips(setup.margins.left)}" w:header="720" w:footer="720"/>`;

    const refs: string[] = [];
    if (headerRId) refs.push(`<w:headerReference w:type="default" r:id="${headerRId}"/>`);
    if (footerRId) refs.push(`<w:footerReference w:type="default" r:id="${footerRId}"/>`);

    return `<w:sectPr>${refs.join('')}${pgSz}${pgMar}</w:sectPr>`;
  }

  private static buildHeaderFooterXml(hf: HeaderFooter, type: 'header' | 'footer'): string {
    const tag = type === 'header' ? 'hdr' : 'ftr';
    const blocks = hf.blocks.map((b) => DocxExporter.blockToXml(b, [])).join('\n');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:${tag} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${blocks}
</w:${tag}>`;
  }

  private static async collectImages(
    block: Block,
    fetcher: ImageFetcher,
    zip: JSZip,
    entries: ImageEntry[],
    nextRId: () => string,
  ): Promise<void> {
    for (const inline of block.inlines) {
      if (inline.style.image) {
        const src = inline.style.image.src;
        // Skip if this src was already fetched (dedupe).
        if (entries.some((e) => e.src === src)) continue;
        const blob = await fetcher(src);
        const ext = (src.split('.').pop() || 'png').toLowerCase().split('?')[0];
        const rId = nextRId();
        const path = `media/image_${rId}.${ext}`;
        zip.file(`word/${path}`, blob);
        entries.push({ rId, path, ext, src });
      }
    }
    // Also check table cells
    if (block.tableData) {
      for (const row of block.tableData.rows) {
        for (const cell of row.cells) {
          for (const cellBlock of cell.blocks) {
            await DocxExporter.collectImages(cellBlock, fetcher, zip, entries, nextRId);
          }
        }
      }
    }
  }
}
