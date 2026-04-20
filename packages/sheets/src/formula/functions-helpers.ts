import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { EvalNode, ErrNode } from './formula';
import { ref2str } from './arguments';
import { Grid } from '../model/core/types';
import {
  isCrossSheetRef,
  isSrng,
  parseCrossSheetRef,
  parseRange,
  toSref,
  toSrefs,
} from '../model/core/coordinates';

export type FormulaError = ErrNode;

export type ParsedCriterion = {
  op: '=' | '<>' | '<' | '<=' | '>' | '>=';
  value: string;
  numericValue?: number;
  boolValue?: boolean;
  wildcardPattern?: RegExp;
};

export type ReferenceMatrix = {
  refs: string[];
  rowCount: number;
  colCount: number;
};

export type LookupValue = {
  normalized: string;
  numericValue?: number;
  boolValue?: boolean;
};

/**
 * `toStr` converts an EvalNode to a string, propagating errors.
 */
export function toStr(
  node: EvalNode,
  grid?: Grid,
): { t: 'str'; v: string } | ErrNode {
  if (node.t === 'err') return node;
  if (node.t === 'str') return node;
  if (node.t === 'num') return { t: 'str', v: node.v.toString() };
  if (node.t === 'bool') return { t: 'str', v: node.v ? 'TRUE' : 'FALSE' };
  if (node.t === 'ref' && grid) {
    return ref2str(node, grid);
  }
  return ErrNode.VALUE;
}

export function isFormulaError(value: unknown): value is FormulaError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as FormulaError).t === 'err'
  );
}

export function getRefsFromExpression(
  expr: ParseTree,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): { t: 'refs'; v: string[] } | FormulaError {
  const node = visit(expr);
  if (node.t === 'err') {
    return node;
  }
  if (node.t !== 'ref' || !grid) {
    return ErrNode.VALUE;
  }

  return { t: 'refs', v: Array.from(toSrefs([node.v])) };
}

export function getReferenceMatrixFromExpression(
  expr: ParseTree,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): { t: 'matrix'; v: ReferenceMatrix } | FormulaError {
  const node = visit(expr);
  if (node.t === 'err') {
    return node;
  }
  if (node.t !== 'ref' || !grid) {
    return ErrNode.VALUE;
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

    const [a, b] = parseRange(localRange);
    const minR = Math.min(a.r, b.r);
    const maxR = Math.max(a.r, b.r);
    const minC = Math.min(a.c, b.c);
    const maxC = Math.max(a.c, b.c);
    const refs: string[] = [];
    for (let row = minR; row <= maxR; row++) {
      for (let col = minC; col <= maxC; col++) {
        refs.push(`${prefix}${toSref({ r: row, c: col })}`);
      }
    }

    return {
      t: 'matrix',
      v: {
        refs,
        rowCount: maxR - minR + 1,
        colCount: maxC - minC + 1,
      },
    };
  } catch {
    return ErrNode.VALUE;
  }
}

export function toLookupValue(raw: string): LookupValue {
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

export function lookupValueFromNode(
  node: EvalNode,
  grid?: Grid,
): LookupValue | FormulaError {
  const str = toStr(node, grid);
  if (str.t === 'err') {
    return str;
  }

  return toLookupValue(str.v);
}

export function lookupValueFromRef(ref: string, grid?: Grid): LookupValue {
  const raw = grid?.get(ref)?.v || '';
  return toLookupValue(raw);
}

export function equalLookupValues(left: LookupValue, right: LookupValue): boolean {
  if (left.numericValue !== undefined && right.numericValue !== undefined) {
    return left.numericValue === right.numericValue;
  }

  if (left.boolValue !== undefined && right.boolValue !== undefined) {
    return left.boolValue === right.boolValue;
  }

  return left.normalized === right.normalized;
}

export function compareLookupValues(left: LookupValue, right: LookupValue): number {
  if (left.numericValue !== undefined && right.numericValue !== undefined) {
    return left.numericValue - right.numericValue;
  }

  if (left.boolValue !== undefined && right.boolValue !== undefined) {
    return Number(left.boolValue) - Number(right.boolValue);
  }

  return left.normalized.localeCompare(right.normalized);
}

export function toNumberOrZero(value: string): number {
  const num = Number(value);
  return isNaN(num) ? 0 : num;
}

export function parseCriterion(
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

export function matchesCriterion(value: string, criterion: ParsedCriterion): boolean {
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

export function wildcardToRegex(pattern: string): string {
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

