// @ts-nocheck
// Generated from antlr/Formula.g4 by ANTLR 4.9.0-SNAPSHOT


import { ATN } from "antlr4ts/atn/ATN";
import { ATNDeserializer } from "antlr4ts/atn/ATNDeserializer";
import { FailedPredicateException } from "antlr4ts/FailedPredicateException";
import { NotNull } from "antlr4ts/Decorators";
import { NoViableAltException } from "antlr4ts/NoViableAltException";
import { Override } from "antlr4ts/Decorators";
import { Parser } from "antlr4ts/Parser";
import { ParserRuleContext } from "antlr4ts/ParserRuleContext";
import { ParserATNSimulator } from "antlr4ts/atn/ParserATNSimulator";
import { ParseTreeListener } from "antlr4ts/tree/ParseTreeListener";
import { ParseTreeVisitor } from "antlr4ts/tree/ParseTreeVisitor";
import { RecognitionException } from "antlr4ts/RecognitionException";
import { RuleContext } from "antlr4ts/RuleContext";
//import { RuleVersion } from "antlr4ts/RuleVersion";
import { TerminalNode } from "antlr4ts/tree/TerminalNode";
import { Token } from "antlr4ts/Token";
import { TokenStream } from "antlr4ts/TokenStream";
import { Vocabulary } from "antlr4ts/Vocabulary";
import { VocabularyImpl } from "antlr4ts/VocabularyImpl";

import * as Utils from "antlr4ts/misc/Utils";

import { FormulaListener } from "./FormulaListener";
import { FormulaVisitor } from "./FormulaVisitor";


export class FormulaParser extends Parser {
	public static readonly T__0 = 1;
	public static readonly T__1 = 2;
	public static readonly T__2 = 3;
	public static readonly REFERENCE = 4;
	public static readonly REF = 5;
	public static readonly REFRANGE = 6;
	public static readonly BOOL = 7;
	public static readonly STRING = 8;
	public static readonly NUM = 9;
	public static readonly FUNCNAME = 10;
	public static readonly WS = 11;
	public static readonly MUL = 12;
	public static readonly DIV = 13;
	public static readonly ADD = 14;
	public static readonly SUB = 15;
	public static readonly EQ = 16;
	public static readonly NEQ = 17;
	public static readonly LTE = 18;
	public static readonly GTE = 19;
	public static readonly LT = 20;
	public static readonly GT = 21;
	public static readonly RULE_formula = 0;
	public static readonly RULE_expr = 1;
	public static readonly RULE_args = 2;
	// tslint:disable:no-trailing-whitespace
	public static readonly ruleNames: string[] = [
		"formula", "expr", "args",
	];

	private static readonly _LITERAL_NAMES: Array<string | undefined> = [
		undefined, "'('", "')'", "','", undefined, undefined, undefined, undefined, 
		undefined, undefined, undefined, undefined, "'*'", "'/'", "'+'", "'-'", 
		"'='", "'<>'", "'<='", "'>='", "'<'", "'>'",
	];
	private static readonly _SYMBOLIC_NAMES: Array<string | undefined> = [
		undefined, undefined, undefined, undefined, "REFERENCE", "REF", "REFRANGE", 
		"BOOL", "STRING", "NUM", "FUNCNAME", "WS", "MUL", "DIV", "ADD", "SUB", 
		"EQ", "NEQ", "LTE", "GTE", "LT", "GT",
	];
	public static readonly VOCABULARY: Vocabulary = new VocabularyImpl(FormulaParser._LITERAL_NAMES, FormulaParser._SYMBOLIC_NAMES, []);

	// @Override
	// @NotNull
	public get vocabulary(): Vocabulary {
		return FormulaParser.VOCABULARY;
	}
	// tslint:enable:no-trailing-whitespace

	// @Override
	public get grammarFileName(): string { return "Formula.g4"; }

	// @Override
	public get ruleNames(): string[] { return FormulaParser.ruleNames; }

	// @Override
	public get serializedATN(): string { return FormulaParser._serializedATN; }

