import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { ANTLRErrorListener } from 'antlr4ts/ANTLRErrorListener';
import { Token as AntlrToken } from 'antlr4ts/Token';
import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FormulaLexer } from '../../antlr/FormulaLexer';
import { FormulaVisitor } from '../../antlr/FormulaVisitor';
import {
  AddSubContext,
  ArgsContext,
  ArrayLiteralContext,
  BooleanContext,
  CallContext,
  ComparisonContext,
  ConcatContext,
  FormulaParser,
  FunctionContext,
  IdentifierContext,
  MulDivContext,
  NumberContext,
  ParenthesesContext,
  ReferenceContext,
  StrContext,
  UnarySignContext,
} from '../../antlr/FormulaParser';
import { FunctionMap } from './functions';
import { Grid, Range, Reference } from '../model/core/types';
import { NumberArgs, StringArgs } from './arguments';
import {
  isSrng,
  parseRef,
  parseRange,
  isCrossSheetRef,
} from '../model/core/coordinates';

/**
 * `Token` represents a token in the formula.
 */
export type Token = {
  type: string;
  start: number;
  stop: number;
  text: string;
};

type FormulaSyntaxError = {
  message: string;
  line: number;
  charPositionInLine: number;
};

type ParsedExpression = {
  tree: ParseTree;
  syntaxErrors: FormulaSyntaxError[];
  parser: FormulaParser;
};

function createSyntaxErrorListener<TSymbol>(
  syntaxErrors: FormulaSyntaxError[],
): ANTLRErrorListener<TSymbol> {
  return {
    syntaxError: (
      _recognizer,
      _offendingSymbol,
      line,
      charPositionInLine,
      msg,
    ) => {
      syntaxErrors.push({ message: msg, line, charPositionInLine });
    },
  };
}

const EMPTY_SENTINEL = 'zEmptyArg__';

/**
 * `preprocessEmptyArgs` replaces empty argument positions (e.g. `,,` or `(,`
 * or `,)`) with a sentinel function call so the parser can handle them.
 */
function preprocessEmptyArgs(body: string): string {
  let result = '';
  let inString = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];

    if (ch === '"') {
      if (inString && i + 1 < body.length && body[i + 1] === '"') {
        result += '""';
        i++;
        continue;
      }
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString) {
      result += ch;
      continue;
    }

    if (ch === '(') {
      result += ch;
      // Empty first arg: ( followed by , (but NOT by ) which is empty call)
      let j = i + 1;
      while (j < body.length && body[j] === ' ') j++;
      if (j < body.length && body[j] === ',') {
        result += EMPTY_SENTINEL + '()';
      }
    } else if (ch === ',') {
      result += ch;
      // Empty middle/last arg: , followed by , or )
      let j = i + 1;
      while (j < body.length && body[j] === ' ') j++;
      if (j < body.length && (body[j] === ',' || body[j] === ')')) {
        result += EMPTY_SENTINEL + '()';
      }
    } else {
      result += ch;
    }
  }

  return result;
}

function parseExpression(formula: string): ParsedExpression | undefined {
  const stream = CharStreams.fromString(preprocessEmptyArgs(formula.slice(1)));
  const lexer = new FormulaLexer(stream);
  const tokens = new CommonTokenStream(lexer);
  const parser = new FormulaParser(tokens);
  const syntaxErrors: FormulaSyntaxError[] = [];

  lexer.removeErrorListeners();
  parser.removeErrorListeners();
  lexer.addErrorListener(createSyntaxErrorListener<number>(syntaxErrors));
  parser.addErrorListener(createSyntaxErrorListener<AntlrToken>(syntaxErrors));

  try {
    const tree = parser.expr();
    if (parser.inputStream.LA(1) !== FormulaParser.EOF) {
      syntaxErrors.push({
        message: 'unexpected trailing tokens',
        line: 0,
        charPositionInLine: 0,
      });
    }
    return { tree, syntaxErrors, parser };
  } catch {
    return undefined;
  }
}

function hasSyntaxErrors(parsed: ParsedExpression): boolean {
  return parsed.syntaxErrors.length > 0 || parsed.parser.numberOfSyntaxErrors > 0;
}

