// @ts-nocheck
// Generated from antlr/Formula.g4 by ANTLR 4.9.0-SNAPSHOT

import { ParseTreeVisitor } from 'antlr4ts/tree/ParseTreeVisitor';

import { FunctionContext } from './FormulaParser';
import { MulDivContext } from './FormulaParser';
import { AddSubContext } from './FormulaParser';
import { NumberContext } from './FormulaParser';
import { BooleanContext } from './FormulaParser';
import { ReferenceContext } from './FormulaParser';
import { ParenthesesContext } from './FormulaParser';
import { FormulaContext } from './FormulaParser';
import { ExprContext } from './FormulaParser';
import { ArgsContext } from './FormulaParser';

/**
 * This interface defines a complete generic visitor for a parse tree produced
 * by `FormulaParser`.
 *
 * @param <Result> The return type of the visit operation. Use `void` for
 * operations with no return type.
 */
export interface FormulaVisitor<Result> extends ParseTreeVisitor<Result> {
  /**
   * Visit a parse tree produced by the `Function`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitFunction?: (ctx: FunctionContext) => Result;

  /**
   * Visit a parse tree produced by the `MulDiv`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitMulDiv?: (ctx: MulDivContext) => Result;

  /**
   * Visit a parse tree produced by the `AddSub`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitAddSub?: (ctx: AddSubContext) => Result;

  /**
   * Visit a parse tree produced by the `Number`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitNumber?: (ctx: NumberContext) => Result;

  /**
   * Visit a parse tree produced by the `Boolean`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitBoolean?: (ctx: BooleanContext) => Result;

  /**
   * Visit a parse tree produced by the `Reference`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitReference?: (ctx: ReferenceContext) => Result;

  /**
   * Visit a parse tree produced by the `Parentheses`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitParentheses?: (ctx: ParenthesesContext) => Result;

  /**
   * Visit a parse tree produced by `FormulaParser.formula`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitFormula?: (ctx: FormulaContext) => Result;

  /**
   * Visit a parse tree produced by `FormulaParser.expr`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitExpr?: (ctx: ExprContext) => Result;

  /**
   * Visit a parse tree produced by `FormulaParser.args`.
   * @param ctx the parse tree
   * @return the visitor result
   */
  visitArgs?: (ctx: ArgsContext) => Result;
}
