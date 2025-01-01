import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { ParseTree } from 'antlr4ts/tree/ParseTree';
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
import { FunctionMap } from './functions';
import { Grid, Reference } from '../worksheet/types';
import { NumberArgs } from './arguments';
import { isSrng } from '../worksheet/coordinates';

/**
 * `Token` represents a token in the formula.
 */
export type Token = {
  type: string;
  start: number;
  stop: number;
  text: string;
};

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
 * `extractTokens` returns tokens in the expression.
 */
export function extractTokens(formula: string): Array<Token> {
  const stream = CharStreams.fromString(formula.slice(1));
  const lexer = new FormulaLexer(stream);
  const tokenStream = new CommonTokenStream(lexer);
  lexer.removeErrorListeners();
  tokenStream.fill();

  const tokens: Array<Token> = [];
  for (const token of tokenStream.getTokens()) {
    tokens.push({
      type:
        token.type === -1
          ? 'EOF'
          : lexer.vocabulary.getSymbolicName(token.type)!,
      start: token.startIndex,
      stop: token.stopIndex,
      text: token.text!,
    });
  }

  return tokens;
}

/**
 * `evaluate` returns the result of the expression.
 */
export function evaluate(formula: string, grid?: Grid): string {
  try {
    const stream = CharStreams.fromString(formula.slice(1));
    const lexer = new FormulaLexer(stream);
    const tokens = new CommonTokenStream(lexer);
    const parser = new FormulaParser(tokens);
    const tree = parser.expr();
    const evaluator = new Evaluator(grid);
    lexer.removeErrorListeners();
    parser.removeErrorListeners();

    const node = evaluator.visit(tree);
    if (node.t === 'ref' && grid) {
      if (isSrng(node.v)) {
        return '#VALUE!';
      }
      return grid.get(node.v)?.v || '';
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
  v: '#VALUE!' | '#REF!' | '#N/A!' | '#ERROR!';
};
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
  private grid: Grid | undefined;

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
    if (FunctionMap.has(name)) {
      const func = FunctionMap.get(name)!;
      return func(ctx, this.visit, this.grid);
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

    return { t: 'num', v: left.v / right.v };
  }
}