	protected createFailedPredicateException(predicate?: string, message?: string): FailedPredicateException {
		return new FailedPredicateException(this, predicate, message);
	}

	constructor(input: TokenStream) {
		super(input);
		this._interp = new ParserATNSimulator(FormulaParser._ATN, this);
	}
	// @RuleVersion(0)
	public formula(): FormulaContext {
		let _localctx: FormulaContext = new FormulaContext(this._ctx, this.state);
		this.enterRule(_localctx, 0, FormulaParser.RULE_formula);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 7;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			do {
				{
				{
				this.state = 6;
				this.expr(0);
				}
				}
				this.state = 9;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			} while ((((_la) & ~0x1F) === 0 && ((1 << _la) & ((1 << FormulaParser.T__0) | (1 << FormulaParser.REFERENCE) | (1 << FormulaParser.BOOL) | (1 << FormulaParser.STRING) | (1 << FormulaParser.NUM) | (1 << FormulaParser.FUNCNAME))) !== 0));
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}

	public expr(): ExprContext;
	public expr(_p: number): ExprContext;
	// @RuleVersion(0)
	public expr(_p?: number): ExprContext {
		if (_p === undefined) {
			_p = 0;
		}

		let _parentctx: ParserRuleContext = this._ctx;
		let _parentState: number = this.state;
		let _localctx: ExprContext = new ExprContext(this._ctx, _parentState);
		let _prevctx: ExprContext = _localctx;
		let _startState: number = 2;
		this.enterRecursionRule(_localctx, 2, FormulaParser.RULE_expr, _p);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 26;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case FormulaParser.FUNCNAME:
				{
				_localctx = new FunctionContext(_localctx);
				this._ctx = _localctx;
				_prevctx = _localctx;

				this.state = 12;
				this.match(FormulaParser.FUNCNAME);
				this.state = 13;
				this.match(FormulaParser.T__0);
				this.state = 15;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if ((((_la) & ~0x1F) === 0 && ((1 << _la) & ((1 << FormulaParser.T__0) | (1 << FormulaParser.REFERENCE) | (1 << FormulaParser.BOOL) | (1 << FormulaParser.STRING) | (1 << FormulaParser.NUM) | (1 << FormulaParser.FUNCNAME))) !== 0)) {
					{
					this.state = 14;
					this.args();
					}
				}

				this.state = 17;
				this.match(FormulaParser.T__1);
				}
				break;
			case FormulaParser.NUM:
				{
				_localctx = new NumberContext(_localctx);
				this._ctx = _localctx;
				_prevctx = _localctx;
				this.state = 18;
				this.match(FormulaParser.NUM);
				}
				break;
			case FormulaParser.BOOL:
				{
				_localctx = new BooleanContext(_localctx);
				this._ctx = _localctx;
				_prevctx = _localctx;
				this.state = 19;
				this.match(FormulaParser.BOOL);
				}
				break;
			case FormulaParser.STRING:
				{
				_localctx = new StrContext(_localctx);
				this._ctx = _localctx;
				_prevctx = _localctx;
				this.state = 20;
				this.match(FormulaParser.STRING);
				}
				break;
			case FormulaParser.REFERENCE:
				{
				_localctx = new ReferenceContext(_localctx);
				this._ctx = _localctx;
				_prevctx = _localctx;
				this.state = 21;
				this.match(FormulaParser.REFERENCE);
				}
				break;
			case FormulaParser.T__0:
				{
				_localctx = new ParenthesesContext(_localctx);
				this._ctx = _localctx;
				_prevctx = _localctx;
				this.state = 22;
				this.match(FormulaParser.T__0);
				this.state = 23;
				this.expr(0);
				this.state = 24;
				this.match(FormulaParser.T__1);
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
			this._ctx._stop = this._input.tryLT(-1);
			this.state = 39;
			this._errHandler.sync(this);
			_alt = this.interpreter.adaptivePredict(this._input, 4, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					if (this._parseListeners != null) {
						this.triggerExitRuleEvent();
					}
					_prevctx = _localctx;
					{
					this.state = 37;
					this._errHandler.sync(this);
					switch ( this.interpreter.adaptivePredict(this._input, 3, this._ctx) ) {
					case 1:
						{
						_localctx = new MulDivContext(new ExprContext(_parentctx, _parentState));
						this.pushNewRecursionContext(_localctx, _startState, FormulaParser.RULE_expr);
						this.state = 28;
						if (!(this.precpred(this._ctx, 8))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 8)");
						}
						this.state = 29;
						(_localctx as MulDivContext)._op = this._input.LT(1);
						_la = this._input.LA(1);
						if (!(_la === FormulaParser.MUL || _la === FormulaParser.DIV)) {
							(_localctx as MulDivContext)._op = this._errHandler.recoverInline(this);
						} else {
							if (this._input.LA(1) === Token.EOF) {
								this.matchedEOF = true;
							}

							this._errHandler.reportMatch(this);
							this.consume();
						}
						this.state = 30;
						this.expr(9);
						}
						break;

					case 2:
						{
						_localctx = new AddSubContext(new ExprContext(_parentctx, _parentState));
						this.pushNewRecursionContext(_localctx, _startState, FormulaParser.RULE_expr);
						this.state = 31;
						if (!(this.precpred(this._ctx, 7))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 7)");
						}
						this.state = 32;
						(_localctx as AddSubContext)._op = this._input.LT(1);
						_la = this._input.LA(1);
						if (!(_la === FormulaParser.ADD || _la === FormulaParser.SUB)) {
							(_localctx as AddSubContext)._op = this._errHandler.recoverInline(this);
						} else {
							if (this._input.LA(1) === Token.EOF) {
								this.matchedEOF = true;
							}

							this._errHandler.reportMatch(this);
							this.consume();
						}
						this.state = 33;
						this.expr(8);
						}
						break;

					case 3:
						{
						_localctx = new ComparisonContext(new ExprContext(_parentctx, _parentState));
						this.pushNewRecursionContext(_localctx, _startState, FormulaParser.RULE_expr);
						this.state = 34;
						if (!(this.precpred(this._ctx, 6))) {
							throw this.createFailedPredicateException("this.precpred(this._ctx, 6)");
						}
						this.state = 35;
						(_localctx as ComparisonContext)._op = this._input.LT(1);
						_la = this._input.LA(1);
						if (!((((_la) & ~0x1F) === 0 && ((1 << _la) & ((1 << FormulaParser.EQ) | (1 << FormulaParser.NEQ) | (1 << FormulaParser.LTE) | (1 << FormulaParser.GTE) | (1 << FormulaParser.LT) | (1 << FormulaParser.GT))) !== 0))) {
							(_localctx as ComparisonContext)._op = this._errHandler.recoverInline(this);
						} else {
							if (this._input.LA(1) === Token.EOF) {
								this.matchedEOF = true;
							}

							this._errHandler.reportMatch(this);
							this.consume();
						}
						this.state = 36;
						this.expr(7);
						}
						break;
					}
					}
				}
				this.state = 41;
				this._errHandler.sync(this);
				_alt = this.interpreter.adaptivePredict(this._input, 4, this._ctx);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.unrollRecursionContexts(_parentctx);
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public args(): ArgsContext {
		let _localctx: ArgsContext = new ArgsContext(this._ctx, this.state);
		this.enterRule(_localctx, 4, FormulaParser.RULE_args);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 42;
			this.expr(0);
			this.state = 47;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la === FormulaParser.T__2) {
				{
				{
				this.state = 43;
				this.match(FormulaParser.T__2);
				this.state = 44;
				this.expr(0);
				}
				}
				this.state = 49;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}