function isOnlyMissingClosingParenAtEof(
  syntaxErrors: FormulaSyntaxError[],
): boolean {
  return (
    syntaxErrors.length > 0 &&
    syntaxErrors.every((error) =>
      error.message.includes("missing ')' at '<EOF>'"),
    )
  );
}

function countUnclosedLeftParens(formula: string): number {
  const stream = CharStreams.fromString(formula.slice(1));
  const lexer = new FormulaLexer(stream);
  const tokens = new CommonTokenStream(lexer);
  lexer.removeErrorListeners();
  tokens.fill();

  let openParens = 0;
  for (const token of tokens.getTokens()) {
    if (token.type === FormulaLexer.T__0) {
      openParens += 1;
      continue;
    }
    if (token.type === FormulaLexer.T__1 && openParens > 0) {
      openParens -= 1;
    }
  }

  return openParens;
}

/**
 * `normalizeFormulaOnCommit` auto-fixes safe, incomplete formulas on commit.
 * Currently it appends missing trailing `)` when syntax errors are only
 * `missing ')' at '<EOF>'`.
 */
export function normalizeFormulaOnCommit(formula: string): string {
  if (!formula.startsWith('=')) {
    return formula;
  }

  const parsed = parseExpression(formula);
  if (!parsed) {
    return formula;
  }
  if (!hasSyntaxErrors(parsed)) {
    return formula;
  }
  if (!isOnlyMissingClosingParenAtEof(parsed.syntaxErrors)) {
    return formula;
  }

  const missingClosingParens = countUnclosedLeftParens(formula);
  if (missingClosingParens <= 0) {
    return formula;
  }

  const candidate = formula + ')'.repeat(missingClosingParens);
  const reparsed = parseExpression(candidate);
  if (!reparsed || hasSyntaxErrors(reparsed)) {
    return formula;
  }

  return candidate;
}

/**
 * `extractReferences` returns references in the expression.
 */
export function extractReferences(formula: string): Set<Reference> {
  const stream = CharStreams.fromString(formula.slice(1));
  const lexer = new FormulaLexer(stream);
  const tokens = new CommonTokenStream(lexer);
  lexer.removeErrorListeners();
  tokens.fill();

  const references = new Set<Reference>();
  for (const token of tokens.getTokens()) {
    if (token.type === FormulaParser.REFERENCE) {
      references.add(token.text!.toUpperCase());
    }
  }

  return references;
}

/**
 * `codePointToUtf16Offsets` builds a mapping from code-point index to UTF-16
 * index.  `offsets[i]` is the UTF-16 position of the i-th code point.
 * `offsets[codePointCount]` equals `str.length` (a sentinel past the end).
 *
 * ANTLR4-ts `CharStreams.fromString` uses Unicode code points for token
 * indices, while JavaScript string methods use UTF-16 code units.  Characters
 * outside the BMP (e.g. emoji) are 1 code point but 2 UTF-16 code units,
 * causing the two index systems to diverge.
 */
function codePointToUtf16Offsets(str: string): number[] {
  const offsets: number[] = [];
  let u16 = 0;
  for (const ch of str) {
    offsets.push(u16);
    u16 += ch.length; // 1 for BMP, 2 for supplementary
  }
  offsets.push(u16); // sentinel
  return offsets;
}

/**
 * `extractTokens` returns tokens in the expression.
 */
export function extractTokens(formula: string): Array<Token> {
  const body = formula.slice(1); // skip '='
  const stream = CharStreams.fromString(body);
  const lexer = new FormulaLexer(stream);
  const tokenStream = new CommonTokenStream(lexer);
  lexer.removeErrorListeners();
  tokenStream.fill();

  // ANTLR token indices are code-point based; JS slice is UTF-16 based.
  // Build a mapping so gap-filling and returned start/stop use UTF-16.
  const cpOff = codePointToUtf16Offsets(body);

  const tokens: Array<Token> = [];
  for (const token of tokenStream.getTokens()) {
    if (token.type == FormulaLexer.EOF) {
      continue;
    }

    tokens.push({
      type: lexer.vocabulary.getSymbolicName(token.type) || 'STRING',
      start: cpOff[token.startIndex],
      stop: cpOff[token.stopIndex + 1] - 1,
      text: token.text!,
    });
  }

  const filledTokens: Array<Token> = [];
  let currToken: Token | undefined;
  for (const token of tokens) {
    if (!currToken && token.start > 0) {
      // Leading gap: space(s) between '=' and the first token
      filledTokens.push({
        type: 'STRING',
        start: 0,
        stop: token.start - 1,
        text: body.slice(0, token.start),
      });
    } else if (currToken && currToken.stop + 1 !== token.start) {
      filledTokens.push({
        type: 'STRING',
        start: currToken.stop + 1,
        stop: token.start - 1,
        text: body.slice(currToken.stop + 1, token.start),
      });
    }
    filledTokens.push(token);

    currToken = token;
  }

  if (currToken && currToken.stop + 1 < body.length) {
    filledTokens.push({
      type: 'STRING',
      start: currToken.stop + 1,
      stop: body.length - 1,
      text: body.slice(currToken.stop + 1),
    });
  }

  return filledTokens;
}

