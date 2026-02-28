import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { EvalNode } from './formula';
import { NumberArgs, BoolArgs, ref2str } from './arguments';
import { Grid } from '../model/types';
import {
  isCrossSheetRef,
  isSrng,
  parseCrossSheetRef,
  parseRange,
  parseRef,
  toColumnLabel,
  toSref,
  toSrefs,
} from '../model/coordinates';

/**
 * FunctionMap is a map of function name to the function implementation.
 */
export const FunctionMap = new Map([
  ['SUM', sum],
  ['ABS', absFunc],
  ['ROUND', roundFunc],
  ['ROUNDUP', roundUpFunc],
  ['ROUNDDOWN', roundDownFunc],
  ['INT', intFunc],
  ['MOD', modFunc],
  ['SQRT', sqrtFunc],
  ['POWER', powerFunc],
  ['PRODUCT', productFunc],
  ['MEDIAN', medianFunc],
  ['IF', ifFunc],
  ['IFS', ifsFunc],
  ['SWITCH', switchFunc],
  ['AND', andFunc],
  ['OR', orFunc],
  ['NOT', notFunc],
  ['AVERAGE', average],
  ['MIN', minFunc],
  ['MAX', maxFunc],
  ['COUNT', countFunc],
  ['COUNTA', countaFunc],
  ['COUNTBLANK', countblankFunc],
  ['COUNTIF', countifFunc],
  ['SUMIF', sumifFunc],
  ['COUNTIFS', countifsFunc],
  ['SUMIFS', sumifsFunc],
  ['MATCH', matchFunc],
  ['INDEX', indexFunc],
  ['VLOOKUP', vlookupFunc],
  ['HLOOKUP', hlookupFunc],
  ['TRIM', trimFunc],
  ['LEN', lenFunc],
  ['LEFT', leftFunc],
  ['RIGHT', rightFunc],
  ['MID', midFunc],
  ['CONCATENATE', concatenateFunc],
  ['CONCAT', concatFunc],
  ['FIND', findFunc],
  ['SEARCH', searchFunc],
  ['TEXTJOIN', textjoinFunc],
  ['LOWER', lowerFunc],
  ['UPPER', upperFunc],
  ['PROPER', properFunc],
  ['SUBSTITUTE', substituteFunc],
  ['TODAY', todayFunc],
  ['NOW', nowFunc],
  ['DATE', dateFunc],
  ['TIME', timeFunc],
  ['DAYS', daysFunc],
  ['YEAR', yearFunc],
  ['MONTH', monthFunc],
  ['DAY', dayFunc],
  ['HOUR', hourFunc],
  ['MINUTE', minuteFunc],
  ['SECOND', secondFunc],
  ['WEEKDAY', weekdayFunc],
  ['RAND', randFunc],
  ['RANDBETWEEN', randbetweenFunc],
  ['ISBLANK', isblankFunc],
  ['ISNUMBER', isnumberFunc],
  ['ISTEXT', istextFunc],
  ['ISERROR', iserrorFunc],
  ['ISERR', iserrFunc],
  ['ISNA', isnaFunc],
  ['ISLOGICAL', islogicalFunc],
  ['ISNONTEXT', isnontextFunc],
  ['IFERROR', iferrorFunc],
  ['IFNA', ifnaFunc],
  ['PI', piFunc],
  ['SIGN', signFunc],
  ['EVEN', evenFunc],
  ['ODD', oddFunc],
  ['EXP', expFunc],
  ['LN', lnFunc],
  ['LOG', logFunc],
  ['SIN', sinFunc],
  ['COS', cosFunc],
  ['TAN', tanFunc],
  ['ASIN', asinFunc],
  ['ACOS', acosFunc],
  ['ATAN', atanFunc],
  ['ATAN2', atan2Func],
  ['DEGREES', degreesFunc],
  ['RADIANS', radiansFunc],
  ['CEILING', ceilingFunc],
  ['FLOOR', floorFunc],
  ['TRUNC', truncFunc],
  ['MROUND', mroundFunc],
  ['EXACT', exactFunc],
  ['REPLACE', replaceFunc],
  ['REPT', reptFunc],
  ['T', tFunc],
  ['VALUE', valueFunc],
  ['TEXT', textFunc],
  ['CHAR', charFunc],
  ['CODE', codeFunc],
  ['AVERAGEIF', averageifFunc],
  ['AVERAGEIFS', averageifsFunc],
  ['LARGE', largeFunc],
  ['SMALL', smallFunc],
  ['N', nFunc],
  ['SUMPRODUCT', sumproductFunc],
  ['GCD', gcdFunc],
  ['LCM', lcmFunc],
  ['COMBIN', combinFunc],
  ['FACT', factFunc],
  ['QUOTIENT', quotientFunc],
  ['XOR', xorFunc],
  ['CHOOSE', chooseFunc],
  ['TYPE', typeFunc],
  ['EDATE', edateFunc],
  ['EOMONTH', eomonthFunc],
  ['NETWORKDAYS', networkdaysFunc],
  ['DATEVALUE', datevalueFunc],
  ['TIMEVALUE', timevalueFunc],
  ['DATEDIF', datedifFunc],
  ['ROW', rowFunc],
  ['COLUMN', columnFunc],
  ['ROWS', rowsFunc],
  ['COLUMNS', columnsFunc],
  ['ADDRESS', addressFunc],
  ['HYPERLINK', hyperlinkFunc],
  ['MINIFS', minifsFunc],
  ['MAXIFS', maxifsFunc],
  ['RANK', rankFunc],
  ['PERCENTILE', percentileFunc],
  ['CLEAN', cleanFunc],
  ['NUMBERVALUE', numbervalueFunc],
  ['STDEV', stdevFunc],
  ['STDEVP', stdevpFunc],
  ['STDEV.S', stdevFunc],
  ['STDEV.P', stdevpFunc],
  ['VAR', varFunc],
  ['VARP', varpFunc],
  ['VAR.S', varFunc],
  ['VAR.P', varpFunc],
  ['MODE', modeFunc],
  ['MODE.SNGL', modeFunc],
  ['SUMSQ', sumsqFunc],
  ['NA', naFunc],
  ['QUARTILE', quartileFunc],
  ['QUARTILE.INC', quartileFunc],
  ['COUNTUNIQUE', countuniqueFunc],
  ['FIXED', fixedFunc],
  ['DOLLAR', dollarFunc],
  ['WEEKNUM', weeknumFunc],
  ['ISOWEEKNUM', isoweeknumFunc],
  ['WORKDAY', workdayFunc],
  ['YEARFRAC', yearfracFunc],
  ['LOOKUP', lookupFunc],
  ['INDIRECT', indirectFunc],
  ['ERROR.TYPE', errortypeFunc],
  ['ISDATE', isdateFunc],
  ['SPLIT', splitFunc],
  ['JOIN', joinFunc],
  ['REGEXMATCH', regexmatchFunc],
  ['FORECAST', forecastFunc],
  ['FORECAST.LINEAR', forecastFunc],
  ['SLOPE', slopeFunc],
  ['INTERCEPT', interceptFunc],
  ['CORREL', correlFunc],
  ['XLOOKUP', xlookupFunc],
  ['OFFSET', offsetFunc],
  ['ISEVEN', isevenFunc],
  ['ISODD', isoddFunc],
  ['FACTDOUBLE', factdoubleFunc],
  ['BASE', baseFunc],
  ['DECIMAL', decimalFunc],
  ['SQRTPI', sqrtpiFunc],
  ['SINH', sinhFunc],
  ['COSH', coshFunc],
  ['TANH', tanhFunc],
  ['ASINH', asinhFunc],
  ['ACOSH', acoshFunc],
  ['ATANH', atanhFunc],
  ['COT', cotFunc],
  ['CSC', cscFunc],
  ['SEC', secFunc],
  ['REGEXEXTRACT', regexextractFunc],
  ['REGEXREPLACE', regexreplaceFunc],
  ['UNICODE', unicodeFunc],
  ['UNICHAR', unicharFunc],
  ['GEOMEAN', geomeanFunc],
  ['HARMEAN', harmeanFunc],
  ['AVEDEV', avedevFunc],
  ['DEVSQ', devsqFunc],
  ['TRIMMEAN', trimmeanFunc],
  ['PERMUT', permutFunc],
  ['PMT', pmtFunc],
  ['FV', fvFunc],
  ['PV', pvFunc],
  ['NPV', npvFunc],
  ['NPER', nperFunc],
  ['IPMT', ipmtFunc],
  ['PPMT', ppmtFunc],
  ['SLN', slnFunc],
  ['EFFECT', effectFunc],
  ['RATE', rateFunc],
  ['IRR', irrFunc],
  ['DB', dbFunc],
  ['DDB', ddbFunc],
  ['NOMINAL', nominalFunc],
  ['CUMIPMT', cumipmtFunc],
  ['CUMPRINC', cumprincFunc],
  ['AVERAGEA', averageaFunc],
  ['MINA', minaFunc],
  ['MAXA', maxaFunc],
  ['FISHER', fisherFunc],
  ['FISHERINV', fisherinvFunc],
  ['GAMMA', gammaFunc],
  ['GAMMALN', gammalnFunc],
  ['NORMDIST', normdistFunc],
  ['NORM.DIST', normdistFunc],
  ['NORMINV', norminvFunc],
  ['NORM.INV', norminvFunc],
  ['LOGNORMAL.DIST', lognormdistFunc],
  ['LOGNORMAL.INV', lognorminvFunc],
  ['STANDARDIZE', standardizeFunc],
  ['WEIBULL.DIST', weibulldistFunc],
  ['POISSON.DIST', poissondistFunc],
  ['BINOM.DIST', binomdistFunc],
  ['EXPON.DIST', expondistFunc],
  ['CONFIDENCE.NORM', confidencenormFunc],
  ['CONFIDENCE.T', confidencetFunc],
  ['CHISQ.DIST', chisqdistFunc],
  ['CHISQ.INV', chisqinvFunc],
  ['T.DIST', tdistFunc],
  ['T.INV', tinvFunc],
  ['HYPGEOM.DIST', hypgeomdistFunc],
  ['NEGBINOM.DIST', negbinomdistFunc],
  ['ARABIC', arabicFunc],
  ['ROMAN', romanFunc],
  ['MULTINOMIAL', multinomialFunc],
  ['SERIESSUM', seriessumFunc],
  ['DELTA', deltaFunc],
  ['GESTEP', gestepFunc],
  ['ERF', erfFunc],
  ['ERFC', erfcFunc],
  ['XNPV', xnpvFunc],
  ['XIRR', xirrFunc],
  ['SYD', sydFunc],
  ['MIRR', mirrFunc],
  ['TBILLEQ', tbilleqFunc],
  ['TBILLPRICE', tbillpriceFunc],
  ['TBILLYIELD', tbillyieldFunc],
  ['DOLLARDE', dollardeFunc],
  ['DOLLARFR', dollarfrFunc],
  ['ENCODEURL', encodeurlFunc],
  ['ISURL', isurlFunc],
  ['ISFORMULA', isformulaFunc],
  ['FORMULATEXT', formulatextFunc],
  ['CEILING.MATH', ceilingmathFunc],
  ['FLOOR.MATH', floormathFunc],
  ['CEILING.PRECISE', ceilingpreciseFunc],
  ['FLOOR.PRECISE', floorpreciseFunc],
  ['COVAR', covarFunc],
  ['COVARIANCE.P', covarFunc],
  ['COVARIANCE.S', covarsFunc],
  ['RSQ', rsqFunc],
  ['STEYX', steyxFunc],
  ['SUMX2MY2', sumx2my2Func],
  ['SUMX2PY2', sumx2py2Func],
  ['SUMXMY2', sumxmy2Func],
  ['PERCENTILE.INC', percentileFunc],
  ['PERCENTILE.EXC', percentileexcFunc],
  ['QUARTILE.EXC', quartileexcFunc],
  ['RANK.AVG', rankavgFunc],
  ['RANK.EQ', rankFunc],
  ['PERCENTRANK', percentrankFunc],
  ['PERCENTRANK.INC', percentrankFunc],
  ['PERCENTRANK.EXC', percentrankexcFunc],
  ['BETA.DIST', betadistFunc],
  ['BETA.INV', betainvFunc],
  ['F.DIST', fdistFunc],
  ['F.INV', finvFunc],
  ['GAMMA.DIST', gammadistFunc],
  ['GAMMA.INV', gammainvFunc],
  ['CHISQ.DIST.RT', chisqdistrtFunc],
  ['CHISQ.INV.RT', chisqinvrtFunc],
  ['T.DIST.RT', tdistrtFunc],
  ['T.DIST.2T', tdist2tFunc],
  ['T.INV.2T', tinv2tFunc],
  ['F.DIST.RT', fdistrtFunc],
  ['F.INV.RT', finvrtFunc],
  ['BINOM.INV', biominvFunc],
  ['TEXTBEFORE', textbeforeFunc],
  ['TEXTAFTER', textafterFunc],
  ['VALUETOTEXT', valuetotextFunc],
  ['SEQUENCE', sequenceFunc],
  ['RANDARRAY', randarrayFunc],
  ['SORT', sortFunc],
  ['UNIQUE', uniqueFunc],
  ['FLATTEN', flattenFunc],
  ['TRANSPOSE', transposeFunc],
  ['NORM.S.DIST', normsdistFunc],
  ['NORM.S.INV', normsinvFunc],
  ['SUBTOTAL', subtotalFunc],
  ['VARA', varaFunc],
  ['VARPA', varpaFunc],
  ['SKEW', skewFunc],
  ['KURT', kurtFunc],
  ['ISREF', isrefFunc],
  ['SHEET', sheetFunc],
  ['SHEETS', sheetsFunc],
  ['MDETERM', mdetermFunc],
  ['PROB', probFunc],
  ['CONVERT', convertFunc],
]);

/**
 * `sum` is the implementation of the SUM function.
 */
export function sum(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args()!;
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let value = 0;
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }

    value += node.v;
  }

  return {
    t: 'num',
    v: value,
  };
}

/**
 * `absFunc` is the implementation of the ABS function.
 * ABS(number) — returns the absolute value of a number.
 */
export function absFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: Math.abs(num.v) };
}

function roundHalfAwayFromZero(value: number): number {
  if (value >= 0) {
    return Math.floor(value + 0.5);
  }

  return Math.ceil(value - 0.5);
}

function parsePlaces(
  expr: ParseTree | undefined,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): { t: 'num'; v: number } | { t: 'err'; v: '#VALUE!' | '#REF!' | '#N/A!' | '#ERROR!' } {
  if (!expr) {
    return { t: 'num', v: 0 };
  }

  const places = NumberArgs.map(visit(expr), grid);
  if (places.t === 'err') {
    return places;
  }

  return { t: 'num', v: Math.trunc(places.v) };
}

type FormulaError = {
  t: 'err';
  v: '#VALUE!' | '#REF!' | '#N/A!' | '#ERROR!';
};

type ParsedCriterion = {
  op: '=' | '<>' | '<' | '<=' | '>' | '>=';
  value: string;
  numericValue?: number;
  boolValue?: boolean;
  wildcardPattern?: RegExp;
};

type ReferenceMatrix = {
  refs: string[];
  rowCount: number;
  colCount: number;
};

type LookupValue = {
  normalized: string;
  numericValue?: number;
  boolValue?: boolean;
};

function isFormulaError(value: unknown): value is FormulaError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as FormulaError).t === 'err'
  );
}

function getRefsFromExpression(
  expr: ParseTree,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): { t: 'refs'; v: string[] } | FormulaError {
  const node = visit(expr);
  if (node.t === 'err') {
    return node;
  }
  if (node.t !== 'ref' || !grid) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'refs', v: Array.from(toSrefs([node.v])) };
}

function getReferenceMatrixFromExpression(
  expr: ParseTree,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): { t: 'matrix'; v: ReferenceMatrix } | FormulaError {
  const node = visit(expr);
  if (node.t === 'err') {
    return node;
  }
  if (node.t !== 'ref' || !grid) {
    return { t: 'err', v: '#VALUE!' };
  }

  if (!isSrng(node.v)) {
    return {
      t: 'matrix',
      v: {
        refs: [node.v],
        rowCount: 1,
        colCount: 1,
      },
    };
  }

  try {
    let localRange = node.v;
    let prefix = '';
    if (isCrossSheetRef(node.v)) {
      const { sheetName, localRef } = parseCrossSheetRef(node.v);
      localRange = localRef;
      prefix = `${sheetName}!`;
    }

    const [from, to] = parseRange(localRange);
    const refs: string[] = [];
    for (let row = from.r; row <= to.r; row++) {
      for (let col = from.c; col <= to.c; col++) {
        refs.push(`${prefix}${toSref({ r: row, c: col })}`);
      }
    }

    return {
      t: 'matrix',
      v: {
        refs,
        rowCount: to.r - from.r + 1,
        colCount: to.c - from.c + 1,
      },
    };
  } catch {
    return { t: 'err', v: '#VALUE!' };
  }
}

function toLookupValue(raw: string): LookupValue {
  const numeric = raw === '' ? undefined : Number(raw);
  const numericValue = numeric === undefined || isNaN(numeric) ? undefined : numeric;
  const upper = raw.toUpperCase();
  const boolValue =
    upper === 'TRUE'
      ? true
      : upper === 'FALSE'
        ? false
        : undefined;

  return {
    normalized: raw.toLowerCase(),
    numericValue,
    boolValue,
  };
}

function lookupValueFromNode(
  node: EvalNode,
  grid?: Grid,
): LookupValue | FormulaError {
  const str = toStr(node, grid);
  if (str.t === 'err') {
    return str;
  }

  return toLookupValue(str.v);
}

function lookupValueFromRef(ref: string, grid?: Grid): LookupValue {
  const raw = grid?.get(ref)?.v || '';
  return toLookupValue(raw);
}

function equalLookupValues(left: LookupValue, right: LookupValue): boolean {
  if (left.numericValue !== undefined && right.numericValue !== undefined) {
    return left.numericValue === right.numericValue;
  }

  if (left.boolValue !== undefined && right.boolValue !== undefined) {
    return left.boolValue === right.boolValue;
  }

  return left.normalized === right.normalized;
}

function compareLookupValues(left: LookupValue, right: LookupValue): number {
  if (left.numericValue !== undefined && right.numericValue !== undefined) {
    return left.numericValue - right.numericValue;
  }

  if (left.boolValue !== undefined && right.boolValue !== undefined) {
    return Number(left.boolValue) - Number(right.boolValue);
  }

  return left.normalized.localeCompare(right.normalized);
}

function toNumberOrZero(value: string): number {
  const num = Number(value);
  return isNaN(num) ? 0 : num;
}

function parseCriterion(
  node: EvalNode,
  grid?: Grid,
): ParsedCriterion | FormulaError {
  if (node.t === 'err') {
    return node;
  }
  if (node.t === 'num') {
    return { op: '=', value: node.v.toString(), numericValue: node.v };
  }
  if (node.t === 'bool') {
    return { op: '=', value: node.v ? 'TRUE' : 'FALSE', boolValue: node.v };
  }

  const str = toStr(node, grid);
  if (str.t === 'err') {
    return str;
  }

  const match = /^(<=|>=|<>|=|<|>)(.*)$/.exec(str.v);
  const op: ParsedCriterion['op'] = (match?.[1] as ParsedCriterion['op']) || '=';
  const value = match ? match[2] : str.v;

  let numericValue: number | undefined;
  let boolValue: boolean | undefined;
  if (value !== '') {
    const num = Number(value);
    if (!isNaN(num)) {
      numericValue = num;
    } else if (value.toUpperCase() === 'TRUE') {
      boolValue = true;
    } else if (value.toUpperCase() === 'FALSE') {
      boolValue = false;
    }
  }

  let wildcardPattern: RegExp | undefined;
  if ((op === '=' || op === '<>') && /(^|[^~])[*?]/.test(value)) {
    wildcardPattern = new RegExp(`^${wildcardToRegex(value)}$`, 'i');
  }

  return { op, value, numericValue, boolValue, wildcardPattern };
}

function matchesCriterion(value: string, criterion: ParsedCriterion): boolean {
  const numericValue = value === '' ? undefined : Number(value);
  const hasNumericValue = numericValue !== undefined && !isNaN(numericValue);
  const upper = value.toUpperCase();
  const boolValue =
    upper === 'TRUE' ? true : upper === 'FALSE' ? false : undefined;
  const normalized = value.toLowerCase();
  const criterionText = criterion.value.toLowerCase();

  if (criterion.op === '<' || criterion.op === '<=' || criterion.op === '>' || criterion.op === '>=') {
    if (criterion.numericValue !== undefined) {
      if (!hasNumericValue) {
        return false;
      }
      if (criterion.op === '<') return numericValue < criterion.numericValue;
      if (criterion.op === '<=') return numericValue <= criterion.numericValue;
      if (criterion.op === '>') return numericValue > criterion.numericValue;
      return numericValue >= criterion.numericValue;
    }

    if (criterion.op === '<') return normalized < criterionText;
    if (criterion.op === '<=') return normalized <= criterionText;
    if (criterion.op === '>') return normalized > criterionText;
    return normalized >= criterionText;
  }

  let equals = false;
  if (criterion.wildcardPattern) {
    equals = criterion.wildcardPattern.test(value);
  } else if (criterion.numericValue !== undefined && hasNumericValue) {
    equals = numericValue === criterion.numericValue;
  } else if (criterion.boolValue !== undefined && boolValue !== undefined) {
    equals = boolValue === criterion.boolValue;
  } else {
    equals = normalized === criterionText;
  }

  return criterion.op === '=' ? equals : !equals;
}

/**
 * `roundFunc` is the implementation of the ROUND function.
 * ROUND(value, [places]) — rounds to a specified number of digits.
 */
export function roundFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const value = NumberArgs.map(visit(exprs[0]), grid);
  if (value.t === 'err') {
    return value;
  }

  const places = parsePlaces(exprs[1], visit, grid);
  if (places.t === 'err') {
    return places;
  }

  const factor = 10 ** places.v;
  const rounded = roundHalfAwayFromZero(value.v * factor) / factor;
  return { t: 'num', v: rounded };
}

/**
 * `roundUpFunc` is the implementation of the ROUNDUP function.
 * ROUNDUP(value, [places]) — rounds away from zero.
 */
export function roundUpFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const value = NumberArgs.map(visit(exprs[0]), grid);
  if (value.t === 'err') {
    return value;
  }

  const places = parsePlaces(exprs[1], visit, grid);
  if (places.t === 'err') {
    return places;
  }

  const factor = 10 ** places.v;
  const scaled = value.v * factor;
  const rounded = (scaled >= 0 ? Math.ceil(scaled) : Math.floor(scaled)) / factor;
  return { t: 'num', v: rounded };
}

/**
 * `roundDownFunc` is the implementation of the ROUNDDOWN function.
 * ROUNDDOWN(value, [places]) — rounds toward zero.
 */
export function roundDownFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const value = NumberArgs.map(visit(exprs[0]), grid);
  if (value.t === 'err') {
    return value;
  }

  const places = parsePlaces(exprs[1], visit, grid);
  if (places.t === 'err') {
    return places;
  }

  const factor = 10 ** places.v;
  const scaled = value.v * factor;
  const rounded = (scaled >= 0 ? Math.floor(scaled) : Math.ceil(scaled)) / factor;
  return { t: 'num', v: rounded };
}

/**
 * `intFunc` is the implementation of the INT function.
 * INT(value) — rounds down to the nearest integer.
 */
export function intFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const value = NumberArgs.map(visit(exprs[0]), grid);
  if (value.t === 'err') {
    return value;
  }

  return { t: 'num', v: Math.floor(value.v) };
}

/**
 * `modFunc` is the implementation of the MOD function.
 * MOD(dividend, divisor) — returns the remainder after division.
 */
export function modFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const dividend = NumberArgs.map(visit(exprs[0]), grid);
  if (dividend.t === 'err') {
    return dividend;
  }

  const divisor = NumberArgs.map(visit(exprs[1]), grid);
  if (divisor.t === 'err') {
    return divisor;
  }
  if (divisor.v === 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  const remainder = dividend.v - divisor.v * Math.floor(dividend.v / divisor.v);
  return { t: 'num', v: remainder };
}

/**
 * `sqrtFunc` is the implementation of the SQRT function.
 * SQRT(value) — returns the positive square root.
 */
export function sqrtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const value = NumberArgs.map(visit(exprs[0]), grid);
  if (value.t === 'err') {
    return value;
  }
  if (value.v < 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: Math.sqrt(value.v) };
}

/**
 * `powerFunc` is the implementation of the POWER function.
 * POWER(base, exponent) — returns base raised to exponent.
 */
export function powerFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const base = NumberArgs.map(visit(exprs[0]), grid);
  if (base.t === 'err') {
    return base;
  }

  const exponent = NumberArgs.map(visit(exprs[1]), grid);
  if (exponent.t === 'err') {
    return exponent;
  }

  const result = Math.pow(base.v, exponent.v);
  if (!isFinite(result)) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: result };
}

/**
 * `randFunc` is the implementation of the RAND function.
 * RAND() — returns a random number in [0, 1).
 */
export function randFunc(
  ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (args && args.expr().length > 0) {
    return { t: 'err', v: '#N/A!' };
  }

  return { t: 'num', v: Math.random() };
}

/**
 * `randbetweenFunc` is the implementation of the RANDBETWEEN function.
 * RANDBETWEEN(low, high) — returns a random integer in the inclusive range.
 */
export function randbetweenFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const lowNode = NumberArgs.map(visit(exprs[0]), grid);
  if (lowNode.t === 'err') {
    return lowNode;
  }

  const highNode = NumberArgs.map(visit(exprs[1]), grid);
  if (highNode.t === 'err') {
    return highNode;
  }

  const low = Math.ceil(lowNode.v);
  const high = Math.floor(highNode.v);
  if (low > high) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: Math.floor(Math.random() * (high - low + 1)) + low };
}

/**
 * `productFunc` is the implementation of the PRODUCT function.
 * PRODUCT(number1, [number2], ...) — multiplies numeric values.
 */
export function productFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let value = 1;
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    value *= node.v;
  }

  return { t: 'num', v: value };
}

/**
 * `medianFunc` is the implementation of the MEDIAN function.
 * MEDIAN(number1, [number2], ...) — returns the middle value.
 */
export function medianFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const values: number[] = [];
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    values.push(node.v);
  }

  if (values.length === 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return { t: 'num', v: values[middle] };
  }

  return { t: 'num', v: (values[middle - 1] + values[middle]) / 2 };
}

/**
 * `ifFunc` is the implementation of the IF function.
 * IF(condition, value_if_true, [value_if_false])
 */
export function ifFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const condition = BoolArgs.map(visit(exprs[0]), grid);
  if (condition.t === 'err') {
    return condition;
  }

  if (condition.v) {
    return visit(exprs[1]);
  }

  if (exprs.length === 3) {
    return visit(exprs[2]);
  }

  return { t: 'bool', v: false };
}

/**
 * `ifsFunc` is the implementation of the IFS function.
 * IFS(condition1, value1, [condition2, value2], ...) — returns the first value
 * whose condition is true.
 */
export function ifsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length % 2 !== 0) {
    return { t: 'err', v: '#N/A!' };
  }

  for (let i = 0; i < exprs.length; i += 2) {
    const condition = BoolArgs.map(visit(exprs[i]), grid);
    if (condition.t === 'err') {
      return condition;
    }

    if (condition.v) {
      return visit(exprs[i + 1]);
    }
  }

  return { t: 'err', v: '#N/A!' };
}

/**
 * `switchFunc` is the implementation of the SWITCH function.
 * SWITCH(expression, case1, value1, [case2, value2], [default])
 */
export function switchFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const expression = toStr(visit(exprs[0]), grid);
  if (expression.t === 'err') {
    return expression;
  }

  const remaining = exprs.length - 1;
  const hasDefault = remaining % 2 === 1;
  const pairCount = hasDefault ? (remaining - 1) / 2 : remaining / 2;

  for (let i = 0; i < pairCount; i++) {
    const caseValue = toStr(visit(exprs[1 + i * 2]), grid);
    if (caseValue.t === 'err') {
      return caseValue;
    }

    if (caseValue.v === expression.v) {
      return visit(exprs[2 + i * 2]);
    }
  }

  if (hasDefault) {
    return visit(exprs[exprs.length - 1]);
  }

  return { t: 'err', v: '#N/A!' };
}

/**
 * `andFunc` is the implementation of the AND function.
 * AND(val1, val2, ...) — returns TRUE if all arguments are truthy.
 */
export function andFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  for (const node of BoolArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }

    if (!node.v) {
      return { t: 'bool', v: false };
    }
  }

  return { t: 'bool', v: true };
}

/**
 * `orFunc` is the implementation of the OR function.
 * OR(val1, val2, ...) — returns TRUE if any argument is truthy.
 */
export function orFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  for (const node of BoolArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }

    if (node.v) {
      return { t: 'bool', v: true };
    }
  }

  return { t: 'bool', v: false };
}

/**
 * `notFunc` is the implementation of the NOT function.
 * NOT(value) — returns the opposite boolean value.
 */
export function notFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const value = BoolArgs.map(visit(exprs[0]), grid);
  if (value.t === 'err') {
    return value;
  }

  return { t: 'bool', v: !value.v };
}

/**
 * `average` is the implementation of the AVERAGE function.
 * AVERAGE(number1, [number2], ...) — returns the arithmetic mean.
 */
export function average(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args()!;
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let sum = 0;
  let count = 0;
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    sum += node.v;
    count++;
  }

  if (count === 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: sum / count };
}

/**
 * `minFunc` is the implementation of the MIN function.
 * MIN(number1, [number2], ...) — returns the smallest value.
 */
export function minFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args()!;
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let result = Infinity;
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    if (node.v < result) {
      result = node.v;
    }
  }

  return { t: 'num', v: result };
}

/**
 * `maxFunc` is the implementation of the MAX function.
 * MAX(number1, [number2], ...) — returns the largest value.
 */
export function maxFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args()!;
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let result = -Infinity;
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    if (node.v > result) {
      result = node.v;
    }
  }

  return { t: 'num', v: result };
}

/**
 * `countFunc` is the implementation of the COUNT function.
 * COUNT(value1, [value2], ...) — counts numeric values only.
 */
export function countFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args()!;
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let count = 0;
  for (const expr of args.expr()) {
    const node = visit(expr);
    if (node.t === 'num') {
      count++;
    } else if (node.t === 'bool') {
      count++;
    } else if (node.t === 'ref' && grid) {
      if (isSrng(node.v)) {
        for (const ref of toSrefs([node.v])) {
          const val = grid.get(ref)?.v || '';
          if (val !== '' && !isNaN(Number(val))) {
            count++;
          }
        }
      } else {
        const val = grid.get(node.v)?.v || '';
        if (val !== '' && !isNaN(Number(val))) {
          count++;
        }
      }
    }
    // strings that aren't numeric are skipped
  }

  return { t: 'num', v: count };
}

/**
 * `countaFunc` is the implementation of the COUNTA function.
 * COUNTA(value1, [value2], ...) — counts non-empty values.
 */
