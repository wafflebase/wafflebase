import { describe, it, expect } from 'vitest';
import { evaluate, extractReferences } from '../../src/formula/formula';
import { Grid, Cell } from '../../src/model/types';

describe('Cross-Sheet References - Formula', () => {
  describe('extractReferences', () => {
    it('should extract simple cross-sheet reference', () => {
      const refs = extractReferences('=Sheet2!A1');
      expect(refs).toContain('SHEET2!A1');
    });

    it('should extract cross-sheet range reference', () => {
      const refs = extractReferences('=Sheet2!A1:B2');
      expect(refs).toContain('SHEET2!A1:B2');
    });

    it('should extract quoted sheet name reference', () => {
      const refs = extractReferences("='My Sheet'!A1");
      expect(refs).toContain("'MY SHEET'!A1");
    });

    it('should extract quoted sheet name range reference', () => {
      const refs = extractReferences("='My Sheet'!A1:B2");
      expect(refs).toContain("'MY SHEET'!A1:B2");
    });

    it('should extract both local and cross-sheet references', () => {
      const refs = extractReferences('=A1+Sheet2!B1');
      expect(refs).toContain('A1');
      expect(refs).toContain('SHEET2!B1');
    });

    it('should extract cross-sheet refs inside functions', () => {
      const refs = extractReferences('=SUM(Sheet2!A1:A3)');
      expect(refs).toContain('SHEET2!A1:A3');
    });
  });

  describe('evaluate with cross-sheet grid data', () => {
    it('should resolve cross-sheet single ref', () => {
      const grid: Grid = new Map<string, Cell>();
      grid.set('SHEET2!A1', { v: '42' });
      const result = evaluate('=Sheet2!A1', grid);
      expect(result).toBe('42');
    });

    it('should resolve cross-sheet ref in addition', () => {
      const grid: Grid = new Map<string, Cell>();
      grid.set('SHEET2!A1', { v: '10' });
      grid.set('A1', { v: '5' });
      const result = evaluate('=A1+Sheet2!A1', grid);
      expect(result).toBe('15');
    });

    it('should return empty string for missing cross-sheet ref', () => {
      const grid: Grid = new Map<string, Cell>();
      const result = evaluate('=Sheet2!A1', grid);
      expect(result).toBe('');
    });

    it('should evaluate SUM with cross-sheet range', () => {
      const grid: Grid = new Map<string, Cell>();
      grid.set('SHEET2!A1', { v: '1' });
      grid.set('SHEET2!A2', { v: '2' });
      grid.set('SHEET2!A3', { v: '3' });
      const result = evaluate('=SUM(Sheet2!A1:A3)', grid);
      expect(result).toBe('6');
    });

    it('should evaluate with quoted sheet name', () => {
      const grid: Grid = new Map<string, Cell>();
      grid.set("'MY SHEET'!A1", { v: '100' });
      const result = evaluate("='My Sheet'!A1", grid);
      expect(result).toBe('100');
    });
  });
});