/**
 * `extractFormulaRanges` returns ranges referenced in the formula expression.
 * Each REFERENCE token is parsed into a Range (single refs become collapsed ranges).
 */
export function extractFormulaRanges(
  formula: string,
): Array<{ text: string; range: Range }> {
  const tokens = extractTokens(formula);
  const results: Array<{ text: string; range: Range }> = [];

  for (const token of tokens) {
    if (token.type !== 'REFERENCE') continue;

    try {
      const text = token.text.toUpperCase();
      // Skip cross-sheet refs — highlighting them locally doesn't make sense
      if (isCrossSheetRef(text)) continue;

      if (text.includes(':')) {
        results.push({ text, range: parseRange(text) });
      } else {
        const ref = parseRef(text);
        results.push({ text, range: [ref, ref] });
      }
    } catch {
      // Skip invalid references
    }
  }

  return results;
}

/**
 * `isReferenceInsertPosition` returns true when the cursor is at a position
 * in a formula where a cell reference can be inserted (e.g., after `=`, `(`,
 * `,`, or an operator). Also returns true if the cursor is within an existing
 * REFERENCE token (for replacement).
 *
 * @param formula - The full formula string including the leading `=`
 * @param cursorPos - The cursor position in the full formula string
 */
export function isReferenceInsertPosition(
  formula: string,
  cursorPos: number,
): boolean {
  if (!formula.startsWith('=')) return false;
  if (cursorPos <= 0) return false;

  // Cursor right after `=`
  if (cursorPos === 1) return true;

  const tokens = extractTokens(formula);

  // Check if cursor is within an existing REFERENCE token (for replacement)
  for (const token of tokens) {
    // Token positions are relative to post-`=` string, so add 1 for full string
    const tokenStart = token.start + 1;
    const tokenEnd = token.stop + 2; // stop is inclusive, +1 for post-`=` offset
    if (
      token.type === 'REFERENCE' &&
      cursorPos >= tokenStart &&
      cursorPos <= tokenEnd
    ) {
      return true;
    }
  }

  // Find the character before the cursor, skipping whitespace
  const beforeCursor = formula.slice(0, cursorPos);
  const trimmed = beforeCursor.trimEnd();
  if (trimmed.length === 0) return false;

  const lastChar = trimmed[trimmed.length - 1];
  const insertChars = new Set([
    '=',
    '(',
    ',',
    '+',
    '-',
    '*',
    '/',
    '<',
    '>',
    ':',
    '&',
  ]);
  return insertChars.has(lastChar);
}

/**
 * `findReferenceTokenAtCursor` returns the REFERENCE token at the given cursor
 * position, with start/end positions in the full formula string, or undefined
 * if the cursor is not on a reference.
 *
 * @param formula - The full formula string including the leading `=`
 * @param cursorPos - The cursor position in the full formula string
 */
export function findReferenceTokenAtCursor(
  formula: string,
  cursorPos: number,
): { start: number; end: number; text: string } | undefined {
  if (!formula.startsWith('=')) return undefined;

  const tokens = extractTokens(formula);
  for (const token of tokens) {
    if (token.type !== 'REFERENCE') continue;

    // Token positions are relative to post-`=` string, so add 1 for full string
    const tokenStart = token.start + 1;
    const tokenEnd = token.stop + 2; // stop is inclusive, +1 for offset
    if (cursorPos >= tokenStart && cursorPos <= tokenEnd) {
      return { start: tokenStart, end: tokenEnd, text: token.text };
    }
  }

  return undefined;
}

