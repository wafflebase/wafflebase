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
import { Reference } from '../sheet/types';
import { NumberArgs } from './arguments';

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
    const tree = parser.expr();
    const evaluator = new Evaluator(sheet);
    lexer.removeErrorListeners();
    parser.removeErrorListeners();

    const node = evaluator.visit(tree);
    if (node.t === 'ref' && sheet) {
      return sheet.toDisplayString(node.v);
    }

    return node.v.toString();
  } catch (e) {
    return '#ERROR!';
  }
}

export type NumNode = { t: 'num'; v: number };
export type StrNode = { t: 'str'; v: string };
export type BoolNode = { t: 'bool'; v: boolean };
export type ErrNode = { t: 'err'; v: string };
export type RefNode = { t: 'ref'; v: Reference };

/**
 * `Result` represents the result of the evaluation.
 */
export type EvalNode = NumNode | StrNode | BoolNode | RefNode | ErrNode;

/**
 * `Evaluator` class evaluates the formula. The grammar of the formula is defined in
 * `antlr/Formula.g4` file.
 */
class Evaluator implements FormulaVisitor<EvalNode> {
  private sheet: Sheet | undefined;

  constructor(sheet?: Sheet) {
    this.visit = this.visit.bind(this);
    this.sheet = sheet;
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
    if (FunctionMap.has(name)) {
      const func = FunctionMap.get(name)!;
      return func(ctx, this.visit, this.sheet);
    }

    throw new Error('Function not implemented.');
  }

  visitReference(ctx: ReferenceContext): EvalNode {
    if (!this.sheet) {
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
    const left = NumberArgs.map(this.visit(ctx.expr(0)), this.sheet);
    const right = NumberArgs.map(this.visit(ctx.expr(1)), this.sheet);
    if (ctx._op.type === FormulaParser.ADD) {
      return { t: 'num', v: left.v + right.v };
    }

    return { t: 'num', v: left.v - right.v };
  }

  visitMulDiv(ctx: MulDivContext): EvalNode {
    const left = NumberArgs.map(this.visit(ctx.expr(0)), this.sheet);
    const right = NumberArgs.map(this.visit(ctx.expr(1)), this.sheet);
    if (ctx._op.type === FormulaParser.MUL) {
      return { t: 'num', v: left.v * right.v };
    }

    return { t: 'num', v: left.v / right.v };
  }
}
