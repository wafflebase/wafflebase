import { describe, it, expect, vi } from 'vitest';
import {
  evaluate,
  extractReferences,
  extractTokens,
  isReferenceInsertPosition,
  findReferenceTokenAtCursor,
} from '../../src/formula/formula';
import { Grid, Cell } from '../../src/model/types';

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

  it('should correctly evaluate ABS function', () => {
    expect(evaluate('=ABS(0-5)')).toBe('5');
    expect(evaluate('=ABS(5)')).toBe('5');
  });

  it('should correctly evaluate ROUND function', () => {
    expect(evaluate('=ROUND(1.234,2)')).toBe('1.23');
    expect(evaluate('=ROUND(1.235,2)')).toBe('1.24');
    expect(evaluate('=ROUND(0-1.5)')).toBe('-2');
    expect(evaluate('=ROUND(1234,0-2)')).toBe('1200');
  });

  it('should correctly evaluate ROUNDUP function', () => {
    expect(evaluate('=ROUNDUP(1.21,1)')).toBe('1.3');
    expect(evaluate('=ROUNDUP(0-1.21,1)')).toBe('-1.3');
    expect(evaluate('=ROUNDUP(1234,0-2)')).toBe('1300');
  });

  it('should correctly evaluate ROUNDDOWN function', () => {
    expect(evaluate('=ROUNDDOWN(1.29,1)')).toBe('1.2');
    expect(evaluate('=ROUNDDOWN(0-1.29,1)')).toBe('-1.2');
    expect(evaluate('=ROUNDDOWN(1299,0-2)')).toBe('1200');
  });

  it('should correctly evaluate INT function', () => {
    expect(evaluate('=INT(1.9)')).toBe('1');
    expect(evaluate('=INT(0-1.1)')).toBe('-2');
  });

  it('should correctly evaluate MOD function', () => {
    expect(evaluate('=MOD(10,3)')).toBe('1');
    expect(evaluate('=MOD(0-10,3)')).toBe('2');
    expect(evaluate('=MOD(10,0-3)')).toBe('-2');
    expect(evaluate('=MOD(10,0)')).toBe('#VALUE!');
  });

  it('should correctly evaluate SQRT function', () => {
    expect(evaluate('=SQRT(9)')).toBe('3');
    expect(evaluate('=SQRT(0-1)')).toBe('#VALUE!');
  });

  it('should correctly evaluate POWER function', () => {
    expect(evaluate('=POWER(2,3)')).toBe('8');
    expect(evaluate('=POWER(9,0.5)')).toBe('3');
  });

  it('should correctly evaluate PRODUCT function', () => {
    expect(evaluate('=PRODUCT(2,3,4)')).toBe('24');
    expect(evaluate('=PRODUCT(10,0.5)')).toBe('5');
    expect(evaluate('=PRODUCT(TRUE,5)')).toBe('5');
  });

  it('should correctly evaluate MEDIAN function', () => {
    expect(evaluate('=MEDIAN(1,3,2)')).toBe('2');
    expect(evaluate('=MEDIAN(1,2,3,4)')).toBe('2.5');
    expect(evaluate('=MEDIAN(10)')).toBe('10');
  });

  it('should correctly evaluate RAND function', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    expect(evaluate('=RAND()')).toBe('0.25');
    randomSpy.mockRestore();
  });

  it('should correctly evaluate RANDBETWEEN function', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(evaluate('=RANDBETWEEN(1,3)')).toBe('2');
    randomSpy.mockRestore();
    expect(evaluate('=RANDBETWEEN(3,1)')).toBe('#VALUE!');
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

  it('should correctly evaluate IFS function', () => {
    expect(evaluate('=IFS(1=0,"a",2=2,"b")')).toBe('b');
    expect(evaluate('=IFS(TRUE,1,FALSE,2)')).toBe('1');
    expect(evaluate('=IFS(FALSE,1,FALSE,2)')).toBe('#N/A!');
    expect(evaluate('=IFS(TRUE)')).toBe('#N/A!');
  });

  it('should correctly evaluate SWITCH function', () => {
    expect(evaluate('=SWITCH(2,1,"a",2,"b","c")')).toBe('b');
    expect(evaluate('=SWITCH("x","y",1,"z",2,3)')).toBe('3');
    expect(evaluate('=SWITCH(1,2,"a")')).toBe('#N/A!');
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

  it('should correctly evaluate AVERAGE function', () => {
    expect(evaluate('=AVERAGE(1,2,3)')).toBe('2');
    expect(evaluate('=AVERAGE(10,20)')).toBe('15');
    expect(evaluate('=AVERAGE(5)')).toBe('5');
    expect(evaluate('=AVERAGE(1,2,3,4,5)')).toBe('3');
    expect(evaluate('=AVERAGE(0,0,0)')).toBe('0');
  });

  it('should correctly evaluate MIN function', () => {
    expect(evaluate('=MIN(1,2,3)')).toBe('1');
    expect(evaluate('=MIN(5,3,8,1,9)')).toBe('1');
    expect(evaluate('=MIN(0-5,0,5)')).toBe('-5');
    expect(evaluate('=MIN(42)')).toBe('42');
  });

  it('should correctly evaluate MAX function', () => {
    expect(evaluate('=MAX(1,2,3)')).toBe('3');
    expect(evaluate('=MAX(5,3,8,1,9)')).toBe('9');
    expect(evaluate('=MAX(0-5,0,5)')).toBe('5');
    expect(evaluate('=MAX(42)')).toBe('42');
  });

  it('should correctly evaluate COUNT function', () => {
    expect(evaluate('=COUNT(1,2,3)')).toBe('3');
    expect(evaluate('=COUNT(1,"hello",TRUE)')).toBe('2');
    expect(evaluate('=COUNT(TRUE,FALSE)')).toBe('2');
  });

  it('should correctly evaluate COUNTA function', () => {
    expect(evaluate('=COUNTA(1,"hello",TRUE)')).toBe('3');
    expect(evaluate('=COUNTA(1,2,3)')).toBe('3');
  });

  it('should correctly evaluate COUNTBLANK function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' });
    grid.set('A2', { v: '' });
    grid.set('A4', { v: 'hello' });

    expect(evaluate('=COUNTBLANK(A1:A4)', grid)).toBe('2');
    expect(evaluate('=COUNTBLANK("",A1)', grid)).toBe('1');
  });

  it('should correctly evaluate COUNTIF function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' });
    grid.set('A2', { v: '5' });
    grid.set('A3', { v: '15' });
    grid.set('A4', { v: 'apple' });
    grid.set('A5', { v: 'Apricot' });

    expect(evaluate('=COUNTIF(A1:A5,">=10")', grid)).toBe('2');
    expect(evaluate('=COUNTIF(A1:A5,"a*")', grid)).toBe('2');
    expect(evaluate('=COUNTIF(A1:A5,"<>5")', grid)).toBe('4');
  });

  it('should correctly evaluate SUMIF function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: 'east' });
    grid.set('A2', { v: 'west' });
    grid.set('A3', { v: 'east' });
    grid.set('B1', { v: '10' });
    grid.set('B2', { v: '20' });
    grid.set('B3', { v: '30' });

    expect(evaluate('=SUMIF(A1:A3,"east",B1:B3)', grid)).toBe('40');
    expect(evaluate('=SUMIF(B1:B3,">15")', grid)).toBe('50');
  });

  it('should correctly evaluate COUNTIFS function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: 'north' });
    grid.set('A2', { v: 'north' });
    grid.set('A3', { v: 'south' });
    grid.set('B1', { v: '10' });
    grid.set('B2', { v: '20' });
    grid.set('B3', { v: '30' });

    expect(evaluate('=COUNTIFS(A1:A3,"north",B1:B3,">15")', grid)).toBe('1');
    expect(evaluate('=COUNTIFS(A1:A3,"south",B1:B3,">15")', grid)).toBe('1');
  });

  it('should correctly evaluate SUMIFS function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: 'north' });
    grid.set('A2', { v: 'north' });
    grid.set('A3', { v: 'south' });
    grid.set('B1', { v: '10' });
    grid.set('B2', { v: '20' });
    grid.set('B3', { v: '30' });
    grid.set('C1', { v: '1' });
    grid.set('C2', { v: '2' });
    grid.set('C3', { v: '3' });

    expect(evaluate('=SUMIFS(B1:B3,A1:A3,"north",C1:C3,">1")', grid)).toBe(
      '20',
    );
    expect(evaluate('=SUMIFS(B1:B3,A1:A3,"south",C1:C3,">1")', grid)).toBe(
      '30',
    );
  });

  it('should correctly evaluate TRIM function', () => {
    expect(evaluate('=TRIM("  hello  ")')).toBe('hello');
    expect(evaluate('=TRIM("hello")')).toBe('hello');
    expect(evaluate('=TRIM("  spaces  ")')).toBe('spaces');
  });

  it('should correctly evaluate LEN function', () => {
    expect(evaluate('=LEN("hello")')).toBe('5');
    expect(evaluate('=LEN("")')).toBe('0');
    expect(evaluate('=LEN("hello world")')).toBe('11');
  });

  it('should correctly evaluate LEFT function', () => {
    expect(evaluate('=LEFT("hello",3)')).toBe('hel');
    expect(evaluate('=LEFT("hello",1)')).toBe('h');
    expect(evaluate('=LEFT("hello")')).toBe('h');
    expect(evaluate('=LEFT("hello",10)')).toBe('hello');
  });

  it('should correctly evaluate RIGHT function', () => {
    expect(evaluate('=RIGHT("hello",3)')).toBe('llo');
    expect(evaluate('=RIGHT("hello",1)')).toBe('o');
    expect(evaluate('=RIGHT("hello")')).toBe('o');
    expect(evaluate('=RIGHT("hello",10)')).toBe('hello');
  });

  it('should correctly evaluate MID function', () => {
    expect(evaluate('=MID("hello",2,3)')).toBe('ell');
    expect(evaluate('=MID("hello",1,5)')).toBe('hello');
    expect(evaluate('=MID("hello",3,1)')).toBe('l');
  });

  it('should correctly evaluate CONCATENATE function', () => {
    expect(evaluate('=CONCATENATE("hello"," ","world")')).toBe('hello world');
    expect(evaluate('=CONCATENATE("a","b")')).toBe('ab');
    expect(evaluate('=CONCATENATE("x","y","z")')).toBe('xyz');
  });

  it('should correctly evaluate CONCAT function', () => {
    expect(evaluate('=CONCAT("hello"," world")')).toBe('hello world');
    expect(evaluate('=CONCAT("a","b","c")')).toBe('abc');
  });

  it('should correctly evaluate FIND function', () => {
    expect(evaluate('=FIND("o","Hello")')).toBe('5');
    expect(evaluate('=FIND("l","Hello",4)')).toBe('4');
    expect(evaluate('=FIND("h","Hello")')).toBe('#VALUE!');
  });

  it('should correctly evaluate SEARCH function', () => {
    expect(evaluate('=SEARCH("h","Hello")')).toBe('1');
    expect(evaluate('=SEARCH("L","Hello",4)')).toBe('4');
    expect(evaluate('=SEARCH("?e*o","Hello")')).toBe('1');
    expect(evaluate('=SEARCH("z","Hello")')).toBe('#VALUE!');
  });

  it('should correctly evaluate TEXTJOIN function', () => {
    expect(evaluate('=TEXTJOIN("-",TRUE,"a","","b")')).toBe('a-b');
    expect(evaluate('=TEXTJOIN("-",FALSE,"a","","b")')).toBe('a--b');
    expect(evaluate('=TEXTJOIN(" ",TRUE,"hello","world")')).toBe('hello world');
  });

  it('should correctly evaluate LOWER function', () => {
    expect(evaluate('=LOWER("HeLLo")')).toBe('hello');
  });

  it('should correctly evaluate UPPER function', () => {
    expect(evaluate('=UPPER("HeLLo")')).toBe('HELLO');
  });

  it('should correctly evaluate PROPER function', () => {
    expect(evaluate('=PROPER("hello world")')).toBe('Hello World');
    expect(evaluate('=PROPER("mIxEd cAse")')).toBe('Mixed Case');
  });

  it('should correctly evaluate SUBSTITUTE function', () => {
    expect(evaluate('=SUBSTITUTE("abab","ab","x")')).toBe('xx');
    expect(evaluate('=SUBSTITUTE("ababab","ab","x",2)')).toBe('abxab');
    expect(evaluate('=SUBSTITUTE("hello","z","x",1)')).toBe('hello');
    expect(evaluate('=SUBSTITUTE("abc","a","x",0)')).toBe('#VALUE!');
  });

  it('should correctly evaluate TODAY function', () => {
    const result = evaluate('=TODAY()');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should correctly evaluate NOW function', () => {
    const result = evaluate('=NOW()');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('should correctly evaluate DATE function', () => {
    expect(evaluate('=DATE(2024,3,15)')).toBe('2024-03-15');
    expect(evaluate('=DATE(2024,13,1)')).toBe('2025-01-01');
  });

  it('should correctly evaluate TIME function', () => {
    expect(evaluate('=TIME(13,5,9)')).toBe('13:05:09');
    expect(evaluate('=TIME(25,0,0)')).toBe('01:00:00');
  });

  it('should correctly evaluate DAYS function', () => {
    expect(evaluate('=DAYS("2024-03-15","2024-03-10")')).toBe('5');
    expect(evaluate('=DAYS("invalid","2024-03-10")')).toBe('#VALUE!');
  });

  it('should correctly evaluate YEAR function', () => {
    expect(evaluate('=YEAR("2024-03-15")')).toBe('2024');
    expect(evaluate('=YEAR("invalid")')).toBe('#VALUE!');
  });

  it('should correctly evaluate MONTH function', () => {
    expect(evaluate('=MONTH("2024-03-15")')).toBe('3');
    expect(evaluate('=MONTH("invalid")')).toBe('#VALUE!');
  });

  it('should correctly evaluate DAY function', () => {
    expect(evaluate('=DAY("2024-03-15")')).toBe('15');
    expect(evaluate('=DAY("invalid")')).toBe('#VALUE!');
  });

  it('should correctly evaluate HOUR function', () => {
    expect(evaluate('=HOUR("13:45:30")')).toBe('13');
    expect(evaluate('=HOUR("2024-03-15T08:10:20")')).toBe('8');
    expect(evaluate('=HOUR("25:00:00")')).toBe('#VALUE!');
  });

  it('should correctly evaluate MINUTE function', () => {
    expect(evaluate('=MINUTE("13:45:30")')).toBe('45');
    expect(evaluate('=MINUTE("2024-03-15T08:10:20")')).toBe('10');
  });

  it('should correctly evaluate SECOND function', () => {
    expect(evaluate('=SECOND("13:45:30")')).toBe('30');
    expect(evaluate('=SECOND("2024-03-15T08:10:20")')).toBe('20');
  });

  it('should correctly evaluate WEEKDAY function', () => {
    expect(evaluate('=WEEKDAY("2024-03-17")')).toBe('1');
    expect(evaluate('=WEEKDAY("2024-03-17",2)')).toBe('7');
    expect(evaluate('=WEEKDAY("2024-03-17",3)')).toBe('6');
    expect(evaluate('=WEEKDAY("2024-03-17",9)')).toBe('#VALUE!');
  });

  it('should correctly evaluate ISBLANK function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '' });
    grid.set('A2', { v: 'value' });

    expect(evaluate('=ISBLANK(A1)', grid)).toBe('true');
    expect(evaluate('=ISBLANK(A2)', grid)).toBe('false');
    expect(evaluate('=ISBLANK("")')).toBe('false');
  });

  it('should correctly evaluate ISNUMBER function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' });
    grid.set('A2', { v: 'hello' });

    expect(evaluate('=ISNUMBER(10)')).toBe('true');
    expect(evaluate('=ISNUMBER("10")')).toBe('false');
    expect(evaluate('=ISNUMBER(A1)', grid)).toBe('true');
    expect(evaluate('=ISNUMBER(A2)', grid)).toBe('false');
  });

  it('should correctly evaluate ISTEXT function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: 'hello' });
    grid.set('A2', { v: '10' });

    expect(evaluate('=ISTEXT("hello")')).toBe('true');
    expect(evaluate('=ISTEXT(10)')).toBe('false');
    expect(evaluate('=ISTEXT(A1)', grid)).toBe('true');
    expect(evaluate('=ISTEXT(A2)', grid)).toBe('false');
  });

  it('should correctly evaluate ISERROR function', () => {
    expect(evaluate('=ISERROR(SUM())')).toBe('true');
    expect(evaluate('=ISERROR(10)')).toBe('false');
  });

  it('should correctly evaluate ISERR function', () => {
    expect(evaluate('=ISERR(MOD(1,0))')).toBe('true');
    expect(evaluate('=ISERR(SUM())')).toBe('false');
  });

  it('should correctly evaluate ISNA function', () => {
    expect(evaluate('=ISNA(SUM())')).toBe('true');
    expect(evaluate('=ISNA(MOD(1,0))')).toBe('false');
  });

  it('should correctly evaluate ISLOGICAL function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: 'TRUE' });
    grid.set('A2', { v: '10' });

    expect(evaluate('=ISLOGICAL(TRUE)')).toBe('true');
    expect(evaluate('=ISLOGICAL(A1)', grid)).toBe('true');
    expect(evaluate('=ISLOGICAL(A2)', grid)).toBe('false');
  });

  it('should correctly evaluate ISNONTEXT function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '' });
    grid.set('A2', { v: 'hello' });
    grid.set('A3', { v: '10' });
    grid.set('A4', { v: 'TRUE' });

    expect(evaluate('=ISNONTEXT(10)')).toBe('true');
    expect(evaluate('=ISNONTEXT("hello")')).toBe('false');
    expect(evaluate('=ISNONTEXT(A1)', grid)).toBe('true');
    expect(evaluate('=ISNONTEXT(A2)', grid)).toBe('false');
    expect(evaluate('=ISNONTEXT(A3)', grid)).toBe('true');
    expect(evaluate('=ISNONTEXT(A4)', grid)).toBe('true');
    expect(evaluate('=ISNONTEXT(SUM())')).toBe('true');
  });

  it('should correctly evaluate IFERROR function', () => {
    expect(evaluate('=IFERROR(10,"error")')).toBe('10');
    expect(evaluate('=IFERROR("hello","error")')).toBe('hello');
    expect(evaluate('=IFERROR(1+2,"error")')).toBe('3');
    expect(evaluate('=IFERROR(SUM(),"fallback")')).toBe('fallback');
  });

  it('should correctly evaluate IFNA function', () => {
    expect(evaluate('=IFNA(SUM(),"fallback")')).toBe('fallback');
    expect(evaluate('=IFNA(MOD(1,0),"fallback")')).toBe('#VALUE!');
    expect(evaluate('=IFNA(10,"fallback")')).toBe('10');
  });

  it('should correctly extract references', () => {
    expect(extractReferences('=A1+B1')).toEqual(new Set(['A1', 'B1']));
    expect(extractReferences('=SUM(A1, A2:A3) + A4')).toEqual(
      new Set(['A1', 'A2:A3', 'A4']),
    );
  });

  it('should extract multi-letter column references', () => {
    expect(extractReferences('=AA1+AB2')).toEqual(new Set(['AA1', 'AB2']));
    expect(extractReferences('=SUM(AA1:AB2)')).toEqual(new Set(['AA1:AB2']));
  });

  it('should convert lowercase references to uppercase', () => {
    expect(extractReferences('=a1+b1')).toEqual(new Set(['A1', 'B1']));
    expect(extractReferences('=aa1+ab1')).toEqual(new Set(['AA1', 'AB1']));
  });

  it('should evaluate formulas with multi-letter column references', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('AA1', { v: '10' });
    grid.set('AB1', { v: '20' });

    expect(evaluate('=AA1+AB1', grid)).toBe('30');
    expect(evaluate('=SUM(AA1:AB1)', grid)).toBe('30');
  });
});

