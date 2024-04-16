import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { FormulaLexer } from '../../antlr/FormulaLexer';
import { FormulaVisitor } from '../../antlr/FormulaVisitor';
import {
  AddSubContext,
  BooleanContext,
  FormulaParser,
  FunctionContext,
  MulDivContext,
  NumberContext,
  ParenthesesContext,
  ReferenceContext,
} from '../../antlr/FormulaParser';
import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionMap } from './functions';
import { Sheet } from '../sheet/sheet';
import { parseRef, isRangeRef } from '../sheet/coordinates';
import { Reference } from '../sheet/types';
import { NumberArgs } from './arguments';

/**
 * `extractReferences` returns references in the expression.
 */
export function extractReferences(formula: string): Set<Reference> {
  const stream = CharStreams.fromString(formula.slice(1));
  const lexer = new FormulaLexer(stream);
  const tokens = new CommonTokenStream(lexer);
  tokens.fill();

  const references = new Set<Reference>();
  for (const token of tokens.getTokens()) {
    if (token.type === FormulaParser.REFERENCE) {
      references.add(token.text!);
    }
  }

  return references;
}

/**
 * `evaluate` returns the result of the expression.
 */
export function evaluate(formula: string, sheet?: Sheet): string {
  try {
    const stream = CharStreams.fromString(formula.slice(1));
    const lexer = new FormulaLexer(stream);
    const tokens = new CommonTokenStream(lexer);
    const parser = new FormulaParser(tokens);
    parser.removeErrorListeners();

    // TODO(hackerwins): Return #VALUE! if there is a syntax error.
    const tree = parser.expr();
    const evaluator = new Evaluator(sheet);
    return evaluator.visit(tree).v.toString();
  } catch (e) {
    return '#ERROR!';
  }
}

export type NumberResult = { t: 'number'; v: number };
export type StringResult = { t: 'string'; v: string };
export type BooleanResult = { t: 'boolean'; v: boolean };
export type ErrorResult = { t: 'error'; v: string };

/**
 * `Result` represents the result of the evaluation.
 */
export type EvaluationResult =
  | NumberResult
  | StringResult
  | BooleanResult
  | ErrorResult;

/**
 * `Evaluator` class evaluates the formula. The grammar of the formula is defined in
 * `antlr/Formula.g4` file.
 */
class Evaluator implements FormulaVisitor<EvaluationResult> {
  private sheet: Sheet | undefined;

  constructor(sheet?: Sheet) {
    this.visit = this.visit.bind(this);
    this.sheet = sheet;
  }

  visitChildren(): EvaluationResult {
    throw new Error('Method not implemented.');
  }
  visitTerminal(): EvaluationResult {
    throw new Error('Method not implemented.');
  }
  visitErrorNode(): EvaluationResult {
    throw new Error('Method not implemented.');
  }
  visitFormula(): EvaluationResult {
    throw new Error('Method not implemented.');
  }
  visitExpr(): EvaluationResult {
    throw new Error('Method not implemented.');
  }
  visitArgs(): EvaluationResult {
    throw new Error('Method not implemented.');
  }

  visit(tree: ParseTree): EvaluationResult {
    return tree.accept(this);
  }

  visitFunction(ctx: FunctionContext): EvaluationResult {
    const name = ctx.FUNCNAME().text.toUpperCase();
    if (FunctionMap.has(name)) {
      const func = FunctionMap.get(name)!;
      return func(ctx, this.visit);
    }

    throw new Error('Function not implemented.');
  }

  visitReference(ctx: ReferenceContext): EvaluationResult {
    if (!this.sheet) {
      return { t: 'error', v: '#REF!' };
    }

    // TODO(hackerwins): Decompose RefRange.
    if (isRangeRef(ctx.text)) {
      throw new Error('RangeRef not implemented.');
    }

    const value = this.sheet.toDisplayString(parseRef(ctx.text));
    return NumberArgs.map({ t: 'string', v: value });
  }

  visitParentheses(ctx: ParenthesesContext): EvaluationResult {
    return this.visit(ctx.expr());
  }

  visitNumber(ctx: NumberContext): EvaluationResult {
    return {
      t: 'number',
      v: Number(ctx.text),
    };
  }

  visitBoolean(ctx: BooleanContext): EvaluationResult {
    return {
      t: 'boolean',
      v: ctx.text === 'TRUE' || ctx.text === 'true',
    };
  }

  visitAddSub(ctx: AddSubContext): EvaluationResult {
    const left = NumberArgs.map(this.visit(ctx.expr(0)));
    const right = NumberArgs.map(this.visit(ctx.expr(1)));

    if (ctx._op.type === FormulaParser.ADD) {
      return { t: 'number', v: left.v + right.v };
    }

    return { t: 'number', v: left.v - right.v };
  }

  visitMulDiv(ctx: MulDivContext): EvaluationResult {
    const left = NumberArgs.map(this.visit(ctx.expr(0)));
    const right = NumberArgs.map(this.visit(ctx.expr(1)));

    if (ctx._op.type === FormulaParser.MUL) {
      return { t: 'number', v: left.v * right.v };
    }

    return { t: 'number', v: left.v / right.v };
  }
}
