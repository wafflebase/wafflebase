import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { EvalNode } from './formula';
import { NumberArgs, BoolArgs } from './arguments';
import { Grid } from '../model/core/types';
import {
  isSrng,
  toSrefs,
} from '../model/core/coordinates';
import {
  FormulaError,
  ParsedCriterion,
  isFormulaError,
  getRefsFromExpression,
  toNumberOrZero,
  parseCriterion,
  matchesCriterion,
} from './functions-helpers';

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
    } else if (node.t === 'arr') {
      for (const row of node.v) {
        for (const cell of row) {
          if (cell.t === 'num' || cell.t === 'bool') {
            count++;
          }
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
 * MODE.MULT(number1, [number2], ...) — returns the smallest mode.
 * (Same as MODE for single-cell output.)
 */
export function modemultFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1) return { t: 'err', v: '#N/A!' };
  const nums: number[] = [];
  for (const expr of exprs) {
    const result = collectNumericValues(expr, visit, grid);
    if (!Array.isArray(result)) return result;
    nums.push(...result);
  }
  if (nums.length === 0) return { t: 'err', v: '#VALUE!' };
  const freq = new Map<number, number>();
  for (const n of nums) freq.set(n, (freq.get(n) ?? 0) + 1);
  let maxFreq = 0;
  for (const f of freq.values()) if (f > maxFreq) maxFreq = f;
  if (maxFreq <= 1) return { t: 'err', v: '#N/A!' };
  // Return smallest mode
  const modes = Array.from(freq.entries())
    .filter(([, f]) => f === maxFreq)
    .map(([n]) => n)
    .sort((a, b) => a - b);
  return { t: 'num', v: modes[0] };
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
  const p = prob.v;
  if (k < 0 || n < 0 || k > n || p < 0 || p > 1) return { t: 'err', v: '#VALUE!' };

  const cumNode = visit(exprs[3]);
  const cum = cumNode.t === 'bool' ? cumNode.v : cumNode.t === 'num' ? cumNode.v !== 0 : true;

  // Binomial coefficient using log-gamma for numerical stability
  function binomPmf(x: number): number {
    const logCoeff = Math.log(gammaLanczos(n + 1)) - Math.log(gammaLanczos(x + 1)) - Math.log(gammaLanczos(n - x + 1));
    return Math.exp(logCoeff + x * Math.log(p) + (n - x) * Math.log(1 - p));
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
 * BINOM.DIST.RANGE(trials, probability_s, number_s, [number_s2])
 * Returns the probability of a trial result using a binomial distribution.
 */
export function binomdistrangeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 4) return { t: 'err', v: '#N/A!' };

  const trials = NumberArgs.map(visit(exprs[0]), grid);
  if (trials.t === 'err') return trials;
  const prob = NumberArgs.map(visit(exprs[1]), grid);
  if (prob.t === 'err') return prob;
  const s1 = NumberArgs.map(visit(exprs[2]), grid);
  if (s1.t === 'err') return s1;

  const n = Math.trunc(trials.v);
  const p = prob.v;
  const lo = Math.trunc(s1.v);

  let hi = lo;
  if (exprs.length >= 4) {
    const s2 = NumberArgs.map(visit(exprs[3]), grid);
    if (s2.t === 'err') return s2;
    hi = Math.trunc(s2.v);
  }

  if (n < 0 || p < 0 || p > 1 || lo < 0 || hi < lo || hi > n) {
    return { t: 'err', v: '#VALUE!' };
  }

  // Sum P(X=k) for k in [lo, hi]
  let total = 0;
  for (let k = lo; k <= hi; k++) {
    total += binomPmf(n, k, p);
  }
  return { t: 'num', v: total };
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
 * CHISQ.TEST(actual_range, expected_range) — chi-squared test p-value.
 */
export function chisqtestFunc(
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
  const actual = result.ys;
  const expected = result.xs;
  if (actual.length < 1) return { t: 'err', v: '#VALUE!' };

  // Chi-squared statistic
  let chiSq = 0;
  for (let i = 0; i < actual.length; i++) {
    if (expected[i] === 0) return { t: 'err', v: '#VALUE!' };
    chiSq += (actual[i] - expected[i]) ** 2 / expected[i];
  }

  const df = actual.length - 1;
  if (df < 1) return { t: 'err', v: '#VALUE!' };

  // p-value from chi-squared distribution using regularized gamma
  // P(X > chiSq) = 1 - regularizedGamma(df/2, chiSq/2)
  const pValue = 1 - regularizedLowerGamma(df / 2, chiSq / 2);
  return { t: 'num', v: pValue };
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
  const t2 = x.v * x.v;

  if (cum) {
    // CDF using regularized incomplete beta function via chi-squared relation
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
 * T.TEST(range1, range2, tails, type) — Student's t-test p-value.
 * Simplified: type 1=paired, 2=two-sample equal variance.
 */
export function ttestFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 4) return { t: 'err', v: '#N/A!' };
  const result = extractPairedArrays(exprs[0], exprs[1], visit, grid);
  if ('t' in result) return result;
  const arr1 = result.ys;
  const arr2 = result.xs;
  const tails = NumberArgs.map(visit(exprs[2]), grid);
  if (tails.t === 'err') return tails;
  const type = NumberArgs.map(visit(exprs[3]), grid);
  if (type.t === 'err') return type;
  if (arr1.length < 2 || arr2.length < 2) return { t: 'err', v: '#VALUE!' };
  const mean1 = arr1.reduce((a, b) => a + b, 0) / arr1.length;
  const mean2 = arr2.reduce((a, b) => a + b, 0) / arr2.length;
  const var1 = arr1.reduce((a, b) => a + (b - mean1) ** 2, 0) / (arr1.length - 1);
  const var2 = arr2.reduce((a, b) => a + (b - mean2) ** 2, 0) / (arr2.length - 1);
  const n1 = arr1.length, n2 = arr2.length;
  // Two-sample t-statistic (equal variance)
  const sp2 = ((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2);
  const tStat = Math.abs(mean1 - mean2) / Math.sqrt(sp2 * (1 / n1 + 1 / n2));
  const df = n1 + n2 - 2;
  // Approximate p-value using regularized incomplete beta function
  const x = df / (df + tStat * tStat);
  const pOneTail = 0.5 * regularizedBeta(x, df / 2, 0.5);
  const tailCount = Math.trunc(tails.v);
  return { t: 'num', v: tailCount === 1 ? pOneTail : 2 * pOneTail };
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
 * F.TEST(array1, array2) — returns the two-tailed probability of an F-test.
 */
export function ftestFunc(
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
  const arr1 = result.ys;
  const arr2 = result.xs;
  if (arr1.length < 2 || arr2.length < 2) return { t: 'err', v: '#VALUE!' };

  const mean1 = arr1.reduce((a, b) => a + b, 0) / arr1.length;
  const mean2 = arr2.reduce((a, b) => a + b, 0) / arr2.length;
  const var1 = arr1.reduce((s, v) => s + (v - mean1) ** 2, 0) / (arr1.length - 1);
  const var2 = arr2.reduce((s, v) => s + (v - mean2) ** 2, 0) / (arr2.length - 1);

  if (var2 === 0) return { t: 'err', v: '#VALUE!' };
  const f = var1 / var2;
  const df1 = arr1.length - 1;
  const df2 = arr2.length - 1;

  // Two-tailed p-value using regularized beta
  const x = df2 / (df2 + df1 * f);
  const p = regularizedBeta(x, df2 / 2, df1 / 2);
  const pValue = 2 * Math.min(p, 1 - p);
  return { t: 'num', v: pValue };
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
  const p = prob.v;
  if (failures < 0 || successes < 1 || p <= 0 || p > 1) return { t: 'err', v: '#VALUE!' };

  function pmf(x: number): number {
    const logCoeff = Math.log(gammaLanczos(x + successes))
      - Math.log(gammaLanczos(successes)) - Math.log(gammaLanczos(x + 1));
    return Math.exp(logCoeff + successes * Math.log(p) + x * Math.log(1 - p));
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
 * Z.TEST(range, value, [sigma]) — one-tailed p-value of a z-test.
 */
export function ztestFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) return { t: 'err', v: '#N/A!' };
  const dataResult = collectNumericValues(exprs[0], visit, grid);
  if (!Array.isArray(dataResult)) return dataResult;
  if (dataResult.length === 0) return { t: 'err', v: '#VALUE!' };
  const mu = NumberArgs.map(visit(exprs[1]), grid);
  if (mu.t === 'err') return mu;
  const mean = dataResult.reduce((a, b) => a + b, 0) / dataResult.length;
  let sigma: number;
  if (exprs.length >= 3) {
    const s = NumberArgs.map(visit(exprs[2]), grid);
    if (s.t === 'err') return s;
    sigma = s.v;
  } else {
    // Sample standard deviation
    const variance = dataResult.reduce((a, b) => a + (b - mean) ** 2, 0) / (dataResult.length - 1);
    sigma = Math.sqrt(variance);
  }
  const z = (mean - mu.v) / (sigma / Math.sqrt(dataResult.length));
  // P(Z > z) = 1 - normCdf(z)
  return { t: 'num', v: 1 - normCdf(z) };
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
 * GROWTH(known_y, [known_x], [new_x]) — predicted exponential growth values.
 * Returns y = b * m^x using exponential regression on ln(y) vs x.
 */
export function growthFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 3) return { t: 'err', v: '#N/A!' };
  const result = extractPairedArrays(exprs[0], exprs.length >= 2 ? exprs[1] : undefined, visit, grid);
  if ('t' in result) return result;
  // result.ys = known_y (first arg), result.xs = known_x (second arg)
  const knownY = result.ys;
  const knownX = result.xs.length > 0 ? result.xs : knownY.map((_, i) => i + 1);
  if (knownY.length !== knownX.length || knownY.length === 0) return { t: 'err', v: '#VALUE!' };
  // Log-transform y values
  const lnY = knownY.map(y => Math.log(y));
  const reg = linearRegression(knownX, lnY);
  // For new_x, use the first value (single-cell return)
  let newXval: number;
  if (exprs.length >= 3) {
    const nx = NumberArgs.map(visit(exprs[2]), grid);
    if (nx.t === 'err') return nx;
    newXval = nx.v;
  } else {
    newXval = knownX[knownX.length - 1];
  }
  return { t: 'num', v: Math.exp(reg.intercept) * Math.exp(reg.slope * newXval) };
}

/**
 * TREND(known_y, [known_x], [new_x]) — predicted linear trend values.
 */
export function trendFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 3) return { t: 'err', v: '#N/A!' };
  const result = extractPairedArrays(exprs[0], exprs.length >= 2 ? exprs[1] : undefined, visit, grid);
  if ('t' in result) return result;
  const knownY = result.ys;
  const knownX = result.xs.length > 0 ? result.xs : knownY.map((_, i) => i + 1);
  if (knownY.length !== knownX.length || knownY.length === 0) return { t: 'err', v: '#VALUE!' };
  const reg = linearRegression(knownX, knownY);
  let newXval: number;
  if (exprs.length >= 3) {
    const nx = NumberArgs.map(visit(exprs[2]), grid);
    if (nx.t === 'err') return nx;
    newXval = nx.v;
  } else {
    newXval = knownX[knownX.length - 1];
  }
  return { t: 'num', v: reg.slope * newXval + reg.intercept };
}

/**
 * LINEST(known_y, [known_x]) — returns slope (first cell of the result array).
 */
export function linestFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A!' };
  const result = extractPairedArrays(exprs[0], exprs.length >= 2 ? exprs[1] : undefined, visit, grid);
  if ('t' in result) return result;
  const knownY = result.ys;
  const knownX = result.xs.length > 0 ? result.xs : knownY.map((_, i) => i + 1);
  if (knownY.length !== knownX.length || knownY.length === 0) return { t: 'err', v: '#VALUE!' };
  const reg = linearRegression(knownX, knownY);
  // Single-cell output: slope
  return { t: 'num', v: reg.slope };
}