export function countaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args()!;
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let count = 0;
  for (const expr of args.expr()) {
    const node = visit(expr);
    if (node.t === 'num' || node.t === 'bool') {
      count++;
    } else if (node.t === 'str') {
      if (node.v !== '') {
        count++;
      }
    } else if (node.t === 'ref' && grid) {
      if (isSrng(node.v)) {
        for (const ref of toSrefs([node.v])) {
          const val = grid.get(ref)?.v || '';
          if (val !== '') {
            count++;
          }
        }
      } else {
        const val = grid.get(node.v)?.v || '';
        if (val !== '') {
          count++;
        }
      }
    }
  }

  return { t: 'num', v: count };
}

/**
 * `countblankFunc` is the implementation of the COUNTBLANK function.
 * COUNTBLANK(value1, [value2], ...) — counts empty values.
 */
export function countblankFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args()!;
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let count = 0;
  for (const expr of args.expr()) {
    const node = visit(expr);

    if (node.t === 'str') {
      if (node.v === '') {
        count++;
      }
      continue;
    }

    if (node.t !== 'ref' || !grid) {
      continue;
    }

    if (isSrng(node.v)) {
      for (const ref of toSrefs([node.v])) {
        const val = grid.get(ref)?.v || '';
        if (val === '') {
          count++;
        }
      }
      continue;
    }

    const val = grid.get(node.v)?.v || '';
    if (val === '') {
      count++;
    }
  }

  return { t: 'num', v: count };
}

/**
 * `countifFunc` is the implementation of the COUNTIF function.
 * COUNTIF(range, criterion) — counts cells that satisfy a criterion.
 */
export function countifFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const refs = getRefsFromExpression(exprs[0], visit, grid);
  if (refs.t === 'err') {
    return refs;
  }

  const criterion = parseCriterion(visit(exprs[1]), grid);
  if (isFormulaError(criterion)) {
    return criterion;
  }

  let count = 0;
  for (const ref of refs.v) {
    const value = grid?.get(ref)?.v || '';
    if (matchesCriterion(value, criterion)) {
      count++;
    }
  }

  return { t: 'num', v: count };
}

/**
 * `sumifFunc` is the implementation of the SUMIF function.
 * SUMIF(range, criterion, [sum_range]) — sums values matching a criterion.
 */
export function sumifFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const criteriaRefs = getRefsFromExpression(exprs[0], visit, grid);
  if (criteriaRefs.t === 'err') {
    return criteriaRefs;
  }

  const criterion = parseCriterion(visit(exprs[1]), grid);
  if (isFormulaError(criterion)) {
    return criterion;
  }

  const sumRefs =
    exprs.length === 3
      ? getRefsFromExpression(exprs[2], visit, grid)
      : criteriaRefs;
  if (sumRefs.t === 'err') {
    return sumRefs;
  }

  if (criteriaRefs.v.length !== sumRefs.v.length) {
    return { t: 'err', v: '#VALUE!' };
  }

  let total = 0;
  for (let i = 0; i < criteriaRefs.v.length; i++) {
    const criteriaValue = grid?.get(criteriaRefs.v[i])?.v || '';
    if (!matchesCriterion(criteriaValue, criterion)) {
      continue;
    }

    const sumValue = grid?.get(sumRefs.v[i])?.v || '';
    total += toNumberOrZero(sumValue);
  }

  return { t: 'num', v: total };
}

/**
 * `countifsFunc` is the implementation of the COUNTIFS function.
 * COUNTIFS(criteria_range1, criterion1, ...) — counts rows matching all criteria.
 */
export function countifsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length % 2 !== 0) {
    return { t: 'err', v: '#N/A!' };
  }

  const ranges: string[][] = [];
  const criteria: ParsedCriterion[] = [];
  for (let i = 0; i < exprs.length; i += 2) {
    const refs = getRefsFromExpression(exprs[i], visit, grid);
    if (refs.t === 'err') {
      return refs;
    }
    ranges.push(refs.v);

    const criterion = parseCriterion(visit(exprs[i + 1]), grid);
    if (isFormulaError(criterion)) {
      return criterion;
    }
    criteria.push(criterion);
  }

  const expectedLength = ranges[0].length;
  if (ranges.some((r) => r.length !== expectedLength)) {
    return { t: 'err', v: '#VALUE!' };
  }

  let count = 0;
  for (let i = 0; i < expectedLength; i++) {
    let matched = true;
    for (let j = 0; j < ranges.length; j++) {
      const value = grid?.get(ranges[j][i])?.v || '';
      if (!matchesCriterion(value, criteria[j])) {
        matched = false;
        break;
      }
    }

    if (matched) {
      count++;
    }
  }

  return { t: 'num', v: count };
}

/**
 * `sumifsFunc` is the implementation of the SUMIFS function.
 * SUMIFS(sum_range, criteria_range1, criterion1, ...) — sums rows matching all criteria.
 */
export function sumifsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 3 || (exprs.length - 1) % 2 !== 0) {
    return { t: 'err', v: '#N/A!' };
  }

  const sumRefs = getRefsFromExpression(exprs[0], visit, grid);
  if (sumRefs.t === 'err') {
    return sumRefs;
  }

  const ranges: string[][] = [];
  const criteria: ParsedCriterion[] = [];
  for (let i = 1; i < exprs.length; i += 2) {
    const refs = getRefsFromExpression(exprs[i], visit, grid);
    if (refs.t === 'err') {
      return refs;
    }
    ranges.push(refs.v);

    const criterion = parseCriterion(visit(exprs[i + 1]), grid);
    if (isFormulaError(criterion)) {
      return criterion;
    }
    criteria.push(criterion);
  }

  if (ranges.some((r) => r.length !== sumRefs.v.length)) {
    return { t: 'err', v: '#VALUE!' };
  }

  let total = 0;
  for (let i = 0; i < sumRefs.v.length; i++) {
    let matched = true;
    for (let j = 0; j < ranges.length; j++) {
      const value = grid?.get(ranges[j][i])?.v || '';
      if (!matchesCriterion(value, criteria[j])) {
        matched = false;
        break;
      }
    }

    if (matched) {
      total += toNumberOrZero(grid?.get(sumRefs.v[i])?.v || '');
    }
  }

  return { t: 'num', v: total };
}

/**
 * `matchFunc` is the implementation of the MATCH function.
 * MATCH(search_key, range, [search_type]) — returns relative position in a 1D range.
 */
export function matchFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const lookup = lookupValueFromNode(visit(exprs[0]), grid);
  if (isFormulaError(lookup)) {
    return lookup;
  }

  const matrix = getReferenceMatrixFromExpression(exprs[1], visit, grid);
  if (matrix.t === 'err') {
    return matrix;
  }
  if (matrix.v.rowCount > 1 && matrix.v.colCount > 1) {
    return { t: 'err', v: '#N/A!' };
  }

  let searchType = 1;
  if (exprs.length === 3) {
    const searchTypeNode = NumberArgs.map(visit(exprs[2]), grid);
    if (searchTypeNode.t === 'err') {
      return searchTypeNode;
    }
    searchType = Math.trunc(searchTypeNode.v);
  }

  if (searchType !== -1 && searchType !== 0 && searchType !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  if (searchType === 0) {
    for (let i = 0; i < matrix.v.refs.length; i++) {
      const candidate = lookupValueFromRef(matrix.v.refs[i], grid);
      if (equalLookupValues(candidate, lookup)) {
        return { t: 'num', v: i + 1 };
      }
    }

    return { t: 'err', v: '#N/A!' };
  }

  let bestIndex = -1;
  if (searchType === 1) {
    let bestCmp = -Infinity;
    for (let i = 0; i < matrix.v.refs.length; i++) {
      const candidate = lookupValueFromRef(matrix.v.refs[i], grid);
      const cmp = compareLookupValues(candidate, lookup);
      if (cmp <= 0 && cmp > bestCmp) {
        bestCmp = cmp;
        bestIndex = i;
      }
    }
  } else {
    let bestCmp = Infinity;
    for (let i = 0; i < matrix.v.refs.length; i++) {
      const candidate = lookupValueFromRef(matrix.v.refs[i], grid);
      const cmp = compareLookupValues(candidate, lookup);
      if (cmp >= 0 && cmp < bestCmp) {
        bestCmp = cmp;
        bestIndex = i;
      }
    }
  }

  if (bestIndex < 0) {
    return { t: 'err', v: '#N/A!' };
  }

  return { t: 'num', v: bestIndex + 1 };
}

/**
 * `indexFunc` is the implementation of the INDEX function.
 * INDEX(reference, [row], [column]) — returns a cell value from a range.
 */
export function indexFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const matrix = getReferenceMatrixFromExpression(exprs[0], visit, grid);
  if (matrix.t === 'err') {
    return matrix;
  }

  let row = 1;
  let col = 1;
  if (exprs.length >= 2) {
    const rowNode = NumberArgs.map(visit(exprs[1]), grid);
    if (rowNode.t === 'err') {
      return rowNode;
    }
    const rowArg = Math.trunc(rowNode.v);

    if (exprs.length === 2 && matrix.v.rowCount === 1 && matrix.v.colCount > 1) {
      col = rowArg;
    } else {
      row = rowArg;
    }
  }

  if (exprs.length === 3) {
    const colNode = NumberArgs.map(visit(exprs[2]), grid);
    if (colNode.t === 'err') {
      return colNode;
    }
    col = Math.trunc(colNode.v);
  }

  if (row <= 0 || col <= 0) {
    return { t: 'err', v: '#VALUE!' };
  }
  if (row > matrix.v.rowCount || col > matrix.v.colCount) {
    return { t: 'err', v: '#REF!' };
  }

  return {
    t: 'ref',
    v: matrix.v.refs[(row - 1) * matrix.v.colCount + (col - 1)],
  };
}

/**
 * `vlookupFunc` is the implementation of the VLOOKUP function.
 * VLOOKUP(search_key, range, index, [is_sorted]) — vertical lookup by first column.
 */
export function vlookupFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 4) {
    return { t: 'err', v: '#N/A!' };
  }

  const lookup = lookupValueFromNode(visit(exprs[0]), grid);
  if (isFormulaError(lookup)) {
    return lookup;
  }

  const matrix = getReferenceMatrixFromExpression(exprs[1], visit, grid);
  if (matrix.t === 'err') {
    return matrix;
  }

  const indexNode = NumberArgs.map(visit(exprs[2]), grid);
  if (indexNode.t === 'err') {
    return indexNode;
  }
  const targetCol = Math.trunc(indexNode.v);
  if (targetCol <= 0) {
    return { t: 'err', v: '#VALUE!' };
  }
  if (targetCol > matrix.v.colCount) {
    return { t: 'err', v: '#REF!' };
  }

  let isSorted = true;
  if (exprs.length === 4) {
    const sortedNode = BoolArgs.map(visit(exprs[3]), grid);
    if (sortedNode.t === 'err') {
      return sortedNode;
    }
    isSorted = sortedNode.v;
  }

  if (!isSorted) {
    for (let row = 0; row < matrix.v.rowCount; row++) {
      const keyRef = matrix.v.refs[row * matrix.v.colCount];
      const key = lookupValueFromRef(keyRef, grid);
      if (!equalLookupValues(key, lookup)) {
        continue;
      }

      return {
        t: 'ref',
        v: matrix.v.refs[row * matrix.v.colCount + (targetCol - 1)],
      };
    }

    return { t: 'err', v: '#N/A!' };
  }

  let bestRow = -1;
  let bestCmp = -Infinity;
  for (let row = 0; row < matrix.v.rowCount; row++) {
    const keyRef = matrix.v.refs[row * matrix.v.colCount];
    const key = lookupValueFromRef(keyRef, grid);
    const cmp = compareLookupValues(key, lookup);
    if (cmp <= 0 && cmp > bestCmp) {
      bestCmp = cmp;
      bestRow = row;
    }
  }

  if (bestRow < 0) {
    return { t: 'err', v: '#N/A!' };
  }

  return {
    t: 'ref',
    v: matrix.v.refs[bestRow * matrix.v.colCount + (targetCol - 1)],
  };
}

/**
 * `hlookupFunc` is the implementation of the HLOOKUP function.
 * HLOOKUP(search_key, range, index, [is_sorted]) — horizontal lookup by first row.
 */
export function hlookupFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 4) {
    return { t: 'err', v: '#N/A!' };
  }

  const lookup = lookupValueFromNode(visit(exprs[0]), grid);
  if (isFormulaError(lookup)) {
    return lookup;
  }

  const matrix = getReferenceMatrixFromExpression(exprs[1], visit, grid);
  if (matrix.t === 'err') {
    return matrix;
  }

  const indexNode = NumberArgs.map(visit(exprs[2]), grid);
  if (indexNode.t === 'err') {
    return indexNode;
  }
  const targetRow = Math.trunc(indexNode.v);
  if (targetRow <= 0) {
    return { t: 'err', v: '#VALUE!' };
  }
  if (targetRow > matrix.v.rowCount) {
    return { t: 'err', v: '#REF!' };
  }

  let isSorted = true;
  if (exprs.length === 4) {
    const sortedNode = BoolArgs.map(visit(exprs[3]), grid);
    if (sortedNode.t === 'err') {
      return sortedNode;
    }
    isSorted = sortedNode.v;
  }

  if (!isSorted) {
    for (let col = 0; col < matrix.v.colCount; col++) {
      const keyRef = matrix.v.refs[col];
      const key = lookupValueFromRef(keyRef, grid);
      if (!equalLookupValues(key, lookup)) {
        continue;
      }

      return {
        t: 'ref',
        v: matrix.v.refs[(targetRow - 1) * matrix.v.colCount + col],
      };
    }

    return { t: 'err', v: '#N/A!' };
  }

  let bestCol = -1;
  let bestCmp = -Infinity;
  for (let col = 0; col < matrix.v.colCount; col++) {
    const keyRef = matrix.v.refs[col];
    const key = lookupValueFromRef(keyRef, grid);
    const cmp = compareLookupValues(key, lookup);
    if (cmp <= 0 && cmp > bestCmp) {
      bestCmp = cmp;
      bestCol = col;
    }
  }

  if (bestCol < 0) {
    return { t: 'err', v: '#N/A!' };
  }

  return {
    t: 'ref',
    v: matrix.v.refs[(targetRow - 1) * matrix.v.colCount + bestCol],
  };
}

/**
 * `toStr` converts an EvalNode to a string, propagating errors.
 */
function toStr(
  node: EvalNode,
  grid?: Grid,
):
  | { t: 'str'; v: string }
  | { t: 'err'; v: '#VALUE!' | '#REF!' | '#N/A!' | '#ERROR!' } {
  if (node.t === 'err') return node;
  if (node.t === 'str') return node;
  if (node.t === 'num') return { t: 'str', v: node.v.toString() };
  if (node.t === 'bool') return { t: 'str', v: node.v ? 'TRUE' : 'FALSE' };
  if (node.t === 'ref' && grid) {
    return ref2str(node, grid);
  }
  return { t: 'err', v: '#VALUE!' };
}

/**
 * `trimFunc` is the implementation of the TRIM function.
 * TRIM(text) — removes leading and trailing whitespace.
 */
export function trimFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') return str;

  return { t: 'str', v: str.v.trim() };
}

/**
 * `lenFunc` is the implementation of the LEN function.
 * LEN(text) — returns the length of a string.
 */
export function lenFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') return str;

  return { t: 'num', v: str.v.length };
}

/**
 * `leftFunc` is the implementation of the LEFT function.
 * LEFT(text, [num_chars]) — returns leftmost characters.
 */
export function leftFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') return str;

  let n = 1;
  if (exprs.length === 2) {
    const numNode = NumberArgs.map(visit(exprs[1]), grid);
    if (numNode.t === 'err') return numNode;
    n = numNode.v;
  }

  return { t: 'str', v: str.v.slice(0, n) };
}

/**
 * `rightFunc` is the implementation of the RIGHT function.
 * RIGHT(text, [num_chars]) — returns rightmost characters.
 */
export function rightFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') return str;

  let n = 1;
  if (exprs.length === 2) {
    const numNode = NumberArgs.map(visit(exprs[1]), grid);
    if (numNode.t === 'err') return numNode;
    n = numNode.v;
  }

  return { t: 'str', v: str.v.slice(-n) };
}

/**
 * `midFunc` is the implementation of the MID function.
 * MID(text, start_num, num_chars) — returns characters from the middle.
 */
export function midFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') return str;

  const startNode = NumberArgs.map(visit(exprs[1]), grid);
  if (startNode.t === 'err') return startNode;

  const lenNode = NumberArgs.map(visit(exprs[2]), grid);
  if (lenNode.t === 'err') return lenNode;

  const start = startNode.v - 1; // 1-indexed to 0-indexed
  return { t: 'str', v: str.v.slice(start, start + lenNode.v) };
}

/**
 * `concatenateFunc` is the implementation of the CONCATENATE function.
 * CONCATENATE(string1, string2, ...) — joins strings together.
 */
export function concatenateFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2) {
    return { t: 'err', v: '#N/A!' };
  }

  let result = '';
  for (const expr of exprs) {
    const str = toStr(visit(expr), grid);
    if (str.t === 'err') return str;
    result += str.v;
  }

  return { t: 'str', v: result };
}

/**
 * `concatFunc` is the implementation of the CONCAT function.
 * CONCAT(text1, text2, ...) — joins text values into one string.
 */
export function concatFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  return concatenateFunc(ctx, visit, grid);
}

function parseStartPosition(
  expr: ParseTree | undefined,
  text: string,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): { t: 'num'; v: number } | { t: 'err'; v: '#VALUE!' | '#REF!' | '#N/A!' | '#ERROR!' } {
  if (!expr) {
    return { t: 'num', v: 1 };
  }

  const start = NumberArgs.map(visit(expr), grid);
  if (start.t === 'err') {
    return start;
  }

  const value = Math.trunc(start.v);
  if (value < 1 || value > text.length + 1) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: value };
}

/**
 * `findFunc` is the implementation of the FIND function.
 * FIND(search_for, text_to_search, [starting_at]) — case-sensitive search.
 */
export function findFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const searchFor = toStr(visit(exprs[0]), grid);
  if (searchFor.t === 'err') {
    return searchFor;
  }

  const text = toStr(visit(exprs[1]), grid);
  if (text.t === 'err') {
    return text;
  }

  const start = parseStartPosition(exprs[2], text.v, visit, grid);
  if (start.t === 'err') {
    return start;
  }

  if (searchFor.v === '') {
    return { t: 'num', v: start.v };
  }

  const index = text.v.indexOf(searchFor.v, start.v - 1);
  if (index < 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: index + 1 };
}

function wildcardToRegex(pattern: string): string {
  let regex = '';

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];

    if (ch === '~' && i + 1 < pattern.length) {
      regex += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
      continue;
    }

    if (ch === '*') {
      regex += '.*';
      continue;
    }

    if (ch === '?') {
      regex += '.';
      continue;
    }

    regex += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  return regex;
}

/**
 * `searchFunc` is the implementation of the SEARCH function.
 * SEARCH(search_for, text_to_search, [starting_at]) — case-insensitive search.
 */
export function searchFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const searchFor = toStr(visit(exprs[0]), grid);
  if (searchFor.t === 'err') {
    return searchFor;
  }

  const text = toStr(visit(exprs[1]), grid);
  if (text.t === 'err') {
    return text;
  }

  const start = parseStartPosition(exprs[2], text.v, visit, grid);
  if (start.t === 'err') {
    return start;
  }

  if (searchFor.v === '') {
    return { t: 'num', v: start.v };
  }

  const query = wildcardToRegex(searchFor.v);
  const regex = new RegExp(query, 'i');
  const sliced = text.v.slice(start.v - 1);
  const match = regex.exec(sliced);
  if (!match || match.index === undefined) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: start.v + match.index };
}

/**
 * `textjoinFunc` is the implementation of the TEXTJOIN function.
 * TEXTJOIN(delimiter, ignore_empty, text1, [text2], ...)
 */
export function textjoinFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const delimiter = toStr(visit(exprs[0]), grid);
  if (delimiter.t === 'err') {
    return delimiter;
  }

  const ignoreEmpty = BoolArgs.map(visit(exprs[1]), grid);
  if (ignoreEmpty.t === 'err') {
    return ignoreEmpty;
  }

  const values: string[] = [];
  for (const expr of exprs.slice(2)) {
    const node = visit(expr);

    if (node.t === 'ref' && grid && isSrng(node.v)) {
      for (const ref of toSrefs([node.v])) {
        const value = toStr({ t: 'ref', v: ref }, grid);
        if (value.t === 'err') {
          return value;
        }
        if (ignoreEmpty.v && value.v === '') {
          continue;
        }
        values.push(value.v);
      }
      continue;
    }

    const value = toStr(node, grid);
    if (value.t === 'err') {
      return value;
    }
    if (ignoreEmpty.v && value.v === '') {
      continue;
    }
    values.push(value.v);
  }

  return { t: 'str', v: values.join(delimiter.v) };
}

/**
 * `lowerFunc` is the implementation of the LOWER function.
 * LOWER(text) — converts text to lowercase.
 */
export function lowerFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') {
    return str;
  }

  return { t: 'str', v: str.v.toLowerCase() };
}

/**
 * `upperFunc` is the implementation of the UPPER function.
 * UPPER(text) — converts text to uppercase.
 */
export function upperFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') {
    return str;
  }

  return { t: 'str', v: str.v.toUpperCase() };
}

/**
 * `properFunc` is the implementation of the PROPER function.
 * PROPER(text) — capitalizes words in text.
 */
export function properFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') {
    return str;
  }

  const normalized = str.v.toLowerCase().replace(
    /\b([a-z])([a-z]*)/g,
    (_match, first: string, rest: string) => first.toUpperCase() + rest,
  );
  return { t: 'str', v: normalized };
}

/**
 * `substituteFunc` is the implementation of the SUBSTITUTE function.
 * SUBSTITUTE(text, search_for, replace_with, [occurrence]) — replaces text.
 */
export function substituteFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 4) {
    return { t: 'err', v: '#N/A!' };
  }

  const text = toStr(visit(exprs[0]), grid);
  if (text.t === 'err') {
    return text;
  }

  const searchFor = toStr(visit(exprs[1]), grid);
  if (searchFor.t === 'err') {
    return searchFor;
  }

  const replaceWith = toStr(visit(exprs[2]), grid);
  if (replaceWith.t === 'err') {
    return replaceWith;
  }

  if (searchFor.v === '') {
    return { t: 'str', v: text.v };
  }

  if (exprs.length === 3) {
    return { t: 'str', v: text.v.split(searchFor.v).join(replaceWith.v) };
  }

  const occurrence = NumberArgs.map(visit(exprs[3]), grid);
  if (occurrence.t === 'err') {
    return occurrence;
  }

  const target = Math.trunc(occurrence.v);
  if (target <= 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  let from = 0;
  let count = 0;
  while (true) {
    const index = text.v.indexOf(searchFor.v, from);
    if (index < 0) {
      return { t: 'str', v: text.v };
    }

    count++;
    if (count === target) {
      const replaced =
        text.v.slice(0, index) +
        replaceWith.v +
        text.v.slice(index + searchFor.v.length);
      return { t: 'str', v: replaced };
    }

    from = index + searchFor.v.length;
  }
}

/**
 * `todayFunc` is the implementation of the TODAY function.
 * TODAY() — returns the current date as YYYY-MM-DD.
 */
function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * `todayFunc` is the implementation of the TODAY function.
 * TODAY() — returns the current date as YYYY-MM-DD.
 */
export function todayFunc(
  ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (args && args.expr().length > 0) {
    return { t: 'err', v: '#N/A!' };
  }

  return { t: 'str', v: formatDate(new Date()) };
}

/**
 * `nowFunc` is the implementation of the NOW function.
 * NOW() — returns the current date and time as YYYY-MM-DD HH:MM:SS.
 */
export function nowFunc(
  ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (args && args.expr().length > 0) {
    return { t: 'err', v: '#N/A!' };
  }

  const now = new Date();
  return { t: 'str', v: `${formatDate(now)} ${formatTime(now)}` };
}

/**
 * `parseDate` parses a date from an EvalNode, returning a Date or an error.
 */
function parseDate(
  node: EvalNode,
  grid?: Grid,
): Date | { t: 'err'; v: '#VALUE!' | '#REF!' | '#N/A!' | '#ERROR!' } {
  const str = toStr(node, grid);
  if (str.t === 'err') return str;

  const date = new Date(str.v);
  if (isNaN(date.getTime())) {
    return { t: 'err', v: '#VALUE!' };
  }
  return date;
}

/**
 * `parseDateTime` parses either a full datetime/date value or a time literal.
 */
function parseDateTime(
  node: EvalNode,
  grid?: Grid,
): Date | { t: 'err'; v: '#VALUE!' | '#REF!' | '#N/A!' | '#ERROR!' } {
  const str = toStr(node, grid);
  if (str.t === 'err') {
    return str;
  }

  const timeOnly = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(str.v.trim());
  if (timeOnly) {
    const hour = Number(timeOnly[1]);
    const minute = Number(timeOnly[2]);
    const second = Number(timeOnly[3] || '0');
    if (
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      second < 0 ||
      second > 59
    ) {
      return { t: 'err', v: '#VALUE!' };
    }

    return new Date(1970, 0, 1, hour, minute, second);
  }

  const date = new Date(str.v);
  if (isNaN(date.getTime())) {
    return { t: 'err', v: '#VALUE!' };
  }

  return date;
}

/**
 * `dateFunc` is the implementation of the DATE function.
 * DATE(year, month, day) — returns a normalized date as YYYY-MM-DD.
 */
export function dateFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const yearNode = NumberArgs.map(visit(exprs[0]), grid);
  if (yearNode.t === 'err') {
    return yearNode;
  }
  const monthNode = NumberArgs.map(visit(exprs[1]), grid);
  if (monthNode.t === 'err') {
    return monthNode;
  }
  const dayNode = NumberArgs.map(visit(exprs[2]), grid);
  if (dayNode.t === 'err') {
    return dayNode;
  }

  const year = Math.trunc(yearNode.v);
  const month = Math.trunc(monthNode.v);
  const day = Math.trunc(dayNode.v);
  if (!isFinite(year) || !isFinite(month) || !isFinite(day)) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'str', v: formatDate(new Date(year, month - 1, day)) };
}

/**
 * `timeFunc` is the implementation of the TIME function.
 * TIME(hour, minute, second) — returns a normalized time as HH:MM:SS.
 */
export function timeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const hourNode = NumberArgs.map(visit(exprs[0]), grid);
  if (hourNode.t === 'err') {
    return hourNode;
  }
  const minuteNode = NumberArgs.map(visit(exprs[1]), grid);
  if (minuteNode.t === 'err') {
    return minuteNode;
  }
  const secondNode = NumberArgs.map(visit(exprs[2]), grid);
  if (secondNode.t === 'err') {
    return secondNode;
  }

  const hour = Math.trunc(hourNode.v);
  const minute = Math.trunc(minuteNode.v);
  const second = Math.trunc(secondNode.v);
  if (!isFinite(hour) || !isFinite(minute) || !isFinite(second)) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'str', v: formatTime(new Date(1970, 0, 1, hour, minute, second)) };
}

/**
 * `daysFunc` is the implementation of the DAYS function.
 * DAYS(end_date, start_date) — returns the number of days between two dates.
 */
export function daysFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const endDate = parseDate(visit(exprs[0]), grid);
  if (!(endDate instanceof Date)) {
    return endDate;
  }

  const startDate = parseDate(visit(exprs[1]), grid);
  if (!(startDate instanceof Date)) {
    return startDate;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const endUtc = Date.UTC(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
  );
  const startUtc = Date.UTC(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  );

  return { t: 'num', v: (endUtc - startUtc) / dayMs };
}

/**
 * `yearFunc` is the implementation of the YEAR function.
 * YEAR(date) — returns the year from a date.
 */
export function yearFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) return date;

  return { t: 'num', v: date.getFullYear() };
}

/**
 * `monthFunc` is the implementation of the MONTH function.
 * MONTH(date) — returns the month (1-12) from a date.
 */
export function monthFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) return date;

  return { t: 'num', v: date.getMonth() + 1 };
}

/**
 * `dayFunc` is the implementation of the DAY function.
 * DAY(date) — returns the day of the month from a date.
 */
export function dayFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) return date;

  return { t: 'num', v: date.getDate() };
}

/**
 * `hourFunc` is the implementation of the HOUR function.
 * HOUR(time) — returns hour (0-23) from a time/datetime value.
 */
export function hourFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const date = parseDateTime(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  return { t: 'num', v: date.getHours() };
}

/**
 * `minuteFunc` is the implementation of the MINUTE function.
 * MINUTE(time) — returns minute (0-59) from a time/datetime value.
 */
export function minuteFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const date = parseDateTime(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  return { t: 'num', v: date.getMinutes() };
}

/**
 * `secondFunc` is the implementation of the SECOND function.
 * SECOND(time) — returns second (0-59) from a time/datetime value.
 */
export function secondFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const date = parseDateTime(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  return { t: 'num', v: date.getSeconds() };
}

/**
 * `weekdayFunc` is the implementation of the WEEKDAY function.
 * WEEKDAY(date, [type]) — returns day-of-week index based on numbering type.
 */
export function weekdayFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  let type = 1;
  if (exprs.length === 2) {
    const typeNode = NumberArgs.map(visit(exprs[1]), grid);
    if (typeNode.t === 'err') {
      return typeNode;
    }
    type = Math.trunc(typeNode.v);
  }

  const day = date.getDay(); // Sunday = 0
  if (type === 1) {
    return { t: 'num', v: day + 1 };
  }
  if (type === 2) {
    return { t: 'num', v: day === 0 ? 7 : day };
  }
  if (type === 3) {
    return { t: 'num', v: day === 0 ? 6 : day - 1 };
  }

  return { t: 'err', v: '#VALUE!' };
}

/**
 * `isblankFunc` is the implementation of the ISBLANK function.
 * ISBLANK(value) — returns TRUE when the value is an empty cell reference.
 */
export function isblankFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const node = visit(exprs[0]);
  if (node.t === 'err') {
    return node;
  }
  if (node.t !== 'ref' || !grid) {
    return { t: 'bool', v: false };
  }
  if (isSrng(node.v)) {
    return { t: 'err', v: '#VALUE!' };
  }

  const value = grid.get(node.v)?.v || '';
  return { t: 'bool', v: value === '' };
}

/**
 * `isnumberFunc` is the implementation of the ISNUMBER function.
 * ISNUMBER(value) — returns TRUE when value is numeric.
 */
export function isnumberFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const node = visit(exprs[0]);
  if (node.t === 'err') {
    return node;
  }
  if (node.t === 'num') {
    return { t: 'bool', v: true };
  }
  if (node.t !== 'ref' || !grid) {
    return { t: 'bool', v: false };
  }
  if (isSrng(node.v)) {
    return { t: 'err', v: '#VALUE!' };
  }

  const value = grid.get(node.v)?.v || '';
  const upper = value.toUpperCase();
  const isBoolean = upper === 'TRUE' || upper === 'FALSE';
  return {
    t: 'bool',
    v: value !== '' && !isBoolean && !isNaN(Number(value)),
  };
}

/**
 * `istextFunc` is the implementation of the ISTEXT function.
 * ISTEXT(value) — returns TRUE when value is text.
 */
