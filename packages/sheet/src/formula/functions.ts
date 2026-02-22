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
