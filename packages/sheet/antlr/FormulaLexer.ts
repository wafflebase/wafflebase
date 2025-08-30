// @ts-nocheck
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
  public static readonly REFERENCE = 4;
  public static readonly REF = 5;
  public static readonly REFRANGE = 6;
  public static readonly BOOL = 7;
  public static readonly NUM = 8;
  public static readonly FUNCNAME = 9;
  public static readonly WS = 10;
  public static readonly MUL = 11;
  public static readonly DIV = 12;
  public static readonly ADD = 13;
  public static readonly SUB = 14;

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
    'REFERENCE',
    'REF',
    'REFRANGE',
    'BOOL',
    'NUM',
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
    'REFERENCE',
    'REF',
    'REFRANGE',
    'BOOL',
    'NUM',
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
        this.REF_action(_localctx, actionIndex);
        break;
    }
  }
  private REF_action(_localctx: RuleContext, actionIndex: number): void {
    switch (actionIndex) {
      case 0:
        1, 3;
        break;
    }
  }

  public static readonly _serializedATN: string =
    '\x03\uC91D\uCABA\u058D\uAFBA\u4F53\u0607\uEA8B\uC241\x02\x10m\b\x01\x04' +
    '\x02\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04' +
    '\x07\t\x07\x04\b\t\b\x04\t\t\t\x04\n\t\n\x04\v\t\v\x04\f\t\f\x04\r\t\r' +
    '\x04\x0E\t\x0E\x04\x0F\t\x0F\x03\x02\x03\x02\x03\x03\x03\x03\x03\x04\x03' +
    '\x04\x03\x05\x03\x05\x05\x05(\n\x05\x03\x06\x03\x06\x03\x06\x03\x06\x07' +
    '\x06.\n\x06\f\x06\x0E\x061\v\x06\x03\x07\x03\x07\x03\x07\x03\x07\x03\b' +
    '\x03\b\x03\b\x03\b\x03\b\x03\b\x03\b\x03\b\x03\b\x03\b\x03\b\x03\b\x03' +
    '\b\x03\b\x03\b\x03\b\x03\b\x03\b\x05\bI\n\b\x03\t\x06\tL\n\t\r\t\x0E\t' +
    'M\x03\t\x03\t\x06\tR\n\t\r\t\x0E\tS\x05\tV\n\t\x03\n\x03\n\x07\nZ\n\n' +
    '\f\n\x0E\n]\v\n\x03\v\x06\v`\n\v\r\v\x0E\va\x03\v\x03\v\x03\f\x03\f\x03' +
    '\r\x03\r\x03\x0E\x03\x0E\x03\x0F\x03\x0F\x02\x02\x02\x10\x03\x02\x03\x05' +
    '\x02\x04\x07\x02\x05\t\x02\x06\v\x02\x07\r\x02\b\x0F\x02\t\x11\x02\n\x13' +
    '\x02\v\x15\x02\f\x17\x02\r\x19\x02\x0E\x1B\x02\x0F\x1D\x02\x10\x03\x02' +
    '\x07\x04\x02C\\c|\x03\x023;\x03\x022;\x05\x022;C\\c|\x04\x02\v\v""\x02' +
    'v\x02\x03\x03\x02\x02\x02\x02\x05\x03\x02\x02\x02\x02\x07\x03\x02\x02' +
    '\x02\x02\t\x03\x02\x02\x02\x02\v\x03\x02\x02\x02\x02\r\x03\x02\x02\x02' +
    '\x02\x0F\x03\x02\x02\x02\x02\x11\x03\x02\x02\x02\x02\x13\x03\x02\x02\x02' +
    '\x02\x15\x03\x02\x02\x02\x02\x17\x03\x02\x02\x02\x02\x19\x03\x02\x02\x02' +
    '\x02\x1B\x03\x02\x02\x02\x02\x1D\x03\x02\x02\x02\x03\x1F\x03\x02\x02\x02' +
    "\x05!\x03\x02\x02\x02\x07#\x03\x02\x02\x02\t'\x03\x02\x02\x02\v)\x03" +
    '\x02\x02\x02\r2\x03\x02\x02\x02\x0FH\x03\x02\x02\x02\x11K\x03\x02\x02' +
    '\x02\x13W\x03\x02\x02\x02\x15_\x03\x02\x02\x02\x17e\x03\x02\x02\x02\x19' +
    'g\x03\x02\x02\x02\x1Bi\x03\x02\x02\x02\x1Dk\x03\x02\x02\x02\x1F \x07*' +
    '\x02\x02 \x04\x03\x02\x02\x02!"\x07+\x02\x02"\x06\x03\x02\x02\x02#$' +
    "\x07.\x02\x02$\b\x03\x02\x02\x02%(\x05\v\x06\x02&(\x05\r\x07\x02'%\x03" +
    "\x02\x02\x02'&\x03\x02\x02\x02(\n\x03\x02\x02\x02)*\t\x02\x02\x02*+\b" +
    '\x06\x02\x02+/\t\x03\x02\x02,.\t\x04\x02\x02-,\x03\x02\x02\x02.1\x03\x02' +
    '\x02\x02/-\x03\x02\x02\x02/0\x03\x02\x02\x020\f\x03\x02\x02\x021/\x03' +
    '\x02\x02\x0223\x05\v\x06\x0234\x07<\x02\x0245\x05\v\x06\x025\x0E\x03\x02' +
    '\x02\x0267\x07V\x02\x0278\x07T\x02\x0289\x07W\x02\x029I\x07G\x02\x02:' +
    ';\x07H\x02\x02;<\x07C\x02\x02<=\x07N\x02\x02=>\x07U\x02\x02>I\x07G\x02' +
    '\x02?@\x07v\x02\x02@A\x07t\x02\x02AB\x07w\x02\x02BI\x07g\x02\x02CD\x07' +
    'h\x02\x02DE\x07c\x02\x02EF\x07n\x02\x02FG\x07u\x02\x02GI\x07g\x02\x02' +
    'H6\x03\x02\x02\x02H:\x03\x02\x02\x02H?\x03\x02\x02\x02HC\x03\x02\x02\x02' +
    'I\x10\x03\x02\x02\x02JL\t\x04\x02\x02KJ\x03\x02\x02\x02LM\x03\x02\x02' +
    '\x02MK\x03\x02\x02\x02MN\x03\x02\x02\x02NU\x03\x02\x02\x02OQ\x070\x02' +
    '\x02PR\t\x04\x02\x02QP\x03\x02\x02\x02RS\x03\x02\x02\x02SQ\x03\x02\x02' +
    '\x02ST\x03\x02\x02\x02TV\x03\x02\x02\x02UO\x03\x02\x02\x02UV\x03\x02\x02' +
    '\x02V\x12\x03\x02\x02\x02W[\t\x02\x02\x02XZ\t\x05\x02\x02YX\x03\x02\x02' +
    '\x02Z]\x03\x02\x02\x02[Y\x03\x02\x02\x02[\\\x03\x02\x02\x02\\\x14\x03' +
    '\x02\x02\x02][\x03\x02\x02\x02^`\t\x06\x02\x02_^\x03\x02\x02\x02`a\x03' +
    '\x02\x02\x02a_\x03\x02\x02\x02ab\x03\x02\x02\x02bc\x03\x02\x02\x02cd\b' +
    '\v\x03\x02d\x16\x03\x02\x02\x02ef\x07,\x02\x02f\x18\x03\x02\x02\x02gh' +
    '\x071\x02\x02h\x1A\x03\x02\x02\x02ij\x07-\x02\x02j\x1C\x03\x02\x02\x02' +
    "kl\x07/\x02\x02l\x1E\x03\x02\x02\x02\v\x02'/HMSU[a\x04\x03\x06\x02\b" +
    '\x02\x02';
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
