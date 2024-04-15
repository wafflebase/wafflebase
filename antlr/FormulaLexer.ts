// Generated from antlr/Formula.g4 by ANTLR 4.9.0-SNAPSHOT

import { ATN } from 'antlr4ts/atn/ATN';
import { ATNDeserializer } from 'antlr4ts/atn/ATNDeserializer';
import { CharStream } from 'antlr4ts/CharStream';
import { Lexer } from 'antlr4ts/Lexer';
import { LexerATNSimulator } from 'antlr4ts/atn/LexerATNSimulator';
import { NotNull } from 'antlr4ts/Decorators';
import { Override } from 'antlr4ts/Decorators';
import { RuleContext } from 'antlr4ts/RuleContext';
import { Vocabulary } from 'antlr4ts/Vocabulary';
import { VocabularyImpl } from 'antlr4ts/VocabularyImpl';

import * as Utils from 'antlr4ts/misc/Utils';

export class FormulaLexer extends Lexer {
  public static readonly T__0 = 1;
  public static readonly T__1 = 2;
  public static readonly T__2 = 3;
  public static readonly NUM = 4;
  public static readonly REFERENCE = 5;
  public static readonly FUNCNAME = 6;
  public static readonly WS = 7;
  public static readonly MUL = 8;
  public static readonly DIV = 9;
  public static readonly ADD = 10;
  public static readonly SUB = 11;

  // tslint:disable:no-trailing-whitespace
  public static readonly channelNames: string[] = [
    'DEFAULT_TOKEN_CHANNEL',
    'HIDDEN',
  ];

  // tslint:disable:no-trailing-whitespace
  public static readonly modeNames: string[] = ['DEFAULT_MODE'];

  public static readonly ruleNames: string[] = [
    'T__0',
    'T__1',
    'T__2',
    'NUM',
    'REFERENCE',
    'FUNCNAME',
    'WS',
    'MUL',
    'DIV',
    'ADD',
    'SUB',
  ];

  private static readonly _LITERAL_NAMES: Array<string | undefined> = [
    undefined,
    "'('",
    "')'",
    "','",
    undefined,
    undefined,
    undefined,
    undefined,
    "'*'",
    "'/'",
    "'+'",
    "'-'",
  ];
  private static readonly _SYMBOLIC_NAMES: Array<string | undefined> = [
    undefined,
    undefined,
    undefined,
    undefined,
    'NUM',
    'REFERENCE',
    'FUNCNAME',
    'WS',
    'MUL',
    'DIV',
    'ADD',
    'SUB',
  ];
  public static readonly VOCABULARY: Vocabulary = new VocabularyImpl(
    FormulaLexer._LITERAL_NAMES,
    FormulaLexer._SYMBOLIC_NAMES,
    [],
  );

  // @Override
  // @NotNull
  public get vocabulary(): Vocabulary {
    return FormulaLexer.VOCABULARY;
  }
  // tslint:enable:no-trailing-whitespace

  constructor(input: CharStream) {
    super(input);
    this._interp = new LexerATNSimulator(FormulaLexer._ATN, this);
  }

  // @Override
  public get grammarFileName(): string {
    return 'Formula.g4';
  }

  // @Override
  public get ruleNames(): string[] {
    return FormulaLexer.ruleNames;
  }

  // @Override
  public get serializedATN(): string {
    return FormulaLexer._serializedATN;
  }

  // @Override
  public get channelNames(): string[] {
    return FormulaLexer.channelNames;
  }

  // @Override
  public get modeNames(): string[] {
    return FormulaLexer.modeNames;
  }

  // @Override
  public action(
    _localctx: RuleContext,
    ruleIndex: number,
    actionIndex: number,
  ): void {
    switch (ruleIndex) {
      case 4:
        this.REFERENCE_action(_localctx, actionIndex);
        break;
    }
  }
  private REFERENCE_action(_localctx: RuleContext, actionIndex: number): void {
    switch (actionIndex) {
      case 0:
        1, 3;
        break;
    }
  }