/**
 * `evaluate` returns the result of the expression.
 */
export function evaluate(formula: string, grid?: Grid): string {
  try {
    const parsed = parseExpression(formula);
    if (!parsed || hasSyntaxErrors(parsed)) {
      return '#ERROR!';
    }

    const evaluator = new Evaluator(grid);
    const node = evaluator.visit(parsed.tree);
    if (node.t === 'ref' && grid) {
      if (isSrng(node.v)) {
        return '#VALUE!';
      }
      return grid.get(node.v)?.v || '';
    }

    if (node.t === 'empty') {
      return '0';
    }

    if (node.t === 'arr') {
      const topLeft = node.v[0]?.[0];
      if (!topLeft || topLeft.t === 'empty') return '0';
      if (topLeft.t === 'arr' || topLeft.t === 'lambda') return '#VALUE!';
      return topLeft.v.toString();
    }

    if (node.t === 'lambda') {
      return '#ERROR!';
    }

    return node.v.toString();
  } catch (e) {
    return '#ERROR!';
  }
}

export type NumNode = { t: 'num'; v: number };
export type StrNode = { t: 'str'; v: string };
export type BoolNode = { t: 'bool'; v: boolean };
export type ErrNode = {
  t: 'err';
  v: '#VALUE!' | '#REF!' | '#N/A!' | '#ERROR!' | '#DIV/0!';
};
export type RefNode = { t: 'ref'; v: Reference };
export type EmptyNode = { t: 'empty' };
export type ArrNode = { t: 'arr'; v: EvalNode[][]; rows: number; cols: number };
export type LambdaNode = {
  t: 'lambda';
  params: string[];
  body: ParseTree;
  closureScope: Map<string, EvalNode>;
};

/**
 * `Result` represents the result of the evaluation.
 */
export type EvalNode =
  | NumNode
  | StrNode
  | BoolNode
  | RefNode
  | ErrNode
  | EmptyNode
  | ArrNode
  | LambdaNode;

/**
 * `Evaluator` class evaluates the formula. The grammar of the formula is defined in
 * `antlr/Formula.g4` file.
 */
class Evaluator implements FormulaVisitor<EvalNode> {
  private grid: Grid | undefined;
  private scope = new Map<string, EvalNode>();

  constructor(grid?: Grid) {
    this.visit = this.visit.bind(this);
    this.grid = grid;
  }

  visitChildren(): EvalNode {
    throw new Error('Method not implemented.');
  }
  visitTerminal(): EvalNode {
    throw new Error('Method not implemented.');
  }
  visitErrorNode(): EvalNode {
    throw new Error('Method not implemented.');
  }
  visitFormula(): EvalNode {
    throw new Error('Method not implemented.');
  }
  visitExpr(): EvalNode {
    throw new Error('Method not implemented.');
  }
  visitArgs(): EvalNode {
    throw new Error('Method not implemented.');
  }

  visit(tree: ParseTree): EvalNode {
    return tree.accept(this);
  }

  visitFunction(ctx: FunctionContext): EvalNode {
    const name = ctx.FUNCNAME().text.toUpperCase();

    if (name === 'LET') return this.evalLet(ctx);
    if (name === 'LAMBDA') return this.evalLambda(ctx);

    if (FunctionMap.has(name)) {
      const func = FunctionMap.get(name)!;
      return func(ctx, this.visit, this.grid);
    }

    const scopeVal = this.scope.get(name);
    if (scopeVal?.t === 'lambda') {
      return this.invokeLambda(scopeVal, ctx.args());
    }

    throw new Error('Function not implemented.');
  }

  visitReference(ctx: ReferenceContext): EvalNode {
    if (!this.grid) {
      return { t: 'err', v: '#REF!' };
    }

    return { t: 'ref', v: ctx.text.toUpperCase() };
  }

  visitParentheses(ctx: ParenthesesContext): EvalNode {
    return this.visit(ctx.expr());
  }

  visitNumber(ctx: NumberContext): EvalNode {
    return {
      t: 'num',
      v: Number(ctx.text),
    };
  }

