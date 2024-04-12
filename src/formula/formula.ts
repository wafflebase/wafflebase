import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { FormulaLexer } from '../../antlr/FormulaLexer';
import { FormulaVisitor } from '../../antlr/FormulaVisitor';
import {
  AddSubContext,
  ArgsContext,
  ExprContext,
  FormulaParser,
  FunctionContext,
  FormulaContext,
  MulDivContext,
  NumberContext,
  ParenthesesContext,
  ReferenceContext,
} from '../../antlr/FormulaParser';
import { ParseTree } from 'antlr4ts/tree/ParseTree';

class Evaluator implements FormulaVisitor<number> {
  visitChildren(): number {
    throw new Error('Method not implemented.');
  }
  visitTerminal(): number {
    throw new Error('Method not implemented.');
  }
  visitErrorNode(): number {
    throw new Error('Method not implemented.');
  }
  visitFunction?: ((ctx: FunctionContext) => number) | undefined;
  visitReference?: ((ctx: ReferenceContext) => number) | undefined;
  visitFormula?: ((ctx: FormulaContext) => number) | undefined;
  visitExpr?: ((ctx: ExprContext) => number) | undefined;
  visitArgs?: ((ctx: ArgsContext) => number) | undefined;

  visit(tree: ParseTree): number {
    return tree.accept(this);
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

/**
 * `evaluate` returns the result of the expression.
 */
export function evaluate(expression: string): number {
  const stream = CharStreams.fromString(expression);
  const lexer = new FormulaLexer(stream);
  const tokens = new CommonTokenStream(lexer);
  const parser = new FormulaParser(tokens);

  const tree = parser.expr();
  const evaluator = new Evaluator();
  return evaluator.visit(tree);
}