export function istextFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const node = visit(exprs[0]);
  if (node.t === 'err') {
    return node;
  }
  if (node.t === 'str') {
    return { t: 'bool', v: true };
  }
  if (node.t !== 'ref' || !grid) {
    return { t: 'bool', v: false };
  }
  if (isSrng(node.v)) {
    return { t: 'err', v: '#VALUE!' };
  }

  const value = grid.get(node.v)?.v || '';
  if (value === '') {
    return { t: 'bool', v: false };
  }

  const upper = value.toUpperCase();
  const isBoolean = upper === 'TRUE' || upper === 'FALSE';
  const isNumeric = !isNaN(Number(value));
  return { t: 'bool', v: !isBoolean && !isNumeric };
}

/**
 * `iserrorFunc` is the implementation of the ISERROR function.
 * ISERROR(value) — returns TRUE if the value is any error.
 */
export function iserrorFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const value = visit(exprs[0]);
  return { t: 'bool', v: value.t === 'err' };
}

/**
 * `iserrFunc` is the implementation of the ISERR function.
 * ISERR(value) — returns TRUE for all errors except #N/A!.
 */
export function iserrFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const value = visit(exprs[0]);
  return { t: 'bool', v: value.t === 'err' && value.v !== '#N/A!' };
}

/**
 * `isnaFunc` is the implementation of the ISNA function.
 * ISNA(value) — returns TRUE only for #N/A! errors.
 */
export function isnaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const value = visit(exprs[0]);
  return { t: 'bool', v: value.t === 'err' && value.v === '#N/A!' };
}

/**
 * `islogicalFunc` is the implementation of the ISLOGICAL function.
 * ISLOGICAL(value) — returns TRUE when value is a boolean.
 */
export function islogicalFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const node = visit(exprs[0]);
  if (node.t === 'err') {
    return node;
  }
  if (node.t === 'bool') {
    return { t: 'bool', v: true };
  }
  if (node.t !== 'ref' || !grid) {
    return { t: 'bool', v: false };
  }
  if (isSrng(node.v)) {
    return { t: 'err', v: '#VALUE!' };
  }

  const value = grid.get(node.v)?.v || '';
  const upper = value.toUpperCase();
  return { t: 'bool', v: upper === 'TRUE' || upper === 'FALSE' };
}

/**
 * `isnontextFunc` is the implementation of the ISNONTEXT function.
 * ISNONTEXT(value) — returns TRUE when value is not text.
 */
export function isnontextFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const node = visit(exprs[0]);
  if (node.t === 'err') {
    return { t: 'bool', v: true };
  }
  if (node.t === 'str') {
    return { t: 'bool', v: false };
  }
  if (node.t === 'num' || node.t === 'bool') {
    return { t: 'bool', v: true };
  }
  if (node.t !== 'ref' || !grid) {
    return { t: 'bool', v: false };
  }
  if (isSrng(node.v)) {
    return { t: 'err', v: '#VALUE!' };
  }

  const value = grid.get(node.v)?.v || '';
  if (value === '') {
    return { t: 'bool', v: true };
  }

  const upper = value.toUpperCase();
  const isBoolean = upper === 'TRUE' || upper === 'FALSE';
  const isNumeric = !isNaN(Number(value));
  return { t: 'bool', v: isBoolean || isNumeric };
}

/**
 * `iferrorFunc` is the implementation of the IFERROR function.
 * IFERROR(value, value_if_error) — returns value_if_error if value is an error.
 */
export function iferrorFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const value = visit(exprs[0]);
  if (value.t === 'err') {
    return visit(exprs[1]);
  }

  return value;
}

/**
 * `ifnaFunc` is the implementation of the IFNA function.
 * IFNA(value, value_if_na) — returns fallback only when value is #N/A!.
 */
export function ifnaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const value = visit(exprs[0]);
  if (value.t === 'err' && value.v === '#N/A!') {
    return visit(exprs[1]);
  }

  return value;
}

/**
 * PI() — returns the value of π.
 */
export function piFunc(
  ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (args && args.expr().length > 0) {
    return { t: 'err', v: '#N/A!' };
  }

  return { t: 'num', v: Math.PI };
}

/**
 * SIGN(number) — returns -1, 0, or 1 indicating the sign of a number.
 */
export function signFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: Math.sign(num.v) };
}

/**
 * EVEN(number) — rounds a number up to the nearest even integer.
 */
export function evenFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  const v = num.v;
  if (v === 0) {
    return { t: 'num', v: 0 };
  }

  const rounded = v > 0 ? Math.ceil(v) : Math.floor(v);
  const result = rounded % 2 === 0 ? rounded : (v > 0 ? rounded + 1 : rounded - 1);
  return { t: 'num', v: result };
}

/**
 * ODD(number) — rounds a number up to the nearest odd integer.
 */
export function oddFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  const v = num.v;
  if (v === 0) {
    return { t: 'num', v: 1 };
  }

  const rounded = v > 0 ? Math.ceil(v) : Math.floor(v);
  const absRounded = Math.abs(rounded);
  const result = absRounded % 2 === 1 ? rounded : (v > 0 ? rounded + 1 : rounded - 1);
  return { t: 'num', v: result };
}

/**
 * EXP(number) — returns e raised to the power of a number.
 */
export function expFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: Math.exp(num.v) };
}

/**
 * LN(number) — returns the natural logarithm of a number.
 */
export function lnFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }
  if (num.v <= 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: Math.log(num.v) };
}

/**
 * LOG(number, [base]) — returns the logarithm of a number to the given base (default 10).
 */
export function logFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }
  if (num.v <= 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  let base = 10;
  if (exprs.length === 2) {
    const baseNode = NumberArgs.map(visit(exprs[1]), grid);
    if (baseNode.t === 'err') {
      return baseNode;
    }
    if (baseNode.v <= 0 || baseNode.v === 1) {
      return { t: 'err', v: '#VALUE!' };
    }
    base = baseNode.v;
  }

  return { t: 'num', v: Math.log(num.v) / Math.log(base) };
}

/**
 * SIN(angle) — returns the sine of an angle (in radians).
 */
export function sinFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: Math.sin(num.v) };
}

/**
 * COS(angle) — returns the cosine of an angle (in radians).
 */
export function cosFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: Math.cos(num.v) };
}

/**
 * TAN(angle) — returns the tangent of an angle (in radians).
 */
export function tanFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: Math.tan(num.v) };
}

/**
 * ASIN(value) — returns the arcsine in radians.
 */
export function asinFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }
  if (num.v < -1 || num.v > 1) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: Math.asin(num.v) };
}

/**
 * ACOS(value) — returns the arccosine in radians.
 */
export function acosFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }
  if (num.v < -1 || num.v > 1) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: Math.acos(num.v) };
}

/**
 * ATAN(value) — returns the arctangent in radians.
 */
export function atanFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: Math.atan(num.v) };
}

/**
 * ATAN2(x, y) — returns the angle in radians between the x-axis and a line from the origin to (x, y).
 */
export function atan2Func(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') {
    return x;
  }

  const y = NumberArgs.map(visit(exprs[1]), grid);
  if (y.t === 'err') {
    return y;
  }

  if (x.v === 0 && y.v === 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: Math.atan2(y.v, x.v) };
}

/**
 * DEGREES(angle) — converts radians to degrees.
 */
export function degreesFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: (num.v * 180) / Math.PI };
}

/**
 * RADIANS(angle) — converts degrees to radians.
 */
export function radiansFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: (num.v * Math.PI) / 180 };
}

/**
 * CEILING(number, [significance]) — rounds a number up to the nearest multiple of significance.
 */
export function ceilingFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  let significance = 1;
  if (exprs.length === 2) {
    const sigNode = NumberArgs.map(visit(exprs[1]), grid);
    if (sigNode.t === 'err') {
      return sigNode;
    }
    significance = sigNode.v;
  }

  if (significance === 0) {
    return { t: 'num', v: 0 };
  }

  if (num.v > 0 && significance < 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: Math.ceil(num.v / significance) * significance };
}

/**
 * FLOOR(number, [significance]) — rounds a number down to the nearest multiple of significance.
 */
export function floorFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  let significance = 1;
  if (exprs.length === 2) {
    const sigNode = NumberArgs.map(visit(exprs[1]), grid);
    if (sigNode.t === 'err') {
      return sigNode;
    }
    significance = sigNode.v;
  }

  if (significance === 0) {
    return { t: 'num', v: 0 };
  }

  if (num.v > 0 && significance < 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: Math.floor(num.v / significance) * significance };
}

/**
 * TRUNC(number, [places]) — truncates a number to a given number of decimal places.
 */
export function truncFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  let places = 0;
  if (exprs.length === 2) {
    const placesNode = NumberArgs.map(visit(exprs[1]), grid);
    if (placesNode.t === 'err') {
      return placesNode;
    }
    places = Math.trunc(placesNode.v);
  }

  const factor = Math.pow(10, places);
  return { t: 'num', v: Math.trunc(num.v * factor) / factor };
}

/**
 * MROUND(number, multiple) — rounds a number to the nearest specified multiple.
 */
export function mroundFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  const multiple = NumberArgs.map(visit(exprs[1]), grid);
  if (multiple.t === 'err') {
    return multiple;
  }

  if (multiple.v === 0) {
    return { t: 'num', v: 0 };
  }

  if ((num.v > 0 && multiple.v < 0) || (num.v < 0 && multiple.v > 0)) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: Math.round(num.v / multiple.v) * multiple.v };
}

/**
 * EXACT(text1, text2) — case-sensitive comparison of two strings.
 */
export function exactFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const a = toStr(visit(exprs[0]), grid);
  if (a.t === 'err') {
    return a;
  }

  const b = toStr(visit(exprs[1]), grid);
  if (b.t === 'err') {
    return b;
  }

  return { t: 'bool', v: a.v === b.v };
}

/**
 * REPLACE(old_text, start_num, num_chars, new_text) — replaces part of a text string.
 */
export function replaceFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 4) {
    return { t: 'err', v: '#N/A!' };
  }

  const oldText = toStr(visit(exprs[0]), grid);
  if (oldText.t === 'err') {
    return oldText;
  }

  const startNum = NumberArgs.map(visit(exprs[1]), grid);
  if (startNum.t === 'err') {
    return startNum;
  }

  const numChars = NumberArgs.map(visit(exprs[2]), grid);
  if (numChars.t === 'err') {
    return numChars;
  }

  const newText = toStr(visit(exprs[3]), grid);
  if (newText.t === 'err') {
    return newText;
  }

  const start = Math.trunc(startNum.v) - 1;
  const count = Math.trunc(numChars.v);
  if (start < 0 || count < 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  const result = oldText.v.slice(0, start) + newText.v + oldText.v.slice(start + count);
  return { t: 'str', v: result };
}

/**
 * REPT(text, number_times) — repeats text a given number of times.
 */
export function reptFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const text = toStr(visit(exprs[0]), grid);
  if (text.t === 'err') {
    return text;
  }

  const times = NumberArgs.map(visit(exprs[1]), grid);
  if (times.t === 'err') {
    return times;
  }

  const count = Math.trunc(times.v);
  if (count < 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'str', v: text.v.repeat(count) };
}

/**
 * T(value) — returns text if value is text, or empty string otherwise.
 */
export function tFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const node = visit(exprs[0]);
  if (node.t === 'err') {
    return node;
  }
  if (node.t === 'str') {
    return node;
  }
  if (node.t === 'ref' && grid) {
    const value = grid.get(node.v)?.v || '';
    if (value === '') {
      return { t: 'str', v: '' };
    }
    const upper = value.toUpperCase();
    const isBoolean = upper === 'TRUE' || upper === 'FALSE';
    const isNumeric = !isNaN(Number(value));
    if (isBoolean || isNumeric) {
      return { t: 'str', v: '' };
    }
    return { t: 'str', v: value };
  }

  return { t: 'str', v: '' };
}

/**
 * VALUE(text) — converts a text representation of a number to a number.
 */
export function valueFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') {
    return str;
  }

  const trimmed = str.v.trim();
  const num = Number(trimmed);
  if (trimmed === '' || isNaN(num)) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: num };
}

/**
 * TEXT(number, format) — formats a number as text with a given format pattern.
 * Supports basic patterns: 0, 0.00, #,##0, #,##0.00, 0%, 0.00%.
 */
export function textFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  const fmt = toStr(visit(exprs[1]), grid);
  if (fmt.t === 'err') {
    return fmt;
  }

  const format = fmt.v;
  const value = num.v;

  // Percentage formats
  if (format.endsWith('%')) {
    const decimalPart = format.slice(0, -1);
    const decimals = (decimalPart.split('.')[1] || '').length;
    return { t: 'str', v: (value * 100).toFixed(decimals) + '%' };
  }

  // Comma-separated formats
  if (format.includes(',')) {
    const decimals = (format.split('.')[1] || '').replace(/[^0#]/g, '').length;
    const parts = value.toFixed(decimals).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return { t: 'str', v: parts.join('.') };
  }

  // Fixed decimal formats
  if (format.includes('.')) {
    const decimals = (format.split('.')[1] || '').length;
    return { t: 'str', v: value.toFixed(decimals) };
  }

  // Integer format
  return { t: 'str', v: value.toFixed(0) };
}

/**
 * CHAR(number) — returns the character for the given character code.
 */
export function charFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  const code = Math.trunc(num.v);
  if (code < 1 || code > 65535) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'str', v: String.fromCharCode(code) };
}

/**
 * CODE(text) — returns the character code for the first character in a text string.
 */
export function codeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') {
    return str;
  }

  if (str.v.length === 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: str.v.charCodeAt(0) };
}

/**
 * AVERAGEIF(range, criterion, [average_range]) — averages values matching a criterion.
 */
export function averageifFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const criteriaRefs = getRefsFromExpression(exprs[0], visit, grid);
  if (criteriaRefs.t === 'err') {
    return criteriaRefs;
  }

  const criterion = parseCriterion(visit(exprs[1]), grid);
  if (isFormulaError(criterion)) {
    return criterion;
  }

  const avgRefs =
    exprs.length === 3
      ? getRefsFromExpression(exprs[2], visit, grid)
      : criteriaRefs;
  if (avgRefs.t === 'err') {
    return avgRefs;
  }

  if (criteriaRefs.v.length !== avgRefs.v.length) {
    return { t: 'err', v: '#VALUE!' };
  }

  let total = 0;
  let count = 0;
  for (let i = 0; i < criteriaRefs.v.length; i++) {
    const criteriaValue = grid?.get(criteriaRefs.v[i])?.v || '';
    if (!matchesCriterion(criteriaValue, criterion)) {
      continue;
    }

    const avgValue = grid?.get(avgRefs.v[i])?.v || '';
    const num = Number(avgValue);
    if (avgValue !== '' && !isNaN(num)) {
      total += num;
      count++;
    }
  }

  if (count === 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: total / count };
}

/**
 * AVERAGEIFS(average_range, criteria_range1, criterion1, ...) — averages values matching all criteria.
 */
export function averageifsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 3 || (exprs.length - 1) % 2 !== 0) {
    return { t: 'err', v: '#N/A!' };
  }

  const avgRefs = getRefsFromExpression(exprs[0], visit, grid);
  if (avgRefs.t === 'err') {
    return avgRefs;
  }

  const ranges: string[][] = [];
  const criteria: ParsedCriterion[] = [];
  for (let i = 1; i < exprs.length; i += 2) {
    const refs = getRefsFromExpression(exprs[i], visit, grid);
    if (refs.t === 'err') {
      return refs;
    }
    ranges.push(refs.v);

    const criterion = parseCriterion(visit(exprs[i + 1]), grid);
    if (isFormulaError(criterion)) {
      return criterion;
    }
    criteria.push(criterion);
  }

  if (ranges.some((r) => r.length !== avgRefs.v.length)) {
    return { t: 'err', v: '#VALUE!' };
  }

  let total = 0;
  let count = 0;
  for (let i = 0; i < avgRefs.v.length; i++) {
    let matched = true;
    for (let j = 0; j < ranges.length; j++) {
      const value = grid?.get(ranges[j][i])?.v || '';
      if (!matchesCriterion(value, criteria[j])) {
        matched = false;
        break;
      }
    }

    if (matched) {
      const avgValue = grid?.get(avgRefs.v[i])?.v || '';
      const num = Number(avgValue);
      if (avgValue !== '' && !isNaN(num)) {
        total += num;
        count++;
      }
    }
  }

  if (count === 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: total / count };
}

/**
 * LARGE(data, n) — returns the nth largest value in a data set.
 */
export function largeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const values: number[] = [];
  const dataNode = visit(exprs[0]);
  if (dataNode.t === 'err') {
    return dataNode;
  }
  if (dataNode.t === 'num') {
    values.push(dataNode.v);
  } else if (dataNode.t === 'ref' && grid) {
    for (const ref of toSrefs([dataNode.v])) {
      const cellVal = grid.get(ref)?.v || '';
      if (cellVal !== '' && !isNaN(Number(cellVal))) {
        values.push(Number(cellVal));
      }
    }
  }

  const nNode = NumberArgs.map(visit(exprs[1]), grid);
  if (nNode.t === 'err') {
    return nNode;
  }

  const n = Math.trunc(nNode.v);
  if (n < 1 || n > values.length) {
    return { t: 'err', v: '#VALUE!' };
  }

  values.sort((a, b) => b - a);
  return { t: 'num', v: values[n - 1] };
}

/**
 * SMALL(data, n) — returns the nth smallest value in a data set.
 */
export function smallFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const values: number[] = [];
  const dataNode = visit(exprs[0]);
  if (dataNode.t === 'err') {
    return dataNode;
  }
  if (dataNode.t === 'num') {
    values.push(dataNode.v);
  } else if (dataNode.t === 'ref' && grid) {
    for (const ref of toSrefs([dataNode.v])) {
      const cellVal = grid.get(ref)?.v || '';
      if (cellVal !== '' && !isNaN(Number(cellVal))) {
        values.push(Number(cellVal));
      }
    }
  }

  const nNode = NumberArgs.map(visit(exprs[1]), grid);
  if (nNode.t === 'err') {
    return nNode;
  }

  const n = Math.trunc(nNode.v);
  if (n < 1 || n > values.length) {
    return { t: 'err', v: '#VALUE!' };
  }

  values.sort((a, b) => a - b);
  return { t: 'num', v: values[n - 1] };
}

/**
 * N(value) — converts a value to a number.
 */
export function nFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const node = visit(exprs[0]);
  if (node.t === 'err') {
    return node;
  }
  if (node.t === 'num') {
    return node;
  }
  if (node.t === 'bool') {
    return { t: 'num', v: node.v ? 1 : 0 };
  }
  if (node.t === 'ref' && grid) {
    const value = grid.get(node.v)?.v || '';
    if (value === '') {
      return { t: 'num', v: 0 };
    }
    const upper = value.toUpperCase();
    if (upper === 'TRUE') return { t: 'num', v: 1 };
    if (upper === 'FALSE') return { t: 'num', v: 0 };
    const num = Number(value);
    return { t: 'num', v: isNaN(num) ? 0 : num };
  }

  return { t: 'num', v: 0 };
}

/**
 * SUMPRODUCT(array1, [array2], ...) — multiplies corresponding elements and returns the sum.
 */
export function sumproductFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const arrays: number[][] = [];
  for (const expr of exprs) {
    const refs = getRefsFromExpression(expr, visit, grid);
    if (refs.t === 'err') {
      return refs;
    }

    const values: number[] = [];
    for (const ref of refs.v) {
      const cellVal = grid?.get(ref)?.v || '';
      values.push(cellVal !== '' && !isNaN(Number(cellVal)) ? Number(cellVal) : 0);
    }
    arrays.push(values);
  }

  const length = arrays[0].length;
  if (arrays.some((a) => a.length !== length)) {
    return { t: 'err', v: '#VALUE!' };
  }

  let total = 0;
  for (let i = 0; i < length; i++) {
    let product = 1;
    for (const arr of arrays) {
      product *= arr[i];
    }
    total += product;
  }

  return { t: 'num', v: total };
}

function gcdTwo(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * GCD(number1, [number2], ...) — returns the greatest common divisor.
 */
export function gcdFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let result = 0;
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    const val = Math.trunc(node.v);
    if (val < 0) {
      return { t: 'err', v: '#VALUE!' };
    }
    result = gcdTwo(result, val);
  }

  return { t: 'num', v: result };
}

/**
 * LCM(number1, [number2], ...) — returns the least common multiple.
 */
export function lcmFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let result = 1;
  let hasValue = false;
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    const val = Math.trunc(node.v);
    if (val < 0) {
      return { t: 'err', v: '#VALUE!' };
    }
    if (val === 0) {
      return { t: 'num', v: 0 };
    }
    result = (result / gcdTwo(result, val)) * val;
    hasValue = true;
  }

  if (!hasValue) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: result };
}

/**
 * COMBIN(n, k) — returns the number of combinations.
 */
export function combinFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const nNode = NumberArgs.map(visit(exprs[0]), grid);
  if (nNode.t === 'err') {
    return nNode;
  }

  const kNode = NumberArgs.map(visit(exprs[1]), grid);
  if (kNode.t === 'err') {
    return kNode;
  }

  const n = Math.trunc(nNode.v);
  const k = Math.trunc(kNode.v);
  if (n < 0 || k < 0 || k > n) {
    return { t: 'err', v: '#VALUE!' };
  }

  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }

  return { t: 'num', v: Math.round(result) };
}

/**
 * FACT(number) — returns the factorial of a number.
 */
export function factFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  const n = Math.trunc(num.v);
  if (n < 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return { t: 'num', v: result };
}

/**
 * QUOTIENT(numerator, denominator) — returns the integer portion of a division.
 */
export function quotientFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const numerator = NumberArgs.map(visit(exprs[0]), grid);
  if (numerator.t === 'err') {
    return numerator;
  }

  const denominator = NumberArgs.map(visit(exprs[1]), grid);
  if (denominator.t === 'err') {
    return denominator;
  }

  if (denominator.v === 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: Math.trunc(numerator.v / denominator.v) };
}

/**
 * XOR(logical1, [logical2], ...) — returns TRUE if an odd number of arguments are TRUE.
 */
export function xorFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let trueCount = 0;
  for (const node of BoolArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    if (node.v) {
      trueCount++;
    }
  }

  return { t: 'bool', v: trueCount % 2 === 1 };
}

/**
 * CHOOSE(index, value1, [value2], ...) — returns a value from a list based on index.
 */
export function chooseFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const indexNode = NumberArgs.map(visit(exprs[0]), grid);
  if (indexNode.t === 'err') {
    return indexNode;
  }

  const index = Math.trunc(indexNode.v);
  if (index < 1 || index >= exprs.length) {
    return { t: 'err', v: '#VALUE!' };
  }

  return visit(exprs[index]);
}

/**
 * TYPE(value) — returns a number indicating the data type of a value.
 * 1=number, 2=text, 4=boolean, 16=error, 64=array.
 */
export function typeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const node = visit(exprs[0]);
  switch (node.t) {
    case 'num':
      return { t: 'num', v: 1 };
    case 'str':
      return { t: 'num', v: 2 };
    case 'bool':
      return { t: 'num', v: 4 };
    case 'err':
      return { t: 'num', v: 16 };
    case 'ref':
      return { t: 'num', v: 1 }; // Cell refs are treated as number by default
    default:
      return { t: 'num', v: 1 };
  }
}

/**
 * EDATE(start_date, months) — returns a date that is a given number of months before/after.
 */
export function edateFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  const monthsNode = NumberArgs.map(visit(exprs[1]), grid);
  if (monthsNode.t === 'err') {
    return monthsNode;
  }

  const months = Math.trunc(monthsNode.v);
  const result = new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
  return { t: 'str', v: formatDate(result) };
}

/**
 * EOMONTH(start_date, months) — returns the last day of a month a given number of months away.
 */
export function eomonthFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  const monthsNode = NumberArgs.map(visit(exprs[1]), grid);
  if (monthsNode.t === 'err') {
    return monthsNode;
  }

  const months = Math.trunc(monthsNode.v);
  // Day 0 of the next month = last day of the target month
  const result = new Date(date.getFullYear(), date.getMonth() + months + 1, 0);
  return { t: 'str', v: formatDate(result) };
}

/**
 * NETWORKDAYS(start_date, end_date) — returns the number of working days between two dates.
 * Excludes weekends (Saturday and Sunday). Holidays parameter not supported.
 */
export function networkdaysFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const startDate = parseDate(visit(exprs[0]), grid);
  if (!(startDate instanceof Date)) {
    return startDate;
  }

  const endDate = parseDate(visit(exprs[1]), grid);
  if (!(endDate instanceof Date)) {
    return endDate;
  }

  const direction = startDate <= endDate ? 1 : -1;
  const start = direction === 1 ? startDate : endDate;
  const end = direction === 1 ? endDate : startDate;

  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }

  return { t: 'num', v: count * direction };
}

/**
 * DATEVALUE(date_string) — converts a date string to a date value.
 */
export function datevalueFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  return { t: 'str', v: formatDate(date) };
}

/**
 * TIMEVALUE(time_string) — converts a time string to a time value (fraction of a day).
 */
export function timevalueFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const date = parseDateTime(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const fraction = (hours * 3600 + minutes * 60 + seconds) / 86400;

  return { t: 'num', v: fraction };
}

/**
 * DATEDIF(start_date, end_date, unit) — calculates the difference between two dates.
 * Units: "Y" (years), "M" (months), "D" (days).
 */
export function datedifFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const startDate = parseDate(visit(exprs[0]), grid);
  if (!(startDate instanceof Date)) {
    return startDate;
  }

  const endDate = parseDate(visit(exprs[1]), grid);
  if (!(endDate instanceof Date)) {
    return endDate;
  }

  if (startDate > endDate) {
    return { t: 'err', v: '#VALUE!' };
  }

  const unitStr = toStr(visit(exprs[2]), grid);
  if (unitStr.t === 'err') {
    return unitStr;
  }

  const unit = unitStr.v.toUpperCase();

  if (unit === 'D') {
    const dayMs = 24 * 60 * 60 * 1000;
    const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    return { t: 'num', v: (endUtc - startUtc) / dayMs };
  }

  if (unit === 'M') {
    let months =
      (endDate.getFullYear() - startDate.getFullYear()) * 12 +
      (endDate.getMonth() - startDate.getMonth());
    if (endDate.getDate() < startDate.getDate()) {
      months--;
    }
    return { t: 'num', v: months };
  }

  if (unit === 'Y') {
    let years = endDate.getFullYear() - startDate.getFullYear();
    if (
      endDate.getMonth() < startDate.getMonth() ||
      (endDate.getMonth() === startDate.getMonth() && endDate.getDate() < startDate.getDate())
    ) {
      years--;
    }
    return { t: 'num', v: years };
  }

  if (unit === 'MD') {
    let days = endDate.getDate() - startDate.getDate();
    if (days < 0) {
      const prevMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 0);
      days += prevMonth.getDate();
    }
    return { t: 'num', v: days };
  }

  if (unit === 'YM') {
    let months = endDate.getMonth() - startDate.getMonth();
    if (months < 0) {
      months += 12;
    }
    if (endDate.getDate() < startDate.getDate()) {
      months--;
      if (months < 0) months += 12;
    }
    return { t: 'num', v: months };
  }

  if (unit === 'YD') {
    const startAdjusted = new Date(endDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    if (startAdjusted > endDate) {
      startAdjusted.setFullYear(startAdjusted.getFullYear() - 1);
    }
    const dayMs = 24 * 60 * 60 * 1000;
    const startUtc = Date.UTC(startAdjusted.getFullYear(), startAdjusted.getMonth(), startAdjusted.getDate());
    const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    return { t: 'num', v: (endUtc - startUtc) / dayMs };
  }

  return { t: 'err', v: '#VALUE!' };
}

/**
 * ROW([reference]) — returns the row number of a reference.
 */
export function rowFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args || args.expr().length === 0) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const node = visit(exprs[0]);
  if (node.t === 'err') {
    return node;
  }
  if (node.t !== 'ref') {
    return { t: 'err', v: '#VALUE!' };
  }

  const refStr = isSrng(node.v) ? node.v.split(':')[0] : node.v;
  let localRef = refStr;
  if (isCrossSheetRef(refStr)) {
    localRef = parseCrossSheetRef(refStr).localRef;
  }

  try {
    const ref = parseRef(localRef);
    return { t: 'num', v: ref.r };
  } catch {
    return { t: 'err', v: '#REF!' };
  }
}

/**
 * COLUMN([reference]) — returns the column number of a reference.
 */
export function columnFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args || args.expr().length === 0) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const node = visit(exprs[0]);
  if (node.t === 'err') {
    return node;
  }
  if (node.t !== 'ref') {
    return { t: 'err', v: '#VALUE!' };
  }

  const refStr = isSrng(node.v) ? node.v.split(':')[0] : node.v;
  let localRef = refStr;
  if (isCrossSheetRef(refStr)) {
    localRef = parseCrossSheetRef(refStr).localRef;
  }

  try {
    const ref = parseRef(localRef);
    return { t: 'num', v: ref.c };
  } catch {
    return { t: 'err', v: '#REF!' };
  }
}

/**
 * ROWS(range) — returns the number of rows in a range.
 */
export function rowsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const node = visit(exprs[0]);
  if (node.t === 'err') {
    return node;
  }
  if (node.t !== 'ref') {
    return { t: 'err', v: '#VALUE!' };
  }

  if (!isSrng(node.v)) {
    return { t: 'num', v: 1 };
  }

  let localRange = node.v;
  if (isCrossSheetRef(node.v)) {
    localRange = parseCrossSheetRef(node.v).localRef;
  }

  try {
    const [from, to] = parseRange(localRange);
    return { t: 'num', v: Math.abs(to.r - from.r) + 1 };
  } catch {
    return { t: 'err', v: '#REF!' };
  }
}

/**
 * COLUMNS(range) — returns the number of columns in a range.
 */
export function columnsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const node = visit(exprs[0]);
  if (node.t === 'err') {
    return node;
  }
  if (node.t !== 'ref') {
    return { t: 'err', v: '#VALUE!' };
  }

  if (!isSrng(node.v)) {
    return { t: 'num', v: 1 };
  }

  let localRange = node.v;
  if (isCrossSheetRef(node.v)) {
    localRange = parseCrossSheetRef(node.v).localRef;
  }

  try {
    const [from, to] = parseRange(localRange);
    return { t: 'num', v: Math.abs(to.c - from.c) + 1 };
  } catch {
    return { t: 'err', v: '#REF!' };
  }
}

/**
 * ADDRESS(row, column, [abs_num]) — returns a cell reference as a string.
 */
export function addressFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 4) {
    return { t: 'err', v: '#N/A!' };
  }

  const rowNode = NumberArgs.map(visit(exprs[0]), grid);
  if (rowNode.t === 'err') {
    return rowNode;
  }
  const colNode = NumberArgs.map(visit(exprs[1]), grid);
  if (colNode.t === 'err') {
    return colNode;
  }

  const row = Math.trunc(rowNode.v);
  const col = Math.trunc(colNode.v);
  if (row < 1 || col < 1) {
    return { t: 'err', v: '#VALUE!' };
  }

  let absNum = 1;
  if (exprs.length >= 3) {
    const absNode = NumberArgs.map(visit(exprs[2]), grid);
    if (absNode.t === 'err') {
      return absNode;
    }
    absNum = Math.trunc(absNode.v);
  }

  const colLabel = toColumnLabel(col);

  switch (absNum) {
    case 1:
      return { t: 'str', v: `$${colLabel}$${row}` };
    case 2:
      return { t: 'str', v: `${colLabel}$${row}` };
    case 3:
      return { t: 'str', v: `$${colLabel}${row}` };
    case 4:
      return { t: 'str', v: `${colLabel}${row}` };
    default:
      return { t: 'err', v: '#VALUE!' };
  }
}