	public sempred(_localctx: RuleContext, ruleIndex: number, predIndex: number): boolean {
		switch (ruleIndex) {
		case 1:
			return this.expr_sempred(_localctx as ExprContext, predIndex);
		}
		return true;
	}
	private expr_sempred(_localctx: ExprContext, predIndex: number): boolean {
		switch (predIndex) {
		case 0:
			return this.precpred(this._ctx, 8);

		case 1:
			return this.precpred(this._ctx, 7);

		case 2:
			return this.precpred(this._ctx, 6);
		}
		return true;
	}

	public static readonly _serializedATN: string =
		"\x03\uC91D\uCABA\u058D\uAFBA\u4F53\u0607\uEA8B\uC241\x03\x175\x04\x02" +
		"\t\x02\x04\x03\t\x03\x04\x04\t\x04\x03\x02\x06\x02\n\n\x02\r\x02\x0E\x02" +
		"\v\x03\x03\x03\x03\x03\x03\x03\x03\x05\x03\x12\n\x03\x03\x03\x03\x03\x03" +
		"\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x05\x03\x1D\n\x03" +
		"\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03" +
		"\x07\x03(\n\x03\f\x03\x0E\x03+\v\x03\x03\x04\x03\x04\x03\x04\x07\x040" +
		"\n\x04\f\x04\x0E\x043\v\x04\x03\x04\x02\x02\x03\x04\x05\x02\x02\x04\x02" +
		"\x06\x02\x02\x05\x03\x02\x0E\x0F\x03\x02\x10\x11\x03\x02\x12\x17\x02<" +
		"\x02\t\x03\x02\x02\x02\x04\x1C\x03\x02\x02\x02\x06,\x03\x02\x02\x02\b" +
		"\n\x05\x04\x03\x02\t\b\x03\x02\x02\x02\n\v\x03\x02\x02\x02\v\t\x03\x02" +
		"\x02\x02\v\f\x03\x02\x02\x02\f\x03\x03\x02\x02\x02\r\x0E\b\x03\x01\x02" +
		"\x0E\x0F\x07\f\x02\x02\x0F\x11\x07\x03\x02\x02\x10\x12\x05\x06\x04\x02" +
		"\x11\x10\x03\x02\x02\x02\x11\x12\x03\x02\x02\x02\x12\x13\x03\x02\x02\x02" +
		"\x13\x1D\x07\x04\x02\x02\x14\x1D\x07\v\x02\x02\x15\x1D\x07\t\x02\x02\x16" +
		"\x1D\x07\n\x02\x02\x17\x1D\x07\x06\x02\x02\x18\x19\x07\x03\x02\x02\x19" +
		"\x1A\x05\x04\x03\x02\x1A\x1B\x07\x04\x02\x02\x1B\x1D\x03\x02\x02\x02\x1C" +
		"\r\x03\x02\x02\x02\x1C\x14\x03\x02\x02\x02\x1C\x15\x03\x02\x02\x02\x1C" +
		"\x16\x03\x02\x02\x02\x1C\x17\x03\x02\x02\x02\x1C\x18\x03\x02\x02\x02\x1D" +
		")\x03\x02\x02\x02\x1E\x1F\f\n\x02\x02\x1F \t\x02\x02\x02 (\x05\x04\x03" +
		"\v!\"\f\t\x02\x02\"#\t\x03\x02\x02#(\x05\x04\x03\n$%\f\b\x02\x02%&\t\x04" +
		"\x02\x02&(\x05\x04\x03\t\'\x1E\x03\x02\x02\x02\'!\x03\x02\x02\x02\'$\x03" +
		"\x02\x02\x02(+\x03\x02\x02\x02)\'\x03\x02\x02\x02)*\x03\x02\x02\x02*\x05" +
		"\x03\x02\x02\x02+)\x03\x02\x02\x02,1\x05\x04\x03\x02-.\x07\x05\x02\x02" +
		".0\x05\x04\x03\x02/-\x03\x02\x02\x0203\x03\x02\x02\x021/\x03\x02\x02\x02" +
		"12\x03\x02\x02\x022\x07\x03\x02\x02\x0231\x03\x02\x02\x02\b\v\x11\x1C" +
		"\')1";
	public static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!FormulaParser.__ATN) {
			FormulaParser.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(FormulaParser._serializedATN));
		}

		return FormulaParser.__ATN;
	}

}

