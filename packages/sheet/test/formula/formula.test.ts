import { describe, it, expect } from 'vitest';
import {
  evaluate,
  extractReferences,
  extractTokens,
} from '../../src/formula/formula';

describe('Formula', () => {
  it('should correctly evaluate addition', () => {
    expect(evaluate('=1+2')).toBe('3');
    expect(evaluate('=10+5')).toBe('15');
    expect(evaluate('=100+200')).toBe('300');
  });

  it('should correctly evaluate subtraction', () => {
    expect(evaluate('=5-3')).toBe('2');
    expect(evaluate('=10-5')).toBe('5');
    expect(evaluate('=100-50')).toBe('50');
  });

  it('should correctly evaluate multiplication', () => {
    expect(evaluate('=2*3')).toBe('6');
    expect(evaluate('=10*5')).toBe('50');
    expect(evaluate('=100*2')).toBe('200');
  });

  it('should correctly evaluate division', () => {
    expect(evaluate('=6/2')).toBe('3');
    expect(evaluate('=10/5')).toBe('2');
    expect(evaluate('=100/4')).toBe('25');
  });

  it('should correctly evaluate complex formulas', () => {
    expect(evaluate('=2+3*4')).toBe('14');
    expect(evaluate('=(2+3)*4')).toBe('20');
    expect(evaluate('=10-5/2')).toBe('7.5');
    expect(evaluate('=(10-5)/2')).toBe('2.5');
  });

  it('should correctly evaluate functions', () => {
    expect(evaluate('=SUM(0)')).toBe('0');
    expect(evaluate('=SUM(1,2,3)')).toBe('6');
    expect(evaluate('=SUM(true,false,true)')).toBe('2');
  });

  it('should correctly evaluate comparison operators', () => {
    expect(evaluate('=1=1')).toBe('true');
    expect(evaluate('=1=2')).toBe('false');
    expect(evaluate('=1<>2')).toBe('true');
    expect(evaluate('=1<>1')).toBe('false');
    expect(evaluate('=1<2')).toBe('true');
    expect(evaluate('=2<1')).toBe('false');
    expect(evaluate('=2>1')).toBe('true');
    expect(evaluate('=1>2')).toBe('false');
    expect(evaluate('=1<=1')).toBe('true');
    expect(evaluate('=1<=2')).toBe('true');
    expect(evaluate('=2<=1')).toBe('false');
    expect(evaluate('=1>=1')).toBe('true');
    expect(evaluate('=2>=1')).toBe('true');
    expect(evaluate('=1>=2')).toBe('false');
  });

  it('should correctly evaluate string literals', () => {
    expect(evaluate('="hello"')).toBe('hello');
    expect(evaluate('="hello world"')).toBe('hello world');
  });

  it('should correctly evaluate IF function', () => {
    expect(evaluate('=IF(TRUE,1,2)')).toBe('1');
    expect(evaluate('=IF(FALSE,1,2)')).toBe('2');
    expect(evaluate('=IF(TRUE,"yes","no")')).toBe('yes');
    expect(evaluate('=IF(FALSE,"yes","no")')).toBe('no');
    expect(evaluate('=IF(1>0,10,20)')).toBe('10');
    expect(evaluate('=IF(1<0,10,20)')).toBe('20');
    expect(evaluate('=IF(TRUE,1)')).toBe('1');
    expect(evaluate('=IF(FALSE,1)')).toBe('false');
  });

  it('should correctly evaluate AND function', () => {
    expect(evaluate('=AND(TRUE,TRUE)')).toBe('true');
    expect(evaluate('=AND(TRUE,FALSE)')).toBe('false');
    expect(evaluate('=AND(FALSE,FALSE)')).toBe('false');
    expect(evaluate('=AND(TRUE,TRUE,TRUE)')).toBe('true');
    expect(evaluate('=AND(TRUE,TRUE,FALSE)')).toBe('false');
    expect(evaluate('=AND(1,1)')).toBe('true');
    expect(evaluate('=AND(1,0)')).toBe('false');
  });

  it('should correctly evaluate OR function', () => {
    expect(evaluate('=OR(TRUE,TRUE)')).toBe('true');
    expect(evaluate('=OR(TRUE,FALSE)')).toBe('true');
    expect(evaluate('=OR(FALSE,FALSE)')).toBe('false');
    expect(evaluate('=OR(FALSE,FALSE,TRUE)')).toBe('true');
    expect(evaluate('=OR(0,0)')).toBe('false');
    expect(evaluate('=OR(0,1)')).toBe('true');
  });

  it('should correctly evaluate NOT function', () => {
    expect(evaluate('=NOT(TRUE)')).toBe('false');
    expect(evaluate('=NOT(FALSE)')).toBe('true');
    expect(evaluate('=NOT(1)')).toBe('false');
    expect(evaluate('=NOT(0)')).toBe('true');
  });

  it('should correctly evaluate combined logical formulas', () => {
    expect(evaluate('=IF(AND(1>0,2>1),"yes","no")')).toBe('yes');
    expect(evaluate('=IF(OR(1>2,2>1),"yes","no")')).toBe('yes');
    expect(evaluate('=IF(NOT(FALSE),1,2)')).toBe('1');
  });

  it('should display #ERROR! for invalid formulas', () => {
    expect(evaluate('abc')).toBe('#ERROR!');
    expect(evaluate('=1+')).toBe('#ERROR!');
  });

  it('should display #N/A for invalid arguments', () => {
    expect(evaluate('=SUM()')).toBe('#N/A!');
  });

  it('should correctly extract references', () => {
    expect(extractReferences('=A1+B1')).toEqual(new Set(['A1', 'B1']));
    expect(extractReferences('=SUM(A1, A2:A3) + A4')).toEqual(
      new Set(['A1', 'A2:A3', 'A4']),
    );
  });

  it('should convert lowercase references to uppercase', () => {
    expect(extractReferences('=a1+b1')).toEqual(new Set(['A1', 'B1']));
  });
});

