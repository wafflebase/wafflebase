import { describe, it, expect } from 'vitest';
import { redirectFormula } from '../../src/model/shifting';
import { Sref } from '../../src/model/types';

describe('redirectFormula', () => {
  it('should redirect a single cell reference', () => {
    const refMap = new Map<Sref, Sref>([['A1', 'C3']]);
    expect(redirectFormula('=A1+10', refMap)).toBe('=C3+10');
  });

  it('should redirect multiple references', () => {
    const refMap = new Map<Sref, Sref>([
      ['A1', 'C1'],
      ['B1', 'D1'],
    ]);
    expect(redirectFormula('=A1+B1', refMap)).toBe('=C1+D1');
  });

  it('should leave unmapped references unchanged', () => {
    const refMap = new Map<Sref, Sref>([['A1', 'C3']]);
    expect(redirectFormula('=A1+B2', refMap)).toBe('=C3+B2');
  });

  it('should redirect range references when both endpoints are mapped', () => {
    const refMap = new Map<Sref, Sref>([
      ['A1', 'C1'],
      ['A3', 'C3'],
    ]);
    expect(redirectFormula('=SUM(A1:A3)', refMap)).toBe('=SUM(C1:C3)');
  });

  it('should leave range references unchanged when only one endpoint is mapped', () => {
    const refMap = new Map<Sref, Sref>([['A1', 'C1']]);
    expect(redirectFormula('=SUM(A1:A3)', refMap)).toBe('=SUM(A1:A3)');
  });

  it('should not redirect cross-sheet references', () => {
    const refMap = new Map<Sref, Sref>([['A1', 'C3']]);
    expect(redirectFormula('=Sheet2!A1+A1', refMap)).toBe('=Sheet2!A1+C3');
  });

  it('should return formula unchanged when no references match', () => {
    const refMap = new Map<Sref, Sref>([['Z99', 'A1']]);
    expect(redirectFormula('=A1+B2', refMap)).toBe('=A1+B2');
  });

  it('should handle case-insensitive references', () => {
    const refMap = new Map<Sref, Sref>([['A1', 'C3']]);
    expect(redirectFormula('=a1+10', refMap)).toBe('=C3+10');
  });
});
