import { describe, it, expect } from 'vitest';
import {
  searchFunctions,
  findFunction,
  formatSignature,
  FunctionCatalog,
  listFunctionCategories,
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

    it('should find OR, ODD, and OFFSET but not AND with "O"', () => {
      const results = searchFunctions('O');
      expect(results).toHaveLength(3);
      const names = results.map((r) => r.name);
      expect(names).toContain('OR');
      expect(names).toContain('ODD');
      expect(names).toContain('OFFSET');
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
      expect(findFunction('MINIFS')!.name).toBe('MINIFS');
      expect(findFunction('MAXIFS')!.name).toBe('MAXIFS');
      expect(findFunction('RANK')!.name).toBe('RANK');
      expect(findFunction('PERCENTILE')!.name).toBe('PERCENTILE');
      expect(findFunction('CLEAN')!.name).toBe('CLEAN');
      expect(findFunction('NUMBERVALUE')!.name).toBe('NUMBERVALUE');
      expect(findFunction('STDEV')!.name).toBe('STDEV');
      expect(findFunction('STDEVP')!.name).toBe('STDEVP');
      expect(findFunction('VAR')!.name).toBe('VAR');
      expect(findFunction('VARP')!.name).toBe('VARP');
      expect(findFunction('MODE')!.name).toBe('MODE');
      expect(findFunction('SUMSQ')!.name).toBe('SUMSQ');
      expect(findFunction('NA')!.name).toBe('NA');
      expect(findFunction('QUARTILE')!.name).toBe('QUARTILE');
      expect(findFunction('COUNTUNIQUE')!.name).toBe('COUNTUNIQUE');
      expect(findFunction('FIXED')!.name).toBe('FIXED');
      expect(findFunction('DOLLAR')!.name).toBe('DOLLAR');
      expect(findFunction('WEEKNUM')!.name).toBe('WEEKNUM');
      expect(findFunction('ISOWEEKNUM')!.name).toBe('ISOWEEKNUM');
      expect(findFunction('WORKDAY')!.name).toBe('WORKDAY');
      expect(findFunction('YEARFRAC')!.name).toBe('YEARFRAC');
      expect(findFunction('LOOKUP')!.name).toBe('LOOKUP');
      expect(findFunction('INDIRECT')!.name).toBe('INDIRECT');
      expect(findFunction('ERROR.TYPE')!.name).toBe('ERROR.TYPE');
      expect(findFunction('ISDATE')!.name).toBe('ISDATE');
      expect(findFunction('SPLIT')!.name).toBe('SPLIT');
      expect(findFunction('JOIN')!.name).toBe('JOIN');
      expect(findFunction('REGEXMATCH')!.name).toBe('REGEXMATCH');
      expect(findFunction('FORECAST')!.name).toBe('FORECAST');
      expect(findFunction('SLOPE')!.name).toBe('SLOPE');
      expect(findFunction('INTERCEPT')!.name).toBe('INTERCEPT');
      expect(findFunction('CORREL')!.name).toBe('CORREL');
      expect(findFunction('XLOOKUP')!.name).toBe('XLOOKUP');
      expect(findFunction('OFFSET')!.name).toBe('OFFSET');
      expect(findFunction('ISEVEN')!.name).toBe('ISEVEN');
      expect(findFunction('ISODD')!.name).toBe('ISODD');
      expect(findFunction('FACTDOUBLE')!.name).toBe('FACTDOUBLE');
      expect(findFunction('BASE')!.name).toBe('BASE');
      expect(findFunction('DECIMAL')!.name).toBe('DECIMAL');
      expect(findFunction('SQRTPI')!.name).toBe('SQRTPI');
      expect(findFunction('SINH')!.name).toBe('SINH');
      expect(findFunction('COSH')!.name).toBe('COSH');
      expect(findFunction('TANH')!.name).toBe('TANH');
      expect(findFunction('ASINH')!.name).toBe('ASINH');
      expect(findFunction('ACOSH')!.name).toBe('ACOSH');
      expect(findFunction('ATANH')!.name).toBe('ATANH');
      expect(findFunction('COT')!.name).toBe('COT');
      expect(findFunction('CSC')!.name).toBe('CSC');
      expect(findFunction('SEC')!.name).toBe('SEC');
      expect(findFunction('REGEXEXTRACT')!.name).toBe('REGEXEXTRACT');
      expect(findFunction('REGEXREPLACE')!.name).toBe('REGEXREPLACE');
      expect(findFunction('UNICODE')!.name).toBe('UNICODE');
      expect(findFunction('UNICHAR')!.name).toBe('UNICHAR');
      expect(findFunction('GEOMEAN')!.name).toBe('GEOMEAN');
      expect(findFunction('HARMEAN')!.name).toBe('HARMEAN');
      expect(findFunction('AVEDEV')!.name).toBe('AVEDEV');
      expect(findFunction('DEVSQ')!.name).toBe('DEVSQ');
      expect(findFunction('TRIMMEAN')!.name).toBe('TRIMMEAN');
      expect(findFunction('PERMUT')!.name).toBe('PERMUT');
      expect(findFunction('PMT')!.name).toBe('PMT');
      expect(findFunction('FV')!.name).toBe('FV');
      expect(findFunction('PV')!.name).toBe('PV');
      expect(findFunction('NPV')!.name).toBe('NPV');
      expect(findFunction('NPER')!.name).toBe('NPER');
      expect(findFunction('IPMT')!.name).toBe('IPMT');
      expect(findFunction('PPMT')!.name).toBe('PPMT');
      expect(findFunction('SLN')!.name).toBe('SLN');
      expect(findFunction('EFFECT')!.name).toBe('EFFECT');
      expect(findFunction('RATE')!.name).toBe('RATE');
      expect(findFunction('IRR')!.name).toBe('IRR');
      expect(findFunction('DB')!.name).toBe('DB');
      expect(findFunction('DDB')!.name).toBe('DDB');
      expect(findFunction('NOMINAL')!.name).toBe('NOMINAL');
      expect(findFunction('CUMIPMT')!.name).toBe('CUMIPMT');
      expect(findFunction('CUMPRINC')!.name).toBe('CUMPRINC');
      expect(findFunction('AVERAGEA')!.name).toBe('AVERAGEA');
      expect(findFunction('MINA')!.name).toBe('MINA');
      expect(findFunction('MAXA')!.name).toBe('MAXA');
      expect(findFunction('FISHER')!.name).toBe('FISHER');
      expect(findFunction('FISHERINV')!.name).toBe('FISHERINV');
      expect(findFunction('GAMMA')!.name).toBe('GAMMA');
      expect(findFunction('GAMMALN')!.name).toBe('GAMMALN');
      expect(findFunction('NORMDIST')!.name).toBe('NORMDIST');
      expect(findFunction('NORMINV')!.name).toBe('NORMINV');
      expect(findFunction('LOGNORMAL.DIST')!.name).toBe('LOGNORMAL.DIST');
      expect(findFunction('LOGNORMAL.INV')!.name).toBe('LOGNORMAL.INV');
      expect(findFunction('STANDARDIZE')!.name).toBe('STANDARDIZE');
      expect(findFunction('WEIBULL.DIST')!.name).toBe('WEIBULL.DIST');
      expect(findFunction('POISSON.DIST')!.name).toBe('POISSON.DIST');
      expect(findFunction('BINOM.DIST')!.name).toBe('BINOM.DIST');
    });

    it('should return undefined for unknown function', () => {
      expect(findFunction('UNKNOWN')).toBeUndefined();
    });

    it('should expose Google Sheets categories for functions', () => {
      expect(findFunction('SUM')!.category).toBe('Math');
      expect(findFunction('AVERAGE')!.category).toBe('Statistical');
      expect(findFunction('IF')!.category).toBe('Logical');
      expect(findFunction('VLOOKUP')!.category).toBe('Lookup');
      expect(findFunction('TODAY')!.category).toBe('Date');
      expect(findFunction('LEN')!.category).toBe('Text');
      expect(findFunction('ISERROR')!.category).toBe('Info');
      expect(findFunction('PMT')!.category).toBe('Financial');
    });
  });

  describe('listFunctionCategories', () => {
    it('should return used categories in Google Sheets order', () => {
      expect(listFunctionCategories()).toEqual([
        'Date',
        'Financial',
        'Info',
        'Logical',
        'Lookup',
        'Math',
        'Statistical',
        'Text',
      ]);
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