/**
 * HYPERLINK(url, [link_label]) — creates a hyperlink. Returns the label text.
 */
export function hyperlinkFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const url = toStr(visit(exprs[0]), grid);
  if (url.t === 'err') {
    return url;
  }

  if (exprs.length === 2) {
    const label = toStr(visit(exprs[1]), grid);
    if (label.t === 'err') {
      return label;
    }
    return { t: 'str', v: label.v };
  }

  return { t: 'str', v: url.v };
}

/**
 * MINIFS(min_range, criteria_range1, criterion1, ...) — returns the minimum of a range meeting all criteria.
 */
export function minifsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 3 || (exprs.length - 1) % 2 !== 0) {
    return { t: 'err', v: '#N/A!' };
  }

  const minRefs = getRefsFromExpression(exprs[0], visit, grid);
  if (minRefs.t === 'err') {
    return minRefs;
  }

  const ranges: string[][] = [];
  const criteria: ParsedCriterion[] = [];
  for (let i = 1; i < exprs.length; i += 2) {
    const refs = getRefsFromExpression(exprs[i], visit, grid);
    if (refs.t === 'err') {
      return refs;
    }
    ranges.push(refs.v);

    const criterion = parseCriterion(visit(exprs[i + 1]), grid);
    if (isFormulaError(criterion)) {
      return criterion;
    }
    criteria.push(criterion);
  }

  if (ranges.some((r) => r.length !== minRefs.v.length)) {
    return { t: 'err', v: '#VALUE!' };
  }

  let min = Infinity;
  for (let i = 0; i < minRefs.v.length; i++) {
    let matched = true;
    for (let j = 0; j < ranges.length; j++) {
      const value = grid?.get(ranges[j][i])?.v || '';
      if (!matchesCriterion(value, criteria[j])) {
        matched = false;
        break;
      }
    }

    if (matched) {
      const val = grid?.get(minRefs.v[i])?.v || '';
      const num = Number(val);
      if (val !== '' && !isNaN(num) && num < min) {
        min = num;
      }
    }
  }

  if (min === Infinity) {
    return { t: 'num', v: 0 };
  }

  return { t: 'num', v: min };
}

/**
 * MAXIFS(max_range, criteria_range1, criterion1, ...) — returns the maximum of a range meeting all criteria.
 */
export function maxifsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 3 || (exprs.length - 1) % 2 !== 0) {
    return { t: 'err', v: '#N/A!' };
  }

  const maxRefs = getRefsFromExpression(exprs[0], visit, grid);
  if (maxRefs.t === 'err') {
    return maxRefs;
  }

  const ranges: string[][] = [];
  const criteria: ParsedCriterion[] = [];
  for (let i = 1; i < exprs.length; i += 2) {
    const refs = getRefsFromExpression(exprs[i], visit, grid);
    if (refs.t === 'err') {
      return refs;
    }
    ranges.push(refs.v);

    const criterion = parseCriterion(visit(exprs[i + 1]), grid);
    if (isFormulaError(criterion)) {
      return criterion;
    }
    criteria.push(criterion);
  }

  if (ranges.some((r) => r.length !== maxRefs.v.length)) {
    return { t: 'err', v: '#VALUE!' };
  }

  let max = -Infinity;
  for (let i = 0; i < maxRefs.v.length; i++) {
    let matched = true;
    for (let j = 0; j < ranges.length; j++) {
      const value = grid?.get(ranges[j][i])?.v || '';
      if (!matchesCriterion(value, criteria[j])) {
        matched = false;
        break;
      }
    }

    if (matched) {
      const val = grid?.get(maxRefs.v[i])?.v || '';
      const num = Number(val);
      if (val !== '' && !isNaN(num) && num > max) {
        max = num;
      }
    }
  }

  if (max === -Infinity) {
    return { t: 'num', v: 0 };
  }

  return { t: 'num', v: max };
}

/**
 * RANK(value, data, [order]) — returns the rank of a value within a data set.
 * order=0 (default): descending. order=1: ascending.
 */
export function rankFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const valueNode = NumberArgs.map(visit(exprs[0]), grid);
  if (valueNode.t === 'err') {
    return valueNode;
  }

  const dataNode = visit(exprs[1]);
  if (dataNode.t === 'err') {
    return dataNode;
  }

  const values: number[] = [];
  if (dataNode.t === 'num') {
    values.push(dataNode.v);
  } else if (dataNode.t === 'ref' && grid) {
    for (const ref of toSrefs([dataNode.v])) {
      const cellVal = grid.get(ref)?.v || '';
      if (cellVal !== '' && !isNaN(Number(cellVal))) {
        values.push(Number(cellVal));
      }
    }
  }

  let order = 0;
  if (exprs.length === 3) {
    const orderNode = NumberArgs.map(visit(exprs[2]), grid);
    if (orderNode.t === 'err') {
      return orderNode;
    }
    order = Math.trunc(orderNode.v);
  }

  const target = valueNode.v;
  if (!values.includes(target)) {
    return { t: 'err', v: '#N/A!' };
  }

  if (order === 0) {
    // Descending: count values greater than target
    const rank = values.filter((v) => v > target).length + 1;
    return { t: 'num', v: rank };
  } else {
    // Ascending: count values less than target
    const rank = values.filter((v) => v < target).length + 1;
    return { t: 'num', v: rank };
  }
}

/**
 * PERCENTILE(data, k) — returns the k-th percentile of a data set (k in 0..1).
 */
export function percentileFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const values: number[] = [];
  const dataNode = visit(exprs[0]);
  if (dataNode.t === 'err') {
    return dataNode;
  }
  if (dataNode.t === 'num') {
    values.push(dataNode.v);
  } else if (dataNode.t === 'ref' && grid) {
    for (const ref of toSrefs([dataNode.v])) {
      const cellVal = grid.get(ref)?.v || '';
      if (cellVal !== '' && !isNaN(Number(cellVal))) {
        values.push(Number(cellVal));
      }
    }
  }

  const kNode = NumberArgs.map(visit(exprs[1]), grid);
  if (kNode.t === 'err') {
    return kNode;
  }

  const k = kNode.v;
  if (k < 0 || k > 1 || values.length === 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  values.sort((a, b) => a - b);
  const n = values.length;
  const rank = k * (n - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const fraction = rank - lower;

  if (lower === upper) {
    return { t: 'num', v: values[lower] };
  }

  return { t: 'num', v: values[lower] + fraction * (values[upper] - values[lower]) };
}

/**
 * CLEAN(text) — removes all non-printable characters from text.
 */
export function cleanFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') {
    return str;
  }

  // Remove characters 0-31 (non-printable ASCII control characters)
  // eslint-disable-next-line no-control-regex
  return { t: 'str', v: str.v.replace(/[\x00-\x1F]/g, '') };
}

/**
 * NUMBERVALUE(text, [decimal_separator], [group_separator]) — converts text to number.
 */
export function numbervalueFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') {
    return str;
  }

  let decimalSep = '.';
  if (exprs.length >= 2) {
    const decNode = toStr(visit(exprs[1]), grid);
    if (decNode.t === 'err') {
      return decNode;
    }
    decimalSep = decNode.v || '.';
  }

  let groupSep = ',';
  if (exprs.length === 3) {
    const grpNode = toStr(visit(exprs[2]), grid);
    if (grpNode.t === 'err') {
      return grpNode;
    }
    groupSep = grpNode.v || ',';
  }

  let cleaned = str.v.trim();
  if (groupSep) {
    cleaned = cleaned.split(groupSep).join('');
  }
  if (decimalSep !== '.') {
    cleaned = cleaned.replace(decimalSep, '.');
  }

  // Handle percentage
  if (cleaned.endsWith('%')) {
    const num = Number(cleaned.slice(0, -1));
    if (isNaN(num)) {
      return { t: 'err', v: '#VALUE!' };
    }
    return { t: 'num', v: num / 100 };
  }

  const num = Number(cleaned);
  if (cleaned === '' || isNaN(num)) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: num };
}

/**
 * STDEV(number1, [number2], ...) — returns the sample standard deviation.
 */
export function stdevFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const values: number[] = [];
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    values.push(node.v);
  }

  if (values.length < 2) {
    return { t: 'err', v: '#VALUE!' };
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sumSqDiff = values.reduce((a, v) => a + (v - mean) ** 2, 0);
  return { t: 'num', v: Math.sqrt(sumSqDiff / (values.length - 1)) };
}

/**
 * STDEVP(number1, [number2], ...) — returns the population standard deviation.
 */
export function stdevpFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const values: number[] = [];
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    values.push(node.v);
  }

  if (values.length === 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sumSqDiff = values.reduce((a, v) => a + (v - mean) ** 2, 0);
  return { t: 'num', v: Math.sqrt(sumSqDiff / values.length) };
}

/**
 * VAR(number1, [number2], ...) — returns the sample variance.
 */
export function varFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const values: number[] = [];
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    values.push(node.v);
  }

  if (values.length < 2) {
    return { t: 'err', v: '#VALUE!' };
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sumSqDiff = values.reduce((a, v) => a + (v - mean) ** 2, 0);
  return { t: 'num', v: sumSqDiff / (values.length - 1) };
}

/**
 * VARP(number1, [number2], ...) — returns the population variance.
 */
export function varpFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const values: number[] = [];
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    values.push(node.v);
  }

  if (values.length === 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sumSqDiff = values.reduce((a, v) => a + (v - mean) ** 2, 0);
  return { t: 'num', v: sumSqDiff / values.length };
}

/**
 * MODE(number1, [number2], ...) — returns the most frequently occurring value.
 */
export function modeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const values: number[] = [];
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    values.push(node.v);
  }

  if (values.length === 0) {
    return { t: 'err', v: '#N/A!' };
  }

  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }

  let maxCount = 0;
  let mode = values[0];
  for (const [v, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      mode = v;
    }
  }

  if (maxCount <= 1) {
    return { t: 'err', v: '#N/A!' };
  }

  return { t: 'num', v: mode };
}

/**
 * SUMSQ(number1, [number2], ...) — returns the sum of the squares of the arguments.
 */
export function sumsqFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let total = 0;
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    total += node.v ** 2;
  }

  return { t: 'num', v: total };
}

/**
 * NA() — returns the #N/A! error value.
 */
export function naFunc(
  ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (args && args.expr().length > 0) {
    return { t: 'err', v: '#N/A!' };
  }

  return { t: 'err', v: '#N/A!' };
}

/**
 * QUARTILE(data, quart) — returns the quartile of a data set (quart: 0-4).
 */
export function quartileFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const values: number[] = [];
  const dataNode = visit(exprs[0]);
  if (dataNode.t === 'err') {
    return dataNode;
  }
  if (dataNode.t === 'num') {
    values.push(dataNode.v);
  } else if (dataNode.t === 'ref' && grid) {
    for (const ref of toSrefs([dataNode.v])) {
      const cellVal = grid.get(ref)?.v || '';
      if (cellVal !== '' && !isNaN(Number(cellVal))) {
        values.push(Number(cellVal));
      }
    }
  }

  const quartNode = NumberArgs.map(visit(exprs[1]), grid);
  if (quartNode.t === 'err') {
    return quartNode;
  }

  const quart = Math.trunc(quartNode.v);
  if (quart < 0 || quart > 4 || values.length === 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  const k = quart / 4;
  values.sort((a, b) => a - b);
  const n = values.length;
  const rank = k * (n - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const fraction = rank - lower;

  if (lower === upper) {
    return { t: 'num', v: values[lower] };
  }

  return { t: 'num', v: values[lower] + fraction * (values[upper] - values[lower]) };
}

/**
 * COUNTUNIQUE(value1, [value2], ...) — counts the number of unique values.
 */
export function countuniqueFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const unique = new Set<string>();
  const exprs = args.expr();
  for (const expr of exprs) {
    const node = visit(expr);
    if (node.t === 'err') {
      return node;
    }
    if (node.t === 'ref' && grid) {
      for (const ref of toSrefs([node.v])) {
        const cellVal = grid.get(ref)?.v;
        if (cellVal !== undefined && cellVal !== '') {
          unique.add(cellVal);
        }
      }
    } else if (node.t === 'num') {
      unique.add(String(node.v));
    } else if (node.t === 'str' && node.v !== '') {
      unique.add(node.v);
    } else if (node.t === 'bool') {
      unique.add(String(node.v));
    }
  }

  return { t: 'num', v: unique.size };
}

/**
 * FIXED(number, [decimals], [no_commas]) — formats a number with fixed decimal places.
 */
export function fixedFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  let decimals = 2;
  if (exprs.length >= 2) {
    const decNode = NumberArgs.map(visit(exprs[1]), grid);
    if (decNode.t === 'err') {
      return decNode;
    }
    decimals = Math.trunc(decNode.v);
  }

  let noCommas = false;
  if (exprs.length === 3) {
    const boolNode = BoolArgs.map(visit(exprs[2]), grid);
    if (boolNode.t === 'err') {
      return boolNode;
    }
    noCommas = boolNode.v;
  }

  let result: string;
  if (decimals < 0) {
    const factor = 10 ** (-decimals);
    result = String(Math.round(num.v / factor) * factor);
  } else {
    result = num.v.toFixed(decimals);
  }

  if (!noCommas) {
    const parts = result.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    result = parts.join('.');
  }

  return { t: 'str', v: result };
}

/**
 * DOLLAR(number, [decimals]) — formats a number as currency with a dollar sign.
 */
export function dollarFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  let decimals = 2;
  if (exprs.length === 2) {
    const decNode = NumberArgs.map(visit(exprs[1]), grid);
    if (decNode.t === 'err') {
      return decNode;
    }
    decimals = Math.trunc(decNode.v);
  }

  let value: number;
  if (decimals < 0) {
    const factor = 10 ** (-decimals);
    value = Math.round(num.v / factor) * factor;
  } else {
    value = num.v;
  }

  const isNeg = value < 0;
  const absFixed = Math.abs(value).toFixed(Math.max(0, decimals));
  const parts = absFixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const formatted = parts.join('.');

  return { t: 'str', v: isNeg ? `($${formatted})` : `$${formatted}` };
}

/**
 * WEEKNUM(date, [type]) — returns the week number of the year.
 * type=1 (default): week starts Sunday. type=2: week starts Monday.
 */
export function weeknumFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  let type = 1;
  if (exprs.length === 2) {
    const typeNode = NumberArgs.map(visit(exprs[1]), grid);
    if (typeNode.t === 'err') {
      return typeNode;
    }
    type = Math.trunc(typeNode.v);
  }

  const jan1 = new Date(date.getFullYear(), 0, 1);
  const startDay = type === 2 ? 1 : 0;
  const jan1Day = jan1.getDay();
  const dayOffset = (jan1Day - startDay + 7) % 7;
  const weekStart = new Date(jan1.getTime() - dayOffset * 86400000);
  const diff = date.getTime() - weekStart.getTime();
  const weekNum = Math.floor(diff / (7 * 86400000)) + 1;

  return { t: 'num', v: weekNum };
}

/**
 * ISOWEEKNUM(date) — returns the ISO week number of the year.
 */
export function isoweeknumFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  return { t: 'num', v: weekNo };
}

/**
 * WORKDAY(start_date, days, [holidays]) — returns a date that is a specified number of working days away.
 */
export function workdayFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const startDate = parseDate(visit(exprs[0]), grid);
  if (!(startDate instanceof Date)) {
    return startDate;
  }

  const daysNode = NumberArgs.map(visit(exprs[1]), grid);
  if (daysNode.t === 'err') {
    return daysNode;
  }

  const holidayDates = new Set<string>();
  if (exprs.length === 3) {
    const holNode = visit(exprs[2]);
    if (holNode.t === 'err') {
      return holNode;
    }
    if (holNode.t === 'ref' && grid) {
      for (const ref of toSrefs([holNode.v])) {
        const cellVal = grid.get(ref)?.v || '';
        if (cellVal) {
          holidayDates.add(cellVal);
        }
      }
    } else if (holNode.t === 'str') {
      holidayDates.add(holNode.v);
    }
  }

  let remaining = Math.trunc(daysNode.v);
  const direction = remaining > 0 ? 1 : -1;
  remaining = Math.abs(remaining);
  const current = new Date(startDate);

  while (remaining > 0) {
    current.setDate(current.getDate() + direction);
    const day = current.getDay();
    if (day !== 0 && day !== 6 && !holidayDates.has(formatDate(current))) {
      remaining--;
    }
  }

  return { t: 'str', v: formatDate(current) };
}

/**
 * YEARFRAC(start_date, end_date, [basis]) — returns the fraction of the year between two dates.
 * basis: 0=US 30/360, 1=actual/actual, 2=actual/360, 3=actual/365, 4=European 30/360.
 */
export function yearfracFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const startDate = parseDate(visit(exprs[0]), grid);
  if (!(startDate instanceof Date)) {
    return startDate;
  }

  const endDate = parseDate(visit(exprs[1]), grid);
  if (!(endDate instanceof Date)) {
    return endDate;
  }

  let basis = 0;
  if (exprs.length === 3) {
    const basisNode = NumberArgs.map(visit(exprs[2]), grid);
    if (basisNode.t === 'err') {
      return basisNode;
    }
    basis = Math.trunc(basisNode.v);
  }

  if (basis < 0 || basis > 4) {
    return { t: 'err', v: '#VALUE!' };
  }

  const s = startDate < endDate ? startDate : endDate;
  const e = startDate < endDate ? endDate : startDate;
  const diff = Math.round((e.getTime() - s.getTime()) / 86400000);

  switch (basis) {
    case 0:
    case 4:
      return { t: 'num', v: diff / 360 };
    case 1: {
      const sy = s.getFullYear();
      const ey = e.getFullYear();
      if (sy === ey) {
        const yearDays = (new Date(sy + 1, 0, 1).getTime() - new Date(sy, 0, 1).getTime()) / 86400000;
        return { t: 'num', v: diff / yearDays };
      }
      const years = ey - sy + 1;
      const totalDays = (new Date(ey + 1, 0, 1).getTime() - new Date(sy, 0, 1).getTime()) / 86400000;
      const avgYear = totalDays / years;
      return { t: 'num', v: diff / avgYear };
    }
    case 2:
      return { t: 'num', v: diff / 360 };
    case 3:
      return { t: 'num', v: diff / 365 };
    default:
      return { t: 'err', v: '#VALUE!' };
  }
}

/**
 * LOOKUP(search_key, search_range, [result_range]) — searches a sorted range for a key.
 */
export function lookupFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const keyNode = visit(exprs[0]);
  if (keyNode.t === 'err') {
    return keyNode;
  }

  const searchRefs = getRefsFromExpression(exprs[1], visit, grid);
  if (isFormulaError(searchRefs)) {
    return searchRefs;
  }

  let resultRefsList = searchRefs.v;
  if (exprs.length === 3) {
    const rr = getRefsFromExpression(exprs[2], visit, grid);
    if (isFormulaError(rr)) {
      return rr;
    }
    resultRefsList = rr.v;
  }

  const keyVal = keyNode.t === 'num' ? keyNode.v : keyNode.t === 'str' ? keyNode.v : '';
  const keyIsNum = keyNode.t === 'num';

  let matchIdx = -1;
  for (let i = 0; i < searchRefs.v.length; i++) {
    const cellVal = grid?.get(searchRefs.v[i])?.v || '';
    if (keyIsNum) {
      const cellNum = Number(cellVal);
      if (cellVal !== '' && !isNaN(cellNum) && cellNum <= (keyVal as number)) {
        matchIdx = i;
      }
    } else {
      if (cellVal.toLowerCase() <= String(keyVal).toLowerCase()) {
        matchIdx = i;
      }
    }
  }

  if (matchIdx === -1 || matchIdx >= resultRefsList.length) {
    return { t: 'err', v: '#N/A!' };
  }

  const resultVal = grid?.get(resultRefsList[matchIdx])?.v || '';
  const num = Number(resultVal);
  if (resultVal !== '' && !isNaN(num)) {
    return { t: 'num', v: num };
  }
  return { t: 'str', v: resultVal };
}

/**
 * INDIRECT(ref_string) — returns the reference specified by a text string.
 */
export function indirectFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') {
    return str;
  }

  if (!grid) {
    return { t: 'err', v: '#REF!' };
  }

  const ref = str.v.trim();
  const cellVal = grid.get(ref)?.v;
  if (cellVal === undefined) {
    return { t: 'str', v: '' };
  }

  const num = Number(cellVal);
  if (cellVal !== '' && !isNaN(num)) {
    return { t: 'num', v: num };
  }
  return { t: 'str', v: cellVal };
}

/**
 * ERROR.TYPE(value) — returns a number corresponding to the error type.
 * 1=#NULL!, 2=#DIV/0!, 3=#VALUE!, 4=#REF!, 5=#NAME?, 6=#NUM!, 7=#N/A!, 8=#ERROR!
 */
export function errortypeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const node = visit(exprs[0]);
  if (node.t !== 'err') {
    return { t: 'err', v: '#N/A!' };
  }

  const errorMap: Record<string, number> = {
    '#NULL!': 1,
    '#DIV/0!': 2,
    '#VALUE!': 3,
    '#REF!': 4,
    '#NAME?': 5,
    '#NUM!': 6,
    '#N/A!': 7,
    '#ERROR!': 8,
  };

  const code = errorMap[node.v];
  if (code !== undefined) {
    return { t: 'num', v: code };
  }

  return { t: 'err', v: '#N/A!' };
}

/**
 * ISDATE(value) — checks whether a value is a date.
 */
export function isdateFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const node = visit(exprs[0]);
  if (node.t === 'err') {
    return { t: 'bool', v: false };
  }

  if (node.t !== 'str' || node.v === '') {
    return { t: 'bool', v: false };
  }

  // Only accept strings with date-like separators (-, /)
  if (!/[\-\/]/.test(node.v)) {
    return { t: 'bool', v: false };
  }

  const d = new Date(node.v);
  return { t: 'bool', v: !isNaN(d.getTime()) };
}

/**
 * SPLIT(text, delimiter, [split_by_each], [remove_empty]) — splits text around a delimiter.
 * Returns the first segment (spreadsheet arrays not supported yet).
 */
export function splitFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 4) {
    return { t: 'err', v: '#N/A!' };
  }

  const text = toStr(visit(exprs[0]), grid);
  if (text.t === 'err') {
    return text;
  }

  const delimiter = toStr(visit(exprs[1]), grid);
  if (delimiter.t === 'err') {
    return delimiter;
  }

  // split_by_each: if true (default), each character in delimiter is a separate delimiter
  let splitByEach = true;
  if (exprs.length >= 3) {
    const sbeNode = BoolArgs.map(visit(exprs[2]), grid);
    if (sbeNode.t === 'err') {
      return sbeNode;
    }
    splitByEach = sbeNode.v;
  }

  let removeEmpty = true;
  if (exprs.length === 4) {
    const reNode = BoolArgs.map(visit(exprs[3]), grid);
    if (reNode.t === 'err') {
      return reNode;
    }
    removeEmpty = reNode.v;
  }

  let parts: string[];
  if (splitByEach && delimiter.v.length > 1) {
    const regex = new RegExp('[' + delimiter.v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ']');
    parts = text.v.split(regex);
  } else {
    parts = text.v.split(delimiter.v);
  }

  if (removeEmpty) {
    parts = parts.filter((p) => p !== '');
  }

  // Return first segment since we don't support array spilling
  return { t: 'str', v: parts.length > 0 ? parts[0] : '' };
}

/**
 * JOIN(delimiter, value_or_array1, [value_or_array2], ...) — joins values with a delimiter.
 */
export function joinFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const delimiter = toStr(visit(exprs[0]), grid);
  if (delimiter.t === 'err') {
    return delimiter;
  }

  const parts: string[] = [];
  for (let i = 1; i < exprs.length; i++) {
    const node = visit(exprs[i]);
    if (node.t === 'err') {
      return node;
    }
    if (node.t === 'ref' && grid) {
      for (const ref of toSrefs([node.v])) {
        const cellVal = grid.get(ref)?.v || '';
        parts.push(cellVal);
      }
    } else if (node.t === 'num') {
      parts.push(String(node.v));
    } else if (node.t === 'str') {
      parts.push(node.v);
    } else if (node.t === 'bool') {
      parts.push(node.v ? 'TRUE' : 'FALSE');
    }
  }

  return { t: 'str', v: parts.join(delimiter.v) };
}

/**
 * REGEXMATCH(text, regular_expression) — returns whether a piece of text matches a regex.
 */
export function regexmatchFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const text = toStr(visit(exprs[0]), grid);
  if (text.t === 'err') {
    return text;
  }

  const pattern = toStr(visit(exprs[1]), grid);
  if (pattern.t === 'err') {
    return pattern;
  }

  try {
    const regex = new RegExp(pattern.v);
    return { t: 'bool', v: regex.test(text.v) };
  } catch {
    return { t: 'err', v: '#VALUE!' };
  }
}

/**
 * Extract paired numeric arrays from two range expressions.
 */
function extractPairedArrays(
  expr1: ParseTree,
  expr2: ParseTree,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): { xs: number[]; ys: number[] } | FormulaError {
  const yRefs = getRefsFromExpression(expr1, visit, grid);
  if (isFormulaError(yRefs)) return yRefs;
  const xRefs = getRefsFromExpression(expr2, visit, grid);
  if (isFormulaError(xRefs)) return xRefs;

  if (yRefs.v.length !== xRefs.v.length) {
    return { t: 'err', v: '#N/A!' };
  }

  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < xRefs.v.length; i++) {
    const xv = grid?.get(xRefs.v[i])?.v || '';
    const yv = grid?.get(yRefs.v[i])?.v || '';
    if (xv !== '' && yv !== '' && !isNaN(Number(xv)) && !isNaN(Number(yv))) {
      xs.push(Number(xv));
      ys.push(Number(yv));
    }
  }

  if (xs.length < 2) {
    return { t: 'err', v: '#N/A!' };
  }

  return { xs, ys };
}

function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumXX = xs.reduce((a, x) => a + x * x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/**
 * FORECAST(x, known_ys, known_xs) — predicts a y value for a given x using linear regression.
 */
export function forecastFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const xNode = NumberArgs.map(visit(exprs[0]), grid);
  if (xNode.t === 'err') {
    return xNode;
  }

  const data = extractPairedArrays(exprs[1], exprs[2], visit, grid);
  if ('t' in data) return data;

  const { slope, intercept } = linearRegression(data.xs, data.ys);
  return { t: 'num', v: intercept + slope * xNode.v };
}

/**
 * SLOPE(known_ys, known_xs) — returns the slope of the linear regression line.
 */
export function slopeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const data = extractPairedArrays(exprs[0], exprs[1], visit, grid);
  if ('t' in data) return data;

  const { slope } = linearRegression(data.xs, data.ys);
  return { t: 'num', v: slope };
}

/**
 * INTERCEPT(known_ys, known_xs) — returns the y-intercept of the linear regression line.
 */
export function interceptFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const data = extractPairedArrays(exprs[0], exprs[1], visit, grid);
  if ('t' in data) return data;

  const { intercept } = linearRegression(data.xs, data.ys);
  return { t: 'num', v: intercept };
}

/**
 * CORREL(data_y, data_x) — returns the Pearson correlation coefficient.
 */
export function correlFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const data = extractPairedArrays(exprs[0], exprs[1], visit, grid);
  if ('t' in data) return data;

  const n = data.xs.length;
  const meanX = data.xs.reduce((a, b) => a + b, 0) / n;
  const meanY = data.ys.reduce((a, b) => a + b, 0) / n;

  let sumXYDiff = 0;
  let sumXXDiff = 0;
  let sumYYDiff = 0;
  for (let i = 0; i < n; i++) {
    const dx = data.xs[i] - meanX;
    const dy = data.ys[i] - meanY;
    sumXYDiff += dx * dy;
    sumXXDiff += dx * dx;
    sumYYDiff += dy * dy;
  }

  const denom = Math.sqrt(sumXXDiff * sumYYDiff);
  if (denom === 0) {
    return { t: 'err', v: '#DIV/0!' };
  }

  return { t: 'num', v: sumXYDiff / denom };
}

/**
 * XLOOKUP(search_key, lookup_range, return_range, [if_not_found], [match_mode], [search_mode])
 */
export function xlookupFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 6) {
    return { t: 'err', v: '#N/A!' };
  }

  const keyNode = visit(exprs[0]);
  if (keyNode.t === 'err') {
    return keyNode;
  }

  const lookupRefs = getRefsFromExpression(exprs[1], visit, grid);
  if (isFormulaError(lookupRefs)) {
    return lookupRefs;
  }

  const returnRefs = getRefsFromExpression(exprs[2], visit, grid);
  if (isFormulaError(returnRefs)) {
    return returnRefs;
  }

  let ifNotFound: EvalNode | null = null;
  if (exprs.length >= 4) {
    ifNotFound = visit(exprs[3]);
  }

  let matchMode = 0; // 0=exact, -1=exact or next smaller, 1=exact or next larger
  if (exprs.length >= 5) {
    const mmNode = NumberArgs.map(visit(exprs[4]), grid);
    if (mmNode.t === 'err') return mmNode;
    matchMode = Math.trunc(mmNode.v);
  }

  const keyVal = keyNode.t === 'num' ? keyNode.v
    : keyNode.t === 'str' ? keyNode.v
    : keyNode.t === 'bool' ? keyNode.v
    : '';
  const keyIsNum = keyNode.t === 'num';

  let matchIdx = -1;

  if (matchMode === 0) {
    // Exact match
    for (let i = 0; i < lookupRefs.v.length; i++) {
      const cellVal = grid?.get(lookupRefs.v[i])?.v || '';
      if (keyIsNum) {
        if (cellVal !== '' && Number(cellVal) === keyVal) {
          matchIdx = i;
          break;
        }
      } else {
        if (String(cellVal).toLowerCase() === String(keyVal).toLowerCase()) {
          matchIdx = i;
          break;
        }
      }
    }
  } else if (matchMode === -1) {
    // Exact or next smaller
    let bestVal = -Infinity;
    for (let i = 0; i < lookupRefs.v.length; i++) {
      const cellVal = grid?.get(lookupRefs.v[i])?.v || '';
      if (keyIsNum) {
        const num = Number(cellVal);
        if (cellVal !== '' && !isNaN(num) && num <= (keyVal as number) && num > bestVal) {
          bestVal = num;
          matchIdx = i;
        }
      }
    }
  } else if (matchMode === 1) {
    // Exact or next larger
    let bestVal = Infinity;
    for (let i = 0; i < lookupRefs.v.length; i++) {
      const cellVal = grid?.get(lookupRefs.v[i])?.v || '';
      if (keyIsNum) {
        const num = Number(cellVal);
        if (cellVal !== '' && !isNaN(num) && num >= (keyVal as number) && num < bestVal) {
          bestVal = num;
          matchIdx = i;
        }
      }
    }
  }

  if (matchIdx === -1) {
    if (ifNotFound) {
      return ifNotFound;
    }
    return { t: 'err', v: '#N/A!' };
  }

  if (matchIdx >= returnRefs.v.length) {
    return { t: 'err', v: '#N/A!' };
  }

  const resultVal = grid?.get(returnRefs.v[matchIdx])?.v || '';
  const num = Number(resultVal);
  if (resultVal !== '' && !isNaN(num)) {
    return { t: 'num', v: num };
  }
  return { t: 'str', v: resultVal };
}