describe('Formula.isReferenceInsertPosition', () => {
  it('should return true after =', () => {
    expect(isReferenceInsertPosition('=', 1)).toBe(true);
  });

  it('should return true after (', () => {
    expect(isReferenceInsertPosition('=SUM(', 5)).toBe(true);
  });

  it('should return true after ,', () => {
    expect(isReferenceInsertPosition('=SUM(A1,', 9)).toBe(true);
  });

  it('should return true after operators', () => {
    expect(isReferenceInsertPosition('=A1+', 4)).toBe(true);
    expect(isReferenceInsertPosition('=A1-', 4)).toBe(true);
    expect(isReferenceInsertPosition('=A1*', 4)).toBe(true);
    expect(isReferenceInsertPosition('=A1/', 4)).toBe(true);
  });

  it('should return true after comparison operators', () => {
    expect(isReferenceInsertPosition('=A1>', 4)).toBe(true);
    expect(isReferenceInsertPosition('=A1<', 4)).toBe(true);
  });

  it('should return true on existing reference', () => {
    // Cursor at position 3 is within "A1" (positions 1-3 in full string)
    expect(isReferenceInsertPosition('=A1+B2', 2)).toBe(true);
    expect(isReferenceInsertPosition('=A1+B2', 3)).toBe(true);
  });

  it('should return false after )', () => {
    expect(isReferenceInsertPosition('=SUM(A1)', 9)).toBe(false);
  });

  it('should return false for non-formula strings', () => {
    expect(isReferenceInsertPosition('hello', 3)).toBe(false);
  });

  it('should return false at position 0', () => {
    expect(isReferenceInsertPosition('=A1', 0)).toBe(false);
  });

  it('should return true after = with spaces', () => {
    expect(isReferenceInsertPosition('= ', 2)).toBe(true);
  });

  it('should return true after : for range building', () => {
    expect(isReferenceInsertPosition('=A1:', 4)).toBe(true);
  });
});

