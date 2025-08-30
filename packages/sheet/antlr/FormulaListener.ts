// @ts-nocheck
// Generated from antlr/Formula.g4 by ANTLR 4.9.0-SNAPSHOT

import { ParseTreeListener } from 'antlr4ts/tree/ParseTreeListener';

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
 * This interface defines a complete listener for a parse tree produced by
 * `FormulaParser`.
 */
export interface FormulaListener extends ParseTreeListener {
  /**
   * Enter a parse tree produced by the `Function`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   */
  enterFunction?: (ctx: FunctionContext) => void;
  /**
   * Exit a parse tree produced by the `Function`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   */
  exitFunction?: (ctx: FunctionContext) => void;

  /**
   * Enter a parse tree produced by the `MulDiv`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   */
  enterMulDiv?: (ctx: MulDivContext) => void;
  /**
   * Exit a parse tree produced by the `MulDiv`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   */
  exitMulDiv?: (ctx: MulDivContext) => void;

  /**
   * Enter a parse tree produced by the `AddSub`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   */
  enterAddSub?: (ctx: AddSubContext) => void;
  /**
   * Exit a parse tree produced by the `AddSub`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   */
  exitAddSub?: (ctx: AddSubContext) => void;

  /**
   * Enter a parse tree produced by the `Number`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   */
  enterNumber?: (ctx: NumberContext) => void;
  /**
   * Exit a parse tree produced by the `Number`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   */
  exitNumber?: (ctx: NumberContext) => void;

  /**
   * Enter a parse tree produced by the `Boolean`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   */
  enterBoolean?: (ctx: BooleanContext) => void;
  /**
   * Exit a parse tree produced by the `Boolean`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   */
  exitBoolean?: (ctx: BooleanContext) => void;

  /**
   * Enter a parse tree produced by the `Reference`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   */
  enterReference?: (ctx: ReferenceContext) => void;
  /**
   * Exit a parse tree produced by the `Reference`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   */
  exitReference?: (ctx: ReferenceContext) => void;

  /**
   * Enter a parse tree produced by the `Parentheses`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   */
  enterParentheses?: (ctx: ParenthesesContext) => void;
  /**
   * Exit a parse tree produced by the `Parentheses`
   * labeled alternative in `FormulaParser.expr`.
   * @param ctx the parse tree
   */
  exitParentheses?: (ctx: ParenthesesContext) => void;

  /**
   * Enter a parse tree produced by `FormulaParser.formula`.
   * @param ctx the parse tree
   */
  enterFormula?: (ctx: FormulaContext) => void;
  /**
   * Exit a parse tree produced by `FormulaParser.formula`.
   * @param ctx the parse tree
   */
  exitFormula?: (ctx: FormulaContext) => void;

  /**
   * Enter a parse tree produced by `FormulaParser.expr`.
   * @param ctx the parse tree
   */
  enterExpr?: (ctx: ExprContext) => void;
  /**
   * Exit a parse tree produced by `FormulaParser.expr`.
   * @param ctx the parse tree
   */
  exitExpr?: (ctx: ExprContext) => void;

  /**
   * Enter a parse tree produced by `FormulaParser.args`.
   * @param ctx the parse tree
   */
  enterArgs?: (ctx: ArgsContext) => void;
  /**
   * Exit a parse tree produced by `FormulaParser.args`.
   * @param ctx the parse tree
   */
  exitArgs?: (ctx: ArgsContext) => void;
}