/**
 * OFFSET(reference, rows, cols, [height], [width]) — returns a reference offset from a starting reference.
 */
export function offsetFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 5) {
    return { t: 'err', v: '#N/A!' };
  }

  const refNode = visit(exprs[0]);
  if (refNode.t === 'err') {
    return refNode;
  }
  if (refNode.t !== 'ref' || !grid) {
    return { t: 'err', v: '#VALUE!' };
  }

  const rowsNode = NumberArgs.map(visit(exprs[1]), grid);
  if (rowsNode.t === 'err') return rowsNode;
  const colsNode = NumberArgs.map(visit(exprs[2]), grid);
  if (colsNode.t === 'err') return colsNode;

  const rowOffset = Math.trunc(rowsNode.v);
  const colOffset = Math.trunc(colsNode.v);

  // Parse the starting reference
  const refStr = isSrng(refNode.v) ? refNode.v.split(':')[0] : refNode.v;
  const parsed = parseRef(refStr);

  const newRow = parsed.r + rowOffset;
  const newCol = parsed.c + colOffset;

  if (newRow < 1 || newCol < 1) {
    return { t: 'err', v: '#REF!' };
  }

  // For single cell OFFSET (no height/width or 1x1)
  const newRef = `${toColumnLabel(newCol)}${newRow}`;
  const cellVal = grid.get(newRef)?.v || '';
  const num = Number(cellVal);
  if (cellVal !== '' && !isNaN(num)) {
    return { t: 'num', v: num };
  }
  return { t: 'str', v: cellVal };
}

/**
 * ISEVEN(number) — checks whether a number is even.
 */
export function isevenFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  return { t: 'bool', v: Math.trunc(num.v) % 2 === 0 };
}

/**
 * ISODD(number) — checks whether a number is odd.
 */
export function isoddFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  return { t: 'bool', v: Math.trunc(num.v) % 2 !== 0 };
}

/**
 * FACTDOUBLE(number) — returns the double factorial of a number.
 */
export function factdoubleFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  const n = Math.trunc(num.v);
  if (n < -1) return { t: 'err', v: '#VALUE!' };
  if (n <= 0) return { t: 'num', v: 1 };
  let result = 1;
  for (let i = n; i > 0; i -= 2) {
    result *= i;
  }
  return { t: 'num', v: result };
}

/**
 * BASE(number, base, [min_length]) — converts a number to text in another base.
 */
export function baseFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) return { t: 'err', v: '#N/A!' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  const base = NumberArgs.map(visit(exprs[1]), grid);
  if (base.t === 'err') return base;
  const b = Math.trunc(base.v);
  if (b < 2 || b > 36) return { t: 'err', v: '#VALUE!' };
  let result = Math.trunc(num.v).toString(b).toUpperCase();
  if (exprs.length === 3) {
    const minLen = NumberArgs.map(visit(exprs[2]), grid);
    if (minLen.t === 'err') return minLen;
    result = result.padStart(Math.trunc(minLen.v), '0');
  }
  return { t: 'str', v: result };
}

/**
 * DECIMAL(text, base) — converts text from another base to a decimal number.
 */
export function decimalFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };
  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') return str;
  const base = NumberArgs.map(visit(exprs[1]), grid);
  if (base.t === 'err') return base;
  const b = Math.trunc(base.v);
  if (b < 2 || b > 36) return { t: 'err', v: '#VALUE!' };
  const num = parseInt(str.v, b);
  if (isNaN(num)) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: num };
}

/**
 * SQRTPI(number) — returns the square root of (number * PI).
 */
export function sqrtpiFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  if (num.v < 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: Math.sqrt(num.v * Math.PI) };
}

/**
 * SINH(number) — returns the hyperbolic sine.
 */
export function sinhFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  return { t: 'num', v: Math.sinh(num.v) };
}

/**
 * COSH(number) — returns the hyperbolic cosine.
 */
export function coshFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  return { t: 'num', v: Math.cosh(num.v) };
}

/**
 * TANH(number) — returns the hyperbolic tangent.
 */
export function tanhFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  return { t: 'num', v: Math.tanh(num.v) };
}

/**
 * ASINH(number) — returns the inverse hyperbolic sine.
 */
export function asinhFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  return { t: 'num', v: Math.asinh(num.v) };
}

/**
 * ACOSH(number) — returns the inverse hyperbolic cosine.
 */
export function acoshFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  if (num.v < 1) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: Math.acosh(num.v) };
}

/**
 * ATANH(number) — returns the inverse hyperbolic tangent.
 */
export function atanhFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  if (num.v <= -1 || num.v >= 1) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: Math.atanh(num.v) };
}

/**
 * COT(angle) — returns the cotangent of an angle in radians.
 */
export function cotFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  const tan = Math.tan(num.v);
  if (tan === 0) return { t: 'err', v: '#DIV/0!' };
  return { t: 'num', v: 1 / tan };
}

/**
 * CSC(angle) — returns the cosecant of an angle in radians.
 */
export function cscFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  const sin = Math.sin(num.v);
  if (sin === 0) return { t: 'err', v: '#DIV/0!' };
  return { t: 'num', v: 1 / sin };
}

/**
 * SEC(angle) — returns the secant of an angle in radians.
 */
export function secFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  const cos = Math.cos(num.v);
  if (cos === 0) return { t: 'err', v: '#DIV/0!' };
  return { t: 'num', v: 1 / cos };
}

/**
 * REGEXEXTRACT(text, regular_expression) — extracts matching substrings.
 */
export function regexextractFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };
  const text = toStr(visit(exprs[0]), grid);
  if (text.t === 'err') return text;
  const pattern = toStr(visit(exprs[1]), grid);
  if (pattern.t === 'err') return pattern;
  try {
    const match = new RegExp(pattern.v).exec(text.v);
    if (!match) return { t: 'err', v: '#N/A!' };
    return { t: 'str', v: match[1] !== undefined ? match[1] : match[0] };
  } catch {
    return { t: 'err', v: '#VALUE!' };
  }
}

/**
 * REGEXREPLACE(text, regular_expression, replacement) — replaces text using regex.
 */
export function regexreplaceFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };
  const text = toStr(visit(exprs[0]), grid);
  if (text.t === 'err') return text;
  const pattern = toStr(visit(exprs[1]), grid);
  if (pattern.t === 'err') return pattern;
  const replacement = toStr(visit(exprs[2]), grid);
  if (replacement.t === 'err') return replacement;
  try {
    return { t: 'str', v: text.v.replace(new RegExp(pattern.v, 'g'), replacement.v) };
  } catch {
    return { t: 'err', v: '#VALUE!' };
  }
}

/**
 * UNICODE(text) — returns the Unicode code point of the first character.
 */
export function unicodeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') return str;
  if (str.v.length === 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: str.v.codePointAt(0)! };
}

/**
 * UNICHAR(number) — returns the Unicode character for a code point.
 */
export function unicharFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  const code = Math.trunc(num.v);
  if (code < 1) return { t: 'err', v: '#VALUE!' };
  try {
    return { t: 'str', v: String.fromCodePoint(code) };
  } catch {
    return { t: 'err', v: '#VALUE!' };
  }
}

/**
 * GEOMEAN(number1, [number2], ...) — returns the geometric mean.
 */
export function geomeanFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const values: number[] = [];
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') return node;
    if (node.v <= 0) return { t: 'err', v: '#VALUE!' };
    values.push(node.v);
  }
  if (values.length === 0) return { t: 'err', v: '#N/A!' };
  const logSum = values.reduce((a, v) => a + Math.log(v), 0);
  return { t: 'num', v: Math.exp(logSum / values.length) };
}

/**
 * HARMEAN(number1, [number2], ...) — returns the harmonic mean.
 */
export function harmeanFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const values: number[] = [];
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') return node;
    if (node.v <= 0) return { t: 'err', v: '#VALUE!' };
    values.push(node.v);
  }
  if (values.length === 0) return { t: 'err', v: '#N/A!' };
  const recipSum = values.reduce((a, v) => a + 1 / v, 0);
  return { t: 'num', v: values.length / recipSum };
}

/**
 * AVEDEV(number1, [number2], ...) — returns the average absolute deviation from the mean.
 */
export function avedevFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const values: number[] = [];
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') return node;
    values.push(node.v);
  }
  if (values.length === 0) return { t: 'err', v: '#N/A!' };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const avgDev = values.reduce((a, v) => a + Math.abs(v - mean), 0) / values.length;
  return { t: 'num', v: avgDev };
}

/**
 * DEVSQ(number1, [number2], ...) — returns the sum of squared deviations from the mean.
 */
export function devsqFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const values: number[] = [];
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') return node;
    values.push(node.v);
  }
  if (values.length === 0) return { t: 'err', v: '#N/A!' };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { t: 'num', v: values.reduce((a, v) => a + (v - mean) ** 2, 0) };
}

/**
 * TRIMMEAN(data, percent) — returns the mean of the interior portion of a data set.
 */
export function trimmeanFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const dataNode = visit(exprs[0]);
  if (dataNode.t === 'err') return dataNode;

  const values: number[] = [];
  if (dataNode.t === 'num') {
    values.push(dataNode.v);
  } else if (dataNode.t === 'ref' && grid) {
    for (const ref of toSrefs([dataNode.v])) {
      const cellVal = grid.get(ref)?.v || '';
      if (cellVal !== '' && !isNaN(Number(cellVal))) {
        values.push(Number(cellVal));
      }
    }
  }

  const pctNode = NumberArgs.map(visit(exprs[1]), grid);
  if (pctNode.t === 'err') return pctNode;
  const pct = pctNode.v;
  if (pct < 0 || pct >= 1) return { t: 'err', v: '#VALUE!' };

  if (values.length === 0) return { t: 'err', v: '#N/A!' };

  values.sort((a, b) => a - b);
  const trimCount = Math.floor(values.length * pct / 2);
  const trimmed = values.slice(trimCount, values.length - trimCount);
  if (trimmed.length === 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: trimmed.reduce((a, b) => a + b, 0) / trimmed.length };
}

/**
 * PERMUT(n, k) — returns the number of permutations.
 */
export function permutFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };
  const nNode = NumberArgs.map(visit(exprs[0]), grid);
  if (nNode.t === 'err') return nNode;
  const kNode = NumberArgs.map(visit(exprs[1]), grid);
  if (kNode.t === 'err') return kNode;
  const n = Math.trunc(nNode.v);
  const k = Math.trunc(kNode.v);
  if (n < 0 || k < 0 || k > n) return { t: 'err', v: '#VALUE!' };
  let result = 1;
  for (let i = n; i > n - k; i--) {
    result *= i;
  }
  return { t: 'num', v: result };
}

/**
 * Helper: compute PMT given rate, nper, pv, fv, type.
 */
function computePmt(rate: number, nper: number, pv: number, fv: number, type: number): number {
  if (rate === 0) {
    return -(pv + fv) / nper;
  }
  const pvif = Math.pow(1 + rate, nper);
  return -(rate * (pv * pvif + fv) / ((1 + rate * type) * (pvif - 1)));
}

/**
 * PMT(rate, nper, pv, [fv], [type]) — calculates the periodic payment for a loan.
 */
export function pmtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 5) return { t: 'err', v: '#N/A!' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const nper = NumberArgs.map(visit(exprs[1]), grid);
  if (nper.t === 'err') return nper;
  const pv = NumberArgs.map(visit(exprs[2]), grid);
  if (pv.t === 'err') return pv;

  let fv = 0;
  if (exprs.length >= 4) {
    const fvNode = NumberArgs.map(visit(exprs[3]), grid);
    if (fvNode.t === 'err') return fvNode;
    fv = fvNode.v;
  }

  let type = 0;
  if (exprs.length === 5) {
    const typeNode = NumberArgs.map(visit(exprs[4]), grid);
    if (typeNode.t === 'err') return typeNode;
    type = Math.trunc(typeNode.v);
  }

  return { t: 'num', v: computePmt(rate.v, nper.v, pv.v, fv, type) };
}

/**
 * FV(rate, nper, pmt, [pv], [type]) — calculates the future value of an investment.
 */
export function fvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 5) return { t: 'err', v: '#N/A!' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const nper = NumberArgs.map(visit(exprs[1]), grid);
  if (nper.t === 'err') return nper;
  const pmt = NumberArgs.map(visit(exprs[2]), grid);
  if (pmt.t === 'err') return pmt;

  let pv = 0;
  if (exprs.length >= 4) {
    const pvNode = NumberArgs.map(visit(exprs[3]), grid);
    if (pvNode.t === 'err') return pvNode;
    pv = pvNode.v;
  }

  let type = 0;
  if (exprs.length === 5) {
    const typeNode = NumberArgs.map(visit(exprs[4]), grid);
    if (typeNode.t === 'err') return typeNode;
    type = Math.trunc(typeNode.v);
  }

  if (rate.v === 0) {
    return { t: 'num', v: -(pv + pmt.v * nper.v) };
  }

  const pvif = Math.pow(1 + rate.v, nper.v);
  return { t: 'num', v: -(pv * pvif + pmt.v * (1 + rate.v * type) * (pvif - 1) / rate.v) };
}

/**
 * PV(rate, nper, pmt, [fv], [type]) — calculates the present value of an investment.
 */
export function pvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 5) return { t: 'err', v: '#N/A!' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const nper = NumberArgs.map(visit(exprs[1]), grid);
  if (nper.t === 'err') return nper;
  const pmt = NumberArgs.map(visit(exprs[2]), grid);
  if (pmt.t === 'err') return pmt;

  let fv = 0;
  if (exprs.length >= 4) {
    const fvNode = NumberArgs.map(visit(exprs[3]), grid);
    if (fvNode.t === 'err') return fvNode;
    fv = fvNode.v;
  }

  let type = 0;
  if (exprs.length === 5) {
    const typeNode = NumberArgs.map(visit(exprs[4]), grid);
    if (typeNode.t === 'err') return typeNode;
    type = Math.trunc(typeNode.v);
  }

  if (rate.v === 0) {
    return { t: 'num', v: -(fv + pmt.v * nper.v) };
  }

  const pvif = Math.pow(1 + rate.v, nper.v);
  return { t: 'num', v: -(fv + pmt.v * (1 + rate.v * type) * (pvif - 1) / rate.v) / pvif };
}

/**
 * NPV(rate, value1, [value2], ...) — calculates net present value of a series of cash flows.
 */
export function npvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 2) return { t: 'err', v: '#N/A!' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;

  let npv = 0;
  let period = 1;

  for (let i = 1; i < exprs.length; i++) {
    const node = visit(exprs[i]);
    if (node.t === 'err') return node;
    if (node.t === 'ref' && grid) {
      for (const ref of toSrefs([node.v])) {
        const cellVal = grid.get(ref)?.v || '';
        if (cellVal !== '' && !isNaN(Number(cellVal))) {
          npv += Number(cellVal) / Math.pow(1 + rate.v, period);
          period++;
        }
      }
    } else if (node.t === 'num') {
      npv += node.v / Math.pow(1 + rate.v, period);
      period++;
    }
  }

  return { t: 'num', v: npv };
}

/**
 * NPER(rate, pmt, pv, [fv], [type]) — calculates number of periods for an investment.
 */
export function nperFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 5) return { t: 'err', v: '#N/A!' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const pmt = NumberArgs.map(visit(exprs[1]), grid);
  if (pmt.t === 'err') return pmt;
  const pv = NumberArgs.map(visit(exprs[2]), grid);
  if (pv.t === 'err') return pv;

  let fv = 0;
  if (exprs.length >= 4) {
    const fvNode = NumberArgs.map(visit(exprs[3]), grid);
    if (fvNode.t === 'err') return fvNode;
    fv = fvNode.v;
  }

  let type = 0;
  if (exprs.length === 5) {
    const typeNode = NumberArgs.map(visit(exprs[4]), grid);
    if (typeNode.t === 'err') return typeNode;
    type = Math.trunc(typeNode.v);
  }

  if (rate.v === 0) {
    if (pmt.v === 0) return { t: 'err', v: '#DIV/0!' };
    return { t: 'num', v: -(pv.v + fv) / pmt.v };
  }

  const z = pmt.v * (1 + rate.v * type) / rate.v;
  return { t: 'num', v: Math.log((z - fv) / (pv.v + z)) / Math.log(1 + rate.v) };
}

/**
 * IPMT(rate, period, nper, pv, [fv], [type]) — returns the interest portion of a payment.
 */
export function ipmtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 4 || exprs.length > 6) return { t: 'err', v: '#N/A!' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const per = NumberArgs.map(visit(exprs[1]), grid);
  if (per.t === 'err') return per;
  const nper = NumberArgs.map(visit(exprs[2]), grid);
  if (nper.t === 'err') return nper;
  const pv = NumberArgs.map(visit(exprs[3]), grid);
  if (pv.t === 'err') return pv;

  let fv = 0;
  if (exprs.length >= 5) {
    const fvNode = NumberArgs.map(visit(exprs[4]), grid);
    if (fvNode.t === 'err') return fvNode;
    fv = fvNode.v;
  }

  let type = 0;
  if (exprs.length === 6) {
    const typeNode = NumberArgs.map(visit(exprs[5]), grid);
    if (typeNode.t === 'err') return typeNode;
    type = Math.trunc(typeNode.v);
  }

  const pmt = computePmt(rate.v, nper.v, pv.v, fv, type);

  // Calculate remaining balance before the period
  let balance = pv.v;
  for (let i = 1; i < per.v; i++) {
    if (type === 1 && i === 1) {
      balance += pmt;
    }
    const interest = balance * rate.v;
    balance += interest + (type === 0 ? pmt : (i > 1 ? pmt : 0));
  }

  const ipmt = balance * rate.v;
  if (type === 1 && per.v === 1) return { t: 'num', v: 0 };
  return { t: 'num', v: ipmt };
}

/**
 * PPMT(rate, period, nper, pv, [fv], [type]) — returns the principal portion of a payment.
 */
export function ppmtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 4 || exprs.length > 6) return { t: 'err', v: '#N/A!' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const per = NumberArgs.map(visit(exprs[1]), grid);
  if (per.t === 'err') return per;
  const nper = NumberArgs.map(visit(exprs[2]), grid);
  if (nper.t === 'err') return nper;
  const pv = NumberArgs.map(visit(exprs[3]), grid);
  if (pv.t === 'err') return pv;

  let fv = 0;
  if (exprs.length >= 5) {
    const fvNode = NumberArgs.map(visit(exprs[4]), grid);
    if (fvNode.t === 'err') return fvNode;
    fv = fvNode.v;
  }

  let type = 0;
  if (exprs.length === 6) {
    const typeNode = NumberArgs.map(visit(exprs[5]), grid);
    if (typeNode.t === 'err') return typeNode;
    type = Math.trunc(typeNode.v);
  }

  const pmt = computePmt(rate.v, nper.v, pv.v, fv, type);

  // IPMT at this period
  let balance = pv.v;
  for (let i = 1; i < per.v; i++) {
    if (type === 1 && i === 1) {
      balance += pmt;
    }
    const interest = balance * rate.v;
    balance += interest + (type === 0 ? pmt : (i > 1 ? pmt : 0));
  }

  const ipmt = (type === 1 && per.v === 1) ? 0 : balance * rate.v;
  return { t: 'num', v: pmt - ipmt };
}

/**
 * SLN(cost, salvage, life) — returns the straight-line depreciation.
 */
export function slnFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };
  const cost = NumberArgs.map(visit(exprs[0]), grid);
  if (cost.t === 'err') return cost;
  const salvage = NumberArgs.map(visit(exprs[1]), grid);
  if (salvage.t === 'err') return salvage;
  const life = NumberArgs.map(visit(exprs[2]), grid);
  if (life.t === 'err') return life;
  if (life.v === 0) return { t: 'err', v: '#DIV/0!' };
  return { t: 'num', v: (cost.v - salvage.v) / life.v };
}

/**
 * EFFECT(nominal_rate, periods_per_year) — returns the effective annual interest rate.
 */
export function effectFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };
  const nominal = NumberArgs.map(visit(exprs[0]), grid);
  if (nominal.t === 'err') return nominal;
  const periods = NumberArgs.map(visit(exprs[1]), grid);
  if (periods.t === 'err') return periods;
  const n = Math.trunc(periods.v);
  if (n < 1 || nominal.v <= 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: Math.pow(1 + nominal.v / n, n) - 1 };
}

/**
 * RATE(nper, pmt, pv, [fv], [type], [guess]) — returns interest rate per period using Newton's method.
 */
export function rateFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 6) return { t: 'err', v: '#N/A!' };

  const nper = NumberArgs.map(visit(exprs[0]), grid);
  if (nper.t === 'err') return nper;
  const pmt = NumberArgs.map(visit(exprs[1]), grid);
  if (pmt.t === 'err') return pmt;
  const pv = NumberArgs.map(visit(exprs[2]), grid);
  if (pv.t === 'err') return pv;

  let fv = 0;
  if (exprs.length >= 4) {
    const fvNode = NumberArgs.map(visit(exprs[3]), grid);
    if (fvNode.t === 'err') return fvNode;
    fv = fvNode.v;
  }

  let type = 0;
  if (exprs.length >= 5) {
    const typeNode = NumberArgs.map(visit(exprs[4]), grid);
    if (typeNode.t === 'err') return typeNode;
    type = Math.trunc(typeNode.v);
  }

  let guess = 0.1;
  if (exprs.length === 6) {
    const guessNode = NumberArgs.map(visit(exprs[5]), grid);
    if (guessNode.t === 'err') return guessNode;
    guess = guessNode.v;
  }

  // Newton's method
  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const r1 = Math.pow(1 + rate, nper.v);
    const y = pv.v * r1 + pmt.v * (1 + rate * type) * (r1 - 1) / rate + fv;
    const dy = nper.v * pv.v * Math.pow(1 + rate, nper.v - 1)
      + pmt.v * (1 + rate * type) * (nper.v * Math.pow(1 + rate, nper.v - 1) * rate - (r1 - 1)) / (rate * rate)
      + pmt.v * type * (r1 - 1) / rate;
    const newRate = rate - y / dy;
    if (Math.abs(newRate - rate) < 1e-10) return { t: 'num', v: newRate };
    rate = newRate;
  }
  return { t: 'err', v: '#VALUE!' };
}

/**
 * IRR(values, [guess]) — returns the internal rate of return using Newton's method.
 */
export function irrFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A!' };

  const values: number[] = [];
  const refsResult = getRefsFromExpression(exprs[0], visit, grid);
  if (refsResult.t === 'err') return refsResult;
  for (const ref of refsResult.v) {
    const cell = grid!.get(ref);
    const v = cell ? Number(cell.v) : 0;
    if (isNaN(v)) return { t: 'err', v: '#VALUE!' };
    values.push(v);
  }

  let guess = 0.1;
  if (exprs.length === 2) {
    const guessNode = NumberArgs.map(visit(exprs[1]), grid);
    if (guessNode.t === 'err') return guessNode;
    guess = guessNode.v;
  }

  // Newton's method
  let rate = guess;
  for (let iter = 0; iter < 100; iter++) {
    let npv = 0;
    let dnpv = 0;
    for (let i = 0; i < values.length; i++) {
      const denom = Math.pow(1 + rate, i);
      npv += values[i] / denom;
      dnpv -= i * values[i] / Math.pow(1 + rate, i + 1);
    }
    if (Math.abs(dnpv) < 1e-15) return { t: 'err', v: '#VALUE!' };
    const newRate = rate - npv / dnpv;
    if (Math.abs(newRate - rate) < 1e-10) return { t: 'num', v: newRate };
    rate = newRate;
  }
  return { t: 'err', v: '#VALUE!' };
}

/**
 * DB(cost, salvage, life, period, [month]) — returns fixed-declining balance depreciation.
 */
export function dbFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 4 || exprs.length > 5) return { t: 'err', v: '#N/A!' };

  const cost = NumberArgs.map(visit(exprs[0]), grid);
  if (cost.t === 'err') return cost;
  const salvage = NumberArgs.map(visit(exprs[1]), grid);
  if (salvage.t === 'err') return salvage;
  const life = NumberArgs.map(visit(exprs[2]), grid);
  if (life.t === 'err') return life;
  const period = NumberArgs.map(visit(exprs[3]), grid);
  if (period.t === 'err') return period;

  let month = 12;
  if (exprs.length === 5) {
    const monthNode = NumberArgs.map(visit(exprs[4]), grid);
    if (monthNode.t === 'err') return monthNode;
    month = Math.trunc(monthNode.v);
  }

  if (life.v <= 0 || period.v < 1 || cost.v < 0) return { t: 'err', v: '#VALUE!' };

  // Calculate rate rounded to 3 decimal places
  const rate = Math.round((1 - Math.pow(salvage.v / cost.v, 1 / life.v)) * 1000) / 1000;

  let totalDepreciation = 0;
  const per = Math.trunc(period.v);

  for (let p = 1; p <= per; p++) {
    let depreciation: number;
    if (p === 1) {
      depreciation = cost.v * rate * month / 12;
    } else if (p === Math.trunc(life.v) + 1) {
      depreciation = (cost.v - totalDepreciation) * rate * (12 - month) / 12;
    } else {
      depreciation = (cost.v - totalDepreciation) * rate;
    }
    if (p === per) return { t: 'num', v: depreciation };
    totalDepreciation += depreciation;
  }

  return { t: 'err', v: '#VALUE!' };
}

/**
 * DDB(cost, salvage, life, period, [factor]) — returns double-declining balance depreciation.
 */
export function ddbFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 4 || exprs.length > 5) return { t: 'err', v: '#N/A!' };

  const cost = NumberArgs.map(visit(exprs[0]), grid);
  if (cost.t === 'err') return cost;
  const salvage = NumberArgs.map(visit(exprs[1]), grid);
  if (salvage.t === 'err') return salvage;
  const life = NumberArgs.map(visit(exprs[2]), grid);
  if (life.t === 'err') return life;
  const period = NumberArgs.map(visit(exprs[3]), grid);
  if (period.t === 'err') return period;

  let factor = 2;
  if (exprs.length === 5) {
    const factorNode = NumberArgs.map(visit(exprs[4]), grid);
    if (factorNode.t === 'err') return factorNode;
    factor = factorNode.v;
  }

  if (life.v <= 0 || period.v < 1) return { t: 'err', v: '#VALUE!' };

  const rate = factor / life.v;
  let bookValue = cost.v;
  const per = Math.trunc(period.v);

  for (let p = 1; p <= per; p++) {
    let depreciation = bookValue * rate;
    // Don't depreciate below salvage value
    if (bookValue - depreciation < salvage.v) {
      depreciation = bookValue - salvage.v;
    }
    if (depreciation < 0) depreciation = 0;
    if (p === per) return { t: 'num', v: depreciation };
    bookValue -= depreciation;
  }

  return { t: 'err', v: '#VALUE!' };
}

/**
 * NOMINAL(effective_rate, periods_per_year) — returns the nominal annual interest rate.
 */
export function nominalFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };
  const effectiveRate = NumberArgs.map(visit(exprs[0]), grid);
  if (effectiveRate.t === 'err') return effectiveRate;
  const periods = NumberArgs.map(visit(exprs[1]), grid);
  if (periods.t === 'err') return periods;
  const n = Math.trunc(periods.v);
  if (n < 1 || effectiveRate.v <= 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: n * (Math.pow(1 + effectiveRate.v, 1 / n) - 1) };
}

/**
 * CUMIPMT(rate, nper, pv, start_period, end_period, type) — returns cumulative interest paid.
 */
export function cumipmtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 6) return { t: 'err', v: '#N/A!' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const nper = NumberArgs.map(visit(exprs[1]), grid);
  if (nper.t === 'err') return nper;
  const pv = NumberArgs.map(visit(exprs[2]), grid);
  if (pv.t === 'err') return pv;
  const startPeriod = NumberArgs.map(visit(exprs[3]), grid);
  if (startPeriod.t === 'err') return startPeriod;
  const endPeriod = NumberArgs.map(visit(exprs[4]), grid);
  if (endPeriod.t === 'err') return endPeriod;
  const type = NumberArgs.map(visit(exprs[5]), grid);
  if (type.t === 'err') return type;

  const start = Math.trunc(startPeriod.v);
  const end = Math.trunc(endPeriod.v);
  const t = Math.trunc(type.v);

  if (rate.v <= 0 || nper.v <= 0 || pv.v <= 0 || start < 1 || end < start || (t !== 0 && t !== 1)) {
    return { t: 'err', v: '#VALUE!' };
  }

  const pmt = computePmt(rate.v, nper.v, pv.v, 0, t);
  let cumInterest = 0;
  let balance = pv.v;

  for (let p = 1; p <= end; p++) {
    const interest = (t === 1 && p === 1) ? 0 : balance * rate.v;
    const principal = pmt - interest;
    if (p >= start) cumInterest += interest;
    balance += principal;
  }

  return { t: 'num', v: cumInterest };
}

/**
 * CUMPRINC(rate, nper, pv, start_period, end_period, type) — returns cumulative principal paid.
 */
export function cumprincFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 6) return { t: 'err', v: '#N/A!' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const nper = NumberArgs.map(visit(exprs[1]), grid);
  if (nper.t === 'err') return nper;
  const pv = NumberArgs.map(visit(exprs[2]), grid);
  if (pv.t === 'err') return pv;
  const startPeriod = NumberArgs.map(visit(exprs[3]), grid);
  if (startPeriod.t === 'err') return startPeriod;
  const endPeriod = NumberArgs.map(visit(exprs[4]), grid);
  if (endPeriod.t === 'err') return endPeriod;
  const type = NumberArgs.map(visit(exprs[5]), grid);
  if (type.t === 'err') return type;

  const start = Math.trunc(startPeriod.v);
  const end = Math.trunc(endPeriod.v);
  const t = Math.trunc(type.v);

  if (rate.v <= 0 || nper.v <= 0 || pv.v <= 0 || start < 1 || end < start || (t !== 0 && t !== 1)) {
    return { t: 'err', v: '#VALUE!' };
  }

  const pmt = computePmt(rate.v, nper.v, pv.v, 0, t);
  let cumPrincipal = 0;
  let balance = pv.v;

  for (let p = 1; p <= end; p++) {
    const interest = (t === 1 && p === 1) ? 0 : balance * rate.v;
    const principal = pmt - interest;
    if (p >= start) cumPrincipal += principal;
    balance += principal;
  }

  return { t: 'num', v: cumPrincipal };
}

/**
 * AVERAGEA(value1, [value2], ...) — average including text (as 0) and booleans.
 */
export function averageaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };

  let sum = 0;
  let count = 0;
  for (const expr of args.expr()) {
    const node = visit(expr);
    if (node.t === 'err') return node;
    if (node.t === 'ref' && grid) {
      const refs = Array.from(toSrefs([node.v]));
      for (const ref of refs) {
        const cell = grid.get(ref);
        if (!cell || cell.v === undefined || cell.v === '') continue;
        const n = Number(cell.v);
        sum += isNaN(n) ? 0 : n;
        count++;
      }
    } else if (node.t === 'num') {
      sum += node.v;
      count++;
    } else if (node.t === 'bool') {
      sum += node.v ? 1 : 0;
      count++;
    } else if (node.t === 'str') {
      sum += 0;
      count++;
    }
  }
  if (count === 0) return { t: 'err', v: '#DIV/0!' };
  return { t: 'num', v: sum / count };
}