  visitBoolean(ctx: BooleanContext): EvalNode {
    return {
      t: 'bool',
      v: ctx.text === 'TRUE' || ctx.text === 'true',
    };
  }

  visitAddSub(ctx: AddSubContext): EvalNode {
    const left = NumberArgs.map(this.visit(ctx.expr(0)), this.grid);
    if (left.t === 'err') {
      return left;
    }

    const right = NumberArgs.map(this.visit(ctx.expr(1)), this.grid);
    if (right.t === 'err') {
      return right;
    }

    if (ctx._op.type === FormulaParser.ADD) {
      return { t: 'num', v: left.v + right.v };
    }

    return { t: 'num', v: left.v - right.v };
  }

  visitMulDiv(ctx: MulDivContext): EvalNode {
    const left = NumberArgs.map(this.visit(ctx.expr(0)), this.grid);
    if (left.t === 'err') {
      return left;
    }

    const right = NumberArgs.map(this.visit(ctx.expr(1)), this.grid);
    if (right.t === 'err') {
      return right;
    }

    if (ctx._op.type === FormulaParser.MUL) {
      return { t: 'num', v: left.v * right.v };
    }

    if (right.v === 0) {
      return { t: 'err', v: '#DIV/0!' };
    }

    return { t: 'num', v: left.v / right.v };
  }

  visitConcat(ctx: ConcatContext): EvalNode {
    const left = StringArgs.map(this.visit(ctx.expr(0)), this.grid);
    if (left.t === 'err') {
      return left;
    }

    const right = StringArgs.map(this.visit(ctx.expr(1)), this.grid);
    if (right.t === 'err') {
      return right;
    }

    return { t: 'str', v: left.v + right.v };
  }

  visitComparison(ctx: ComparisonContext): EvalNode {
    const left = this.resolveValue(this.visit(ctx.expr(0)));
    if (left.t === 'err') {
      return left;
    }

    const right = this.resolveValue(this.visit(ctx.expr(1)));
    if (right.t === 'err') {
      return right;
    }

    const op = ctx._op.type;

    // Different types: EQ→false, NEQ→true, order: num < str < bool
    if (left.t !== right.t) {
      if (op === FormulaParser.EQ) return { t: 'bool', v: false };
      if (op === FormulaParser.NEQ) return { t: 'bool', v: true };

      const typeOrder = { num: 0, str: 1, bool: 2 };
      const diff =
        (typeOrder[left.t as keyof typeof typeOrder] ?? 0) -
        (typeOrder[right.t as keyof typeof typeOrder] ?? 0);
      return this.compareBool(op, diff);
    }

    // Same type comparison
    if (left.t === 'str' && right.t === 'str') {
      const cmp = left.v.localeCompare(right.v, undefined, {
        sensitivity: 'accent',
      });
      return this.compareBool(op, cmp);
    }

    if (left.t === 'bool' && right.t === 'bool') {
      const lv = left.v ? 1 : 0;
      const rv = right.v ? 1 : 0;
      return this.compareBool(op, lv - rv);
    }

    // Numbers (default)
    const lv = (left as NumNode).v;
    const rv = (right as NumNode).v;
    return this.compareBool(op, lv < rv ? -1 : lv > rv ? 1 : 0);
  }

  private resolveValue(node: EvalNode): EvalNode {
    if (node.t !== 'ref' || !this.grid) return node;
    if (isSrng(node.v)) return { t: 'err', v: '#VALUE!' };
    const val = this.grid.get(node.v)?.v || '';
    if (val === '') return { t: 'num', v: 0 };
    if (val === 'TRUE' || val === 'true') return { t: 'bool', v: true };
    if (val === 'FALSE' || val === 'false') return { t: 'bool', v: false };
    const num = Number(val);
    if (!isNaN(num)) return { t: 'num', v: num };
    return { t: 'str', v: val };
  }

  private compareBool(op: number, cmp: number): EvalNode {
    switch (op) {
      case FormulaParser.EQ:
        return { t: 'bool', v: cmp === 0 };
      case FormulaParser.NEQ:
        return { t: 'bool', v: cmp !== 0 };
      case FormulaParser.LT:
        return { t: 'bool', v: cmp < 0 };
      case FormulaParser.GT:
        return { t: 'bool', v: cmp > 0 };
      case FormulaParser.LTE:
        return { t: 'bool', v: cmp <= 0 };
      case FormulaParser.GTE:
        return { t: 'bool', v: cmp >= 0 };
      default:
        return { t: 'err', v: '#ERROR!' };
    }
  }

