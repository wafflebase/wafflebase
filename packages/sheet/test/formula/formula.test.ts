import { describe, it, expect, vi } from 'vitest';
import {
  evaluate,
  extractReferences,
  extractTokens,
  isReferenceInsertPosition,
  findReferenceTokenAtCursor,
  normalizeFormulaOnCommit,
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
    expect(evaluate('=SUM(1,2,3')).toBe('#ERROR!');
  });

  it('should normalize missing trailing function parenthesis on commit', () => {
    expect(normalizeFormulaOnCommit('=SUM(1,2,3')).toBe('=SUM(1,2,3)');
  });

  it('should not normalize unrelated invalid formulas on commit', () => {
    expect(normalizeFormulaOnCommit('=1+')).toBe('=1+');
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

  it('should correctly evaluate MATCH function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' });
    grid.set('A2', { v: '20' });
    grid.set('A3', { v: '30' });
    grid.set('B1', { v: '30' });
    grid.set('B2', { v: '20' });
    grid.set('B3', { v: '10' });
    grid.set('C1', { v: 'apple' });
    grid.set('C2', { v: 'banana' });
    grid.set('C3', { v: 'carrot' });

    expect(evaluate('=MATCH(20,A1:A3,0)', grid)).toBe('2');
    expect(evaluate('=MATCH("BANANA",C1:C3,0)', grid)).toBe('2');
    expect(evaluate('=MATCH(25,A1:A3,1)', grid)).toBe('2');
    expect(evaluate('=MATCH(25,B1:B3,0-1)', grid)).toBe('1');
    expect(evaluate('=MATCH(25,A1:B3,0)', grid)).toBe('#N/A!');
  });

  it('should correctly evaluate INDEX function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' });
    grid.set('B1', { v: '20' });
    grid.set('C1', { v: '30' });
    grid.set('A2', { v: '40' });
    grid.set('B2', { v: '50' });
    grid.set('C2', { v: '60' });

    expect(evaluate('=INDEX(A1:C2,2,3)', grid)).toBe('60');
    expect(evaluate('=INDEX(A1:C1,2)', grid)).toBe('20');
    expect(evaluate('=INDEX(A1:C2)', grid)).toBe('10');
    expect(evaluate('=INDEX(A1:C2,3,1)', grid)).toBe('#REF!');
    expect(evaluate('=INDEX(A1:C2,0,1)', grid)).toBe('#VALUE!');
  });

  it('should correctly evaluate VLOOKUP function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: 'A' });
    grid.set('A2', { v: 'B' });
    grid.set('A3', { v: 'C' });
    grid.set('B1', { v: '10' });
    grid.set('B2', { v: '20' });
    grid.set('B3', { v: '30' });
    grid.set('D1', { v: '1' });
    grid.set('D2', { v: '5' });
    grid.set('D3', { v: '10' });
    grid.set('E1', { v: '100' });
    grid.set('E2', { v: '500' });
    grid.set('E3', { v: '1000' });

    expect(evaluate('=VLOOKUP("b",A1:B3,2,FALSE)', grid)).toBe('20');
    expect(evaluate('=VLOOKUP(7,D1:E3,2,TRUE)', grid)).toBe('500');
    expect(evaluate('=VLOOKUP(0,D1:E3,2,TRUE)', grid)).toBe('#N/A!');
    expect(evaluate('=VLOOKUP("z",A1:B3,2,FALSE)', grid)).toBe('#N/A!');
    expect(evaluate('=VLOOKUP("A",A1:B3,3,FALSE)', grid)).toBe('#REF!');
  });

  it('should correctly evaluate HLOOKUP function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '1' });
    grid.set('B1', { v: '5' });
    grid.set('C1', { v: '10' });
    grid.set('A2', { v: '10' });
    grid.set('B2', { v: '50' });
    grid.set('C2', { v: '100' });
    grid.set('A3', { v: '100' });
    grid.set('B3', { v: '500' });
    grid.set('C3', { v: '1000' });

    expect(evaluate('=HLOOKUP(5,A1:C3,2,FALSE)', grid)).toBe('50');
    expect(evaluate('=HLOOKUP(7,A1:C3,3,TRUE)', grid)).toBe('500');
    expect(evaluate('=HLOOKUP(0,A1:C3,2,TRUE)', grid)).toBe('#N/A!');
    expect(evaluate('=HLOOKUP(8,A1:C3,2,FALSE)', grid)).toBe('#N/A!');
    expect(evaluate('=HLOOKUP(5,A1:C3,4,FALSE)', grid)).toBe('#REF!');
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

  it('should correctly evaluate PI function', () => {
    expect(evaluate('=PI()')).toBe(String(Math.PI));
    expect(evaluate('=PI(1)')).toBe('#N/A!');
  });

  it('should correctly evaluate SIGN function', () => {
    expect(evaluate('=SIGN(5)')).toBe('1');
    expect(evaluate('=SIGN(0-3)')).toBe('-1');
    expect(evaluate('=SIGN(0)')).toBe('0');
  });

  it('should correctly evaluate EVEN function', () => {
    expect(evaluate('=EVEN(1)')).toBe('2');
    expect(evaluate('=EVEN(2)')).toBe('2');
    expect(evaluate('=EVEN(3)')).toBe('4');
    expect(evaluate('=EVEN(0-1)')).toBe('-2');
    expect(evaluate('=EVEN(0)')).toBe('0');
    expect(evaluate('=EVEN(1.5)')).toBe('2');
  });

  it('should correctly evaluate ODD function', () => {
    expect(evaluate('=ODD(1)')).toBe('1');
    expect(evaluate('=ODD(2)')).toBe('3');
    expect(evaluate('=ODD(4)')).toBe('5');
    expect(evaluate('=ODD(0-1)')).toBe('-1');
    expect(evaluate('=ODD(0)')).toBe('1');
    expect(evaluate('=ODD(1.5)')).toBe('3');
  });

  it('should correctly evaluate EXP function', () => {
    expect(evaluate('=EXP(0)')).toBe('1');
    expect(evaluate('=EXP(1)')).toBe(String(Math.E));
  });

  it('should correctly evaluate LN function', () => {
    expect(evaluate('=LN(1)')).toBe('0');
    expect(evaluate('=LN(EXP(1))')).toBe('1');
    expect(evaluate('=LN(0)')).toBe('#VALUE!');
    expect(evaluate('=LN(0-1)')).toBe('#VALUE!');
  });

  it('should correctly evaluate LOG function', () => {
    expect(evaluate('=LOG(100)')).toBe('2');
    expect(evaluate('=LOG(8,2)')).toBe('3');
    expect(evaluate('=LOG(0)')).toBe('#VALUE!');
    expect(evaluate('=LOG(10,1)')).toBe('#VALUE!');
  });

  it('should correctly evaluate SIN function', () => {
    expect(evaluate('=SIN(0)')).toBe('0');
    expect(evaluate('=SIN(PI()/2)')).toBe('1');
  });

  it('should correctly evaluate COS function', () => {
    expect(evaluate('=COS(0)')).toBe('1');
    expect(evaluate('=COS(PI())')).toBe('-1');
  });

  it('should correctly evaluate TAN function', () => {
    expect(evaluate('=TAN(0)')).toBe('0');
  });

  it('should correctly evaluate ASIN function', () => {
    expect(evaluate('=ASIN(0)')).toBe('0');
    expect(evaluate('=ASIN(1)')).toBe(String(Math.PI / 2));
    expect(evaluate('=ASIN(2)')).toBe('#VALUE!');
  });

  it('should correctly evaluate ACOS function', () => {
    expect(evaluate('=ACOS(1)')).toBe('0');
    expect(evaluate('=ACOS(0)')).toBe(String(Math.PI / 2));
    expect(evaluate('=ACOS(2)')).toBe('#VALUE!');
  });

  it('should correctly evaluate ATAN function', () => {
    expect(evaluate('=ATAN(0)')).toBe('0');
    expect(evaluate('=ATAN(1)')).toBe(String(Math.PI / 4));
  });

  it('should correctly evaluate ATAN2 function', () => {
    expect(evaluate('=ATAN2(1,0)')).toBe('0');
    expect(evaluate('=ATAN2(0,1)')).toBe(String(Math.PI / 2));
    expect(evaluate('=ATAN2(0,0)')).toBe('#VALUE!');
  });

  it('should correctly evaluate DEGREES function', () => {
    expect(evaluate('=DEGREES(PI())')).toBe('180');
    expect(evaluate('=DEGREES(0)')).toBe('0');
  });

  it('should correctly evaluate RADIANS function', () => {
    expect(evaluate('=RADIANS(180)')).toBe(String(Math.PI));
    expect(evaluate('=RADIANS(0)')).toBe('0');
  });

  it('should correctly evaluate CEILING function', () => {
    expect(evaluate('=CEILING(2.5,1)')).toBe('3');
    expect(evaluate('=CEILING(1.5,0.5)')).toBe('1.5');
    expect(evaluate('=CEILING(0-2.5,1)')).toBe('-2');
    expect(evaluate('=CEILING(2.5,0)')).toBe('0');
    expect(evaluate('=CEILING(2.5,0-1)')).toBe('#VALUE!');
  });

  it('should correctly evaluate FLOOR function', () => {
    expect(evaluate('=FLOOR(2.5,1)')).toBe('2');
    expect(evaluate('=FLOOR(1.7,0.5)')).toBe('1.5');
    expect(evaluate('=FLOOR(0-2.5,1)')).toBe('-3');
    expect(evaluate('=FLOOR(2.5,0)')).toBe('0');
    expect(evaluate('=FLOOR(2.5,0-1)')).toBe('#VALUE!');
  });

  it('should correctly evaluate TRUNC function', () => {
    expect(evaluate('=TRUNC(8.9)')).toBe('8');
    expect(evaluate('=TRUNC(0-8.9)')).toBe('-8');
    expect(evaluate('=TRUNC(1.234,2)')).toBe('1.23');
    expect(evaluate('=TRUNC(1234,0-2)')).toBe('1200');
  });

  it('should correctly evaluate MROUND function', () => {
    expect(evaluate('=MROUND(10,3)')).toBe('9');
    expect(evaluate('=MROUND(12,5)')).toBe('10');
    expect(evaluate('=MROUND(13,5)')).toBe('15');
    expect(evaluate('=MROUND(0-10,0-3)')).toBe('-9');
    expect(evaluate('=MROUND(10,0-3)')).toBe('#VALUE!');
    expect(evaluate('=MROUND(10,0)')).toBe('0');
  });

  it('should correctly evaluate EXACT function', () => {
    expect(evaluate('=EXACT("hello","hello")')).toBe('true');
    expect(evaluate('=EXACT("hello","Hello")')).toBe('false');
    expect(evaluate('=EXACT("","")')).toBe('true');
  });

  it('should correctly evaluate REPLACE function', () => {
    expect(evaluate('=REPLACE("abcdef",3,2,"XY")')).toBe('abXYef');
    expect(evaluate('=REPLACE("hello",1,5,"world")')).toBe('world');
    expect(evaluate('=REPLACE("abc",2,0,"X")')).toBe('aXbc');
  });

  it('should correctly evaluate REPT function', () => {
    expect(evaluate('=REPT("ab",3)')).toBe('ababab');
    expect(evaluate('=REPT("x",0)')).toBe('');
    expect(evaluate('=REPT("x",0-1)')).toBe('#VALUE!');
  });

  it('should correctly evaluate T function', () => {
    expect(evaluate('=T("hello")')).toBe('hello');
    expect(evaluate('=T(123)')).toBe('');
  });

  it('should correctly evaluate VALUE function', () => {
    expect(evaluate('=VALUE("123")')).toBe('123');
    expect(evaluate('=VALUE("3.14")')).toBe('3.14');
    expect(evaluate('=VALUE("abc")')).toBe('#VALUE!');
    expect(evaluate('=VALUE("")')).toBe('#VALUE!');
  });

  it('should correctly evaluate TEXT function', () => {
    expect(evaluate('=TEXT(1234.5,"#,##0.00")')).toBe('1,234.50');
    expect(evaluate('=TEXT(0.75,"0%")')).toBe('75%');
    expect(evaluate('=TEXT(3.14159,"0.00")')).toBe('3.14');
    expect(evaluate('=TEXT(42,"0")')).toBe('42');
  });

  it('should correctly evaluate CHAR function', () => {
    expect(evaluate('=CHAR(65)')).toBe('A');
    expect(evaluate('=CHAR(97)')).toBe('a');
    expect(evaluate('=CHAR(0)')).toBe('#VALUE!');
  });

  it('should correctly evaluate CODE function', () => {
    expect(evaluate('=CODE("A")')).toBe('65');
    expect(evaluate('=CODE("abc")')).toBe('97');
    expect(evaluate('=CODE("")')).toBe('#VALUE!');
  });

  it('should correctly evaluate AVERAGEIF function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' });
    grid.set('A2', { v: '20' });
    grid.set('A3', { v: '30' });

    expect(evaluate('=AVERAGEIF(A1:A3,">15")', grid)).toBe('25');
    expect(evaluate('=AVERAGEIF(A1:A3,">=10")', grid)).toBe('20');
  });

  it('should correctly evaluate AVERAGEIFS function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: 'north' });
    grid.set('A2', { v: 'north' });
    grid.set('A3', { v: 'south' });
    grid.set('B1', { v: '10' });
    grid.set('B2', { v: '20' });
    grid.set('B3', { v: '30' });

    expect(evaluate('=AVERAGEIFS(B1:B3,A1:A3,"north")', grid)).toBe('15');
  });

  it('should correctly evaluate LARGE function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' });
    grid.set('A2', { v: '30' });
    grid.set('A3', { v: '20' });

    expect(evaluate('=LARGE(A1:A3,1)', grid)).toBe('30');
    expect(evaluate('=LARGE(A1:A3,2)', grid)).toBe('20');
    expect(evaluate('=LARGE(A1:A3,3)', grid)).toBe('10');
    expect(evaluate('=LARGE(A1:A3,4)', grid)).toBe('#VALUE!');
  });

  it('should correctly evaluate SMALL function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' });
    grid.set('A2', { v: '30' });
    grid.set('A3', { v: '20' });

    expect(evaluate('=SMALL(A1:A3,1)', grid)).toBe('10');
    expect(evaluate('=SMALL(A1:A3,2)', grid)).toBe('20');
    expect(evaluate('=SMALL(A1:A3,3)', grid)).toBe('30');
    expect(evaluate('=SMALL(A1:A3,4)', grid)).toBe('#VALUE!');
  });

  it('should correctly evaluate N function', () => {
    expect(evaluate('=N(42)')).toBe('42');
    expect(evaluate('=N("hello")')).toBe('0');
    expect(evaluate('=N(TRUE)')).toBe('1');
    expect(evaluate('=N(FALSE)')).toBe('0');
  });

  it('should correctly evaluate SUMPRODUCT function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '1' });
    grid.set('A2', { v: '2' });
    grid.set('A3', { v: '3' });
    grid.set('B1', { v: '4' });
    grid.set('B2', { v: '5' });
    grid.set('B3', { v: '6' });

    expect(evaluate('=SUMPRODUCT(A1:A3,B1:B3)', grid)).toBe('32');
    expect(evaluate('=SUMPRODUCT(A1:A3)', grid)).toBe('6');
  });

  it('should correctly evaluate GCD function', () => {
    expect(evaluate('=GCD(12,8)')).toBe('4');
    expect(evaluate('=GCD(24,36,48)')).toBe('12');
    expect(evaluate('=GCD(7,13)')).toBe('1');
  });

  it('should correctly evaluate LCM function', () => {
    expect(evaluate('=LCM(4,6)')).toBe('12');
    expect(evaluate('=LCM(3,5,7)')).toBe('105');
    expect(evaluate('=LCM(5,0)')).toBe('0');
  });

  it('should correctly evaluate COMBIN function', () => {
    expect(evaluate('=COMBIN(5,2)')).toBe('10');
    expect(evaluate('=COMBIN(10,3)')).toBe('120');
    expect(evaluate('=COMBIN(5,0)')).toBe('1');
    expect(evaluate('=COMBIN(5,6)')).toBe('#VALUE!');
  });

  it('should correctly evaluate FACT function', () => {
    expect(evaluate('=FACT(5)')).toBe('120');
    expect(evaluate('=FACT(0)')).toBe('1');
    expect(evaluate('=FACT(1)')).toBe('1');
    expect(evaluate('=FACT(0-1)')).toBe('#VALUE!');
  });

  it('should correctly evaluate QUOTIENT function', () => {
    expect(evaluate('=QUOTIENT(5,2)')).toBe('2');
    expect(evaluate('=QUOTIENT(0-10,3)')).toBe('-3');
    expect(evaluate('=QUOTIENT(10,0)')).toBe('#VALUE!');
  });

  it('should correctly evaluate XOR function', () => {
    expect(evaluate('=XOR(TRUE,FALSE)')).toBe('true');
    expect(evaluate('=XOR(TRUE,TRUE)')).toBe('false');
    expect(evaluate('=XOR(FALSE,FALSE)')).toBe('false');
    expect(evaluate('=XOR(TRUE,TRUE,TRUE)')).toBe('true');
  });

  it('should correctly evaluate CHOOSE function', () => {
    expect(evaluate('=CHOOSE(1,"a","b","c")')).toBe('a');
    expect(evaluate('=CHOOSE(3,"a","b","c")')).toBe('c');
    expect(evaluate('=CHOOSE(0,"a","b")')).toBe('#VALUE!');
    expect(evaluate('=CHOOSE(4,"a","b","c")')).toBe('#VALUE!');
  });

  it('should correctly evaluate TYPE function', () => {
    expect(evaluate('=TYPE(1)')).toBe('1');
    expect(evaluate('=TYPE("hello")')).toBe('2');
    expect(evaluate('=TYPE(TRUE)')).toBe('4');
    expect(evaluate('=TYPE(SUM())')).toBe('16');
  });

  it('should correctly evaluate EDATE function', () => {
    expect(evaluate('=EDATE("2024-01-31",1)')).toBe('2024-03-02');
    expect(evaluate('=EDATE("2024-03-15",0-1)')).toBe('2024-02-15');
    expect(evaluate('=EDATE("2024-01-15",12)')).toBe('2025-01-15');
  });

  it('should correctly evaluate EOMONTH function', () => {
    expect(evaluate('=EOMONTH("2024-01-15",0)')).toBe('2024-01-31');
    expect(evaluate('=EOMONTH("2024-01-15",1)')).toBe('2024-02-29');
    expect(evaluate('=EOMONTH("2024-01-15",0-1)')).toBe('2023-12-31');
  });

  it('should correctly evaluate NETWORKDAYS function', () => {
    expect(evaluate('=NETWORKDAYS("2024-03-11","2024-03-15")')).toBe('5');
    expect(evaluate('=NETWORKDAYS("2024-03-11","2024-03-17")')).toBe('5');
  });

  it('should correctly evaluate DATEVALUE function', () => {
    expect(evaluate('=DATEVALUE("2024-03-15")')).toBe('2024-03-15');
    expect(evaluate('=DATEVALUE("invalid")')).toBe('#VALUE!');
  });

  it('should correctly evaluate TIMEVALUE function', () => {
    expect(evaluate('=TIMEVALUE("12:00:00")')).toBe('0.5');
    expect(evaluate('=TIMEVALUE("06:00:00")')).toBe('0.25');
  });

  it('should correctly evaluate DATEDIF function', () => {
    expect(evaluate('=DATEDIF("2024-01-01","2024-12-31","D")')).toBe('365');
    expect(evaluate('=DATEDIF("2024-01-01","2024-06-01","M")')).toBe('5');
    expect(evaluate('=DATEDIF("2022-01-01","2024-06-01","Y")')).toBe('2');
    expect(evaluate('=DATEDIF("2024-06-01","2024-01-01","D")')).toBe('#VALUE!');
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