/**
 * MINA(value1, [value2], ...) — minimum including text (as 0) and booleans.
 */
export function minaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };

  let min = Infinity;
  let hasValue = false;
  for (const expr of args.expr()) {
    const node = visit(expr);
    if (node.t === 'err') return node;
    if (node.t === 'ref' && grid) {
      const refs = Array.from(toSrefs([node.v]));
      for (const ref of refs) {
        const cell = grid.get(ref);
        if (!cell || cell.v === undefined || cell.v === '') continue;
        const n = Number(cell.v);
        const val = isNaN(n) ? 0 : n;
        if (val < min) min = val;
        hasValue = true;
      }
    } else if (node.t === 'num') {
      if (node.v < min) min = node.v;
      hasValue = true;
    } else if (node.t === 'bool') {
      const v = node.v ? 1 : 0;
      if (v < min) min = v;
      hasValue = true;
    } else if (node.t === 'str') {
      if (0 < min) min = 0;
      hasValue = true;
    }
  }
  if (!hasValue) return { t: 'num', v: 0 };
  return { t: 'num', v: min };
}

/**
 * MAXA(value1, [value2], ...) — maximum including text (as 0) and booleans.
 */
export function maxaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };

  let max = -Infinity;
  let hasValue = false;
  for (const expr of args.expr()) {
    const node = visit(expr);
    if (node.t === 'err') return node;
    if (node.t === 'ref' && grid) {
      const refs = Array.from(toSrefs([node.v]));
      for (const ref of refs) {
        const cell = grid.get(ref);
        if (!cell || cell.v === undefined || cell.v === '') continue;
        const n = Number(cell.v);
        const val = isNaN(n) ? 0 : n;
        if (val > max) max = val;
        hasValue = true;
      }
    } else if (node.t === 'num') {
      if (node.v > max) max = node.v;
      hasValue = true;
    } else if (node.t === 'bool') {
      const v = node.v ? 1 : 0;
      if (v > max) max = v;
      hasValue = true;
    } else if (node.t === 'str') {
      if (0 > max) max = 0;
      hasValue = true;
    }
  }
  if (!hasValue) return { t: 'num', v: 0 };
  return { t: 'num', v: max };
}

/**
 * FISHER(x) — returns the Fisher transformation.
 */
export function fisherFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  if (x.v <= -1 || x.v >= 1) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: 0.5 * Math.log((1 + x.v) / (1 - x.v)) };
}

/**
 * FISHERINV(y) — returns the inverse Fisher transformation.
 */
export function fisherinvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const y = NumberArgs.map(visit(exprs[0]), grid);
  if (y.t === 'err') return y;
  const e2y = Math.exp(2 * y.v);
  return { t: 'num', v: (e2y - 1) / (e2y + 1) };
}

/**
 * Lanczos approximation for the gamma function.
 */
function gammaLanczos(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    return Math.PI / (Math.sin(Math.PI * z) * gammaLanczos(1 - z));
  }

  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) {
    x += c[i] / (z + i);
  }
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

/**
 * GAMMA(number) — returns the gamma function value.
 */
export function gammaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const n = NumberArgs.map(visit(exprs[0]), grid);
  if (n.t === 'err') return n;
  if (n.v <= 0 && Number.isInteger(n.v)) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: gammaLanczos(n.v) };
}

/**
 * GAMMALN(number) — returns the natural log of the gamma function.
 */
export function gammalnFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const n = NumberArgs.map(visit(exprs[0]), grid);
  if (n.t === 'err') return n;
  if (n.v <= 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: Math.log(gammaLanczos(n.v)) };
}

/**
 * Error function approximation (Abramowitz and Stegun 7.1.26).
 */
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

/**
 * Standard normal CDF.
 */
function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * Standard normal PDF.
 */
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Standard normal inverse CDF (rational approximation).
 */
function normInv(p: number): number {
  if (p <= 0 || p >= 1) return NaN;
  if (p < 0.5) return -normInv(1 - p);

  // Rational approximation for upper half
  const t = Math.sqrt(-2 * Math.log(1 - p));
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;
  return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
}

/**
 * NORMDIST(x, mean, stdev, cumulative) / NORM.DIST — normal distribution.
 */
export function normdistFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 4) return { t: 'err', v: '#N/A!' };

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const mean = NumberArgs.map(visit(exprs[1]), grid);
  if (mean.t === 'err') return mean;
  const stdev = NumberArgs.map(visit(exprs[2]), grid);
  if (stdev.t === 'err') return stdev;
  if (stdev.v <= 0) return { t: 'err', v: '#VALUE!' };

  const cumNode = visit(exprs[3]);
  const cum = cumNode.t === 'bool' ? cumNode.v : cumNode.t === 'num' ? cumNode.v !== 0 : true;

  const z = (x.v - mean.v) / stdev.v;
  if (cum) {
    return { t: 'num', v: normCdf(z) };
  }
  return { t: 'num', v: normPdf(z) / stdev.v };
}

/**
 * NORMINV(probability, mean, stdev) / NORM.INV — inverse normal distribution.
 */
export function norminvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const p = NumberArgs.map(visit(exprs[0]), grid);
  if (p.t === 'err') return p;
  const mean = NumberArgs.map(visit(exprs[1]), grid);
  if (mean.t === 'err') return mean;
  const stdev = NumberArgs.map(visit(exprs[2]), grid);
  if (stdev.t === 'err') return stdev;
  if (stdev.v <= 0 || p.v <= 0 || p.v >= 1) return { t: 'err', v: '#VALUE!' };

  return { t: 'num', v: mean.v + stdev.v * normInv(p.v) };
}

/**
 * LOGNORMAL.DIST(x, mean, stdev, cumulative) — lognormal distribution.
 */
export function lognormdistFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 4) return { t: 'err', v: '#N/A!' };

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const mean = NumberArgs.map(visit(exprs[1]), grid);
  if (mean.t === 'err') return mean;
  const stdev = NumberArgs.map(visit(exprs[2]), grid);
  if (stdev.t === 'err') return stdev;
  if (x.v <= 0 || stdev.v <= 0) return { t: 'err', v: '#VALUE!' };

  const cumNode = visit(exprs[3]);
  const cum = cumNode.t === 'bool' ? cumNode.v : cumNode.t === 'num' ? cumNode.v !== 0 : true;

  const z = (Math.log(x.v) - mean.v) / stdev.v;
  if (cum) {
    return { t: 'num', v: normCdf(z) };
  }
  return { t: 'num', v: normPdf(z) / (x.v * stdev.v) };
}

/**
 * LOGNORMAL.INV(probability, mean, stdev) — inverse lognormal distribution.
 */
export function lognorminvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const p = NumberArgs.map(visit(exprs[0]), grid);
  if (p.t === 'err') return p;
  const mean = NumberArgs.map(visit(exprs[1]), grid);
  if (mean.t === 'err') return mean;
  const stdev = NumberArgs.map(visit(exprs[2]), grid);
  if (stdev.t === 'err') return stdev;
  if (stdev.v <= 0 || p.v <= 0 || p.v >= 1) return { t: 'err', v: '#VALUE!' };

  return { t: 'num', v: Math.exp(mean.v + stdev.v * normInv(p.v)) };
}

/**
 * STANDARDIZE(x, mean, stdev) — returns a normalized value (z-score).
 */
export function standardizeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const mean = NumberArgs.map(visit(exprs[1]), grid);
  if (mean.t === 'err') return mean;
  const stdev = NumberArgs.map(visit(exprs[2]), grid);
  if (stdev.t === 'err') return stdev;
  if (stdev.v <= 0) return { t: 'err', v: '#VALUE!' };

  return { t: 'num', v: (x.v - mean.v) / stdev.v };
}

/**
 * WEIBULL.DIST(x, alpha, beta, cumulative) — Weibull distribution.
 */
export function weibulldistFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 4) return { t: 'err', v: '#N/A!' };

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const alpha = NumberArgs.map(visit(exprs[1]), grid);
  if (alpha.t === 'err') return alpha;
  const beta = NumberArgs.map(visit(exprs[2]), grid);
  if (beta.t === 'err') return beta;
  if (x.v < 0 || alpha.v <= 0 || beta.v <= 0) return { t: 'err', v: '#VALUE!' };

  const cumNode = visit(exprs[3]);
  const cum = cumNode.t === 'bool' ? cumNode.v : cumNode.t === 'num' ? cumNode.v !== 0 : true;

  if (cum) {
    return { t: 'num', v: 1 - Math.exp(-Math.pow(x.v / beta.v, alpha.v)) };
  }
  return { t: 'num', v: (alpha.v / Math.pow(beta.v, alpha.v)) * Math.pow(x.v, alpha.v - 1) * Math.exp(-Math.pow(x.v / beta.v, alpha.v)) };
}

/**
 * POISSON.DIST(x, mean, cumulative) — Poisson distribution.
 */
export function poissondistFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const mean = NumberArgs.map(visit(exprs[1]), grid);
  if (mean.t === 'err') return mean;
  if (mean.v < 0) return { t: 'err', v: '#VALUE!' };

  const cumNode = visit(exprs[2]);
  const cum = cumNode.t === 'bool' ? cumNode.v : cumNode.t === 'num' ? cumNode.v !== 0 : true;

  const k = Math.trunc(x.v);
  if (k < 0) return { t: 'err', v: '#VALUE!' };

  if (cum) {
    let sum = 0;
    for (let i = 0; i <= k; i++) {
      sum += Math.pow(mean.v, i) * Math.exp(-mean.v) / gammaLanczos(i + 1);
    }
    return { t: 'num', v: sum };
  }
  return { t: 'num', v: Math.pow(mean.v, k) * Math.exp(-mean.v) / gammaLanczos(k + 1) };
}

/**
 * BINOM.DIST(successes, trials, probability, cumulative) — binomial distribution.
 */
export function binomdistFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 4) return { t: 'err', v: '#N/A!' };

  const s = NumberArgs.map(visit(exprs[0]), grid);
  if (s.t === 'err') return s;
  const trials = NumberArgs.map(visit(exprs[1]), grid);
  if (trials.t === 'err') return trials;
  const prob = NumberArgs.map(visit(exprs[2]), grid);
  if (prob.t === 'err') return prob;

  const k = Math.trunc(s.v);
  const n = Math.trunc(trials.v);
  if (k < 0 || n < 0 || k > n || prob.v < 0 || prob.v > 1) return { t: 'err', v: '#VALUE!' };

  const cumNode = visit(exprs[3]);
  const cum = cumNode.t === 'bool' ? cumNode.v : cumNode.t === 'num' ? cumNode.v !== 0 : true;

  // Binomial coefficient using log-gamma for numerical stability
  function binomPmf(x: number): number {
    const logCoeff = Math.log(gammaLanczos(n + 1)) - Math.log(gammaLanczos(x + 1)) - Math.log(gammaLanczos(n - x + 1));
    return Math.exp(logCoeff + x * Math.log(prob.v) + (n - x) * Math.log(1 - prob.v));
  }

  if (cum) {
    let sum = 0;
    for (let i = 0; i <= k; i++) {
      sum += binomPmf(i);
    }
    return { t: 'num', v: sum };
  }
  return { t: 'num', v: binomPmf(k) };
}

/**
 * EXPON.DIST(x, lambda, cumulative) — exponential distribution.
 */
export function expondistFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const lambda = NumberArgs.map(visit(exprs[1]), grid);
  if (lambda.t === 'err') return lambda;
  if (x.v < 0 || lambda.v <= 0) return { t: 'err', v: '#VALUE!' };

  const cumNode = visit(exprs[2]);
  const cum = cumNode.t === 'bool' ? cumNode.v : cumNode.t === 'num' ? cumNode.v !== 0 : true;

  if (cum) {
    return { t: 'num', v: 1 - Math.exp(-lambda.v * x.v) };
  }
  return { t: 'num', v: lambda.v * Math.exp(-lambda.v * x.v) };
}

/**
 * CONFIDENCE.NORM(alpha, stdev, size) — confidence interval using normal distribution.
 */
export function confidencenormFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const alpha = NumberArgs.map(visit(exprs[0]), grid);
  if (alpha.t === 'err') return alpha;
  const stdev = NumberArgs.map(visit(exprs[1]), grid);
  if (stdev.t === 'err') return stdev;
  const size = NumberArgs.map(visit(exprs[2]), grid);
  if (size.t === 'err') return size;

  if (alpha.v <= 0 || alpha.v >= 1 || stdev.v <= 0 || size.v < 1) {
    return { t: 'err', v: '#VALUE!' };
  }

  const z = normInv(1 - alpha.v / 2);
  return { t: 'num', v: z * stdev.v / Math.sqrt(Math.trunc(size.v)) };
}

/**
 * Log of the gamma function (more numerically stable than log(gammaLanczos(a))).
 */
function logGamma(a: number): number {
  return Math.log(gammaLanczos(a));
}

/**
 * Lower regularized incomplete gamma function P(a,x) using series or continued fraction.
 */
function lowerIncompleteGamma(a: number, x: number): number {
  if (x < 0) return 0;
  if (x === 0) return 0;

  // Series expansion for x < a+1
  if (x < a + 1) {
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n < 200; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < 1e-14 * Math.abs(sum)) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }

  // Continued fraction (Lentz's algorithm) for x >= a+1 → compute Q(a,x) then P = 1-Q
  let b = x + 1 - a;
  let c = 1e30;
  let d = 1 / b;
  let h = d;

  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }

  return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/**
 * CHISQ.DIST(x, degrees_freedom, cumulative) — chi-squared distribution.
 */
export function chisqdistFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const df = NumberArgs.map(visit(exprs[1]), grid);
  if (df.t === 'err') return df;
  if (x.v < 0 || df.v < 1) return { t: 'err', v: '#VALUE!' };

  const cumNode = visit(exprs[2]);
  const cum = cumNode.t === 'bool' ? cumNode.v : cumNode.t === 'num' ? cumNode.v !== 0 : true;

  const k = Math.trunc(df.v);
  const halfK = k / 2;

  if (cum) {
    return { t: 'num', v: lowerIncompleteGamma(halfK, x.v / 2) };
  }
  // PDF: x^(k/2-1) * exp(-x/2) / (2^(k/2) * Gamma(k/2))
  const pdf = Math.pow(x.v, halfK - 1) * Math.exp(-x.v / 2) / (Math.pow(2, halfK) * gammaLanczos(halfK));
  return { t: 'num', v: pdf };
}

/**
 * CHISQ.INV(probability, degrees_freedom) — inverse chi-squared distribution.
 * Uses Newton's method with regularized incomplete gamma function.
 */
export function chisqinvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const p = NumberArgs.map(visit(exprs[0]), grid);
  if (p.t === 'err') return p;
  const df = NumberArgs.map(visit(exprs[1]), grid);
  if (df.t === 'err') return df;
  if (p.v <= 0 || p.v >= 1 || df.v < 1) return { t: 'err', v: '#VALUE!' };

  const k = Math.trunc(df.v);
  // Initial guess using Wilson-Hilferty approximation
  let x = k * Math.pow(1 - 2 / (9 * k) + normInv(p.v) * Math.sqrt(2 / (9 * k)), 3);
  if (x <= 0) x = 0.01;

  // Newton's method
  for (let i = 0; i < 100; i++) {
    const cdf = lowerIncompleteGamma(k / 2, x / 2);
    const halfK = k / 2;
    const pdf = Math.pow(x, halfK - 1) * Math.exp(-x / 2) / (Math.pow(2, halfK) * gammaLanczos(halfK));
    if (Math.abs(pdf) < 1e-15) break;
    const newX = x - (cdf - p.v) / pdf;
    if (Math.abs(newX - x) < 1e-10) { x = newX; break; }
    x = Math.max(newX, 1e-10);
  }

  return { t: 'num', v: x };
}

/**
 * T.DIST(x, degrees_freedom, cumulative) — Student's t-distribution.
 */
export function tdistFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const df = NumberArgs.map(visit(exprs[1]), grid);
  if (df.t === 'err') return df;
  if (df.v < 1) return { t: 'err', v: '#VALUE!' };

  const cumNode = visit(exprs[2]);
  const cum = cumNode.t === 'bool' ? cumNode.v : cumNode.t === 'num' ? cumNode.v !== 0 : true;

  const v = Math.trunc(df.v);

  if (cum) {
    // CDF using regularized incomplete beta function via chi-squared relation
    const t2 = x.v * x.v;
    const p = lowerIncompleteGamma(v / 2, v / (v + t2) * v / 2);
    // Use the relation: T.DIST(x) = 1 - 0.5 * I_x(df/2, 1/2) for x > 0
    // Simpler approach: use numeric integration with regularized beta
    // For simplicity, use the relationship with chi-squared:
    // P(T ≤ x) = 0.5 + sign(x) * 0.5 * I(df/(df+x²))(df/2, 1/2)
    const xi = v / (v + t2);
    const ibeta = regularizedBeta(xi, v / 2, 0.5);
    return { t: 'num', v: x.v >= 0 ? 1 - 0.5 * ibeta : 0.5 * ibeta };
  }

  // PDF: Gamma((v+1)/2) / (sqrt(v*pi) * Gamma(v/2)) * (1 + x²/v)^(-(v+1)/2)
  const pdf = gammaLanczos((v + 1) / 2) / (Math.sqrt(v * Math.PI) * gammaLanczos(v / 2))
    * Math.pow(1 + t2 / v, -(v + 1) / 2);
  return { t: 'num', v: pdf };
}

/**
 * Regularized incomplete beta function I_x(a, b).
 * Uses series expansion which is stable for the values we need.
 */
function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use symmetry for better convergence
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedBeta(1 - x, b, a);
  }

  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const prefix = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta) / a;

  // Continued fraction (Numerical Recipes betacf)
  const MAXIT = 200;
  const EPS = 1e-14;
  const FPMIN = 1e-30;

  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    // Even step
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;

    // Odd step
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }

  return prefix * h;
}

/**
 * Compute the inverse t-distribution value for probability p and degrees of freedom v.
 */
function computeTInv(p: number, v: number): number {
  // Newton's method starting from normal approximation
  let t = normInv(p);

  for (let i = 0; i < 100; i++) {
    const t2 = t * t;
    const xi = v / (v + t2);
    const ibeta = regularizedBeta(xi, v / 2, 0.5);
    const cdf = t >= 0 ? 1 - 0.5 * ibeta : 0.5 * ibeta;
    const pdf = gammaLanczos((v + 1) / 2) / (Math.sqrt(v * Math.PI) * gammaLanczos(v / 2))
      * Math.pow(1 + t2 / v, -(v + 1) / 2);
    if (Math.abs(pdf) < 1e-15) break;
    const newT = t - (cdf - p) / pdf;
    if (Math.abs(newT - t) < 1e-10) return newT;
    t = newT;
  }

  return t;
}

/**
 * T.INV(probability, degrees_freedom) — inverse Student's t-distribution.
 */
export function tinvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const p = NumberArgs.map(visit(exprs[0]), grid);
  if (p.t === 'err') return p;
  const df = NumberArgs.map(visit(exprs[1]), grid);
  if (df.t === 'err') return df;
  if (p.v <= 0 || p.v >= 1 || df.v < 1) return { t: 'err', v: '#VALUE!' };

  return { t: 'num', v: computeTInv(p.v, Math.trunc(df.v)) };
}

/**
 * HYPGEOM.DIST(sample_s, number_sample, population_s, number_pop, cumulative) — hypergeometric distribution.
 */
export function hypgeomdistFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 5) return { t: 'err', v: '#N/A!' };

  const s = NumberArgs.map(visit(exprs[0]), grid);
  if (s.t === 'err') return s;
  const nSample = NumberArgs.map(visit(exprs[1]), grid);
  if (nSample.t === 'err') return nSample;
  const popS = NumberArgs.map(visit(exprs[2]), grid);
  if (popS.t === 'err') return popS;
  const nPop = NumberArgs.map(visit(exprs[3]), grid);
  if (nPop.t === 'err') return nPop;

  const cumNode = visit(exprs[4]);
  const cum = cumNode.t === 'bool' ? cumNode.v : cumNode.t === 'num' ? cumNode.v !== 0 : true;

  const k = Math.trunc(s.v);
  const n = Math.trunc(nSample.v);
  const K = Math.trunc(popS.v);
  const N = Math.trunc(nPop.v);

  if (k < 0 || n < 0 || K < 0 || N < 0 || n > N || K > N || k > Math.min(n, K)) {
    return { t: 'err', v: '#VALUE!' };
  }

  function logCombin(a: number, b: number): number {
    return Math.log(gammaLanczos(a + 1)) - Math.log(gammaLanczos(b + 1)) - Math.log(gammaLanczos(a - b + 1));
  }

  function pmf(x: number): number {
    return Math.exp(logCombin(K, x) + logCombin(N - K, n - x) - logCombin(N, n));
  }

  if (cum) {
    let sum = 0;
    for (let i = Math.max(0, n + K - N); i <= k; i++) {
      sum += pmf(i);
    }
    return { t: 'num', v: sum };
  }
  return { t: 'num', v: pmf(k) };
}

/**
 * NEGBINOM.DIST(failures, successes, probability, cumulative) — negative binomial distribution.
 */
export function negbinomdistFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 4) return { t: 'err', v: '#N/A!' };

  const f = NumberArgs.map(visit(exprs[0]), grid);
  if (f.t === 'err') return f;
  const s = NumberArgs.map(visit(exprs[1]), grid);
  if (s.t === 'err') return s;
  const prob = NumberArgs.map(visit(exprs[2]), grid);
  if (prob.t === 'err') return prob;

  const cumNode = visit(exprs[3]);
  const cum = cumNode.t === 'bool' ? cumNode.v : cumNode.t === 'num' ? cumNode.v !== 0 : true;

  const failures = Math.trunc(f.v);
  const successes = Math.trunc(s.v);
  if (failures < 0 || successes < 1 || prob.v <= 0 || prob.v > 1) return { t: 'err', v: '#VALUE!' };

  function pmf(x: number): number {
    const logCoeff = Math.log(gammaLanczos(x + successes))
      - Math.log(gammaLanczos(successes)) - Math.log(gammaLanczos(x + 1));
    return Math.exp(logCoeff + successes * Math.log(prob.v) + x * Math.log(1 - prob.v));
  }

  if (cum) {
    let sum = 0;
    for (let i = 0; i <= failures; i++) {
      sum += pmf(i);
    }
    return { t: 'num', v: sum };
  }
  return { t: 'num', v: pmf(failures) };
}

/**
 * CONFIDENCE.T(alpha, stdev, size) — confidence interval using t-distribution.
 */
export function confidencetFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const alpha = NumberArgs.map(visit(exprs[0]), grid);
  if (alpha.t === 'err') return alpha;
  const stdev = NumberArgs.map(visit(exprs[1]), grid);
  if (stdev.t === 'err') return stdev;
  const size = NumberArgs.map(visit(exprs[2]), grid);
  if (size.t === 'err') return size;

  const n = Math.trunc(size.v);
  if (alpha.v <= 0 || alpha.v >= 1 || stdev.v <= 0 || n < 2) {
    return { t: 'err', v: '#VALUE!' };
  }

  // Find t-critical using T.INV(1-alpha/2, n-1)
  const p = 1 - alpha.v / 2;
  const df = n - 1;
  const t = computeTInv(p, df);

  return { t: 'num', v: t * stdev.v / Math.sqrt(n) };
}

/**
 * ARABIC(roman_numeral) — converts Roman numeral text to a number.
 */
export function arabicFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const node = visit(exprs[0]);
  const strResult = toStr(node, grid);
  if (strResult.t === 'err') return strResult;
  const text = strResult.v.toUpperCase();

  const romanValues: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let result = 0;
  for (let i = 0; i < text.length; i++) {
    const current = romanValues[text[i]];
    const next = i + 1 < text.length ? romanValues[text[i + 1]] : 0;
    if (current === undefined) return { t: 'err', v: '#VALUE!' };
    if (current < next) {
      result -= current;
    } else {
      result += current;
    }
  }
  return { t: 'num', v: result };
}

/**
 * ROMAN(number, [form]) — converts a number to Roman numeral text.
 */
export function romanFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A!' };

  const n = NumberArgs.map(visit(exprs[0]), grid);
  if (n.t === 'err') return n;
  let num = Math.trunc(n.v);
  if (num < 0 || num > 3999) return { t: 'err', v: '#VALUE!' };
  if (num === 0) return { t: 'str', v: '' };

  const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const symbols = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
  let result = '';
  for (let i = 0; i < values.length; i++) {
    while (num >= values[i]) {
      result += symbols[i];
      num -= values[i];
    }
  }
  return { t: 'str', v: result };
}

/**
 * MULTINOMIAL(n1, n2, ...) — returns the multinomial coefficient.
 */
export function multinomialFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };

  let sum = 0;
  let denomProduct = 1;
  for (const expr of args.expr()) {
    const n = NumberArgs.map(visit(expr), grid);
    if (n.t === 'err') return n;
    const val = Math.trunc(n.v);
    if (val < 0) return { t: 'err', v: '#VALUE!' };
    sum += val;
    denomProduct *= gammaLanczos(val + 1);
  }
  return { t: 'num', v: Math.round(gammaLanczos(sum + 1) / denomProduct) };
}

/**
 * SERIESSUM(x, n, m, coefficients) — returns the sum of a power series.
 */
export function seriessumFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 4) return { t: 'err', v: '#N/A!' };

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const n = NumberArgs.map(visit(exprs[1]), grid);
  if (n.t === 'err') return n;
  const m = NumberArgs.map(visit(exprs[2]), grid);
  if (m.t === 'err') return m;

  // Get coefficients from range
  const coeffsResult = getRefsFromExpression(exprs[3], visit, grid);
  if (coeffsResult.t === 'err') return coeffsResult;

  let sum = 0;
  for (let i = 0; i < coeffsResult.v.length; i++) {
    const cell = grid!.get(coeffsResult.v[i]);
    const coeff = cell ? Number(cell.v) : 0;
    if (isNaN(coeff)) return { t: 'err', v: '#VALUE!' };
    sum += coeff * Math.pow(x.v, n.v + i * m.v);
  }
  return { t: 'num', v: sum };
}

/**
 * DELTA(number1, [number2]) — tests if two values are equal (1 if equal, 0 otherwise).
 */
export function deltaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A!' };

  const n1 = NumberArgs.map(visit(exprs[0]), grid);
  if (n1.t === 'err') return n1;

  let n2 = 0;
  if (exprs.length === 2) {
    const n2Node = NumberArgs.map(visit(exprs[1]), grid);
    if (n2Node.t === 'err') return n2Node;
    n2 = n2Node.v;
  }

  return { t: 'num', v: n1.v === n2 ? 1 : 0 };
}

/**
 * GESTEP(number, [step]) — returns 1 if number >= step, 0 otherwise.
 */
export function gestepFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A!' };

  const n = NumberArgs.map(visit(exprs[0]), grid);
  if (n.t === 'err') return n;

  let step = 0;
  if (exprs.length === 2) {
    const stepNode = NumberArgs.map(visit(exprs[1]), grid);
    if (stepNode.t === 'err') return stepNode;
    step = stepNode.v;
  }

  return { t: 'num', v: n.v >= step ? 1 : 0 };
}

/**
 * ERF(lower_limit, [upper_limit]) — returns the error function.
 */
export function erfFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A!' };

  const lower = NumberArgs.map(visit(exprs[0]), grid);
  if (lower.t === 'err') return lower;

  if (exprs.length === 1) {
    return { t: 'num', v: erf(lower.v) };
  }

  const upper = NumberArgs.map(visit(exprs[1]), grid);
  if (upper.t === 'err') return upper;
  return { t: 'num', v: erf(upper.v) - erf(lower.v) };
}

/**
 * ERFC(x) — returns the complementary error function.
 */
export function erfcFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  return { t: 'num', v: 1 - erf(x.v) };
}

/**
 * XNPV(rate, values, dates) — net present value with irregular dates.
 */
export function xnpvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;

  const valuesResult = getRefsFromExpression(exprs[1], visit, grid);
  if (valuesResult.t === 'err') return valuesResult;
  const datesResult = getRefsFromExpression(exprs[2], visit, grid);
  if (datesResult.t === 'err') return datesResult;

  if (valuesResult.v.length !== datesResult.v.length) return { t: 'err', v: '#VALUE!' };

  const values: number[] = [];
  const dates: number[] = [];

  for (let i = 0; i < valuesResult.v.length; i++) {
    const vCell = grid!.get(valuesResult.v[i]);
    const v = vCell ? Number(vCell.v) : 0;
    if (isNaN(v)) return { t: 'err', v: '#VALUE!' };
    values.push(v);

    const dCell = grid!.get(datesResult.v[i]);
    const dateStr = dCell?.v || '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return { t: 'err', v: '#VALUE!' };
    dates.push(d.getTime());
  }

  const d0 = dates[0];
  let npv = 0;
  for (let i = 0; i < values.length; i++) {
    const years = (dates[i] - d0) / (365.25 * 24 * 3600 * 1000);
    npv += values[i] / Math.pow(1 + rate.v, years);
  }

  return { t: 'num', v: npv };
}

/**
 * XIRR(values, dates, [guess]) — internal rate of return for irregular cash flows.
 */
export function xirrFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) return { t: 'err', v: '#N/A!' };

  const valuesResult = getRefsFromExpression(exprs[0], visit, grid);
  if (valuesResult.t === 'err') return valuesResult;
  const datesResult = getRefsFromExpression(exprs[1], visit, grid);
  if (datesResult.t === 'err') return datesResult;

  if (valuesResult.v.length !== datesResult.v.length) return { t: 'err', v: '#VALUE!' };

  const values: number[] = [];
  const dates: number[] = [];

  for (let i = 0; i < valuesResult.v.length; i++) {
    const vCell = grid!.get(valuesResult.v[i]);
    const v = vCell ? Number(vCell.v) : 0;
    if (isNaN(v)) return { t: 'err', v: '#VALUE!' };
    values.push(v);

    const dCell = grid!.get(datesResult.v[i]);
    const dateStr = dCell?.v || '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return { t: 'err', v: '#VALUE!' };
    dates.push(d.getTime());
  }

  let guess = 0.1;
  if (exprs.length === 3) {
    const guessNode = NumberArgs.map(visit(exprs[2]), grid);
    if (guessNode.t === 'err') return guessNode;
    guess = guessNode.v;
  }

  const d0 = dates[0];
  let rate = guess;

  for (let iter = 0; iter < 100; iter++) {
    let f = 0;
    let df = 0;
    for (let i = 0; i < values.length; i++) {
      const years = (dates[i] - d0) / (365.25 * 24 * 3600 * 1000);
      const denom = Math.pow(1 + rate, years);
      f += values[i] / denom;
      df -= years * values[i] / Math.pow(1 + rate, years + 1);
    }
    if (Math.abs(df) < 1e-15) return { t: 'err', v: '#VALUE!' };
    const newRate = rate - f / df;
    if (Math.abs(newRate - rate) < 1e-10) return { t: 'num', v: newRate };
    rate = newRate;
  }
  return { t: 'err', v: '#VALUE!' };
}

/**
 * SYD(cost, salvage, life, period) — sum-of-years-digits depreciation.
 */
