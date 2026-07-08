import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { EvalNode, ErrNode, NumNode, BoolNode, numNode } from './formula';
import { Grid } from '../model/core/types';
import { toStr, firstCellValue } from './functions-helpers';
import { NumberArgs, BoolArgs } from './arguments';
import { isSrng } from '../model/core/coordinates';

/**
 * Resolves a single-cell ref or scalar node to a scalar EvalNode,
 * mirroring the comparison logic in formula.ts `resolveValue`.
 */
function resolveScalar(node: EvalNode, grid?: Grid): EvalNode {
  if (node.t !== 'ref') return node;
  if (!grid || isSrng(node.v)) return ErrNode.VALUE;
  const val = grid.get(node.v)?.v ?? '';
  if (val === '') return numNode(0);
  if (val === 'TRUE' || val === 'true') return { t: 'bool', v: true };
  if (val === 'FALSE' || val === 'false') return { t: 'bool', v: false };
  const num = Number(val);
  if (!isNaN(num)) return numNode(num);
  return { t: 'str', v: val };
}

/**
 * Compares two scalar nodes; returns a signed integer:
 * negative → left < right, 0 → equal, positive → left > right.
 * Returns ErrNode on type mismatch for ordered comparisons.
 * Type order: num < str < bool (Google Sheets spec).
 */
function compareScalars(
  left: EvalNode,
  right: EvalNode,
): number | { t: 'bool'; v: boolean } | ErrNode {
  if (left.t === 'err') return left;
  if (right.t === 'err') return right;

  if (left.t !== right.t) {
    const typeOrder: Record<string, number> = { num: 0, str: 1, bool: 2 };
    return (typeOrder[left.t] ?? 0) - (typeOrder[right.t] ?? 0);
  }

  if (left.t === 'str' && right.t === 'str') {
    return left.v.localeCompare(right.v, undefined, { sensitivity: 'accent' });
  }
  if (left.t === 'bool' && right.t === 'bool') {
    return (left.v ? 1 : 0) - (right.v ? 1 : 0);
  }
  const lv = (left as NumNode).v;
  const rv = (right as NumNode).v;
  return lv < rv ? -1 : lv > rv ? 1 : 0;
}

/**
 * Extracts exactly two args.
 * Returns a tuple (array) on success, or ErrNode on failure.
 * Use `Array.isArray(result)` to narrow the type.
 */
function twoArgs(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
): [EvalNode, EvalNode] | ErrNode {
  const exprs = ctx.args()?.expr() ?? [];
  return [visit(exprs[0]), visit(exprs[1])];
}

/** Extracts exactly one arg. Returns ErrNode if arg count is wrong. */
function oneArg(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
): EvalNode {
  const exprs = ctx.args()?.expr() ?? [];
  return visit(exprs[0]);
}

// ─── Arithmetic ──────────────────────────────────────────────────────────────

export function addFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const pair = twoArgs(ctx, visit);
  if (!Array.isArray(pair)) return pair;
  const [a, b] = pair;
  const na = NumberArgs.map(a, grid);
  if (na.t === 'err') return na;
  const nb = NumberArgs.map(b, grid);
  if (nb.t === 'err') return nb;
  return numNode(na.v + nb.v);
}

export function minusFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const pair = twoArgs(ctx, visit);
  if (!Array.isArray(pair)) return pair;
  const [a, b] = pair;
  const na = NumberArgs.map(a, grid);
  if (na.t === 'err') return na;
  const nb = NumberArgs.map(b, grid);
  if (nb.t === 'err') return nb;
  return numNode(na.v - nb.v);
}

export function multiplyFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const pair = twoArgs(ctx, visit);
  if (!Array.isArray(pair)) return pair;
  const [a, b] = pair;
  const na = NumberArgs.map(a, grid);
  if (na.t === 'err') return na;
  const nb = NumberArgs.map(b, grid);
  if (nb.t === 'err') return nb;
  return numNode(na.v * nb.v);
}

export function divideFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const pair = twoArgs(ctx, visit);
  if (!Array.isArray(pair)) return pair;
  const [a, b] = pair;
  const na = NumberArgs.map(a, grid);
  if (na.t === 'err') return na;
  const nb = NumberArgs.map(b, grid);
  if (nb.t === 'err') return nb;
  if (nb.v === 0) return ErrNode.DIV0;
  return numNode(na.v / nb.v);
}

export function powFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const pair = twoArgs(ctx, visit);
  if (!Array.isArray(pair)) return pair;
  const [a, b] = pair;
  const na = NumberArgs.map(a, grid);
  if (na.t === 'err') return na;
  const nb = NumberArgs.map(b, grid);
  if (nb.t === 'err') return nb;
  return numNode(Math.pow(na.v, nb.v));
}

// ─── Unary ───────────────────────────────────────────────────────────────────

