import { describe, it, expect } from 'vitest';
import { detectTableBorder } from '../../src/view/table-resize.js';
import { computeTableLayout } from '../../src/view/table-layout.js';
import { createTableBlock } from '../../src/model/types.js';

function stubCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as unknown as CanvasRenderingContext2D;
}

function makeLayout() {
  const block = createTableBlock(3, 3);
  block.tableData!.columnWidths = [1 / 3, 1 / 3, 1 / 3];
  return computeTableLayout(block.tableData!, 'tbl', stubCtx(), 300);
}

describe('detectTableBorder', () => {
  it('should detect column border between col 0 and col 1', () => {
    const layout = makeLayout();
    const hit = detectTableBorder(layout, 101, 10);
    expect(hit).not.toBeNull();
    expect(hit!.type).toBe('column');
    expect(hit!.index).toBe(0);
  });

  it('should detect column border between col 1 and col 2', () => {
    const layout = makeLayout();
    const hit = detectTableBorder(layout, 199, 10);
    expect(hit).not.toBeNull();
    expect(hit!.type).toBe('column');
    expect(hit!.index).toBe(1);
  });

  it('should not detect left edge of first column', () => {
    const layout = makeLayout();
    const hit = detectTableBorder(layout, 1, 10);
    expect(hit).toBeNull();
  });

  it('should not detect right edge of last column', () => {
    const layout = makeLayout();
    const hit = detectTableBorder(layout, 299, 10);
    expect(hit).toBeNull();
  });

  it('should detect row border between row 0 and row 1', () => {
    const layout = makeLayout();
    const borderY = layout.rowYOffsets[1];
    const hit = detectTableBorder(layout, 50, borderY + 1);
    expect(hit).not.toBeNull();
    expect(hit!.type).toBe('row');
    expect(hit!.index).toBe(0);
  });

  it('should not detect top edge of first row', () => {
    const layout = makeLayout();
    const hit = detectTableBorder(layout, 50, 1);
    expect(hit).toBeNull();
  });

  it('should detect bottom edge of last row for height adjustment', () => {
    const layout = makeLayout();
    const bottomY = layout.totalHeight;
    const hit = detectTableBorder(layout, 50, bottomY - 1);
    expect(hit).not.toBeNull();
    expect(hit!.type).toBe('row');
    expect(hit!.index).toBe(2);
  });

  it('should return null when not near any border', () => {
    const layout = makeLayout();
    const hit = detectTableBorder(layout, 50, 10);
    expect(hit).toBeNull();
  });

  it('should prioritize column over row at intersection', () => {
    const layout = makeLayout();
    const borderY = layout.rowYOffsets[1];
    const hit = detectTableBorder(layout, 101, borderY + 1);
    expect(hit).not.toBeNull();
    expect(hit!.type).toBe('column');
  });
});