/**
 * LOGEST(known_y, [known_x]) — exponential regression, returns growth rate (m).
 * y = b * m^x → ln(y) = ln(b) + x*ln(m)
 */
export function logestFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A!' };
  const result = extractPairedArrays(exprs[0], exprs.length >= 2 ? exprs[1] : undefined, visit, grid);
  if ('t' in result) return result;
  const knownY = result.ys;
  const knownX = result.xs.length > 0 ? result.xs : knownY.map((_, i) => i + 1);
  if (knownY.length !== knownX.length || knownY.length === 0) return { t: 'err', v: '#VALUE!' };
  const lnY = knownY.map(y => Math.log(y));
  const reg = linearRegression(knownX, lnY);
  // Single-cell output: m = e^slope
  return { t: 'num', v: Math.exp(reg.slope) };
}

/**
 * FREQUENCY(data_array, bins_array) — counts how many values fall in each bin.
 * Returns the count for the first bin (single-cell output).
 */
export function frequencyFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A!' };
  const dataResult = collectNumericValues(exprs[0], visit, grid);
  if (!Array.isArray(dataResult)) return dataResult;
  const binsResult = collectNumericValues(exprs[1], visit, grid);
  if (!Array.isArray(binsResult)) return binsResult;
  const data = dataResult;
  const bins = [...binsResult].sort((a, b) => a - b);
  // Build frequency counts
  const counts = new Array(bins.length + 1).fill(0);
  for (const val of data) {
    let placed = false;
    for (let i = 0; i < bins.length; i++) {
      if (val <= bins[i]) {
        counts[i]++;
        placed = true;
        break;
      }
    }
    if (!placed) counts[bins.length]++;
  }
  // Return first bin count (single-cell)
  return { t: 'num', v: counts[0] };
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
 * SKEW.P(number1, [number2], ...) — population skewness.
 */