  public static readonly _serializedATN: string =
    '\x03\uC91D\uCABA\u058D\uAFBA\u4F53\u0607\uEA8B\uC241\x02\rI\b\x01\x04' +
    '\x02\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04' +
    '\x07\t\x07\x04\b\t\b\x04\t\t\t\x04\n\t\n\x04\v\t\v\x04\f\t\f\x03\x02\x03' +
    '\x02\x03\x03\x03\x03\x03\x04\x03\x04\x03\x05\x06\x05!\n\x05\r\x05\x0E' +
    '\x05"\x03\x05\x03\x05\x06\x05\'\n\x05\r\x05\x0E\x05(\x05\x05+\n\x05\x03' +
    '\x06\x03\x06\x03\x06\x03\x06\x07\x061\n\x06\f\x06\x0E\x064\v\x06\x03\x07' +
    '\x06\x077\n\x07\r\x07\x0E\x078\x03\b\x06\b<\n\b\r\b\x0E\b=\x03\b\x03\b' +
    '\x03\t\x03\t\x03\n\x03\n\x03\v\x03\v\x03\f\x03\f\x02\x02\x02\r\x03\x02' +
    '\x03\x05\x02\x04\x07\x02\x05\t\x02\x06\v\x02\x07\r\x02\b\x0F\x02\t\x11' +
    '\x02\n\x13\x02\v\x15\x02\f\x17\x02\r\x03\x02\x06\x03\x022;\x04\x02C\\' +
    'c|\x03\x023;\x04\x02\v\v""\x02N\x02\x03\x03\x02\x02\x02\x02\x05\x03' +
    '\x02\x02\x02\x02\x07\x03\x02\x02\x02\x02\t\x03\x02\x02\x02\x02\v\x03\x02' +
    '\x02\x02\x02\r\x03\x02\x02\x02\x02\x0F\x03\x02\x02\x02\x02\x11\x03\x02' +
    '\x02\x02\x02\x13\x03\x02\x02\x02\x02\x15\x03\x02\x02\x02\x02\x17\x03\x02' +
    '\x02\x02\x03\x19\x03\x02\x02\x02\x05\x1B\x03\x02\x02\x02\x07\x1D\x03\x02' +
    '\x02\x02\t \x03\x02\x02\x02\v,\x03\x02\x02\x02\r6\x03\x02\x02\x02\x0F' +
    ';\x03\x02\x02\x02\x11A\x03\x02\x02\x02\x13C\x03\x02\x02\x02\x15E\x03\x02' +
    '\x02\x02\x17G\x03\x02\x02\x02\x19\x1A\x07*\x02\x02\x1A\x04\x03\x02\x02' +
    '\x02\x1B\x1C\x07+\x02\x02\x1C\x06\x03\x02\x02\x02\x1D\x1E\x07.\x02\x02' +
    '\x1E\b\x03\x02\x02\x02\x1F!\t\x02\x02\x02 \x1F\x03\x02\x02\x02!"\x03' +
    '\x02\x02\x02" \x03\x02\x02\x02"#\x03\x02\x02\x02#*\x03\x02\x02\x02$' +
    "&\x070\x02\x02%'\t\x02\x02\x02&%\x03\x02\x02\x02'(\x03\x02\x02\x02(" +
    '&\x03\x02\x02\x02()\x03\x02\x02\x02)+\x03\x02\x02\x02*$\x03\x02\x02\x02' +
    '*+\x03\x02\x02\x02+\n\x03\x02\x02\x02,-\t\x03\x02\x02-.\b\x06\x02\x02' +
    '.2\t\x04\x02\x02/1\t\x02\x02\x020/\x03\x02\x02\x0214\x03\x02\x02\x022' +
    '0\x03\x02\x02\x0223\x03\x02\x02\x023\f\x03\x02\x02\x0242\x03\x02\x02\x02' +
    '57\t\x03\x02\x0265\x03\x02\x02\x0278\x03\x02\x02\x0286\x03\x02\x02\x02' +
    '89\x03\x02\x02\x029\x0E\x03\x02\x02\x02:<\t\x05\x02\x02;:\x03\x02\x02' +
    '\x02<=\x03\x02\x02\x02=;\x03\x02\x02\x02=>\x03\x02\x02\x02>?\x03\x02\x02' +
    '\x02?@\b\b\x03\x02@\x10\x03\x02\x02\x02AB\x07,\x02\x02B\x12\x03\x02\x02' +
    '\x02CD\x071\x02\x02D\x14\x03\x02\x02\x02EF\x07-\x02\x02F\x16\x03\x02\x02' +
    '\x02GH\x07/\x02\x02H\x18\x03\x02\x02\x02\t\x02"(*28=\x04\x03\x06\x02' +
    '\b\x02\x02';
  public static __ATN: ATN;
  public static get _ATN(): ATN {
    if (!FormulaLexer.__ATN) {
      FormulaLexer.__ATN = new ATNDeserializer().deserialize(
        Utils.toCharArray(FormulaLexer._serializedATN),
      );
    }

    return FormulaLexer.__ATN;
  }
}
