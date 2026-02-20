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
      expect(searchFunctions('sum').map((f) => f.name)).toContain('SUM');
      expect(searchFunctions('Sum').map((f) => f.name)).toContain('SUM');
      expect(searchFunctions('SUM').map((f) => f.name)).toContain('SUM');
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
      expect(findFunction('IFS')!.name).toBe('IFS');
      expect(findFunction('SWITCH')!.name).toBe('SWITCH');
      expect(findFunction('TEXTJOIN')!.name).toBe('TEXTJOIN');
      expect(findFunction('COUNTIF')!.name).toBe('COUNTIF');
      expect(findFunction('SUMIF')!.name).toBe('SUMIF');
      expect(findFunction('COUNTIFS')!.name).toBe('COUNTIFS');
      expect(findFunction('SUMIFS')!.name).toBe('SUMIFS');
      expect(findFunction('MATCH')!.name).toBe('MATCH');
      expect(findFunction('INDEX')!.name).toBe('INDEX');
      expect(findFunction('VLOOKUP')!.name).toBe('VLOOKUP');
      expect(findFunction('HLOOKUP')!.name).toBe('HLOOKUP');
      expect(findFunction('PRODUCT')!.name).toBe('PRODUCT');
      expect(findFunction('MEDIAN')!.name).toBe('MEDIAN');
      expect(findFunction('COUNTBLANK')!.name).toBe('COUNTBLANK');
      expect(findFunction('CONCAT')!.name).toBe('CONCAT');
      expect(findFunction('DATE')!.name).toBe('DATE');
      expect(findFunction('TIME')!.name).toBe('TIME');
      expect(findFunction('DAYS')!.name).toBe('DAYS');
      expect(findFunction('WEEKDAY')!.name).toBe('WEEKDAY');
      expect(findFunction('RANDBETWEEN')!.name).toBe('RANDBETWEEN');
      expect(findFunction('ISBLANK')!.name).toBe('ISBLANK');
      expect(findFunction('ISNUMBER')!.name).toBe('ISNUMBER');
      expect(findFunction('ISTEXT')!.name).toBe('ISTEXT');
      expect(findFunction('ISERROR')!.name).toBe('ISERROR');
      expect(findFunction('ISNONTEXT')!.name).toBe('ISNONTEXT');
      expect(findFunction('IFNA')!.name).toBe('IFNA');
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

    it('should format TEXTJOIN signature', () => {
      const info = findFunction('TEXTJOIN')!;
      expect(formatSignature(info)).toBe(
        'TEXTJOIN(delimiter, ignore_empty, text1, [text2], ...)',
      );
    });

    it('should format SUMIFS signature', () => {
      const info = findFunction('SUMIFS')!;
      expect(formatSignature(info)).toBe(
        'SUMIFS(sum_range, criteria_range1, criterion1, [criteria_range2], ..., [criterion2], ...)',
      );
    });

    it('should format VLOOKUP signature', () => {
      const info = findFunction('VLOOKUP')!;
      expect(formatSignature(info)).toBe(
        'VLOOKUP(search_key, range, index, [is_sorted])',
      );
    });

    it('should format ISNUMBER signature', () => {
      const info = findFunction('ISNUMBER')!;
      expect(formatSignature(info)).toBe('ISNUMBER(value)');
    });

    it('should format WEEKDAY signature', () => {
      const info = findFunction('WEEKDAY')!;
      expect(formatSignature(info)).toBe('WEEKDAY(date, [type])');
    });

    it('should format RAND signature', () => {
      const info = findFunction('RAND')!;
      expect(formatSignature(info)).toBe('RAND()');
    });
  });
});