export function skewpFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  const values: number[] = [];
  for (const expr of exprs) {
    const result = collectNumericValues(expr, visit, grid);
    if (!Array.isArray(result)) return result;
    values.push(...result);
  }
  if (values.length < 3) return { t: 'err', v: '#VALUE!' };
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const stdev = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  if (stdev === 0) return { t: 'err', v: '#VALUE!' };
  const m3 = values.reduce((s, v) => s + ((v - mean) / stdev) ** 3, 0) / n;
  return { t: 'num', v: m3 };
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
 * STDEVA(value1, [value2], ...) — standard deviation of a sample,
 * including text (as 0) and logical values.
 */
export function stdevaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  const values: number[] = [];
  for (const expr of exprs) {
    const node = visit(expr);
    if (node.t === 'err') return node;
    if (node.t === 'num') {
      values.push(node.v);
    } else if (node.t === 'bool') {
      values.push(node.v ? 1 : 0);
    } else if (node.t === 'ref' && grid) {
      for (const sref of toSrefs([node.v])) {
        const cell = grid.get(sref);
        if (cell?.v != null && cell.v !== '') {
          const n = Number(cell.v);
          values.push(isNaN(n) ? 0 : n);
        }
      }
    } else if (node.t === 'str') {
      values.push(0);
    }
  }
  if (values.length < 2) return { t: 'err', v: '#VALUE!' };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return { t: 'num', v: Math.sqrt(variance) };
}

