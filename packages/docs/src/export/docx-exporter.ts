import JSZip from 'jszip';
import type { Document, Block, Inline, TableData, PageSetup, HeaderFooter } from '../model/types.js';
import { DEFAULT_PAGE_SETUP } from '../model/types.js';
import { buildRunPropertiesXml, buildParagraphPropertiesXml } from './docx-style-map.js';
import { pxToTwips, pxToEmus } from '../import/units.js';
import { CONTENT_TYPES, ROOT_RELS, STYLES, DOC_RELS } from './docx-templates.js';

export type ImageFetcher = (url: string) => Promise<Blob>;

type ImageEntry = { rId: string; path: string; ext: string; src: string };

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

function deriveExt(blob: Blob): string {
  const mime = blob.type.toLowerCase();
  return MIME_TO_EXT[mime] || 'bin';
}

export class DocxExporter {
  /**
   * Export a Document to a .docx Blob.
   *
   * @param doc - The document to export.
   * @param imageFetcher - Required when the document contains image inlines.
   *   Called once per unique image src to fetch the raw image Blob. If omitted
   *   and the document contains image inlines, export will throw.
   */
  static async export(
    doc: Document,
    imageFetcher?: ImageFetcher,
  ): Promise<Blob> {
    const zip = new JSZip();
    // rIds are scoped per .rels file in OOXML, so give each part its own
    // counter and entry list. Header and footer images live in separate
    // `.rels` documents from the main document's image relationships.
    // The media filename counter is shared across parts so that header
    // and footer media do not collide with main-document media in the
    // `word/media/` directory.
    const docImageEntries: ImageEntry[] = [];
    const headerImageEntries: ImageEntry[] = [];
    const footerImageEntries: ImageEntry[] = [];
    const makeCounter = () => {
      let n = 10; // Start after reserved IDs
      return () => `rId${n++}`;
    };
    const nextDocRId = makeCounter();
    const nextHeaderRId = makeCounter();
    const nextFooterRId = makeCounter();
    let mediaSeq = 0;
    const nextMediaName = (ext: string) => `media/image_${++mediaSeq}.${ext}`;

    // Collect and fetch images referenced from the main document body.
    if (imageFetcher) {
      for (const block of doc.blocks) {
        await DocxExporter.collectImages(block, imageFetcher, zip, docImageEntries, nextDocRId, nextMediaName);
      }
    }

    // Build header/footer. Each part's rels file uses rIds for the
    // header/footer parts as well as any image relationships referenced
    // from within that part.
    const hfContentTypes: string[] = [];
    let headerRId: string | undefined;
    let footerRId: string | undefined;

    if (doc.header && doc.header.blocks.length > 0) {
      headerRId = nextDocRId();
      if (imageFetcher) {
        for (const block of doc.header.blocks) {
          await DocxExporter.collectImages(block, imageFetcher, zip, headerImageEntries, nextHeaderRId, nextMediaName);
        }
      }
      const headerXml = DocxExporter.buildHeaderFooterXml(doc.header, 'header', headerImageEntries);
      zip.file('word/header1.xml', headerXml);
      zip.file('word/_rels/header1.xml.rels', DocxExporter.buildPartRelsXml(headerImageEntries));
      hfContentTypes.push(`  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`);
    }
    if (doc.footer && doc.footer.blocks.length > 0) {
      footerRId = nextDocRId();
      if (imageFetcher) {
        for (const block of doc.footer.blocks) {
          await DocxExporter.collectImages(block, imageFetcher, zip, footerImageEntries, nextFooterRId, nextMediaName);
        }
      }
      const footerXml = DocxExporter.buildHeaderFooterXml(doc.footer, 'footer', footerImageEntries);
      zip.file('word/footer1.xml', footerXml);
      zip.file('word/_rels/footer1.xml.rels', DocxExporter.buildPartRelsXml(footerImageEntries));
      hfContentTypes.push(`  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`);
    }

    // Assemble document.xml.rels: image relationships for the main body
    // plus any header/footer part relationships (header/footer image
    // rels live in their own .rels files, not here).
    const docRels: string[] = [];
    for (const e of docImageEntries) {
      docRels.push(`  <Relationship Id="${e.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${e.path}"/>`);
    }
    if (headerRId) {
      docRels.push(`  <Relationship Id="${headerRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>`);
    }
    if (footerRId) {
      docRels.push(`  <Relationship Id="${footerRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`);
    }

    // Build document.xml
    const bodyXml = doc.blocks.map((b) => DocxExporter.blockToXml(b, docImageEntries)).join('\n');
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

    zip.file('word/_rels/document.xml.rels', DOC_RELS(docRels.join('\n')));
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
      if (!entry) {
        throw new Error(
          `DOCX export: image inline references ${inline.style.image.src} but no matching media entry was collected. ` +
          `Did you forget to pass an imageFetcher to DocxExporter.export()?`,
        );
      }
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

  private static buildHeaderFooterXml(
    hf: HeaderFooter,
    type: 'header' | 'footer',
    imageEntries: ImageEntry[],
  ): string {
    const tag = type === 'header' ? 'hdr' : 'ftr';
    const blocks = hf.blocks.map((b) => DocxExporter.blockToXml(b, imageEntries)).join('\n');
    // Include the drawing-related namespaces so that any embedded
    // <w:drawing> emitted by inlineToXml resolves correctly.
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:${tag} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
          xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
          xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
${blocks}
</w:${tag}>`;
  }

  /**
   * Build a part-scoped .rels file containing the given image
   * relationships. Used for `word/_rels/header1.xml.rels` and
   * `word/_rels/footer1.xml.rels` so that images referenced from header
   * or footer parts resolve correctly when opened in Word.
   */
  private static buildPartRelsXml(imageEntries: ImageEntry[]): string {
    const rels = imageEntries
      .map(
        (e) =>
          `  <Relationship Id="${e.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${e.path}"/>`,
      )
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels}
</Relationships>`;
  }

  private static async collectImages(
    block: Block,
    fetcher: ImageFetcher,
    zip: JSZip,
    entries: ImageEntry[],
    nextRId: () => string,
    nextMediaName: (ext: string) => string,
  ): Promise<void> {
    for (const inline of block.inlines) {
      if (inline.style.image) {
        const src = inline.style.image.src;
        // Skip if this src was already fetched for the same part (dedupe).
        if (entries.some((e) => e.src === src)) continue;
        const blob = await fetcher(src);
        const ext = deriveExt(blob);
        const rId = nextRId();
        const path = nextMediaName(ext);
        zip.file(`word/${path}`, blob);
        entries.push({ rId, path, ext, src });
      }
    }
    // Also check table cells
    if (block.tableData) {
      for (const row of block.tableData.rows) {
        for (const cell of row.cells) {
          for (const cellBlock of cell.blocks) {
            await DocxExporter.collectImages(cellBlock, fetcher, zip, entries, nextRId, nextMediaName);
          }
        }
      }
    }
  }
}