export function sydFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 4) return { t: 'err', v: '#N/A!' };

  const cost = NumberArgs.map(visit(exprs[0]), grid);
  if (cost.t === 'err') return cost;
  const salvage = NumberArgs.map(visit(exprs[1]), grid);
  if (salvage.t === 'err') return salvage;
  const life = NumberArgs.map(visit(exprs[2]), grid);
  if (life.t === 'err') return life;
  const period = NumberArgs.map(visit(exprs[3]), grid);
  if (period.t === 'err') return period;

  const l = Math.trunc(life.v);
  const p = Math.trunc(period.v);
  if (l <= 0 || p < 1 || p > l) return { t: 'err', v: '#VALUE!' };

  const sumOfYears = l * (l + 1) / 2;
  return { t: 'num', v: (cost.v - salvage.v) * (l - p + 1) / sumOfYears };
}

/**
 * MIRR(values, finance_rate, reinvest_rate) — modified internal rate of return.
 */
export function mirrFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const valuesResult = getRefsFromExpression(exprs[0], visit, grid);
  if (valuesResult.t === 'err') return valuesResult;
  const financeRate = NumberArgs.map(visit(exprs[1]), grid);
  if (financeRate.t === 'err') return financeRate;
  const reinvestRate = NumberArgs.map(visit(exprs[2]), grid);
  if (reinvestRate.t === 'err') return reinvestRate;

  const values: number[] = [];
  for (const ref of valuesResult.v) {
    const cell = grid!.get(ref);
    const v = cell ? Number(cell.v) : 0;
    if (isNaN(v)) return { t: 'err', v: '#VALUE!' };
    values.push(v);
  }

  const n = values.length;
  if (n < 2) return { t: 'err', v: '#VALUE!' };

  // PV of negative cash flows (costs) discounted at finance rate
  let pvNeg = 0;
  // FV of positive cash flows compounded at reinvestment rate
  let fvPos = 0;

  for (let i = 0; i < n; i++) {
    if (values[i] < 0) {
      pvNeg += values[i] / Math.pow(1 + financeRate.v, i);
    } else {
      fvPos += values[i] * Math.pow(1 + reinvestRate.v, n - 1 - i);
    }
  }

  if (pvNeg === 0) return { t: 'err', v: '#DIV/0!' };
  return { t: 'num', v: Math.pow(-fvPos / pvNeg, 1 / (n - 1)) - 1 };
}

/**
 * TBILLEQ(settlement, maturity, discount) — T-bill bond-equivalent yield.
 */
export function tbilleqFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const settlementNode = visit(exprs[0]);
  const maturityNode = visit(exprs[1]);
  const discountNode = NumberArgs.map(visit(exprs[2]), grid);
  if (discountNode.t === 'err') return discountNode;

  const sStr = toStr(settlementNode, grid);
  if (sStr.t === 'err') return sStr;
  const mStr2 = toStr(maturityNode, grid);
  if (mStr2.t === 'err') return mStr2;
  const settlement = new Date(sStr.v);
  const maturity = new Date(mStr2.v);
  if (isNaN(settlement.getTime()) || isNaN(maturity.getTime())) return { t: 'err', v: '#VALUE!' };

  const dsm = (maturity.getTime() - settlement.getTime()) / (24 * 3600 * 1000);
  if (dsm <= 0 || discountNode.v <= 0) return { t: 'err', v: '#VALUE!' };

  return { t: 'num', v: 365 * discountNode.v / (360 - discountNode.v * dsm) };
}

/**
 * TBILLPRICE(settlement, maturity, discount) — T-bill price per $100.
 */
export function tbillpriceFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const settlementNode = visit(exprs[0]);
  const maturityNode = visit(exprs[1]);
  const discountNode = NumberArgs.map(visit(exprs[2]), grid);
  if (discountNode.t === 'err') return discountNode;

  const sStr = toStr(settlementNode, grid);
  const mStr = toStr(maturityNode, grid);
  if (sStr.t === 'err' || mStr.t === 'err') return { t: 'err', v: '#VALUE!' };

  const settlement = new Date(sStr.v);
  const maturity = new Date(mStr.v);
  if (isNaN(settlement.getTime()) || isNaN(maturity.getTime())) return { t: 'err', v: '#VALUE!' };

  const dsm = (maturity.getTime() - settlement.getTime()) / (24 * 3600 * 1000);
  if (dsm <= 0) return { t: 'err', v: '#VALUE!' };

  return { t: 'num', v: 100 * (1 - discountNode.v * dsm / 360) };
}

/**
 * TBILLYIELD(settlement, maturity, price) — T-bill yield.
 */
export function tbillyieldFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const settlementNode = visit(exprs[0]);
  const maturityNode = visit(exprs[1]);
  const priceNode = NumberArgs.map(visit(exprs[2]), grid);
  if (priceNode.t === 'err') return priceNode;

  const sStr = toStr(settlementNode, grid);
  const mStr = toStr(maturityNode, grid);
  if (sStr.t === 'err' || mStr.t === 'err') return { t: 'err', v: '#VALUE!' };

  const settlement = new Date(sStr.v);
  const maturity = new Date(mStr.v);
  if (isNaN(settlement.getTime()) || isNaN(maturity.getTime())) return { t: 'err', v: '#VALUE!' };

  const dsm = (maturity.getTime() - settlement.getTime()) / (24 * 3600 * 1000);
  if (dsm <= 0 || priceNode.v <= 0) return { t: 'err', v: '#VALUE!' };

  return { t: 'num', v: (100 - priceNode.v) / priceNode.v * 360 / dsm };
}

/**
 * DOLLARDE(fractional_dollar, fraction) — converts dollar price to decimal.
 */
export function dollardeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const dollar = NumberArgs.map(visit(exprs[0]), grid);
  if (dollar.t === 'err') return dollar;
  const fraction = NumberArgs.map(visit(exprs[1]), grid);
  if (fraction.t === 'err') return fraction;
  const f = Math.trunc(fraction.v);
  if (f < 1) return { t: 'err', v: '#VALUE!' };

  const intPart = Math.trunc(dollar.v);
  const fracPart = dollar.v - intPart;
  const power = Math.pow(10, Math.ceil(Math.log10(f)));
  return { t: 'num', v: intPart + fracPart * power / f };
}

/**
 * DOLLARFR(decimal_dollar, fraction) — converts dollar price to fractional.
 */
export function dollarfrFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const dollar = NumberArgs.map(visit(exprs[0]), grid);
  if (dollar.t === 'err') return dollar;
  const fraction = NumberArgs.map(visit(exprs[1]), grid);
  if (fraction.t === 'err') return fraction;
  const f = Math.trunc(fraction.v);
  if (f < 1) return { t: 'err', v: '#VALUE!' };

  const intPart = Math.trunc(dollar.v);
  const fracPart = dollar.v - intPart;
  const power = Math.pow(10, Math.ceil(Math.log10(f)));
  return { t: 'num', v: intPart + fracPart * f / power };
}

/**
 * ENCODEURL(text) — encodes a string for use in a URL.
 */
export function encodeurlFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };

  const node = visit(exprs[0]);
  const s = toStr(node, grid);
  if (s.t === 'err') return s;
  return { t: 'str', v: encodeURIComponent(s.v) };
}

/**
 * ISURL(value) — returns TRUE if the value looks like a URL.
 */
export function isurlFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };

  const node = visit(exprs[0]);
  const s = toStr(node, grid);
  if (s.t === 'err') return s;
  const v = s.v.trim();
  const isUrl = /^https?:\/\//i.test(v) || /^ftp:\/\//i.test(v);
  return { t: 'bool', v: isUrl };
}

/**
 * ISFORMULA(cell) — returns TRUE if the referenced cell contains a formula.
 */
export function isformulaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };

  const node = visit(exprs[0]);
  if (node.t !== 'ref' || !grid) return { t: 'bool', v: false };
  if (isSrng(node.v)) return { t: 'err', v: '#VALUE!' };

  const cell = grid.get(node.v);
  return { t: 'bool', v: !!(cell && cell.f) };
}

/**
 * FORMULATEXT(cell) — returns the formula string of the referenced cell.
 */
export function formulatextFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };

  const node = visit(exprs[0]);
  if (node.t !== 'ref' || !grid) return { t: 'err', v: '#N/A!' };
  if (isSrng(node.v)) return { t: 'err', v: '#VALUE!' };

  const cell = grid.get(node.v);
  if (!cell || !cell.f) return { t: 'err', v: '#N/A!' };
  return { t: 'str', v: cell.f };
}

/**
 * CEILING.MATH(number, [significance], [mode]) — rounds up to nearest multiple.
 * If mode is non-zero and number is negative, rounds away from zero.
 */
export function ceilingmathFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 3) return { t: 'err', v: '#N/A!' };

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;

  let significance = 1;
  if (exprs.length >= 2) {
    const sigNode = NumberArgs.map(visit(exprs[1]), grid);
    if (sigNode.t === 'err') return sigNode;
    significance = sigNode.v;
  }
  if (significance === 0) return { t: 'num', v: 0 };

  let mode = 0;
  if (exprs.length === 3) {
    const modeNode = NumberArgs.map(visit(exprs[2]), grid);
    if (modeNode.t === 'err') return modeNode;
    mode = modeNode.v;
  }

  significance = Math.abs(significance);
  if (num.v < 0 && mode !== 0) {
    // Round away from zero (more negative)
    return { t: 'num', v: -Math.ceil(Math.abs(num.v) / significance) * significance };
  }
  return { t: 'num', v: Math.ceil(num.v / significance) * significance };
}

/**
 * FLOOR.MATH(number, [significance], [mode]) — rounds down to nearest multiple.
 * If mode is non-zero and number is negative, rounds toward zero.
 */
export function floormathFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 3) return { t: 'err', v: '#N/A!' };

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;

  let significance = 1;
  if (exprs.length >= 2) {
    const sigNode = NumberArgs.map(visit(exprs[1]), grid);
    if (sigNode.t === 'err') return sigNode;
    significance = sigNode.v;
  }
  if (significance === 0) return { t: 'num', v: 0 };

  let mode = 0;
  if (exprs.length === 3) {
    const modeNode = NumberArgs.map(visit(exprs[2]), grid);
    if (modeNode.t === 'err') return modeNode;
    mode = modeNode.v;
  }

  significance = Math.abs(significance);
  if (num.v < 0 && mode !== 0) {
    // Round toward zero (less negative)
    return { t: 'num', v: -Math.floor(Math.abs(num.v) / significance) * significance };
  }
  return { t: 'num', v: Math.floor(num.v / significance) * significance };
}

/**
 * CEILING.PRECISE(number, [significance]) — always rounds up in magnitude.
 */
export function ceilingpreciseFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A!' };

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;

  let significance = 1;
  if (exprs.length === 2) {
    const sigNode = NumberArgs.map(visit(exprs[1]), grid);
    if (sigNode.t === 'err') return sigNode;
    significance = Math.abs(sigNode.v);
  }
  if (significance === 0) return { t: 'num', v: 0 };

  return { t: 'num', v: Math.ceil(num.v / significance) * significance };
}

/**
 * FLOOR.PRECISE(number, [significance]) — always rounds down in magnitude.
 */
export function floorpreciseFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A!' };

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;

  let significance = 1;
  if (exprs.length === 2) {
    const sigNode = NumberArgs.map(visit(exprs[1]), grid);
    if (sigNode.t === 'err') return sigNode;
    significance = Math.abs(sigNode.v);
  }
  if (significance === 0) return { t: 'num', v: 0 };

  return { t: 'num', v: Math.floor(num.v / significance) * significance };
}

/**
 * COVAR / COVARIANCE.P(data_y, data_x) — population covariance of two datasets.
 */
export function covarFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const result = extractPairedArrays(exprs[0], exprs[1], visit, grid);
  if ('t' in result) return result;
  const { xs, ys } = result;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  const cov = xs.reduce((a, x, i) => a + (x - meanX) * (ys[i] - meanY), 0) / n;
  return { t: 'num', v: cov };
}

/**
 * COVARIANCE.S(data_y, data_x) — sample covariance of two datasets.
 */
export function covarsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const result = extractPairedArrays(exprs[0], exprs[1], visit, grid);
  if ('t' in result) return result;
  const { xs, ys } = result;
  const n = xs.length;
  if (n < 2) return { t: 'err', v: '#N/A!' };
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  const cov = xs.reduce((a, x, i) => a + (x - meanX) * (ys[i] - meanY), 0) / (n - 1);
  return { t: 'num', v: cov };
}

/**
 * RSQ(known_ys, known_xs) — returns the R-squared value (coefficient of determination).
 */
export function rsqFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const result = extractPairedArrays(exprs[0], exprs[1], visit, grid);
  if ('t' in result) return result;
  const { xs, ys } = result;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  const ssXY = xs.reduce((a, x, i) => a + (x - meanX) * (ys[i] - meanY), 0);
  const ssXX = xs.reduce((a, x) => a + (x - meanX) * (x - meanX), 0);
  const ssYY = ys.reduce((a, y) => a + (y - meanY) * (y - meanY), 0);
  if (ssXX === 0 || ssYY === 0) return { t: 'err', v: '#DIV/0!' };
  const r = ssXY / Math.sqrt(ssXX * ssYY);
  return { t: 'num', v: r * r };
}

/**
 * STEYX(known_ys, known_xs) — returns the standard error of the predicted y-value
 * for each x in the regression.
 */
export function steyxFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const result = extractPairedArrays(exprs[0], exprs[1], visit, grid);
  if ('t' in result) return result;
  const { xs, ys } = result;
  const n = xs.length;
  if (n < 3) return { t: 'err', v: '#N/A!' };
  const { slope, intercept } = linearRegression(xs, ys);
  const sse = ys.reduce((a, y, i) => {
    const predicted = slope * xs[i] + intercept;
    return a + (y - predicted) * (y - predicted);
  }, 0);
  return { t: 'num', v: Math.sqrt(sse / (n - 2)) };
}

/**
 * Helper to collect numeric values from a range expression.
 */
function collectNumericValues(
  expr: ParseTree,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): number[] | EvalNode {
  const node = visit(expr);
  if (node.t === 'err') return node;
  const values: number[] = [];
  if (node.t === 'num') {
    values.push(node.v);
  } else if (node.t === 'ref' && grid) {
    for (const ref of toSrefs([node.v])) {
      const cellVal = grid.get(ref)?.v || '';
      if (cellVal !== '' && !isNaN(Number(cellVal))) {
        values.push(Number(cellVal));
      }
    }
  }
  return values;
}

/**
 * SUMX2MY2(array_x, array_y) — sum of x²-y² for paired arrays.
 * Note: extractPairedArrays(expr1, expr2) maps expr1→ys, expr2→xs.
 * So we pass array_x as expr2 and array_y as expr1 (swapped), or
 * just use ys as our x-array and xs as our y-array.
 */
export function sumx2my2Func(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const result = extractPairedArrays(exprs[0], exprs[1], visit, grid);
  if ('t' in result) return result;
  // ys = values from exprs[0] (array_x), xs = values from exprs[1] (array_y)
  const arrX = result.ys;
  const arrY = result.xs;
  let sum = 0;
  for (let i = 0; i < arrX.length; i++) {
    sum += arrX[i] * arrX[i] - arrY[i] * arrY[i];
  }
  return { t: 'num', v: sum };
}

/**
 * SUMX2PY2(array_x, array_y) — sum of x²+y² for paired arrays.
 */
export function sumx2py2Func(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const result = extractPairedArrays(exprs[0], exprs[1], visit, grid);
  if ('t' in result) return result;
  const arrX = result.ys;
  const arrY = result.xs;
  let sum = 0;
  for (let i = 0; i < arrX.length; i++) {
    sum += arrX[i] * arrX[i] + arrY[i] * arrY[i];
  }
  return { t: 'num', v: sum };
}

/**
 * SUMXMY2(array_x, array_y) — sum of (x-y)² for paired arrays.
 */
export function sumxmy2Func(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const result = extractPairedArrays(exprs[0], exprs[1], visit, grid);
  if ('t' in result) return result;
  const arrX = result.ys;
  const arrY = result.xs;
  let sum = 0;
  for (let i = 0; i < arrX.length; i++) {
    const d = arrX[i] - arrY[i];
    sum += d * d;
  }
  return { t: 'num', v: sum };
}

/**
 * PERCENTILE.EXC(data, k) — returns the k-th percentile using exclusive interpolation.
 * k must be in (0, 1) exclusive.
 */
export function percentileexcFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const vals = collectNumericValues(exprs[0], visit, grid);
  if (!Array.isArray(vals)) return vals;
  const kNode = NumberArgs.map(visit(exprs[1]), grid);
  if (kNode.t === 'err') return kNode;
  const k = kNode.v;
  if (k <= 0 || k >= 1 || vals.length === 0) return { t: 'err', v: '#VALUE!' };

  vals.sort((a, b) => a - b);
  const n = vals.length;
  const rank = k * (n + 1) - 1; // 0-indexed
  if (rank < 0 || rank > n - 1) return { t: 'err', v: '#VALUE!' };
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const fraction = rank - lower;
  if (lower === upper || upper >= n) return { t: 'num', v: vals[Math.min(lower, n - 1)] };
  return { t: 'num', v: vals[lower] + fraction * (vals[upper] - vals[lower]) };
}

/**
 * QUARTILE.EXC(data, quart) — returns the exclusive quartile.
 */
export function quartileexcFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const vals = collectNumericValues(exprs[0], visit, grid);
  if (!Array.isArray(vals)) return vals;
  const qNode = NumberArgs.map(visit(exprs[1]), grid);
  if (qNode.t === 'err') return qNode;
  const q = Math.trunc(qNode.v);
  if (q < 1 || q > 3 || vals.length === 0) return { t: 'err', v: '#VALUE!' };

  vals.sort((a, b) => a - b);
  const n = vals.length;
  const k = q / 4;
  const rank = k * (n + 1) - 1;
  if (rank < 0 || rank > n - 1) return { t: 'err', v: '#VALUE!' };
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const fraction = rank - lower;
  if (lower === upper) return { t: 'num', v: vals[lower] };
  return { t: 'num', v: vals[lower] + fraction * (vals[upper] - vals[lower]) };
}

/**
 * RANK.AVG(value, data, [order]) — returns average rank for ties.
 */
export function rankavgFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) return { t: 'err', v: '#N/A!' };

  const valueNode = NumberArgs.map(visit(exprs[0]), grid);
  if (valueNode.t === 'err') return valueNode;

  const vals = collectNumericValues(exprs[1], visit, grid);
  if (!Array.isArray(vals)) return vals;

  let order = 0;
  if (exprs.length === 3) {
    const orderNode = NumberArgs.map(visit(exprs[2]), grid);
    if (orderNode.t === 'err') return orderNode;
    order = Math.trunc(orderNode.v);
  }

  const target = valueNode.v;
  if (!vals.includes(target)) return { t: 'err', v: '#N/A!' };

  const count = vals.filter((v) => v === target).length;
  if (order === 0) {
    const higherCount = vals.filter((v) => v > target).length;
    return { t: 'num', v: higherCount + 1 + (count - 1) / 2 };
  } else {
    const lowerCount = vals.filter((v) => v < target).length;
    return { t: 'num', v: lowerCount + 1 + (count - 1) / 2 };
  }
}

/**
 * PERCENTRANK / PERCENTRANK.INC(data, x, [significance]) — returns percentage rank (inclusive).
 */
export function percentrankFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) return { t: 'err', v: '#N/A!' };

  const vals = collectNumericValues(exprs[0], visit, grid);
  if (!Array.isArray(vals)) return vals;
  if (vals.length === 0) return { t: 'err', v: '#N/A!' };

  const xNode = NumberArgs.map(visit(exprs[1]), grid);
  if (xNode.t === 'err') return xNode;
  const x = xNode.v;

  let sig = 3;
  if (exprs.length === 3) {
    const sigNode = NumberArgs.map(visit(exprs[2]), grid);
    if (sigNode.t === 'err') return sigNode;
    sig = Math.trunc(sigNode.v);
    if (sig < 1) return { t: 'err', v: '#VALUE!' };
  }

  vals.sort((a, b) => a - b);
  if (x < vals[0] || x > vals[vals.length - 1]) return { t: 'err', v: '#N/A!' };

  const n = vals.length;
  // Find position via interpolation
  let smaller = 0;
  for (const v of vals) {
    if (v < x) smaller++;
  }
  // Check if x is in array
  const idx = vals.indexOf(x);
  let rank: number;
  if (idx >= 0) {
    rank = smaller / (n - 1);
  } else {
    // Interpolate between adjacent values
    const lower = vals[smaller - 1];
    const upper = vals[smaller];
    rank = (smaller - 1 + (x - lower) / (upper - lower)) / (n - 1);
  }

  const factor = Math.pow(10, sig);
  return { t: 'num', v: Math.trunc(rank * factor) / factor };
}

/**
 * PERCENTRANK.EXC(data, x, [significance]) — returns percentage rank (exclusive).
 */
export function percentrankexcFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) return { t: 'err', v: '#N/A!' };

  const vals = collectNumericValues(exprs[0], visit, grid);
  if (!Array.isArray(vals)) return vals;
  if (vals.length === 0) return { t: 'err', v: '#N/A!' };

  const xNode = NumberArgs.map(visit(exprs[1]), grid);
  if (xNode.t === 'err') return xNode;
  const x = xNode.v;

  let sig = 3;
  if (exprs.length === 3) {
    const sigNode = NumberArgs.map(visit(exprs[2]), grid);
    if (sigNode.t === 'err') return sigNode;
    sig = Math.trunc(sigNode.v);
    if (sig < 1) return { t: 'err', v: '#VALUE!' };
  }

  vals.sort((a, b) => a - b);
  if (x < vals[0] || x > vals[vals.length - 1]) return { t: 'err', v: '#N/A!' };

  const n = vals.length;
  let smaller = 0;
  for (const v of vals) {
    if (v < x) smaller++;
  }
  const idx = vals.indexOf(x);
  let rank: number;
  if (idx >= 0) {
    rank = (smaller + 1) / (n + 1);
  } else {
    const lower = vals[smaller - 1];
    const upper = vals[smaller];
    rank = (smaller + (x - lower) / (upper - lower)) / (n + 1);
  }

  const factor = Math.pow(10, sig);
  return { t: 'num', v: Math.trunc(rank * factor) / factor };
}

/**
 * BETA.DIST(x, alpha, beta, cumulative, [A], [B]) — beta distribution.
 */
export function betadistFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 4 || exprs.length > 6) return { t: 'err', v: '#N/A!' };

  const xNode = NumberArgs.map(visit(exprs[0]), grid);
  if (xNode.t === 'err') return xNode;
  const alphaNode = NumberArgs.map(visit(exprs[1]), grid);
  if (alphaNode.t === 'err') return alphaNode;
  const betaNode = NumberArgs.map(visit(exprs[2]), grid);
  if (betaNode.t === 'err') return betaNode;
  const cumNode = BoolArgs.map(visit(exprs[3]), grid);
  if (cumNode.t === 'err') return cumNode;

  let A = 0, B = 1;
  if (exprs.length >= 5) {
    const aNode = NumberArgs.map(visit(exprs[4]), grid);
    if (aNode.t === 'err') return aNode;
    A = aNode.v;
  }
  if (exprs.length === 6) {
    const bNode = NumberArgs.map(visit(exprs[5]), grid);
    if (bNode.t === 'err') return bNode;
    B = bNode.v;
  }

  const a = alphaNode.v;
  const b = betaNode.v;
  if (a <= 0 || b <= 0 || A >= B) return { t: 'err', v: '#VALUE!' };

  const x = (xNode.v - A) / (B - A);
  if (x < 0 || x > 1) return { t: 'err', v: '#VALUE!' };

  if (cumNode.v) {
    return { t: 'num', v: regularizedBeta(x, a, b) };
  } else {
    // PDF: x^(a-1) * (1-x)^(b-1) / Beta(a,b)
    const lnBeta = gammaLnHelper(a) + gammaLnHelper(b) - gammaLnHelper(a + b);
    const pdf = Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lnBeta) / (B - A);
    return { t: 'num', v: pdf };
  }
}

/**
 * Helper: log-gamma using Lanczos approximation.
 */
function gammaLnHelper(z: number): number {
  return Math.log(gammaLanczos(z));
}

/**
 * BETA.INV(probability, alpha, beta, [A], [B]) — inverse of beta CDF.
 */
export function betainvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 5) return { t: 'err', v: '#N/A!' };

  const pNode = NumberArgs.map(visit(exprs[0]), grid);
  if (pNode.t === 'err') return pNode;
  const alphaNode = NumberArgs.map(visit(exprs[1]), grid);
  if (alphaNode.t === 'err') return alphaNode;
  const betaNode = NumberArgs.map(visit(exprs[2]), grid);
  if (betaNode.t === 'err') return betaNode;

  let A = 0, B = 1;
  if (exprs.length >= 4) {
    const aNode = NumberArgs.map(visit(exprs[3]), grid);
    if (aNode.t === 'err') return aNode;
    A = aNode.v;
  }
  if (exprs.length === 5) {
    const bNode = NumberArgs.map(visit(exprs[4]), grid);
    if (bNode.t === 'err') return bNode;
    B = bNode.v;
  }

  const p = pNode.v;
  const a = alphaNode.v;
  const b = betaNode.v;
  if (p < 0 || p > 1 || a <= 0 || b <= 0 || A >= B) return { t: 'err', v: '#VALUE!' };

  // Newton's method to find x where regularizedBeta(x, a, b) = p
  let x = 0.5;
  const lnBeta = gammaLnHelper(a) + gammaLnHelper(b) - gammaLnHelper(a + b);
  for (let i = 0; i < 200; i++) {
    const cdf = regularizedBeta(x, a, b);
    const diff = cdf - p;
    if (Math.abs(diff) < 1e-12) break;
    // PDF of beta distribution
    const pdf = Math.exp((a - 1) * Math.log(Math.max(x, 1e-300)) + (b - 1) * Math.log(Math.max(1 - x, 1e-300)) - lnBeta);
    if (pdf === 0) break;
    x = Math.max(1e-15, Math.min(1 - 1e-15, x - diff / pdf));
  }

  return { t: 'num', v: A + x * (B - A) };
}

/**
 * F.DIST(x, deg_freedom1, deg_freedom2, cumulative) — F distribution.
 */
export function fdistFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 4) return { t: 'err', v: '#N/A!' };

  const xNode = NumberArgs.map(visit(exprs[0]), grid);
  if (xNode.t === 'err') return xNode;
  const d1Node = NumberArgs.map(visit(exprs[1]), grid);
  if (d1Node.t === 'err') return d1Node;
  const d2Node = NumberArgs.map(visit(exprs[2]), grid);
  if (d2Node.t === 'err') return d2Node;
  const cumNode = BoolArgs.map(visit(exprs[3]), grid);
  if (cumNode.t === 'err') return cumNode;

  const x = xNode.v;
  const d1 = Math.trunc(d1Node.v);
  const d2 = Math.trunc(d2Node.v);
  if (x < 0 || d1 < 1 || d2 < 1) return { t: 'err', v: '#VALUE!' };

  if (cumNode.v) {
    // CDF using regularized incomplete beta
    const z = (d1 * x) / (d1 * x + d2);
    return { t: 'num', v: regularizedBeta(z, d1 / 2, d2 / 2) };
  } else {
    // PDF
    const lnNum = (d1 / 2) * Math.log(d1) + (d2 / 2) * Math.log(d2) +
      ((d1 / 2) - 1) * Math.log(x);
    const lnDen = ((d1 + d2) / 2) * Math.log(d1 * x + d2) +
      gammaLnHelper(d1 / 2) + gammaLnHelper(d2 / 2) - gammaLnHelper((d1 + d2) / 2);
    return { t: 'num', v: Math.exp(lnNum - lnDen) };
  }
}

/**
 * F.INV(probability, deg_freedom1, deg_freedom2) — inverse of F distribution CDF.
 */
export function finvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const pNode = NumberArgs.map(visit(exprs[0]), grid);
  if (pNode.t === 'err') return pNode;
  const d1Node = NumberArgs.map(visit(exprs[1]), grid);
  if (d1Node.t === 'err') return d1Node;
  const d2Node = NumberArgs.map(visit(exprs[2]), grid);
  if (d2Node.t === 'err') return d2Node;

  const p = pNode.v;
  const d1 = Math.trunc(d1Node.v);
  const d2 = Math.trunc(d2Node.v);
  if (p < 0 || p >= 1 || d1 < 1 || d2 < 1) return { t: 'err', v: '#VALUE!' };

  if (p === 0) return { t: 'num', v: 0 };

  // Newton's method
  let x = 1.0;
  for (let i = 0; i < 200; i++) {
    const z = (d1 * x) / (d1 * x + d2);
    const cdf = regularizedBeta(z, d1 / 2, d2 / 2);
    const diff = cdf - p;
    if (Math.abs(diff) < 1e-12) break;
    // PDF of F
    const lnNum = (d1 / 2) * Math.log(d1) + (d2 / 2) * Math.log(d2) +
      ((d1 / 2) - 1) * Math.log(Math.max(x, 1e-300));
    const lnDen = ((d1 + d2) / 2) * Math.log(d1 * x + d2) +
      gammaLnHelper(d1 / 2) + gammaLnHelper(d2 / 2) - gammaLnHelper((d1 + d2) / 2);
    const pdf = Math.exp(lnNum - lnDen);
    if (pdf === 0) break;
    x = Math.max(1e-15, x - diff / pdf);
  }

  return { t: 'num', v: x };
}

/**
 * GAMMA.DIST(x, alpha, beta, cumulative) — gamma distribution.
 */
export function gammadistFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 4) return { t: 'err', v: '#N/A!' };

  const xNode = NumberArgs.map(visit(exprs[0]), grid);
  if (xNode.t === 'err') return xNode;
  const alphaNode = NumberArgs.map(visit(exprs[1]), grid);
  if (alphaNode.t === 'err') return alphaNode;
  const betaNode = NumberArgs.map(visit(exprs[2]), grid);
  if (betaNode.t === 'err') return betaNode;
  const cumNode = BoolArgs.map(visit(exprs[3]), grid);
  if (cumNode.t === 'err') return cumNode;

  const x = xNode.v;
  const a = alphaNode.v;
  const b = betaNode.v;
  if (x < 0 || a <= 0 || b <= 0) return { t: 'err', v: '#VALUE!' };

  if (cumNode.v) {
    return { t: 'num', v: lowerIncompleteGamma(a, x / b) };
  }
  // PDF: x^(a-1) * exp(-x/b) / (b^a * Gamma(a))
  const pdf = Math.pow(x, a - 1) * Math.exp(-x / b) / (Math.pow(b, a) * gammaLanczos(a));
  return { t: 'num', v: pdf };
}

/**
 * GAMMA.INV(probability, alpha, beta) — inverse gamma distribution CDF.
 */
export function gammainvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const pNode = NumberArgs.map(visit(exprs[0]), grid);
  if (pNode.t === 'err') return pNode;
  const alphaNode = NumberArgs.map(visit(exprs[1]), grid);
  if (alphaNode.t === 'err') return alphaNode;
  const betaNode = NumberArgs.map(visit(exprs[2]), grid);
  if (betaNode.t === 'err') return betaNode;

  const p = pNode.v;
  const a = alphaNode.v;
  const b = betaNode.v;
  if (p < 0 || p > 1 || a <= 0 || b <= 0) return { t: 'err', v: '#VALUE!' };
  if (p === 0) return { t: 'num', v: 0 };
  if (p === 1) return { t: 'err', v: '#VALUE!' };

  // Newton's method: find x where lowerIncompleteGamma(a, x/b) = p
  let x = a * b; // initial guess at the mean
  for (let i = 0; i < 200; i++) {
    const cdf = lowerIncompleteGamma(a, x / b);
    const diff = cdf - p;
    if (Math.abs(diff) < 1e-12) break;
    const pdf = Math.pow(x, a - 1) * Math.exp(-x / b) / (Math.pow(b, a) * gammaLanczos(a));
    if (pdf === 0) break;
    x = Math.max(1e-15, x - diff / pdf);
  }
  return { t: 'num', v: x };
}

