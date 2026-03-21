import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { EvalNode, ErrNode } from './formula';
import { NumberArgs, BoolArgs } from './arguments';
import { Grid } from '../model/core/types';
import {
  isSrng,
  toSrefs,
} from '../model/core/coordinates';
import {
  toStr,
  wildcardToRegex,
} from './functions-helpers';

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
 * TEXTSPLIT(text, col_delimiter, [row_delimiter], [ignore_empty], [match_mode], [pad_with])
 * Splits text by delimiter. Returns first part for single-cell evaluation.
 */
export function textsplitFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A!' };
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 6) return { t: 'err', v: '#N/A!' };

  const textNode = visit(exprs[0]);
  const text = textNode.t === 'str' ? textNode.v : textNode.t === 'num' ? String(textNode.v) : '';
  if (textNode.t === 'err') return textNode;

  const delimNode = visit(exprs[1]);
  if (delimNode.t === 'err') return delimNode;
  const colDelim = delimNode.t === 'str' || delimNode.t === 'num' ? String(delimNode.v) : '';

  if (colDelim === '') return { t: 'err', v: '#VALUE!' };

  let ignoreEmpty = false;
  if (exprs.length >= 4) {
    const ie = visit(exprs[3]);
    ignoreEmpty = ie.t === 'bool' ? ie.v === true : ie.t === 'num' ? ie.v !== 0 : false;
  }

  let parts = text.split(colDelim);
  if (ignoreEmpty) {
    parts = parts.filter((p) => p !== '');
  }

  // Return first part for single-cell evaluation
  return parts.length > 0
    ? { t: 'str', v: parts[0] }
    : { t: 'err', v: '#N/A!' };
}

function parseStartPosition(
  expr: ParseTree | undefined,
  text: string,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): { t: 'num'; v: number } | ErrNode {
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

export const textEntries: [string, (...args: any[]) => EvalNode][] = [
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
  ['EXACT', exactFunc],
  ['REPLACE', replaceFunc],
  ['REPT', reptFunc],
  ['T', tFunc],
  ['VALUE', valueFunc],
  ['TEXT', textFunc],
  ['CHAR', charFunc],
  ['CODE', codeFunc],
  ['CLEAN', cleanFunc],
  ['NUMBERVALUE', numbervalueFunc],
  ['FIXED', fixedFunc],
  ['DOLLAR', dollarFunc],
  ['SPLIT', splitFunc],
  ['JOIN', joinFunc],
  ['REGEXMATCH', regexmatchFunc],
  ['REGEXEXTRACT', regexextractFunc],
  ['REGEXREPLACE', regexreplaceFunc],
  ['UNICODE', unicodeFunc],
  ['UNICHAR', unicharFunc],
  ['ENCODEURL', encodeurlFunc],
  ['TEXTBEFORE', textbeforeFunc],
  ['TEXTAFTER', textafterFunc],
  ['VALUETOTEXT', valuetotextFunc],
  ['TEXTSPLIT', textsplitFunc],
];