/**
 * STDEVPA(value1, [value2], ...) — standard deviation of a population,
 * including text (as 0) and logical values.
 */
export function stdevpaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  const values: number[] = [];
  for (const expr of exprs) {
    const node = visit(expr);
    if (node.t === 'err') return node;
    if (node.t === 'num') {
      values.push(node.v);
    } else if (node.t === 'bool') {
      values.push(node.v ? 1 : 0);
    } else if (node.t === 'ref' && grid) {
      for (const sref of toSrefs([node.v])) {
        const cell = grid.get(sref);
        if (cell?.v != null && cell.v !== '') {
          const n = Number(cell.v);
          values.push(isNaN(n) ? 0 : n);
        }
      }
    } else if (node.t === 'str') {
      values.push(0);
    }
  }
  if (values.length < 1) return { t: 'err', v: '#VALUE!' };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { t: 'num', v: Math.sqrt(variance) };
}

/**
 * GAUSS(z) — returns the probability that a standard normal random variable
 * falls between the mean and z standard deviations from the mean.
 * GAUSS(z) = NORM.S.DIST(z, TRUE) - 0.5
 */
export function gaussFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A!' };
  const z = NumberArgs.map(visit(exprs[0]), grid);
  if (z.t === 'err') return z;
  return { t: 'num', v: normCdf(z.v) - 0.5 };
}