/**
 * CHISQ.DIST.RT(x, degrees_freedom) — right-tailed chi-squared distribution.
 */
export function chisqdistrtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const df = NumberArgs.map(visit(exprs[1]), grid);
  if (df.t === 'err') return df;
  if (x.v < 0 || df.v < 1) return { t: 'err', v: '#VALUE!' };

  const k = Math.trunc(df.v);
  return { t: 'num', v: 1 - lowerIncompleteGamma(k / 2, x.v / 2) };
}

/**
 * CHISQ.INV.RT(probability, degrees_freedom) — inverse right-tailed chi-squared.
 */
export function chisqinvrtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const p = NumberArgs.map(visit(exprs[0]), grid);
  if (p.t === 'err') return p;
  const df = NumberArgs.map(visit(exprs[1]), grid);
  if (df.t === 'err') return df;
  if (p.v <= 0 || p.v >= 1 || df.v < 1) return { t: 'err', v: '#VALUE!' };

  const k = Math.trunc(df.v);
  // Right-tail: find x where 1 - lowerIncompleteGamma(k/2, x/2) = p
  // Same as lowerIncompleteGamma(k/2, x/2) = 1 - p
  const target = 1 - p.v;
  let x = k * Math.pow(1 - 2 / (9 * k) + normInv(target) * Math.sqrt(2 / (9 * k)), 3);
  if (x <= 0) x = 0.01;

  for (let i = 0; i < 100; i++) {
    const cdf = lowerIncompleteGamma(k / 2, x / 2);
    const halfK = k / 2;
    const pdf = Math.pow(x, halfK - 1) * Math.exp(-x / 2) / (Math.pow(2, halfK) * gammaLanczos(halfK));
    if (Math.abs(pdf) < 1e-15) break;
    const newX = x - (cdf - target) / pdf;
    if (Math.abs(newX - x) < 1e-10) { x = newX; break; }
    x = Math.max(newX, 1e-10);
  }
  return { t: 'num', v: x };
}

/**
 * T.DIST.RT(x, degrees_freedom) — right-tailed Student's t-distribution.
 */
export function tdistrtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const df = NumberArgs.map(visit(exprs[1]), grid);
  if (df.t === 'err') return df;
  if (df.v < 1) return { t: 'err', v: '#VALUE!' };

  const v = Math.trunc(df.v);
  const t2 = x.v * x.v;
  const xi = v / (v + t2);
  const ibeta = regularizedBeta(xi, v / 2, 0.5);
  const leftCdf = x.v >= 0 ? 1 - 0.5 * ibeta : 0.5 * ibeta;
  return { t: 'num', v: 1 - leftCdf };
}

/**
 * T.DIST.2T(x, degrees_freedom) — two-tailed Student's t-distribution.
 */
export function tdist2tFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const df = NumberArgs.map(visit(exprs[1]), grid);
  if (df.t === 'err') return df;
  if (x.v < 0 || df.v < 1) return { t: 'err', v: '#VALUE!' };

  const v = Math.trunc(df.v);
  const t2 = x.v * x.v;
  const xi = v / (v + t2);
  const ibeta = regularizedBeta(xi, v / 2, 0.5);
  return { t: 'num', v: ibeta };
}

/**
 * T.INV.2T(probability, degrees_freedom) — inverse two-tailed t-distribution.
 */
export function tinv2tFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const p = NumberArgs.map(visit(exprs[0]), grid);
  if (p.t === 'err') return p;
  const df = NumberArgs.map(visit(exprs[1]), grid);
  if (df.t === 'err') return df;
  if (p.v <= 0 || p.v > 1 || df.v < 1) return { t: 'err', v: '#VALUE!' };

  const v = Math.trunc(df.v);
  // Two-tailed: P(|T| > x) = p, so P(T > x) = p/2, hence x = T.INV(1 - p/2)
  return { t: 'num', v: computeTInv(1 - p.v / 2, v) };
}

/**
 * F.DIST.RT(x, deg_freedom1, deg_freedom2) — right-tailed F distribution.
 */
export function fdistrtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const xNode = NumberArgs.map(visit(exprs[0]), grid);
  if (xNode.t === 'err') return xNode;
  const d1Node = NumberArgs.map(visit(exprs[1]), grid);
  if (d1Node.t === 'err') return d1Node;
  const d2Node = NumberArgs.map(visit(exprs[2]), grid);
  if (d2Node.t === 'err') return d2Node;

  const x = xNode.v;
  const d1 = Math.trunc(d1Node.v);
  const d2 = Math.trunc(d2Node.v);
  if (x < 0 || d1 < 1 || d2 < 1) return { t: 'err', v: '#VALUE!' };

  const z = (d1 * x) / (d1 * x + d2);
  return { t: 'num', v: 1 - regularizedBeta(z, d1 / 2, d2 / 2) };
}

/**
 * F.INV.RT(probability, deg_freedom1, deg_freedom2) — inverse right-tailed F.
 */
export function finvrtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const pNode = NumberArgs.map(visit(exprs[0]), grid);
  if (pNode.t === 'err') return pNode;
  const d1Node = NumberArgs.map(visit(exprs[1]), grid);
  if (d1Node.t === 'err') return d1Node;
  const d2Node = NumberArgs.map(visit(exprs[2]), grid);
  if (d2Node.t === 'err') return d2Node;

  const p = pNode.v;
  const d1 = Math.trunc(d1Node.v);
  const d2 = Math.trunc(d2Node.v);
  if (p <= 0 || p >= 1 || d1 < 1 || d2 < 1) return { t: 'err', v: '#VALUE!' };

  // Right-tail: find x where 1 - F.DIST.CDF(x) = p → F.DIST.CDF(x) = 1 - p
  const target = 1 - p;
  let x = 1.0;
  for (let i = 0; i < 200; i++) {
    const z = (d1 * x) / (d1 * x + d2);
    const cdf = regularizedBeta(z, d1 / 2, d2 / 2);
    const diff = cdf - target;
    if (Math.abs(diff) < 1e-12) break;
    const lnNum = (d1 / 2) * Math.log(d1) + (d2 / 2) * Math.log(d2) +
      ((d1 / 2) - 1) * Math.log(Math.max(x, 1e-300));
    const lnDen = ((d1 + d2) / 2) * Math.log(d1 * x + d2) +
      gammaLnHelper(d1 / 2) + gammaLnHelper(d2 / 2) - gammaLnHelper((d1 + d2) / 2);
    const pdf = Math.exp(lnNum - lnDen);
    if (pdf === 0) break;
    x = Math.max(1e-15, x - diff / pdf);
  }
  return { t: 'num', v: x };
}

/**
 * BINOM.INV(trials, probability_s, alpha) — returns the smallest value for which
 * the cumulative binomial distribution is >= alpha.
 */
export function biominvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const nNode = NumberArgs.map(visit(exprs[0]), grid);
  if (nNode.t === 'err') return nNode;
  const pNode = NumberArgs.map(visit(exprs[1]), grid);
  if (pNode.t === 'err') return pNode;
  const aNode = NumberArgs.map(visit(exprs[2]), grid);
  if (aNode.t === 'err') return aNode;

  const n = Math.trunc(nNode.v);
  const ps = pNode.v;
  const alpha = aNode.v;
  if (n < 0 || ps < 0 || ps > 1 || alpha < 0 || alpha > 1) return { t: 'err', v: '#VALUE!' };

  // Iterate through cumulative probabilities
  let cumProb = 0;
  for (let k = 0; k <= n; k++) {
    // Binomial PMF: C(n,k) * p^k * (1-p)^(n-k)
    const lnPmf = gammaLnHelper(n + 1) - gammaLnHelper(k + 1) - gammaLnHelper(n - k + 1) +
      k * Math.log(Math.max(ps, 1e-300)) + (n - k) * Math.log(Math.max(1 - ps, 1e-300));
    cumProb += Math.exp(lnPmf);
    if (cumProb >= alpha) return { t: 'num', v: k };
  }
  return { t: 'num', v: n };
}

/**
 * TEXTBEFORE(text, delimiter, [instance_num]) — text before the nth delimiter.
 */
export function textbeforeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) return { t: 'err', v: '#N/A!' };

  const textNode = toStr(visit(exprs[0]), grid);
  if (textNode.t === 'err') return textNode;
  const delimNode = toStr(visit(exprs[1]), grid);
  if (delimNode.t === 'err') return delimNode;

  let instance = 1;
  if (exprs.length === 3) {
    const instNode = NumberArgs.map(visit(exprs[2]), grid);
    if (instNode.t === 'err') return instNode;
    instance = Math.trunc(instNode.v);
  }

  const text = textNode.v;
  const delim = delimNode.v;
  if (delim === '') return { t: 'err', v: '#VALUE!' };

  if (instance > 0) {
    let pos = -1;
    for (let i = 0; i < instance; i++) {
      pos = text.indexOf(delim, pos + 1);
      if (pos === -1) return { t: 'err', v: '#N/A!' };
    }
    return { t: 'str', v: text.substring(0, pos) };
  } else if (instance < 0) {
    let pos = text.length;
    for (let i = 0; i < -instance; i++) {
      pos = text.lastIndexOf(delim, pos - 1);
      if (pos === -1) return { t: 'err', v: '#N/A!' };
    }
    return { t: 'str', v: text.substring(0, pos) };
  }
  return { t: 'err', v: '#VALUE!' };
}

/**
 * TEXTAFTER(text, delimiter, [instance_num]) — text after the nth delimiter.
 */
export function textafterFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) return { t: 'err', v: '#N/A!' };

  const textNode = toStr(visit(exprs[0]), grid);
  if (textNode.t === 'err') return textNode;
  const delimNode = toStr(visit(exprs[1]), grid);
  if (delimNode.t === 'err') return delimNode;

  let instance = 1;
  if (exprs.length === 3) {
    const instNode = NumberArgs.map(visit(exprs[2]), grid);
    if (instNode.t === 'err') return instNode;
    instance = Math.trunc(instNode.v);
  }

  const text = textNode.v;
  const delim = delimNode.v;
  if (delim === '') return { t: 'err', v: '#VALUE!' };

  if (instance > 0) {
    let pos = -1;
    for (let i = 0; i < instance; i++) {
      pos = text.indexOf(delim, pos + 1);
      if (pos === -1) return { t: 'err', v: '#N/A!' };
    }
    return { t: 'str', v: text.substring(pos + delim.length) };
  } else if (instance < 0) {
    let pos = text.length;
    for (let i = 0; i < -instance; i++) {
      pos = text.lastIndexOf(delim, pos - 1);
      if (pos === -1) return { t: 'err', v: '#N/A!' };
    }
    return { t: 'str', v: text.substring(pos + delim.length) };
  }
  return { t: 'err', v: '#VALUE!' };
}

/**
 * VALUETOTEXT(value, [format]) — converts a value to text.
 */
export function valuetotextFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A!' };

  const node = visit(exprs[0]);
  if (node.t === 'err') return node;
  const s = toStr(node, grid);
  if (s.t === 'err') return s;

  let format = 0;
  if (exprs.length === 2) {
    const fmtNode = NumberArgs.map(visit(exprs[1]), grid);
    if (fmtNode.t === 'err') return fmtNode;
    format = Math.trunc(fmtNode.v);
  }

  if (format === 1 && node.t === 'str') {
    return { t: 'str', v: '"' + s.v + '"' };
  }
  return { t: 'str', v: s.v };
}

/**
 * SEQUENCE(rows, [columns], [start], [step]) — returns start value for single cell.
 */
export function sequenceFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 4) return { t: 'err', v: '#N/A!' };

  const rowsNode = NumberArgs.map(visit(exprs[0]), grid);
  if (rowsNode.t === 'err') return rowsNode;
  if (rowsNode.v < 1) return { t: 'err', v: '#VALUE!' };

  let start = 1;
  if (exprs.length >= 3) {
    const startNode = NumberArgs.map(visit(exprs[2]), grid);
    if (startNode.t === 'err') return startNode;
    start = startNode.v;
  }

  // Single-cell: return the start value
  return { t: 'num', v: start };
}

/**
 * RANDARRAY([rows], [columns], [min], [max], [whole_number]) — returns random for single cell.
 */
export function randarrayFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  const exprs = args ? args.expr() : [];
  if (exprs.length > 5) return { t: 'err', v: '#N/A!' };

  let min = 0, max = 1, whole = false;
  if (exprs.length >= 3) {
    const minNode = NumberArgs.map(visit(exprs[2]), grid);
    if (minNode.t === 'err') return minNode;
    min = minNode.v;
  }
  if (exprs.length >= 4) {
    const maxNode = NumberArgs.map(visit(exprs[3]), grid);
    if (maxNode.t === 'err') return maxNode;
    max = maxNode.v;
  }
  if (exprs.length >= 5) {
    const wholeNode = BoolArgs.map(visit(exprs[4]), grid);
    if (wholeNode.t === 'err') return wholeNode;
    whole = wholeNode.v;
  }

  if (min > max) return { t: 'err', v: '#VALUE!' };

  const val = min + Math.random() * (max - min);
  return { t: 'num', v: whole ? Math.floor(val) : val };
}

/**
 * SORT(range, [sort_index], [sort_order]) — for single cell returns first sorted value.
 */
export function sortFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 3) return { t: 'err', v: '#N/A!' };

  const vals = collectNumericValues(exprs[0], visit, grid);
  if (!Array.isArray(vals)) return vals;
  if (vals.length === 0) return { t: 'err', v: '#VALUE!' };

  let order = 1;
  if (exprs.length >= 3) {
    const orderNode = NumberArgs.map(visit(exprs[2]), grid);
    if (orderNode.t === 'err') return orderNode;
    order = orderNode.v;
  }

  vals.sort((a, b) => order >= 0 ? a - b : b - a);
  return { t: 'num', v: vals[0] };
}

/**
 * Helper: get the first cell value from a ref node.
 */
function firstCellValue(node: EvalNode, grid: Grid): EvalNode {
  if (node.t !== 'ref') return node;
  const firstRef = toSrefs([node.v]).next().value;
  if (!firstRef) return { t: 'str', v: '' };
  const cell = grid.get(firstRef);
  const val = cell?.v || '';
  if (val === '') return { t: 'str', v: '' };
  if (!isNaN(Number(val))) return { t: 'num', v: Number(val) };
  return { t: 'str', v: val };
}

/**
 * UNIQUE(range) — for single cell returns the first unique value.
 */
export function uniqueFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };

  const node = visit(exprs[0]);
  if (node.t === 'err') return node;
  if (node.t !== 'ref' || !grid) return node;
  return firstCellValue(node, grid);
}

/**
 * FLATTEN(range) — for single cell returns the first value.
 */
export function flattenFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };

  const node = visit(exprs[0]);
  if (node.t === 'err') return node;
  if (node.t !== 'ref' || !grid) return node;
  return firstCellValue(node, grid);
}

/**
 * TRANSPOSE(range) — for single cell returns the value itself.
 */
export function transposeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };

  const node = visit(exprs[0]);
  if (node.t === 'err') return node;
  if (node.t !== 'ref' || !grid) return node;
  return firstCellValue(node, grid);
}

/**
 * NORM.S.DIST(z, cumulative) — standard normal distribution.
 */
export function normsdistFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };

  const z = NumberArgs.map(visit(exprs[0]), grid);
  if (z.t === 'err') return z;
  const cumNode = BoolArgs.map(visit(exprs[1]), grid);
  if (cumNode.t === 'err') return cumNode;

  if (cumNode.v) {
    return { t: 'num', v: normCdf(z.v) };
  }
  return { t: 'num', v: normPdf(z.v) };
}

/**
 * NORM.S.INV(probability) — inverse standard normal distribution.
 */
export function normsinvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };

  const p = NumberArgs.map(visit(exprs[0]), grid);
  if (p.t === 'err') return p;
  if (p.v <= 0 || p.v >= 1) return { t: 'err', v: '#VALUE!' };

  return { t: 'num', v: normInv(p.v) };
}

/**
 * SUBTOTAL(function_num, ref1, [ref2], ...) — applies an aggregate function.
 */
export function subtotalFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 2) return { t: 'err', v: '#N/A!' };

  const fnNode = NumberArgs.map(visit(exprs[0]), grid);
  if (fnNode.t === 'err') return fnNode;
  const fn = Math.trunc(fnNode.v);

  const values: number[] = [];
  for (let i = 1; i < exprs.length; i++) {
    const node = visit(exprs[i]);
    if (node.t === 'err') return node;
    if (node.t === 'num') {
      values.push(node.v);
    } else if (node.t === 'ref' && grid) {
      for (const ref of toSrefs([node.v])) {
        const cellVal = grid.get(ref)?.v || '';
        if (cellVal !== '' && !isNaN(Number(cellVal))) {
          values.push(Number(cellVal));
        }
      }
    }
  }

  const fnNum = fn > 100 ? fn - 100 : fn;
  if (values.length === 0 && fnNum !== 2 && fnNum !== 3) return { t: 'num', v: 0 };

  switch (fnNum) {
    case 1: // AVERAGE
      return { t: 'num', v: values.reduce((a, b) => a + b, 0) / values.length };
    case 2: // COUNT
      return { t: 'num', v: values.length };
    case 3: // COUNTA
      return { t: 'num', v: values.length };
    case 4: // MAX
      return { t: 'num', v: Math.max(...values) };
    case 5: // MIN
      return { t: 'num', v: Math.min(...values) };
    case 6: // PRODUCT
      return { t: 'num', v: values.reduce((a, b) => a * b, 1) };
    case 7: { // STDEV
      const n = values.length;
      if (n < 2) return { t: 'err', v: '#DIV/0!' };
      const mean = values.reduce((a, b) => a + b, 0) / n;
      const variance = values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1);
      return { t: 'num', v: Math.sqrt(variance) };
    }
    case 8: { // STDEVP
      const n = values.length;
      if (n === 0) return { t: 'err', v: '#DIV/0!' };
      const mean = values.reduce((a, b) => a + b, 0) / n;
      const variance = values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / n;
      return { t: 'num', v: Math.sqrt(variance) };
    }
    case 9: // SUM
      return { t: 'num', v: values.reduce((a, b) => a + b, 0) };
    case 10: { // VAR
      const n = values.length;
      if (n < 2) return { t: 'err', v: '#DIV/0!' };
      const mean = values.reduce((a, b) => a + b, 0) / n;
      return { t: 'num', v: values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1) };
    }
    case 11: { // VARP
      const n = values.length;
      if (n === 0) return { t: 'err', v: '#DIV/0!' };
      const mean = values.reduce((a, b) => a + b, 0) / n;
      return { t: 'num', v: values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / n };
    }
    default:
      return { t: 'err', v: '#VALUE!' };
  }
}

/**
 * VARA(value1, [value2], ...) — sample variance treating text as 0, booleans as 0/1.
 */
export function varaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length === 0) return { t: 'err', v: '#N/A!' };

  const values: number[] = [];
  for (const expr of exprs) {
    const node = visit(expr);
    if (node.t === 'err') return node;
    if (node.t === 'num') { values.push(node.v); continue; }
    if (node.t === 'bool') { values.push(node.v ? 1 : 0); continue; }
    if (node.t === 'str') { values.push(0); continue; }
    if (node.t === 'ref' && grid) {
      for (const ref of toSrefs([node.v])) {
        const cv = grid.get(ref)?.v || '';
        if (cv === '') continue;
        if (cv === 'true') { values.push(1); continue; }
        if (cv === 'false') { values.push(0); continue; }
        if (!isNaN(Number(cv))) { values.push(Number(cv)); continue; }
        values.push(0);
      }
    }
  }

  const n = values.length;
  if (n < 2) return { t: 'err', v: '#DIV/0!' };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  return { t: 'num', v: values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1) };
}

/**
 * VARPA(value1, [value2], ...) — population variance treating text as 0, booleans as 0/1.
 */
export function varpaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length === 0) return { t: 'err', v: '#N/A!' };

  const values: number[] = [];
  for (const expr of exprs) {
    const node = visit(expr);
    if (node.t === 'err') return node;
    if (node.t === 'num') { values.push(node.v); continue; }
    if (node.t === 'bool') { values.push(node.v ? 1 : 0); continue; }
    if (node.t === 'str') { values.push(0); continue; }
    if (node.t === 'ref' && grid) {
      for (const ref of toSrefs([node.v])) {
        const cv = grid.get(ref)?.v || '';
        if (cv === '') continue;
        if (cv === 'true') { values.push(1); continue; }
        if (cv === 'false') { values.push(0); continue; }
        if (!isNaN(Number(cv))) { values.push(Number(cv)); continue; }
        values.push(0);
      }
    }
  }

  const n = values.length;
  if (n === 0) return { t: 'err', v: '#DIV/0!' };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  return { t: 'num', v: values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / n };
}

/**
 * SKEW(value1, [value2], ...) — returns the skewness of a dataset.
 */
export function skewFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length === 0) return { t: 'err', v: '#N/A!' };

  const values: number[] = [];
  for (const expr of exprs) {
    const node = visit(expr);
    if (node.t === 'err') return node;
    if (node.t === 'num') { values.push(node.v); continue; }
    if (node.t === 'ref' && grid) {
      for (const ref of toSrefs([node.v])) {
        const cv = grid.get(ref)?.v || '';
        if (cv !== '' && !isNaN(Number(cv))) values.push(Number(cv));
      }
    }
  }

  const n = values.length;
  if (n < 3) return { t: 'err', v: '#DIV/0!' };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const s = Math.sqrt(values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1));
  if (s === 0) return { t: 'err', v: '#DIV/0!' };
  const m3 = values.reduce((a, v) => a + Math.pow((v - mean) / s, 3), 0);
  return { t: 'num', v: (n / ((n - 1) * (n - 2))) * m3 };
}

/**
 * KURT(value1, [value2], ...) — returns the excess kurtosis of a dataset.
 */
export function kurtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length === 0) return { t: 'err', v: '#N/A!' };

  const values: number[] = [];
  for (const expr of exprs) {
    const node = visit(expr);
    if (node.t === 'err') return node;
    if (node.t === 'num') { values.push(node.v); continue; }
    if (node.t === 'ref' && grid) {
      for (const ref of toSrefs([node.v])) {
        const cv = grid.get(ref)?.v || '';
        if (cv !== '' && !isNaN(Number(cv))) values.push(Number(cv));
      }
    }
  }

  const n = values.length;
  if (n < 4) return { t: 'err', v: '#DIV/0!' };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const s = Math.sqrt(values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1));
  if (s === 0) return { t: 'err', v: '#DIV/0!' };
  const m4 = values.reduce((a, v) => a + Math.pow((v - mean) / s, 4), 0);
  const k = (n * (n + 1) * m4) / ((n - 1) * (n - 2) * (n - 3)) - (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
  return { t: 'num', v: k };
}

/**
 * ISREF(value) — returns TRUE if the value is a reference.
 */
export function isrefFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };

  const node = visit(exprs[0]);
  return { t: 'bool', v: node.t === 'ref' };
}

/**
 * SHEET([value]) — returns 1 (single sheet).
 */
export function sheetFunc(
  ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  return { t: 'num', v: 1 };
}

/**
 * SHEETS([reference]) — returns 1 (single sheet).
 */
export function sheetsFunc(
  ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  return { t: 'num', v: 1 };
}

/**
 * MDETERM(square_matrix) — returns the determinant of a square matrix.
 */
export function mdetermFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };

  const node = visit(exprs[0]);
  if (node.t === 'err') return node;
  if (node.t === 'num') return node; // 1x1 matrix
  if (node.t !== 'ref' || !grid) return { t: 'err', v: '#VALUE!' };

  // Parse range to get dimensions
  const ref = node.v;
  if (!isSrng(ref)) {
    // Single cell = 1x1 matrix
    const cell = grid.get(ref);
    const v = cell?.v || '';
    if (v === '' || isNaN(Number(v))) return { t: 'err', v: '#VALUE!' };
    return { t: 'num', v: Number(v) };
  }

  const range = parseRange(ref);
  const rows = range[1].r - range[0].r + 1;
  const cols = range[1].c - range[0].c + 1;
  if (rows !== cols) return { t: 'err', v: '#VALUE!' };

  // Build matrix
  const matrix: number[][] = [];
  for (let r = range[0].r; r <= range[1].r; r++) {
    const row: number[] = [];
    for (let c = range[0].c; c <= range[1].c; c++) {
      const cellRef = toSref({ r, c });
      const cell = grid.get(cellRef);
      const v = cell?.v || '';
      if (v === '' || isNaN(Number(v))) return { t: 'err', v: '#VALUE!' };
      row.push(Number(v));
    }
    matrix.push(row);
  }

  // LU decomposition for determinant
  function det(m: number[][]): number {
    const n = m.length;
    if (n === 1) return m[0][0];
    if (n === 2) return m[0][0] * m[1][1] - m[0][1] * m[1][0];
    let result = 0;
    for (let j = 0; j < n; j++) {
      const sub: number[][] = [];
      for (let i = 1; i < n; i++) {
        sub.push([...m[i].slice(0, j), ...m[i].slice(j + 1)]);
      }
      result += (j % 2 === 0 ? 1 : -1) * m[0][j] * det(sub);
    }
    return result;
  }

  return { t: 'num', v: det(matrix) };
}

/**
 * PROB(x_range, prob_range, lower_limit, [upper_limit]) — probability of values between limits.
 */
export function probFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 4) return { t: 'err', v: '#N/A!' };

  const result = extractPairedArrays(exprs[0], exprs[1], visit, grid);
  if ('t' in result) return result;
  // ys = values from exprs[0] (x_range), xs = values from exprs[1] (prob_range)
  const xValues = result.ys;
  const probs = result.xs;

  const lowerNode = NumberArgs.map(visit(exprs[2]), grid);
  if (lowerNode.t === 'err') return lowerNode;
  const lower = lowerNode.v;

  let upper = lower;
  if (exprs.length === 4) {
    const upperNode = NumberArgs.map(visit(exprs[3]), grid);
    if (upperNode.t === 'err') return upperNode;
    upper = upperNode.v;
  }

  // Validate probabilities sum to <= 1
  const probSum = probs.reduce((a, b) => a + b, 0);
  if (probSum > 1.0001 || probs.some(p => p < 0)) return { t: 'err', v: '#VALUE!' };

  let total = 0;
  for (let i = 0; i < xValues.length; i++) {
    if (xValues[i] >= lower && xValues[i] <= upper) {
      total += probs[i];
    }
  }
  return { t: 'num', v: total };
}

/**
 * CONVERT(number, from_unit, to_unit) — converts between measurement units.
 * Supports a basic set of common conversions.
 */
export function convertFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A!' };

  const numNode = NumberArgs.map(visit(exprs[0]), grid);
  if (numNode.t === 'err') return numNode;
  const fromNode = toStr(visit(exprs[1]), grid);
  if (fromNode.t === 'err') return fromNode;
  const toNode = toStr(visit(exprs[2]), grid);
  if (toNode.t === 'err') return toNode;

  const from = fromNode.v;
  const to = toNode.v;
  const val = numNode.v;

  // Unit conversion tables (to SI base unit)
  type UnitEntry = { category: string; factor: number; offset?: number };
  const units: Record<string, UnitEntry> = {
    // Length (base: meter)
    m: { category: 'length', factor: 1 },
    km: { category: 'length', factor: 1000 },
    cm: { category: 'length', factor: 0.01 },
    mm: { category: 'length', factor: 0.001 },
    in: { category: 'length', factor: 0.0254 },
    ft: { category: 'length', factor: 0.3048 },
    yd: { category: 'length', factor: 0.9144 },
    mi: { category: 'length', factor: 1609.344 },
    Nmi: { category: 'length', factor: 1852 },
    um: { category: 'length', factor: 1e-6 },
    // Mass (base: kilogram)
    kg: { category: 'mass', factor: 1 },
    g: { category: 'mass', factor: 0.001 },
    mg: { category: 'mass', factor: 1e-6 },
    lbm: { category: 'mass', factor: 0.45359237 },
    ozm: { category: 'mass', factor: 0.028349523125 },
    stone: { category: 'mass', factor: 6.35029318 },
    ton: { category: 'mass', factor: 907.18474 },
    // Temperature (special handling)
    C: { category: 'temperature', factor: 1, offset: 0 },
    F: { category: 'temperature', factor: 5 / 9, offset: -32 },
    K: { category: 'temperature', factor: 1, offset: -273.15 },
    // Time (base: second)
    sec: { category: 'time', factor: 1 },
    s: { category: 'time', factor: 1 },
    min: { category: 'time', factor: 60 },
    hr: { category: 'time', factor: 3600 },
    day: { category: 'time', factor: 86400 },
    yr: { category: 'time', factor: 31557600 },
    // Volume (base: liter)
    l: { category: 'volume', factor: 1 },
    lt: { category: 'volume', factor: 1 },
    ml: { category: 'volume', factor: 0.001 },
    gal: { category: 'volume', factor: 3.785411784 },
    qt: { category: 'volume', factor: 0.946352946 },
    pt: { category: 'volume', factor: 0.473176473 },
    cup: { category: 'volume', factor: 0.2365882365 },
    tsp: { category: 'volume', factor: 0.00492892159375 },
    tbs: { category: 'volume', factor: 0.01478676478125 },
    // Speed (base: m/s)
    'm/s': { category: 'speed', factor: 1 },
    'm/h': { category: 'speed', factor: 1 / 3600 },
    mph: { category: 'speed', factor: 0.44704 },
    kn: { category: 'speed', factor: 0.514444 },
    // Area (base: m²)
    m2: { category: 'area', factor: 1 },
    ha: { category: 'area', factor: 10000 },
    acre: { category: 'area', factor: 4046.8564224 },
    // Energy (base: joule)
    J: { category: 'energy', factor: 1 },
    cal: { category: 'energy', factor: 4.1868 },
    BTU: { category: 'energy', factor: 1055.05585262 },
    kWh: { category: 'energy', factor: 3600000 },
    eV: { category: 'energy', factor: 1.602176634e-19 },
  };

  const fromUnit = units[from];
  const toUnit = units[to];
  if (!fromUnit || !toUnit) return { t: 'err', v: '#N/A!' };
  if (fromUnit.category !== toUnit.category) return { t: 'err', v: '#N/A!' };

  if (fromUnit.category === 'temperature') {
    // Convert to Celsius first, then to target
    let celsius: number;
    if (from === 'C') celsius = val;
    else if (from === 'F') celsius = (val - 32) * 5 / 9;
    else celsius = val - 273.15; // K

    let result: number;
    if (to === 'C') result = celsius;
    else if (to === 'F') result = celsius * 9 / 5 + 32;
    else result = celsius + 273.15; // K
    return { t: 'num', v: result };
  }

  // Standard conversion through base unit
  return { t: 'num', v: val * fromUnit.factor / toUnit.factor };
}