describe('Formula.findReferenceTokenAtCursor', () => {
  it('should find reference at cursor', () => {
    const result = findReferenceTokenAtCursor('=A1+B2', 2);
    expect(result).toBeDefined();
    expect(result!.text).toBe('A1');
    expect(result!.start).toBe(1);
    expect(result!.end).toBe(3);
  });

  it('should find reference at cursor end', () => {
    const result = findReferenceTokenAtCursor('=A1+B2', 3);
    expect(result).toBeDefined();
    expect(result!.text).toBe('A1');
  });

  it('should find second reference', () => {
    const result = findReferenceTokenAtCursor('=A1+B2', 5);
    expect(result).toBeDefined();
    expect(result!.text).toBe('B2');
    expect(result!.start).toBe(4);
    expect(result!.end).toBe(6);
  });

  it('should return undefined when not on a reference', () => {
    // Position 4 in =1+2 is after the +, but there's no reference there
    expect(findReferenceTokenAtCursor('=1+2', 2)).toBeUndefined();
  });

  it('should return undefined for non-formula', () => {
    expect(findReferenceTokenAtCursor('hello', 2)).toBeUndefined();
  });

  it('should find range reference', () => {
    const result = findReferenceTokenAtCursor('=SUM(A1:B5)', 7);
    expect(result).toBeDefined();
    expect(result!.text).toBe('A1:B5');
  });

  it('should find multi-letter reference', () => {
    const result = findReferenceTokenAtCursor('=AA1+AB2', 2);
    expect(result).toBeDefined();
    expect(result!.text).toBe('AA1');
    expect(result!.start).toBe(1);
    expect(result!.end).toBe(4);
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

    expect(extractTokens('=AA1+AB2')).toEqual([
      { type: 'REFERENCE', start: 0, stop: 2, text: 'AA1' },
      { type: 'ADD', start: 3, stop: 3, text: '+' },
      { type: 'REFERENCE', start: 4, stop: 6, text: 'AB2' },
    ]);

    expect(extractTokens('=MY_FUNC(1)')).toEqual([
      { type: 'FUNCNAME', start: 0, stop: 6, text: 'MY_FUNC' },
      { type: 'STRING', start: 7, stop: 7, text: '(' },
      { type: 'NUM', start: 8, stop: 8, text: '1' },
      { type: 'STRING', start: 9, stop: 9, text: ')' },
    ]);

    expect(extractTokens('=MY.FUNC(1)')).toEqual([
      { type: 'FUNCNAME', start: 0, stop: 6, text: 'MY.FUNC' },
      { type: 'STRING', start: 7, stop: 7, text: '(' },
      { type: 'NUM', start: 8, stop: 8, text: '1' },
      { type: 'STRING', start: 9, stop: 9, text: ')' },
    ]);
  });
});
