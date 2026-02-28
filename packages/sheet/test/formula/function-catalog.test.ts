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

    it('should find functions starting with O', () => {
      const results = searchFunctions('O');
      const names = results.map((r) => r.name);
      expect(names).toContain('OR');
      expect(names).toContain('ODD');
      expect(names).toContain('OFFSET');
      expect(names).toContain('OCT2DEC');
      expect(names).toContain('OCT2HEX');
      expect(names).toContain('OCT2BIN');
      expect(names).not.toContain('AND');
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
      expect(findFunction('EXPON.DIST')!.name).toBe('EXPON.DIST');
      expect(findFunction('CONFIDENCE.NORM')!.name).toBe('CONFIDENCE.NORM');
      expect(findFunction('CONFIDENCE.T')!.name).toBe('CONFIDENCE.T');
      expect(findFunction('CHISQ.DIST')!.name).toBe('CHISQ.DIST');
      expect(findFunction('CHISQ.INV')!.name).toBe('CHISQ.INV');
      expect(findFunction('T.DIST')!.name).toBe('T.DIST');
      expect(findFunction('T.INV')!.name).toBe('T.INV');
      expect(findFunction('HYPGEOM.DIST')!.name).toBe('HYPGEOM.DIST');
      expect(findFunction('NEGBINOM.DIST')!.name).toBe('NEGBINOM.DIST');
      expect(findFunction('ARABIC')!.name).toBe('ARABIC');
      expect(findFunction('ROMAN')!.name).toBe('ROMAN');
      expect(findFunction('MULTINOMIAL')!.name).toBe('MULTINOMIAL');
      expect(findFunction('SERIESSUM')!.name).toBe('SERIESSUM');
      expect(findFunction('DELTA')!.name).toBe('DELTA');
      expect(findFunction('GESTEP')!.name).toBe('GESTEP');
      expect(findFunction('ERF')!.name).toBe('ERF');
      expect(findFunction('ERFC')!.name).toBe('ERFC');
      expect(findFunction('XNPV')!.name).toBe('XNPV');
      expect(findFunction('XIRR')!.name).toBe('XIRR');
      expect(findFunction('SYD')!.name).toBe('SYD');
      expect(findFunction('MIRR')!.name).toBe('MIRR');
      expect(findFunction('TBILLEQ')!.name).toBe('TBILLEQ');
      expect(findFunction('TBILLPRICE')!.name).toBe('TBILLPRICE');
      expect(findFunction('TBILLYIELD')!.name).toBe('TBILLYIELD');
      expect(findFunction('DOLLARDE')!.name).toBe('DOLLARDE');
      expect(findFunction('DOLLARFR')!.name).toBe('DOLLARFR');
      expect(findFunction('ENCODEURL')!.name).toBe('ENCODEURL');
      expect(findFunction('ISURL')!.name).toBe('ISURL');
      expect(findFunction('ISFORMULA')!.name).toBe('ISFORMULA');
      expect(findFunction('FORMULATEXT')!.name).toBe('FORMULATEXT');
      expect(findFunction('CEILING.MATH')!.name).toBe('CEILING.MATH');
      expect(findFunction('FLOOR.MATH')!.name).toBe('FLOOR.MATH');
      expect(findFunction('CEILING.PRECISE')!.name).toBe('CEILING.PRECISE');
      expect(findFunction('FLOOR.PRECISE')!.name).toBe('FLOOR.PRECISE');
      expect(findFunction('COVAR')!.name).toBe('COVAR');
      expect(findFunction('COVARIANCE.S')!.name).toBe('COVARIANCE.S');
      expect(findFunction('RSQ')!.name).toBe('RSQ');
      expect(findFunction('STEYX')!.name).toBe('STEYX');
      expect(findFunction('SUMX2MY2')!.name).toBe('SUMX2MY2');
      expect(findFunction('SUMX2PY2')!.name).toBe('SUMX2PY2');
      expect(findFunction('SUMXMY2')!.name).toBe('SUMXMY2');
      expect(findFunction('PERCENTILE.EXC')!.name).toBe('PERCENTILE.EXC');
      expect(findFunction('QUARTILE.EXC')!.name).toBe('QUARTILE.EXC');
      expect(findFunction('RANK.AVG')!.name).toBe('RANK.AVG');
      expect(findFunction('PERCENTRANK')!.name).toBe('PERCENTRANK');
      expect(findFunction('PERCENTRANK.EXC')!.name).toBe('PERCENTRANK.EXC');
      expect(findFunction('BETA.DIST')!.name).toBe('BETA.DIST');
      expect(findFunction('BETA.INV')!.name).toBe('BETA.INV');
      expect(findFunction('F.DIST')!.name).toBe('F.DIST');
      expect(findFunction('F.INV')!.name).toBe('F.INV');
      expect(findFunction('GAMMA.DIST')!.name).toBe('GAMMA.DIST');
      expect(findFunction('GAMMA.INV')!.name).toBe('GAMMA.INV');
      expect(findFunction('CHISQ.DIST.RT')!.name).toBe('CHISQ.DIST.RT');
      expect(findFunction('CHISQ.INV.RT')!.name).toBe('CHISQ.INV.RT');
      expect(findFunction('T.DIST.RT')!.name).toBe('T.DIST.RT');
      expect(findFunction('T.DIST.2T')!.name).toBe('T.DIST.2T');
      expect(findFunction('T.INV.2T')!.name).toBe('T.INV.2T');
      expect(findFunction('F.DIST.RT')!.name).toBe('F.DIST.RT');
      expect(findFunction('F.INV.RT')!.name).toBe('F.INV.RT');
      expect(findFunction('BINOM.INV')!.name).toBe('BINOM.INV');
      expect(findFunction('TEXTBEFORE')!.name).toBe('TEXTBEFORE');
      expect(findFunction('TEXTAFTER')!.name).toBe('TEXTAFTER');
      expect(findFunction('VALUETOTEXT')!.name).toBe('VALUETOTEXT');
      expect(findFunction('SEQUENCE')!.name).toBe('SEQUENCE');
      expect(findFunction('RANDARRAY')!.name).toBe('RANDARRAY');
      expect(findFunction('SORT')!.name).toBe('SORT');
      expect(findFunction('UNIQUE')!.name).toBe('UNIQUE');
      expect(findFunction('FLATTEN')!.name).toBe('FLATTEN');
      expect(findFunction('TRANSPOSE')!.name).toBe('TRANSPOSE');
      expect(findFunction('NORM.S.DIST')!.name).toBe('NORM.S.DIST');
      expect(findFunction('NORM.S.INV')!.name).toBe('NORM.S.INV');
      expect(findFunction('SUBTOTAL')!.name).toBe('SUBTOTAL');
      expect(findFunction('VARA')!.name).toBe('VARA');
      expect(findFunction('VARPA')!.name).toBe('VARPA');
      expect(findFunction('SKEW')!.name).toBe('SKEW');
      expect(findFunction('KURT')!.name).toBe('KURT');
      expect(findFunction('ISREF')!.name).toBe('ISREF');
      expect(findFunction('SHEET')!.name).toBe('SHEET');
      expect(findFunction('SHEETS')!.name).toBe('SHEETS');
      expect(findFunction('MDETERM')!.name).toBe('MDETERM');
      expect(findFunction('PROB')!.name).toBe('PROB');
      expect(findFunction('CONVERT')!.name).toBe('CONVERT');
      expect(findFunction('BITAND')!.name).toBe('BITAND');
      expect(findFunction('BITOR')!.name).toBe('BITOR');
      expect(findFunction('BITXOR')!.name).toBe('BITXOR');
      expect(findFunction('BITLSHIFT')!.name).toBe('BITLSHIFT');
      expect(findFunction('BITRSHIFT')!.name).toBe('BITRSHIFT');
      expect(findFunction('HEX2DEC')!.name).toBe('HEX2DEC');
      expect(findFunction('DEC2HEX')!.name).toBe('DEC2HEX');
      expect(findFunction('BIN2DEC')!.name).toBe('BIN2DEC');
      expect(findFunction('DEC2BIN')!.name).toBe('DEC2BIN');
      expect(findFunction('OCT2DEC')!.name).toBe('OCT2DEC');
      expect(findFunction('DEC2OCT')!.name).toBe('DEC2OCT');
      expect(findFunction('COMPLEX')!.name).toBe('COMPLEX');
      expect(findFunction('IMREAL')!.name).toBe('IMREAL');
      expect(findFunction('IMAGINARY')!.name).toBe('IMAGINARY');
      expect(findFunction('IMABS')!.name).toBe('IMABS');
      expect(findFunction('IMSUM')!.name).toBe('IMSUM');
      expect(findFunction('IMSUB')!.name).toBe('IMSUB');
      expect(findFunction('IMPRODUCT')!.name).toBe('IMPRODUCT');
      expect(findFunction('IMDIV')!.name).toBe('IMDIV');
      expect(findFunction('IMCONJUGATE')!.name).toBe('IMCONJUGATE');
      expect(findFunction('IMARGUMENT')!.name).toBe('IMARGUMENT');
      expect(findFunction('IMPOWER')!.name).toBe('IMPOWER');
      expect(findFunction('IMSQRT')!.name).toBe('IMSQRT');
      expect(findFunction('IMEXP')!.name).toBe('IMEXP');
      expect(findFunction('IMLN')!.name).toBe('IMLN');
      expect(findFunction('IMLOG2')!.name).toBe('IMLOG2');
      expect(findFunction('IMLOG10')!.name).toBe('IMLOG10');
      expect(findFunction('IMSIN')!.name).toBe('IMSIN');
      expect(findFunction('IMCOS')!.name).toBe('IMCOS');
      expect(findFunction('IMTAN')!.name).toBe('IMTAN');
      expect(findFunction('IMSINH')!.name).toBe('IMSINH');
      expect(findFunction('IMCOSH')!.name).toBe('IMCOSH');
      expect(findFunction('IMSEC')!.name).toBe('IMSEC');
      expect(findFunction('IMCSC')!.name).toBe('IMCSC');
      expect(findFunction('IMCOT')!.name).toBe('IMCOT');
      expect(findFunction('HEX2BIN')!.name).toBe('HEX2BIN');
      expect(findFunction('HEX2OCT')!.name).toBe('HEX2OCT');
      expect(findFunction('BIN2HEX')!.name).toBe('BIN2HEX');
      expect(findFunction('BIN2OCT')!.name).toBe('BIN2OCT');
      expect(findFunction('OCT2HEX')!.name).toBe('OCT2HEX');
      expect(findFunction('OCT2BIN')!.name).toBe('OCT2BIN');
      expect(findFunction('BESSELJ')!.name).toBe('BESSELJ');
      expect(findFunction('BESSELY')!.name).toBe('BESSELY');
      expect(findFunction('BESSELI')!.name).toBe('BESSELI');
      expect(findFunction('BESSELK')!.name).toBe('BESSELK');
      expect(findFunction('ACCRINT')!.name).toBe('ACCRINT');
      expect(findFunction('ACCRINTM')!.name).toBe('ACCRINTM');
      expect(findFunction('COUPDAYBS')!.name).toBe('COUPDAYBS');
      expect(findFunction('COUPDAYS')!.name).toBe('COUPDAYS');
      expect(findFunction('COUPDAYSNC')!.name).toBe('COUPDAYSNC');
      expect(findFunction('COUPNCD')!.name).toBe('COUPNCD');
      expect(findFunction('COUPNUM')!.name).toBe('COUPNUM');
      expect(findFunction('COUPPCD')!.name).toBe('COUPPCD');
      expect(findFunction('DISC')!.name).toBe('DISC');
      expect(findFunction('PRICEDISC')!.name).toBe('PRICEDISC');
      expect(findFunction('YIELDDISC')!.name).toBe('YIELDDISC');
      expect(findFunction('DURATION')!.name).toBe('DURATION');
      expect(findFunction('MDURATION')!.name).toBe('MDURATION');
      expect(findFunction('RECEIVED')!.name).toBe('RECEIVED');
      expect(findFunction('INTRATE')!.name).toBe('INTRATE');
      expect(findFunction('PRICE')!.name).toBe('PRICE');
      expect(findFunction('YIELD')!.name).toBe('YIELD');
      expect(findFunction('PRICEMAT')!.name).toBe('PRICEMAT');
      expect(findFunction('YIELDMAT')!.name).toBe('YIELDMAT');
      expect(findFunction('AMORLINC')!.name).toBe('AMORLINC');
      expect(findFunction('ISPMT')!.name).toBe('ISPMT');
      expect(findFunction('FVSCHEDULE')!.name).toBe('FVSCHEDULE');
      expect(findFunction('PDURATION')!.name).toBe('PDURATION');
      expect(findFunction('RRI')!.name).toBe('RRI');
      expect(findFunction('DSUM')!.name).toBe('DSUM');
      expect(findFunction('DCOUNT')!.name).toBe('DCOUNT');
      expect(findFunction('DCOUNTA')!.name).toBe('DCOUNTA');
      expect(findFunction('DAVERAGE')!.name).toBe('DAVERAGE');
      expect(findFunction('DMAX')!.name).toBe('DMAX');
      expect(findFunction('DMIN')!.name).toBe('DMIN');
      expect(findFunction('DPRODUCT')!.name).toBe('DPRODUCT');
      expect(findFunction('DGET')!.name).toBe('DGET');
      expect(findFunction('DSTDEV')!.name).toBe('DSTDEV');
      expect(findFunction('DSTDEVP')!.name).toBe('DSTDEVP');
      expect(findFunction('DVAR')!.name).toBe('DVAR');
      expect(findFunction('DVARP')!.name).toBe('DVARP');
      expect(findFunction('GROWTH')!.name).toBe('GROWTH');
      expect(findFunction('TREND')!.name).toBe('TREND');
      expect(findFunction('LINEST')!.name).toBe('LINEST');
      expect(findFunction('LOGEST')!.name).toBe('LOGEST');
      expect(findFunction('FREQUENCY')!.name).toBe('FREQUENCY');
      expect(findFunction('MODE.MULT')!.name).toBe('MODE.MULT');
      expect(findFunction('AGGREGATE')!.name).toBe('AGGREGATE');
      expect(findFunction('COMBINA')!.name).toBe('COMBINA');
      expect(findFunction('PERMUTATIONA')!.name).toBe('PERMUTATIONA');
      expect(findFunction('T.TEST')!.name).toBe('T.TEST');
      expect(findFunction('Z.TEST')!.name).toBe('Z.TEST');
      expect(findFunction('AREAS')!.name).toBe('AREAS');
      expect(findFunction('CELL')!.name).toBe('CELL');
      expect(findFunction('MMULT')!.name).toBe('MMULT');
      expect(findFunction('MINVERSE')!.name).toBe('MINVERSE');
      expect(findFunction('XMATCH')!.name).toBe('XMATCH');
      expect(findFunction('TOCOL')!.name).toBe('TOCOL');
      expect(findFunction('TOROW')!.name).toBe('TOROW');
      expect(findFunction('TEXTSPLIT')!.name).toBe('TEXTSPLIT');
      expect(findFunction('CHOOSEROWS')!.name).toBe('CHOOSEROWS');
      expect(findFunction('CHOOSECOLS')!.name).toBe('CHOOSECOLS');
      expect(findFunction('TAKE')!.name).toBe('TAKE');
      expect(findFunction('DROP')!.name).toBe('DROP');
      expect(findFunction('HSTACK')!.name).toBe('HSTACK');
      expect(findFunction('VSTACK')!.name).toBe('VSTACK');
      expect(findFunction('SORTBY')!.name).toBe('SORTBY');
      expect(findFunction('WRAPCOLS')!.name).toBe('WRAPCOLS');
      expect(findFunction('WRAPROWS')!.name).toBe('WRAPROWS');
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
        'Engineering',
        'Financial',
        'Info',
        'Logical',
        'Lookup',
        'Math',
        'Statistical',
        'Text',
        'Database',
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
