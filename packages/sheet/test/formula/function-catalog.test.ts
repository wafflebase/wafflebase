import { describe, it, expect } from 'vitest';
import {
  searchFunctions,
  findFunction,
  formatSignature,
  FunctionCatalog,
} from '../../src/formula/function-catalog';

describe('FunctionCatalog', () => {
  describe('searchFunctions', () => {
    it('should find functions by prefix (case-insensitive)', () => {
      const results = searchFunctions('su');
      const names = results.map((r) => r.name);
      expect(names).toContain('SUM');
      expect(names).toContain('SUBSTITUTE');
    });

    it('should find multiple matches', () => {
      const results = searchFunctions('');
      expect(results).toHaveLength(FunctionCatalog.length);
    });

    it('should return empty for non-matching prefix', () => {
      const results = searchFunctions('XYZ');
      expect(results).toHaveLength(0);
    });

    it('should match case-insensitively', () => {
      expect(searchFunctions('sum')).toHaveLength(1);
      expect(searchFunctions('Sum')).toHaveLength(1);
      expect(searchFunctions('SUM')).toHaveLength(1);
    });

    it('should find OR and NOT but not AND with "O"', () => {
      const results = searchFunctions('O');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('OR');
    });

    it('should find AND and AVERAGE with "A"', () => {
      const results = searchFunctions('A');
      const names = results.map((r) => r.name);
      expect(names).toContain('AND');
      expect(names).toContain('AVERAGE');
    });
  });

  describe('findFunction', () => {
    it('should find function by exact name', () => {
      const info = findFunction('SUM');
      expect(info).toBeDefined();
      expect(info!.name).toBe('SUM');
    });

    it('should find function case-insensitively', () => {
      const info = findFunction('sum');
      expect(info).toBeDefined();
      expect(info!.name).toBe('SUM');
    });

    it('should find newly added functions', () => {
      expect(findFunction('ABS')!.name).toBe('ABS');
      expect(findFunction('ROUND')!.name).toBe('ROUND');
      expect(findFunction('SUBSTITUTE')!.name).toBe('SUBSTITUTE');
    });

    it('should return undefined for unknown function', () => {
      expect(findFunction('UNKNOWN')).toBeUndefined();
    });
  });

  describe('formatSignature', () => {
    it('should format SUM signature', () => {
      const info = findFunction('SUM')!;
      expect(formatSignature(info)).toBe('SUM(number1, [number2], ...)');
    });

    it('should format IF signature', () => {
      const info = findFunction('IF')!;
      expect(formatSignature(info)).toBe(
        'IF(condition, value_if_true, [value_if_false])',
      );
    });

    it('should format NOT signature', () => {
      const info = findFunction('NOT')!;
      expect(formatSignature(info)).toBe('NOT(logical)');
    });

    it('should format ROUND signature', () => {
      const info = findFunction('ROUND')!;
      expect(formatSignature(info)).toBe('ROUND(value, [places])');
    });

    it('should format SUBSTITUTE signature', () => {
      const info = findFunction('SUBSTITUTE')!;
      expect(formatSignature(info)).toBe(
        'SUBSTITUTE(text, search_for, replace_with, [occurrence])',
      );
    });
  });
});