/**
 * PHI(x) — returns the value of the standard normal density function.
 */
export function phiFunc(
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
  return { t: 'num', v: normPdf(x.v) };
}

/**
 * Extract paired numeric arrays from two range expressions.
 */
function extractPairedArrays(
  expr1: ParseTree,
  expr2: ParseTree | undefined,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): { xs: number[]; ys: number[] } | FormulaError {
  const yRefs = getRefsFromExpression(expr1, visit, grid);
  if (isFormulaError(yRefs)) return yRefs;

  if (!expr2) {
    // No x array provided — generate sequential indices
    const ys: number[] = [];
    for (let i = 0; i < yRefs.v.length; i++) {
      const yv = grid?.get(yRefs.v[i])?.v || '';
      if (yv !== '' && !isNaN(Number(yv))) {
        ys.push(Number(yv));
      }
    }
    if (ys.length < 2) return { t: 'err', v: '#N/A!' };
    return { xs: ys.map((_, i) => i + 1), ys };
  }

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
 * Helper to collect numeric values from a range expression.
 */
export function collectNumericValues(
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
 * Lanczos approximation for the gamma function.
 */
export function gammaLanczos(z: number): number {
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
 * Error function approximation (Abramowitz and Stegun 7.1.26).
 */
export function erf(x: number): number {
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
 * Helper: log-gamma using Lanczos approximation.
 */
function gammaLnHelper(z: number): number {
  return Math.log(gammaLanczos(z));
}

/**
 * Regularized lower incomplete gamma function P(a, x) = gamma(a,x) / Gamma(a)
 */
function regularizedLowerGamma(a: number, x: number): number {
  if (x < 0) return 0;
  if (x === 0) return 0;

  // Series expansion for small x
  if (x < a + 1) {
    let sum = 1 / a;
    let term = 1 / a;
    for (let n = 1; n < 200; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < 1e-14 * Math.abs(sum)) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }

  // Continued fraction for large x
  return 1 - regularizedUpperGamma(a, x);
}

function regularizedUpperGamma(a: number, x: number): number {
  let c = 1e-30;
  let d = 1 / (x + 1 - a);
  let result = d;
  for (let i = 1; i < 200; i++) {
    const an = i * (a - i);
    const bn = x + 2 * i + 1 - a;
    d = bn + an * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = bn + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    result *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  return result * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

function lnGamma(x: number): number {
  // Stirling-Lanczos approximation
  const g = 7;
  const coef = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }
  x -= 1;
  let a = coef[0];
  for (let i = 1; i < g + 2; i++) {
    a += coef[i] / (x + i);
  }
  const t = x + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function binomPmf(n: number, k: number, p: number): number {
  // C(n,k) * p^k * (1-p)^(n-k) in log space to avoid overflow
  let logCoeff = 0;
  for (let i = 0; i < k; i++) {
    logCoeff += Math.log(n - i) - Math.log(i + 1);
  }
  return Math.exp(logCoeff + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

export const statisticalEntries: [string, (...args: any[]) => EvalNode][] = [
  ['AVERAGE', average],
  ['MEDIAN', medianFunc],
  ['MIN', minFunc],
  ['MAX', maxFunc],
  ['COUNT', countFunc],
  ['COUNTA', countaFunc],
  ['COUNTBLANK', countblankFunc],
  ['COUNTIF', countifFunc],
  ['SUMIF', sumifFunc],
  ['COUNTIFS', countifsFunc],
  ['SUMIFS', sumifsFunc],
  ['AVERAGEIF', averageifFunc],
  ['AVERAGEIFS', averageifsFunc],
  ['LARGE', largeFunc],
  ['SMALL', smallFunc],
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
  ['MODE.MULT', modemultFunc],
  ['QUARTILE', quartileFunc],
  ['QUARTILE.INC', quartileFunc],
  ['QUARTILE.EXC', quartileexcFunc],
  ['COUNTUNIQUE', countuniqueFunc],
  ['RANK', rankFunc],
  ['RANK.AVG', rankavgFunc],
  ['RANK.EQ', rankFunc],
  ['PERCENTILE', percentileFunc],
  ['PERCENTILE.INC', percentileFunc],
  ['PERCENTILE.EXC', percentileexcFunc],
  ['PERCENTRANK', percentrankFunc],
  ['PERCENTRANK.INC', percentrankFunc],
  ['PERCENTRANK.EXC', percentrankexcFunc],
  ['TRIMMEAN', trimmeanFunc],
  ['GEOMEAN', geomeanFunc],
  ['HARMEAN', harmeanFunc],
  ['AVEDEV', avedevFunc],
  ['DEVSQ', devsqFunc],
  ['AVERAGEA', averageaFunc],
  ['MINA', minaFunc],
  ['MAXA', maxaFunc],
  ['MINIFS', minifsFunc],
  ['MAXIFS', maxifsFunc],
  ['FISHER', fisherFunc],
  ['FISHERINV', fisherinvFunc],
  ['GAMMA', gammaFunc],
  ['GAMMALN', gammalnFunc],
  ['NORMDIST', normdistFunc],
  ['NORM.DIST', normdistFunc],
  ['NORMINV', norminvFunc],
  ['NORM.INV', norminvFunc],
  ['NORM.S.DIST', normsdistFunc],
  ['NORM.S.INV', normsinvFunc],
  ['LOGNORMAL.DIST', lognormdistFunc],
  ['LOGNORMAL.INV', lognorminvFunc],
  ['STANDARDIZE', standardizeFunc],
  ['WEIBULL.DIST', weibulldistFunc],
  ['POISSON.DIST', poissondistFunc],
  ['BINOM.DIST', binomdistFunc],
  ['BINOM.DIST.RANGE', binomdistrangeFunc],
  ['BINOM.INV', biominvFunc],
  ['EXPON.DIST', expondistFunc],
  ['CONFIDENCE.NORM', confidencenormFunc],
  ['CONFIDENCE.T', confidencetFunc],
  ['CHISQ.DIST', chisqdistFunc],
  ['CHISQ.INV', chisqinvFunc],
  ['CHISQ.DIST.RT', chisqdistrtFunc],
  ['CHISQ.INV.RT', chisqinvrtFunc],
  ['CHISQ.TEST', chisqtestFunc],
  ['T.DIST', tdistFunc],
  ['T.INV', tinvFunc],
  ['T.DIST.RT', tdistrtFunc],
  ['T.DIST.2T', tdist2tFunc],
  ['T.INV.2T', tinv2tFunc],
  ['T.TEST', ttestFunc],
  ['F.DIST', fdistFunc],
  ['F.INV', finvFunc],
  ['F.DIST.RT', fdistrtFunc],
  ['F.INV.RT', finvrtFunc],
  ['F.TEST', ftestFunc],
  ['HYPGEOM.DIST', hypgeomdistFunc],
  ['NEGBINOM.DIST', negbinomdistFunc],
  ['BETA.DIST', betadistFunc],
  ['BETA.INV', betainvFunc],
  ['GAMMA.DIST', gammadistFunc],
  ['GAMMA.INV', gammainvFunc],
  ['Z.TEST', ztestFunc],
  ['FORECAST', forecastFunc],
  ['FORECAST.LINEAR', forecastFunc],
  ['SLOPE', slopeFunc],
  ['INTERCEPT', interceptFunc],
  ['CORREL', correlFunc],
  ['COVAR', covarFunc],
  ['COVARIANCE.P', covarFunc],
  ['COVARIANCE.S', covarsFunc],
  ['RSQ', rsqFunc],
  ['STEYX', steyxFunc],
  ['SUMX2MY2', sumx2my2Func],
  ['SUMX2PY2', sumx2py2Func],
  ['SUMXMY2', sumxmy2Func],
  ['PROB', probFunc],
  ['GROWTH', growthFunc],
  ['TREND', trendFunc],
  ['LINEST', linestFunc],
  ['LOGEST', logestFunc],
  ['FREQUENCY', frequencyFunc],
  ['VARA', varaFunc],
  ['VARPA', varpaFunc],
  ['SKEW', skewFunc],
  ['SKEW.P', skewpFunc],
  ['KURT', kurtFunc],
  ['STDEVA', stdevaFunc],
  ['STDEVPA', stdevpaFunc],
  ['GAUSS', gaussFunc],
  ['PHI', phiFunc],
];
