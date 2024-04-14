import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { FormulaLexer } from '../../antlr/FormulaLexer';
import { FormulaVisitor } from '../../antlr/FormulaVisitor';
import {
  AddSubContext,
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
import { parseReference } from '../sheet/coordinates';

/**
 * `evaluate` returns the result of the expression.
 */
export function evaluate(expression: string, sheet?: Sheet): number {
  const stream = CharStreams.fromString(expression);
  const lexer = new FormulaLexer(stream);
  const tokens = new CommonTokenStream(lexer);
  const parser = new FormulaParser(tokens);

  // TODO(hackerwins): Return #VALUE! if there is a syntax error.
  const tree = parser.expr();
  const evaluator = new Evaluator(sheet);
  return evaluator.visit(tree);
}

class Evaluator implements FormulaVisitor<number> {
  private sheet: Sheet | undefined;

  constructor(sheet?: Sheet) {
    this.visit = this.visit.bind(this);
    this.sheet = sheet;
  }

  visitChildren(): number {
    throw new Error('Method not implemented.');
  }
  visitTerminal(): number {
    throw new Error('Method not implemented.');
  }
  visitErrorNode(): number {
    throw new Error('Method not implemented.');
  }
  visitFormula(): number {
    throw new Error('Method not implemented.');
  }
  visitExpr(): number {
    throw new Error('Method not implemented.');
  }
  visitArgs(): number {
    throw new Error('Method not implemented.');
  }

  visit(tree: ParseTree): number {
    return tree.accept(this);
  }

  visitFunction(ctx: FunctionContext): number {
    const name = ctx.FUNCNAME().text.toUpperCase();
    if (FunctionMap.has(name)) {
      const func = FunctionMap.get(name)!;
      return func(ctx, this.visit);
    }

    throw new Error('Function not implemented.');
  }

  visitReference(ctx: ReferenceContext): number {
    // TODO(hackerwins): Reteurn #REF! if sheet or cell not found.
    if (!this.sheet) {
      throw new Error('Sheet not found.');
    }

    const cellIndex = parseReference(ctx.text);
    const displayValue = this.sheet.toDisplayString(cellIndex);
    return parseInt(displayValue);
  }

  visitParentheses(ctx: ParenthesesContext) {
    return this.visit(ctx.expr());
  }

  visitNumber(ctx: NumberContext): number {
    return parseInt(ctx.text);
  }

  visitAddSub(ctx: AddSubContext): number {
    const left = this.visit(ctx.expr(0));
    const right = this.visit(ctx.expr(1));
    if (ctx._op.type === FormulaParser.ADD) {
      return left + right;
    } else {
      return left - right;
    }
  }

  visitMulDiv(ctx: MulDivContext): number {
    const left = this.visit(ctx.expr(0));
    const right = this.visit(ctx.expr(1));
    if (ctx._op.type === FormulaParser.MUL) {
      return left * right;
    } else {
      return left / right;
    }
  }
}