  visitUnarySign(ctx: UnarySignContext): EvalNode {
    const operand = NumberArgs.map(this.visit(ctx.expr()), this.grid);
    if (operand.t === 'err') {
      return operand;
    }

    if (ctx._op.type === FormulaParser.SUB) {
      return { t: 'num', v: -operand.v };
    }

    return operand;
  }

  visitArrayLiteral(ctx: ArrayLiteralContext): EvalNode {
    const rows: EvalNode[][] = [];
    for (const row of ctx.arrayRow()) {
      const cells: EvalNode[] = [];
      for (const expr of row.expr()) {
        cells.push(this.visit(expr));
      }
      rows.push(cells);
    }
    const cols = rows.reduce((max, r) => Math.max(max, r.length), 0);
    return { t: 'arr', v: rows, rows: rows.length, cols };
  }

  visitIdentifier(ctx: IdentifierContext): EvalNode {
    const name = ctx.FUNCNAME().text.toUpperCase();
    const val = this.scope.get(name);
    if (val !== undefined) return val;
    return { t: 'err', v: '#ERROR!' };
  }

  visitCall(ctx: CallContext): EvalNode {
    const callee = this.visit(ctx.expr());

    if (callee.t === 'bool' && !ctx.args()) {
      return callee;
    }

    if (callee.t !== 'lambda') {
      return { t: 'err', v: '#ERROR!' };
    }
    return this.invokeLambda(callee, ctx.args());
  }

  private evalLet(ctx: FunctionContext): EvalNode {
    const args = ctx.args();
    if (!args) return { t: 'err', v: '#ERROR!' };

    const exprs = args.expr();
    if (exprs.length < 3 || exprs.length % 2 === 0) {
      return { t: 'err', v: '#ERROR!' };
    }

    const savedScope = new Map(this.scope);
    for (let i = 0; i < exprs.length - 1; i += 2) {
      const nameExpr = exprs[i];
      if (!(nameExpr instanceof IdentifierContext)) {
        this.scope = savedScope;
        return { t: 'err', v: '#ERROR!' };
      }
      const name = nameExpr.FUNCNAME().text.toUpperCase();
      this.scope.set(name, this.visit(exprs[i + 1]));
    }

    const result = this.visit(exprs[exprs.length - 1]);
    this.scope = savedScope;
    return result;
  }

  private evalLambda(ctx: FunctionContext): EvalNode {
    const args = ctx.args();
    if (!args) return { t: 'err', v: '#ERROR!' };

    const exprs = args.expr();
    if (exprs.length < 2) return { t: 'err', v: '#ERROR!' };

    const params: string[] = [];
    for (let i = 0; i < exprs.length - 1; i++) {
      if (!(exprs[i] instanceof IdentifierContext)) {
        return { t: 'err', v: '#ERROR!' };
      }
      params.push(
        (exprs[i] as IdentifierContext).FUNCNAME().text.toUpperCase(),
      );
    }

    return {
      t: 'lambda',
      params,
      body: exprs[exprs.length - 1],
      closureScope: new Map(this.scope),
    };
  }

  private invokeLambda(
    lambda: LambdaNode,
    argsCtx: ArgsContext | undefined,
  ): EvalNode {
    const argExprs = argsCtx?.expr() || [];
    if (argExprs.length !== lambda.params.length) {
      return { t: 'err', v: '#ERROR!' };
    }

    const argValues = argExprs.map((e) => this.visit(e));
    const savedScope = new Map(this.scope);
    this.scope = new Map(lambda.closureScope);
    for (let i = 0; i < lambda.params.length; i++) {
      this.scope.set(lambda.params[i], argValues[i]);
    }

    const result = this.visit(lambda.body);
    this.scope = savedScope;
    return result;
  }

  visitStr(ctx: StrContext): EvalNode {
    const text = ctx.text;
    return { t: 'str', v: text.slice(1, -1).replace(/""/g, '"') };
  }
}