describe('Formula.extractTokens', () => {
  it('should correctly extract tokens from formulas', () => {
    expect(extractTokens('=1+2')).toEqual([
      { type: 'NUM', start: 0, stop: 0, text: '1' },
      { type: 'ADD', start: 1, stop: 1, text: '+' },
      { type: 'NUM', start: 2, stop: 2, text: '2' },
    ]);

    expect(extractTokens('=SUM(A1, B2)')).toEqual([
      { type: 'FUNCNAME', start: 0, stop: 2, text: 'SUM' },
      { type: 'STRING', start: 3, stop: 3, text: '(' },
      { type: 'REFERENCE', start: 4, stop: 5, text: 'A1' },
      { type: 'STRING', start: 6, stop: 6, text: ',' },
      { type: 'STRING', start: 7, stop: 7, text: ' ' },
      { type: 'REFERENCE', start: 8, stop: 9, text: 'B2' },
      { type: 'STRING', start: 10, stop: 10, text: ')' },
    ]);

    expect(extractTokens('=A1+B1*C1')).toEqual([
      { type: 'REFERENCE', start: 0, stop: 1, text: 'A1' },
      { type: 'ADD', start: 2, stop: 2, text: '+' },
      { type: 'REFERENCE', start: 3, stop: 4, text: 'B1' },
      { type: 'MUL', start: 5, stop: 5, text: '*' },
      { type: 'REFERENCE', start: 6, stop: 7, text: 'C1' },
    ]);

    expect(extractTokens('=10/2')).toEqual([
      { type: 'NUM', start: 0, stop: 1, text: '10' },
      { type: 'DIV', start: 2, stop: 2, text: '/' },
      { type: 'NUM', start: 3, stop: 3, text: '2' },
    ]);

    expect(extractTokens('=TRUE')).toEqual([
      { type: 'BOOL', start: 0, stop: 3, text: 'TRUE' },
    ]);

    expect(extractTokens('=A1:')).toEqual([
      { type: 'REFERENCE', start: 0, stop: 1, text: 'A1' },
      { type: 'STRING', start: 2, stop: 3, text: ':' },
    ]);
  });
});
