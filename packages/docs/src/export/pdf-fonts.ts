import type { Document, Block, Inline } from '../model/types.js';

const KR_RANGE = /[\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/;
const SERIF_FAMILIES = new Set([
  '바탕', 'Batang', 'Noto Serif KR',
  'Times New Roman', 'Times', 'Georgia',
]);

export interface FontUsage {
  needsKR: boolean;
  needsKRSerif: boolean;
  needsLatinSerif: boolean;
  needsBold: boolean;
  needsItalic: boolean;
}

export function scanFontsUsed(doc: Document): FontUsage {
  const usage: FontUsage = {
    needsKR: false, needsKRSerif: false,
    needsLatinSerif: false, needsBold: false, needsItalic: false,
  };
  const visit = (blocks: Block[]) => {
    for (const block of blocks) visitBlock(block, usage);
  };
  visit(doc.blocks);
  if (doc.header) visit(doc.header.blocks);
  if (doc.footer) visit(doc.footer.blocks);
  return usage;
}

function visitBlock(block: Block, u: FontUsage): void {
  if (block.tableData) {
    for (const row of block.tableData.rows) {
      for (const cell of row.cells) {
        for (const cellBlock of cell.blocks ?? []) visitBlock(cellBlock, u);
      }
    }
  }
  for (const inline of block.inlines) visitInline(inline, u);
}

function visitInline(inline: Inline, u: FontUsage): void {
  const hasKR = KR_RANGE.test(inline.text);
  const isSerif = SERIF_FAMILIES.has(inline.style.fontFamily ?? '');
  if (hasKR) {
    u.needsKR = true;
    if (isSerif) u.needsKRSerif = true;
  } else if (isSerif) {
    u.needsLatinSerif = true;
  }
  if (inline.style.bold) u.needsBold = true;
  if (inline.style.italic) u.needsItalic = true;
}