export function uminusFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const raw = oneArg(ctx, visit);
  if (raw.t === 'err') return raw;
  const n = NumberArgs.map(raw, grid);
  if (n.t === 'err') return n;
  return numNode(-n.v);
}

export function uplusFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const raw = oneArg(ctx, visit);
  if (raw.t === 'err') return raw;
  const n = NumberArgs.map(raw, grid);
  if (n.t === 'err') return n;
  return numNode(n.v);
}

export function unaryPercentFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const raw = oneArg(ctx, visit);
  if (raw.t === 'err') return raw;
  const n = NumberArgs.map(raw, grid);
  if (n.t === 'err') return n;
  return numNode(n.v / 100);
}

// ─── Comparison ──────────────────────────────────────────────────────────────

function comparisonFunc(
  op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte',
): (
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
) => EvalNode {
  return (ctx, visit, grid) => {
    const pair = twoArgs(ctx, visit);
    if (!Array.isArray(pair)) return pair;
    const left = resolveScalar(pair[0], grid);
    const right = resolveScalar(pair[1], grid);
    const cmp = compareScalars(left, right);
    if (typeof cmp === 'object' && 't' in cmp) return cmp as ErrNode;
    switch (op) {
      case 'eq': return { t: 'bool', v: cmp === 0 };
      case 'ne': return { t: 'bool', v: cmp !== 0 };
      case 'lt': return { t: 'bool', v: cmp < 0 };
      case 'lte': return { t: 'bool', v: cmp <= 0 };
      case 'gt': return { t: 'bool', v: cmp > 0 };
      case 'gte': return { t: 'bool', v: cmp >= 0 };
    }
  };
}

export const eqFunc = comparisonFunc('eq');
export const neFunc = comparisonFunc('ne');
export const ltFunc = comparisonFunc('lt');
export const lteFunc = comparisonFunc('lte');
export const gtFunc = comparisonFunc('gt');
export const gteFunc = comparisonFunc('gte');

// ─── Special ─────────────────────────────────────────────────────────────────

/**
 * ISBETWEEN(value, lower, upper, [lower_inclusive=TRUE], [upper_inclusive=TRUE])
 * Returns TRUE if value is between lower and upper.
 */
export function isbetweenFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const exprs = ctx.args()?.expr() ?? [];

  const value = resolveScalar(visit(exprs[0]), grid);
  const lower = resolveScalar(visit(exprs[1]), grid);
  const upper = resolveScalar(visit(exprs[2]), grid);

  let lowerInclusive = true;
  let upperInclusive = true;

  if (exprs.length >= 4) {
    const li = BoolArgs.map(visit(exprs[3]), grid);
    if (li.t === 'err') return li;
    lowerInclusive = (li as BoolNode).v;
  }
  if (exprs.length >= 5) {
    const ui = BoolArgs.map(visit(exprs[4]), grid);
    if (ui.t === 'err') return ui;
    upperInclusive = (ui as BoolNode).v;
  }

  const cmpLower = compareScalars(value, lower);
  const cmpUpper = compareScalars(value, upper);

  if (typeof cmpLower === 'object') return cmpLower as ErrNode;
  if (typeof cmpUpper === 'object') return cmpUpper as ErrNode;

  const lowerOk = lowerInclusive ? cmpLower >= 0 : cmpLower > 0;
  const upperOk = upperInclusive ? cmpUpper <= 0 : cmpUpper < 0;

  return { t: 'bool', v: lowerOk && upperOk };
}

// ─── String ──────────────────────────────────────────────────────────────────

export function concatFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const exprs = ctx.args()?.expr() ?? [];

  let result = '';
  for (const expr of exprs) {
    const str = toStr(visit(expr), grid);
    if (str.t === 'err') return str;
    result += str.v;
  }
  return { t: 'str', v: result };
}

export function uniqueFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const exprs = ctx.args()?.expr() ?? [];

  const node = visit(exprs[0]);
  if (node.t === 'err') return node;
  if (node.t !== 'ref' || !grid) return node;
  return firstCellValue(node, grid);
}

export const operatorEntries: [string, (...args: any[]) => EvalNode][] = [
  ['ADD', addFunc],
  ['MINUS', minusFunc],
  ['MULTIPLY', multiplyFunc],
  ['DIVIDE', divideFunc],
  ['POW', powFunc],
  ['UMINUS', uminusFunc],
  ['UPLUS', uplusFunc],
  ['UNARY_PERCENT', unaryPercentFunc],
  ['EQ', eqFunc],
  ['NE', neFunc],
  ['LT', ltFunc],
  ['LTE', lteFunc],
  ['GT', gtFunc],
  ['GTE', gteFunc],
  ['ISBETWEEN', isbetweenFunc],
  ['CONCAT', concatFunc],
  ['UNIQUE', uniqueFunc],
];