export class FormulaContext extends ParserRuleContext {
	public expr(): ExprContext[];
	public expr(i: number): ExprContext;
	public expr(i?: number): ExprContext | ExprContext[] {
		if (i === undefined) {
			return this.getRuleContexts(ExprContext);
		} else {
			return this.getRuleContext(i, ExprContext);
		}
	}
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return FormulaParser.RULE_formula; }
	// @Override
	public enterRule(listener: FormulaListener): void {
		if (listener.enterFormula) {
			listener.enterFormula(this);
		}
	}
	// @Override
	public exitRule(listener: FormulaListener): void {
		if (listener.exitFormula) {
			listener.exitFormula(this);
		}
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitFormula) {
			return visitor.visitFormula(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class ExprContext extends ParserRuleContext {
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return FormulaParser.RULE_expr; }
	public copyFrom(ctx: ExprContext): void {
		super.copyFrom(ctx);
	}
}
export class FunctionContext extends ExprContext {
	public FUNCNAME(): TerminalNode { return this.getToken(FormulaParser.FUNCNAME, 0); }
	public args(): ArgsContext | undefined {
		return this.tryGetRuleContext(0, ArgsContext);
	}
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public enterRule(listener: FormulaListener): void {
		if (listener.enterFunction) {
			listener.enterFunction(this);
		}
	}
	// @Override
	public exitRule(listener: FormulaListener): void {
		if (listener.exitFunction) {
			listener.exitFunction(this);
		}
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitFunction) {
			return visitor.visitFunction(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class MulDivContext extends ExprContext {
	public _op!: Token;
	public expr(): ExprContext[];
	public expr(i: number): ExprContext;
	public expr(i?: number): ExprContext | ExprContext[] {
		if (i === undefined) {
			return this.getRuleContexts(ExprContext);
		} else {
			return this.getRuleContext(i, ExprContext);
		}
	}
	public MUL(): TerminalNode | undefined { return this.tryGetToken(FormulaParser.MUL, 0); }
	public DIV(): TerminalNode | undefined { return this.tryGetToken(FormulaParser.DIV, 0); }
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public enterRule(listener: FormulaListener): void {
		if (listener.enterMulDiv) {
			listener.enterMulDiv(this);
		}
	}
	// @Override
	public exitRule(listener: FormulaListener): void {
		if (listener.exitMulDiv) {
			listener.exitMulDiv(this);
		}
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitMulDiv) {
			return visitor.visitMulDiv(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class AddSubContext extends ExprContext {
	public _op!: Token;
	public expr(): ExprContext[];
	public expr(i: number): ExprContext;
	public expr(i?: number): ExprContext | ExprContext[] {
		if (i === undefined) {
			return this.getRuleContexts(ExprContext);
		} else {
			return this.getRuleContext(i, ExprContext);
		}
	}
	public ADD(): TerminalNode | undefined { return this.tryGetToken(FormulaParser.ADD, 0); }
	public SUB(): TerminalNode | undefined { return this.tryGetToken(FormulaParser.SUB, 0); }
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public enterRule(listener: FormulaListener): void {
		if (listener.enterAddSub) {
			listener.enterAddSub(this);
		}
	}
	// @Override
	public exitRule(listener: FormulaListener): void {
		if (listener.exitAddSub) {
			listener.exitAddSub(this);
		}
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitAddSub) {
			return visitor.visitAddSub(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class ComparisonContext extends ExprContext {
	public _op!: Token;
	public expr(): ExprContext[];
	public expr(i: number): ExprContext;
	public expr(i?: number): ExprContext | ExprContext[] {
		if (i === undefined) {
			return this.getRuleContexts(ExprContext);
		} else {
			return this.getRuleContext(i, ExprContext);
		}
	}
	public EQ(): TerminalNode | undefined { return this.tryGetToken(FormulaParser.EQ, 0); }
	public NEQ(): TerminalNode | undefined { return this.tryGetToken(FormulaParser.NEQ, 0); }
	public LT(): TerminalNode | undefined { return this.tryGetToken(FormulaParser.LT, 0); }
	public GT(): TerminalNode | undefined { return this.tryGetToken(FormulaParser.GT, 0); }
	public LTE(): TerminalNode | undefined { return this.tryGetToken(FormulaParser.LTE, 0); }
	public GTE(): TerminalNode | undefined { return this.tryGetToken(FormulaParser.GTE, 0); }
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public enterRule(listener: FormulaListener): void {
		if (listener.enterComparison) {
			listener.enterComparison(this);
		}
	}
	// @Override
	public exitRule(listener: FormulaListener): void {
		if (listener.exitComparison) {
			listener.exitComparison(this);
		}
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitComparison) {
			return visitor.visitComparison(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class NumberContext extends ExprContext {
	public NUM(): TerminalNode { return this.getToken(FormulaParser.NUM, 0); }
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public enterRule(listener: FormulaListener): void {
		if (listener.enterNumber) {
			listener.enterNumber(this);
		}
	}
	// @Override
	public exitRule(listener: FormulaListener): void {
		if (listener.exitNumber) {
			listener.exitNumber(this);
		}
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitNumber) {
			return visitor.visitNumber(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class BooleanContext extends ExprContext {
	public BOOL(): TerminalNode { return this.getToken(FormulaParser.BOOL, 0); }
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public enterRule(listener: FormulaListener): void {
		if (listener.enterBoolean) {
			listener.enterBoolean(this);
		}
	}
	// @Override
	public exitRule(listener: FormulaListener): void {
		if (listener.exitBoolean) {
			listener.exitBoolean(this);
		}
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitBoolean) {
			return visitor.visitBoolean(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class StrContext extends ExprContext {
	public STRING(): TerminalNode { return this.getToken(FormulaParser.STRING, 0); }
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public enterRule(listener: FormulaListener): void {
		if (listener.enterStr) {
			listener.enterStr(this);
		}
	}
	// @Override
	public exitRule(listener: FormulaListener): void {
		if (listener.exitStr) {
			listener.exitStr(this);
		}
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitStr) {
			return visitor.visitStr(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class ReferenceContext extends ExprContext {
	public REFERENCE(): TerminalNode { return this.getToken(FormulaParser.REFERENCE, 0); }
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public enterRule(listener: FormulaListener): void {
		if (listener.enterReference) {
			listener.enterReference(this);
		}
	}
	// @Override
	public exitRule(listener: FormulaListener): void {
		if (listener.exitReference) {
			listener.exitReference(this);
		}
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitReference) {
			return visitor.visitReference(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}
export class ParenthesesContext extends ExprContext {
	public expr(): ExprContext {
		return this.getRuleContext(0, ExprContext);
	}
	constructor(ctx: ExprContext) {
		super(ctx.parent, ctx.invokingState);
		this.copyFrom(ctx);
	}
	// @Override
	public enterRule(listener: FormulaListener): void {
		if (listener.enterParentheses) {
			listener.enterParentheses(this);
		}
	}
	// @Override
	public exitRule(listener: FormulaListener): void {
		if (listener.exitParentheses) {
			listener.exitParentheses(this);
		}
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitParentheses) {
			return visitor.visitParentheses(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class ArgsContext extends ParserRuleContext {
	public expr(): ExprContext[];
	public expr(i: number): ExprContext;
	public expr(i?: number): ExprContext | ExprContext[] {
		if (i === undefined) {
			return this.getRuleContexts(ExprContext);
		} else {
			return this.getRuleContext(i, ExprContext);
		}
	}
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return FormulaParser.RULE_args; }
	// @Override
	public enterRule(listener: FormulaListener): void {
		if (listener.enterArgs) {
			listener.enterArgs(this);
		}
	}
	// @Override
	public exitRule(listener: FormulaListener): void {
		if (listener.exitArgs) {
			listener.exitArgs(this);
		}
	}
	// @Override
	public accept<Result>(visitor: FormulaVisitor<Result>): Result {
		if (visitor.visitArgs) {
			return visitor.visitArgs(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


