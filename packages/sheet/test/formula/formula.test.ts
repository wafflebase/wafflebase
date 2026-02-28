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

  it('should correctly evaluate ROW function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A5', { v: '10' });
    expect(evaluate('=ROW(A5)', grid)).toBe('5');
    expect(evaluate('=ROW(B10)', grid)).toBe('10');
  });

  it('should correctly evaluate COLUMN function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('C1', { v: '10' });
    expect(evaluate('=COLUMN(A1)', grid)).toBe('1');
    expect(evaluate('=COLUMN(C1)', grid)).toBe('3');
  });

  it('should correctly evaluate ROWS function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '1' });
    expect(evaluate('=ROWS(A1:A5)', grid)).toBe('5');
    expect(evaluate('=ROWS(A1:C3)', grid)).toBe('3');
    expect(evaluate('=ROWS(A1)', grid)).toBe('1');
  });

  it('should correctly evaluate COLUMNS function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '1' });
    expect(evaluate('=COLUMNS(A1:C1)', grid)).toBe('3');
    expect(evaluate('=COLUMNS(A1:C3)', grid)).toBe('3');
    expect(evaluate('=COLUMNS(A1)', grid)).toBe('1');
  });

  it('should correctly evaluate ADDRESS function', () => {
    expect(evaluate('=ADDRESS(1,1)')).toBe('$A$1');
    expect(evaluate('=ADDRESS(1,1,2)')).toBe('A$1');
    expect(evaluate('=ADDRESS(1,1,3)')).toBe('$A1');
    expect(evaluate('=ADDRESS(1,1,4)')).toBe('A1');
    expect(evaluate('=ADDRESS(5,27)')).toBe('$AA$5');
  });

  it('should correctly evaluate HYPERLINK function', () => {
    expect(evaluate('=HYPERLINK("https://example.com","Click")')).toBe('Click');
    expect(evaluate('=HYPERLINK("https://example.com")')).toBe('https://example.com');
  });

  it('should correctly evaluate MINIFS function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' });
    grid.set('A2', { v: '20' });
    grid.set('A3', { v: '30' });
    grid.set('A4', { v: '5' });
    grid.set('B1', { v: 'yes' });
    grid.set('B2', { v: 'no' });
    grid.set('B3', { v: 'yes' });
    grid.set('B4', { v: 'yes' });
    expect(evaluate('=MINIFS(A1:A4,B1:B4,"yes")', grid)).toBe('5');
    expect(evaluate('=MINIFS(A1:A4,B1:B4,"no")', grid)).toBe('20');
  });

  it('should correctly evaluate MAXIFS function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' });
    grid.set('A2', { v: '20' });
    grid.set('A3', { v: '30' });
    grid.set('A4', { v: '5' });
    grid.set('B1', { v: 'yes' });
    grid.set('B2', { v: 'no' });
    grid.set('B3', { v: 'yes' });
    grid.set('B4', { v: 'yes' });
    expect(evaluate('=MAXIFS(A1:A4,B1:B4,"yes")', grid)).toBe('30');
    expect(evaluate('=MAXIFS(A1:A4,B1:B4,"no")', grid)).toBe('20');
  });

  it('should correctly evaluate RANK function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' });
    grid.set('A2', { v: '30' });
    grid.set('A3', { v: '20' });
    grid.set('A4', { v: '40' });
    // Descending (default)
    expect(evaluate('=RANK(40,A1:A4)', grid)).toBe('1');
    expect(evaluate('=RANK(10,A1:A4)', grid)).toBe('4');
    expect(evaluate('=RANK(20,A1:A4,0)', grid)).toBe('3');
    // Ascending
    expect(evaluate('=RANK(10,A1:A4,1)', grid)).toBe('1');
    expect(evaluate('=RANK(40,A1:A4,1)', grid)).toBe('4');
    // Not found
    expect(evaluate('=RANK(99,A1:A4)', grid)).toBe('#N/A!');
  });

  it('should correctly evaluate PERCENTILE function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' });
    grid.set('A2', { v: '20' });
    grid.set('A3', { v: '30' });
    grid.set('A4', { v: '40' });
    grid.set('A5', { v: '50' });
    expect(evaluate('=PERCENTILE(A1:A5,0)', grid)).toBe('10');
    expect(evaluate('=PERCENTILE(A1:A5,1)', grid)).toBe('50');
    expect(evaluate('=PERCENTILE(A1:A5,0.5)', grid)).toBe('30');
    expect(evaluate('=PERCENTILE(A1:A5,0.25)', grid)).toBe('20');
    // Invalid k
    expect(evaluate('=PERCENTILE(A1:A5,1.5)', grid)).toBe('#VALUE!');
  });

  it('should correctly evaluate CLEAN function', () => {
    expect(evaluate('=CLEAN("hello")')).toBe('hello');
    expect(evaluate('=CLEAN("abc")')).toBe('abc');
  });

  it('should correctly evaluate STDEV function', () => {
    // population stdev = 2, sample stdev = sqrt(32/7) ≈ 2.138
    const result = Number(evaluate('=STDEV(2,4,4,4,5,5,7,9)'));
    expect(result).toBeCloseTo(2.138, 2);
    // Single value should error (need at least 2 for sample)
    expect(evaluate('=STDEV(5)')).toBe('#VALUE!');
  });

  it('should correctly evaluate STDEVP function', () => {
    expect(evaluate('=STDEVP(2,4,4,4,5,5,7,9)')).toBe('2');
    expect(evaluate('=STDEVP(1,1,1)')).toBe('0');
  });

  it('should correctly evaluate VAR function', () => {
    // sample variance = 32/7 ≈ 4.571
    const result = Number(evaluate('=VAR(2,4,4,4,5,5,7,9)'));
    expect(result).toBeCloseTo(4.571, 2);
    expect(evaluate('=VAR(5)')).toBe('#VALUE!');
  });

  it('should correctly evaluate VARP function', () => {
    expect(evaluate('=VARP(2,4,4,4,5,5,7,9)')).toBe('4');
    expect(evaluate('=VARP(1,1,1)')).toBe('0');
  });

  it('should correctly evaluate MODE function', () => {
    expect(evaluate('=MODE(1,2,2,3,3,3)')).toBe('3');
    expect(evaluate('=MODE(1,2,3)')).toBe('#N/A!');
  });

  it('should correctly evaluate SUMSQ function', () => {
    expect(evaluate('=SUMSQ(1,2,3)')).toBe('14');
    expect(evaluate('=SUMSQ(4,5)')).toBe('41');
  });

  it('should correctly evaluate NA function', () => {
    expect(evaluate('=NA()')).toBe('#N/A!');
    expect(evaluate('=IFERROR(NA(),"caught")')).toBe('caught');
  });

  it('should correctly evaluate QUARTILE function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '1' });
    grid.set('A2', { v: '2' });
    grid.set('A3', { v: '3' });
    grid.set('A4', { v: '4' });
    expect(evaluate('=QUARTILE(A1:A4,0)', grid)).toBe('1');
    expect(evaluate('=QUARTILE(A1:A4,2)', grid)).toBe('2.5');
    expect(evaluate('=QUARTILE(A1:A4,4)', grid)).toBe('4');
  });

  it('should correctly evaluate COUNTUNIQUE function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: 'a' });
    grid.set('A2', { v: 'b' });
    grid.set('A3', { v: 'a' });
    grid.set('A4', { v: 'c' });
    expect(evaluate('=COUNTUNIQUE(A1:A4)', grid)).toBe('3');
    expect(evaluate('=COUNTUNIQUE(1,1,2,3)')).toBe('3');
  });

  it('should correctly evaluate FIXED function', () => {
    expect(evaluate('=FIXED(1234.567,2)')).toBe('1,234.57');
    expect(evaluate('=FIXED(1234.567,2,TRUE)')).toBe('1234.57');
    expect(evaluate('=FIXED(1234.567,0)')).toBe('1,235');
    expect(evaluate('=FIXED(44.332)')).toBe('44.33');
  });

  it('should correctly evaluate DOLLAR function', () => {
    expect(evaluate('=DOLLAR(1234.567,2)')).toBe('$1,234.57');
    expect(evaluate('=DOLLAR(1234.567,0)')).toBe('$1,235');
    expect(evaluate('=DOLLAR(0-1234.567,2)')).toBe('($1,234.57)');
  });

  it('should correctly evaluate NUMBERVALUE function', () => {
    expect(evaluate('=NUMBERVALUE("123")')).toBe('123');
    expect(evaluate('=NUMBERVALUE("1,234.56")')).toBe('1234.56');
    expect(evaluate('=NUMBERVALUE("1.234,56",",",".")')).toBe('1234.56');
    expect(evaluate('=NUMBERVALUE("50%")')).toBe('0.5');
    expect(evaluate('=NUMBERVALUE("abc")')).toBe('#VALUE!');
  });

  it('should correctly evaluate WEEKNUM function', () => {
    // DATE(2024,1,1) is Monday, serial 45292
    expect(evaluate('=WEEKNUM(DATE(2024,1,1))')).toBe('1');
    expect(evaluate('=WEEKNUM(DATE(2024,1,7))')).toBe('2');
  });

  it('should correctly evaluate ISOWEEKNUM function', () => {
    // 2024-01-01 is Monday, ISO week 1
    expect(evaluate('=ISOWEEKNUM(DATE(2024,1,1))')).toBe('1');
  });

  it('should correctly evaluate WORKDAY function', () => {
    // DATE(2024,1,1) is Monday, 5 working days → 2024-01-08 (next Monday)
    expect(evaluate('=WORKDAY("2024-01-01",5)')).toBe('2024-01-08');
    // 1 working day from Friday → Monday
    expect(evaluate('=WORKDAY("2024-01-05",1)')).toBe('2024-01-08');
  });

  it('should correctly evaluate YEARFRAC function', () => {
    // 366 days (2024 is leap) / 365 ≈ 1.0027
    const result = Number(evaluate('=YEARFRAC("2024-01-01","2025-01-01",3)'));
    expect(result).toBeCloseTo(1.003, 2);
    // 2023 is not a leap year: 365/365 = 1
    expect(evaluate('=YEARFRAC("2023-01-01","2024-01-01",3)')).toBe('1');
  });

  it('should correctly evaluate LOOKUP function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' });
    grid.set('A2', { v: '20' });
    grid.set('A3', { v: '30' });
    grid.set('B1', { v: 'ten' });
    grid.set('B2', { v: 'twenty' });
    grid.set('B3', { v: 'thirty' });
    expect(evaluate('=LOOKUP(20,A1:A3,B1:B3)', grid)).toBe('twenty');
    expect(evaluate('=LOOKUP(25,A1:A3,B1:B3)', grid)).toBe('twenty');
    expect(evaluate('=LOOKUP(30,A1:A3,B1:B3)', grid)).toBe('thirty');
  });

  it('should correctly evaluate INDIRECT function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '42' });
    expect(evaluate('=INDIRECT("A1")', grid)).toBe('42');
  });

  it('should correctly evaluate ERROR.TYPE function', () => {
    expect(evaluate('=ERROR.TYPE(NA())')).toBe('7'); // #N/A!
    // Non-error returns #N/A!
    expect(evaluate('=ERROR.TYPE(1)')).toBe('#N/A!');
    expect(evaluate('=ERROR.TYPE("hello")')).toBe('#N/A!');
  });

  it('should correctly evaluate ISDATE function', () => {
    expect(evaluate('=ISDATE("2024-01-01")')).toBe('true');
    expect(evaluate('=ISDATE("not a date")')).toBe('false');
    expect(evaluate('=ISDATE(123)')).toBe('false');
  });

  it('should correctly evaluate SPLIT function', () => {
    expect(evaluate('=SPLIT("a,b,c",",")')).toBe('a');
  });

  it('should correctly evaluate JOIN function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: 'a' });
    grid.set('A2', { v: 'b' });
    grid.set('A3', { v: 'c' });
    expect(evaluate('=JOIN(",",A1:A3)', grid)).toBe('a,b,c');
    expect(evaluate('=JOIN("-","x","y","z")')).toBe('x-y-z');
  });

  it('should correctly evaluate REGEXMATCH function', () => {
    expect(evaluate('=REGEXMATCH("hello world","hello")')).toBe('true');
    expect(evaluate('=REGEXMATCH("hello","^h.*o$")')).toBe('true');
    expect(evaluate('=REGEXMATCH("hello","xyz")')).toBe('false');
  });

  it('should correctly evaluate FORECAST function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '1' });
    grid.set('A2', { v: '2' });
    grid.set('A3', { v: '3' });
    grid.set('B1', { v: '2' });
    grid.set('B2', { v: '4' });
    grid.set('B3', { v: '6' });
    // y = 2x, so FORECAST(4) = 8
    expect(evaluate('=FORECAST(4,B1:B3,A1:A3)', grid)).toBe('8');
  });

  it('should correctly evaluate SLOPE function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '1' });
    grid.set('A2', { v: '2' });
    grid.set('A3', { v: '3' });
    grid.set('B1', { v: '2' });
    grid.set('B2', { v: '4' });
    grid.set('B3', { v: '6' });
    expect(evaluate('=SLOPE(B1:B3,A1:A3)', grid)).toBe('2');
  });

  it('should correctly evaluate INTERCEPT function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '1' });
    grid.set('A2', { v: '2' });
    grid.set('A3', { v: '3' });
    grid.set('B1', { v: '2' });
    grid.set('B2', { v: '4' });
    grid.set('B3', { v: '6' });
    // y = 2x + 0, intercept = 0
    expect(evaluate('=INTERCEPT(B1:B3,A1:A3)', grid)).toBe('0');
  });

  it('should correctly evaluate CORREL function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '1' });
    grid.set('A2', { v: '2' });
    grid.set('A3', { v: '3' });
    grid.set('B1', { v: '2' });
    grid.set('B2', { v: '4' });
    grid.set('B3', { v: '6' });
    // Perfect positive correlation
    expect(evaluate('=CORREL(B1:B3,A1:A3)', grid)).toBe('1');
  });

  it('should correctly evaluate XLOOKUP function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' });
    grid.set('A2', { v: '20' });
    grid.set('A3', { v: '30' });
    grid.set('B1', { v: 'ten' });
    grid.set('B2', { v: 'twenty' });
    grid.set('B3', { v: 'thirty' });
    // Exact match
    expect(evaluate('=XLOOKUP(20,A1:A3,B1:B3)', grid)).toBe('twenty');
    // Not found with fallback
    expect(evaluate('=XLOOKUP(99,A1:A3,B1:B3,"missing")', grid)).toBe('missing');
    // Not found without fallback
    expect(evaluate('=XLOOKUP(99,A1:A3,B1:B3)', grid)).toBe('#N/A!');
  });

  it('should correctly evaluate OFFSET function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' });
    grid.set('B1', { v: '20' });
    grid.set('A2', { v: '30' });
    grid.set('B2', { v: '40' });
    // OFFSET(A1, 1, 1) = B2 = 40
    expect(evaluate('=OFFSET(A1,1,1)', grid)).toBe('40');
    // OFFSET(A1, 0, 1) = B1 = 20
    expect(evaluate('=OFFSET(A1,0,1)', grid)).toBe('20');
  });

  it('should correctly evaluate ISEVEN and ISODD functions', () => {
    expect(evaluate('=ISEVEN(4)')).toBe('true');
    expect(evaluate('=ISEVEN(3)')).toBe('false');
    expect(evaluate('=ISODD(3)')).toBe('true');
    expect(evaluate('=ISODD(4)')).toBe('false');
  });

  it('should correctly evaluate FACTDOUBLE function', () => {
    expect(evaluate('=FACTDOUBLE(5)')).toBe('15'); // 5*3*1
    expect(evaluate('=FACTDOUBLE(6)')).toBe('48'); // 6*4*2
    expect(evaluate('=FACTDOUBLE(0)')).toBe('1');
  });

  it('should correctly evaluate BASE and DECIMAL functions', () => {
    expect(evaluate('=BASE(255,16)')).toBe('FF');
    expect(evaluate('=BASE(10,2)')).toBe('1010');
    expect(evaluate('=BASE(10,2,8)')).toBe('00001010');
    expect(evaluate('=DECIMAL("FF",16)')).toBe('255');
    expect(evaluate('=DECIMAL("1010",2)')).toBe('10');
  });

  it('should correctly evaluate SQRTPI function', () => {
    const result = Number(evaluate('=SQRTPI(1)'));
    expect(result).toBeCloseTo(Math.sqrt(Math.PI), 10);
    expect(evaluate('=SQRTPI(0)')).toBe('0');
  });

  it('should correctly evaluate hyperbolic functions', () => {
    expect(evaluate('=SINH(0)')).toBe('0');
    expect(evaluate('=COSH(0)')).toBe('1');
    expect(evaluate('=TANH(0)')).toBe('0');
    expect(evaluate('=ASINH(0)')).toBe('0');
    expect(evaluate('=ACOSH(1)')).toBe('0');
    expect(evaluate('=ATANH(0)')).toBe('0');
  });

  it('should correctly evaluate COT, CSC, SEC functions', () => {
    const cotResult = Number(evaluate('=COT(1)'));
    expect(cotResult).toBeCloseTo(1 / Math.tan(1), 10);
    const cscResult = Number(evaluate('=CSC(1)'));
    expect(cscResult).toBeCloseTo(1 / Math.sin(1), 10);
    const secResult = Number(evaluate('=SEC(0)'));
    expect(secResult).toBeCloseTo(1, 10);
  });

  it('should correctly evaluate REGEXEXTRACT function', () => {
    expect(evaluate('=REGEXEXTRACT("abc123","[0-9]+")')).toBe('123');
    expect(evaluate('=REGEXEXTRACT("hello","(h.*o)")')).toBe('hello');
    expect(evaluate('=REGEXEXTRACT("abc","xyz")')).toBe('#N/A!');
  });

  it('should correctly evaluate REGEXREPLACE function', () => {
    expect(evaluate('=REGEXREPLACE("abc123","[0-9]+","NUM")')).toBe('abcNUM');
    expect(evaluate('=REGEXREPLACE("hello world","world","earth")')).toBe('hello earth');
  });

  it('should correctly evaluate UNICODE and UNICHAR functions', () => {
    expect(evaluate('=UNICODE("A")')).toBe('65');
    expect(evaluate('=UNICHAR(65)')).toBe('A');
    expect(evaluate('=UNICHAR(UNICODE("Z"))')).toBe('Z');
  });

  it('should correctly evaluate GEOMEAN function', () => {
    expect(evaluate('=GEOMEAN(4,9)')).toBe('6');
    expect(evaluate('=GEOMEAN(1,2,4)')).toBe('2');
  });

  it('should correctly evaluate HARMEAN function', () => {
    // HARMEAN(1,2,4) = 3 / (1 + 0.5 + 0.25) = 3/1.75 ≈ 1.714
    const result = Number(evaluate('=HARMEAN(1,2,4)'));
    expect(result).toBeCloseTo(12 / 7, 10);
  });

  it('should correctly evaluate AVEDEV function', () => {
    // AVEDEV(2,4,6) mean=4, deviations: 2,0,2 → avg=4/3
    const result = Number(evaluate('=AVEDEV(2,4,6)'));
    expect(result).toBeCloseTo(4 / 3, 10);
  });

  it('should correctly evaluate DEVSQ function', () => {
    // DEVSQ(2,4,6) mean=4, sq devs: 4,0,4 → sum=8
    expect(evaluate('=DEVSQ(2,4,6)')).toBe('8');
  });

  it('should correctly evaluate TRIMMEAN function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '1' });
    grid.set('A2', { v: '2' });
    grid.set('A3', { v: '3' });
    grid.set('A4', { v: '4' });
    // 0% trim = regular mean = 2.5
    expect(evaluate('=TRIMMEAN(A1:A4,0)', grid)).toBe('2.5');
  });

  it('should correctly evaluate PERMUT function', () => {
    expect(evaluate('=PERMUT(5,2)')).toBe('20'); // 5*4 = 20
    expect(evaluate('=PERMUT(4,4)')).toBe('24'); // 4! = 24
  });

  // --- Batch 16: Financial functions ---
  it('should correctly evaluate PMT function', () => {
    // PMT(0.05/12, 360, 200000) — monthly payment on $200k mortgage at 5%
    const result = evaluate('=PMT(0.05/12,360,200000)');
    expect(Number(result)).toBeCloseTo(-1073.64, 1);
  });

  it('should correctly evaluate FV function', () => {
    // FV(0.06/12, 120, 0-200, 0) — $200/month at 6% for 10 years
    const result = evaluate('=FV(0.06/12,120,0-200,0)');
    expect(Number(result)).toBeCloseTo(32775.87, 0);
  });

  it('should correctly evaluate PV function', () => {
    // PV(0.08/12, 240, 0-500) — present value of $500/month at 8% for 20 years
    const result = evaluate('=PV(0.08/12,240,0-500)');
    expect(Number(result)).toBeCloseTo(59777.15, 0);
  });

  it('should correctly evaluate NPV function', () => {
    // NPV(0.1, 100, 200, 300) — cash flows at 10% discount
    const result = evaluate('=NPV(0.1,100,200,300)');
    expect(Number(result)).toBeCloseTo(481.59, 1);
  });

  it('should correctly evaluate NPER function', () => {
    // NPER(0.06/12, 0-200, 10000) — how many months to pay off $10k at 6%
    const result = evaluate('=NPER(0.06/12,0-200,10000)');
    expect(Number(result)).toBeCloseTo(57.68, 1);
  });

  it('should correctly evaluate IPMT function', () => {
    // IPMT(0.1/12, 1, 36, 8000) — interest in period 1 on $8000 loan at 10%
    const result = evaluate('=IPMT(0.1/12,1,36,8000)');
    expect(Number(result)).toBeCloseTo(66.67, 1);
  });

  it('should correctly evaluate PPMT function', () => {
    // PPMT(0.1/12, 1, 36, 8000) — principal in period 1 on $8000 loan at 10%
    const result = evaluate('=PPMT(0.1/12,1,36,8000)');
    expect(Number(result)).toBeCloseTo(-324.76, 0);
  });

  it('should correctly evaluate SLN function', () => {
    expect(evaluate('=SLN(10000,1000,5)')).toBe('1800'); // (10000-1000)/5
  });

  it('should correctly evaluate EFFECT function', () => {
    // EFFECT(0.1, 4) — 10% nominal compounded quarterly
    const result = evaluate('=EFFECT(0.1,4)');
    expect(Number(result)).toBeCloseTo(0.10381, 4);
  });

  // --- Batch 17: More Financial functions ---
  it('should correctly evaluate RATE function', () => {
    // RATE(360, 0-1073.64, 200000) — rate for $200k loan, ~$1073.64/mo, 360 months
    const result = evaluate('=RATE(360,0-1073.64,200000)');
    expect(Number(result)).toBeCloseTo(0.05 / 12, 4);
  });

  it('should correctly evaluate IRR function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '-10000' } as Cell);
    grid.set('A2', { v: '3000' } as Cell);
    grid.set('A3', { v: '4200' } as Cell);
    grid.set('A4', { v: '6800' } as Cell);
    const result = evaluate('=IRR(A1:A4)', grid);
    expect(Number(result)).toBeCloseTo(0.1634, 2);
  });

  it('should correctly evaluate DB function', () => {
    // DB(1000000, 100000, 6, 1, 7)
    const result = evaluate('=DB(1000000,100000,6,1,7)');
    expect(Number(result)).toBeCloseTo(186083.33, 0);
  });

  it('should correctly evaluate DDB function', () => {
    // DDB(10000, 1000, 5, 1) — double declining on $10k, $1k salvage, 5yr, period 1
    expect(evaluate('=DDB(10000,1000,5,1)')).toBe('4000'); // 10000 * 2/5
  });

  it('should correctly evaluate NOMINAL function', () => {
    // NOMINAL(0.10381, 4) — effective 10.381% quarterly → ~10% nominal
    const result = evaluate('=NOMINAL(0.10381,4)');
    expect(Number(result)).toBeCloseTo(0.1, 3);
  });

  it('should correctly evaluate CUMIPMT function', () => {
    // CUMIPMT(0.1/12, 30, 100000, 1, 12, 0) — interest paid in year 1 on $100k loan
    const result = evaluate('=CUMIPMT(0.1/12,30,100000,1,12,0)');
    expect(Number(result)).toBeGreaterThan(0);
  });

  it('should correctly evaluate CUMPRINC function', () => {
    // CUMPRINC(0.1/12, 30, 100000, 1, 12, 0) — principal paid in year 1
    const result = evaluate('=CUMPRINC(0.1/12,30,100000,1,12,0)');
    expect(Number(result)).toBeLessThan(0);
  });

  // --- Batch 18: Extended Statistical functions ---
  it('should correctly evaluate AVERAGEA function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' } as Cell);
    grid.set('A2', { v: 'hello' } as Cell);
    grid.set('A3', { v: '20' } as Cell);
    // Text "hello" counts as 0, so (10+0+20)/3 = 10
    expect(evaluate('=AVERAGEA(A1:A3)', grid)).toBe('10');
  });

  it('should correctly evaluate MINA function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' } as Cell);
    grid.set('A2', { v: 'hello' } as Cell);
    grid.set('A3', { v: '20' } as Cell);
    // Text "hello" counts as 0, so min is 0
    expect(evaluate('=MINA(A1:A3)', grid)).toBe('0');
  });

  it('should correctly evaluate MAXA function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' } as Cell);
    grid.set('A2', { v: 'hello' } as Cell);
    grid.set('A3', { v: '20' } as Cell);
    expect(evaluate('=MAXA(A1:A3)', grid)).toBe('20');
  });

  it('should correctly evaluate FISHER function', () => {
    const result = evaluate('=FISHER(0.5)');
    expect(Number(result)).toBeCloseTo(0.5493, 3);
  });

  it('should correctly evaluate FISHERINV function', () => {
    const result = evaluate('=FISHERINV(0.5493)');
    expect(Number(result)).toBeCloseTo(0.5, 2);
  });

  it('should correctly evaluate GAMMA function', () => {
    // GAMMA(5) = 4! = 24
    expect(Number(evaluate('=GAMMA(5)'))).toBeCloseTo(24, 5);
    // GAMMA(0.5) = sqrt(pi)
    expect(Number(evaluate('=GAMMA(0.5)'))).toBeCloseTo(Math.sqrt(Math.PI), 4);
  });

  it('should correctly evaluate GAMMALN function', () => {
    // GAMMALN(5) = ln(24)
    expect(Number(evaluate('=GAMMALN(5)'))).toBeCloseTo(Math.log(24), 4);
  });

  it('should correctly evaluate NORMDIST function', () => {
    // NORMDIST(0, 0, 1, 1) — CDF at 0 for standard normal = 0.5
    const result = evaluate('=NORMDIST(0,0,1,1)');
    expect(Number(result)).toBeCloseTo(0.5, 4);
  });

  it('should correctly evaluate NORMINV function', () => {
    // NORMINV(0.5, 0, 1) = 0 (median of standard normal)
    const result = evaluate('=NORMINV(0.5,0,1)');
    expect(Number(result)).toBeCloseTo(0, 2);
  });

  it('should correctly evaluate LOGNORMAL.DIST function', () => {
    const result = evaluate('=LOGNORMAL.DIST(1,0,1,1)');
    expect(Number(result)).toBeCloseTo(0.5, 2);
  });

  it('should correctly evaluate LOGNORMAL.INV function', () => {
    const result = evaluate('=LOGNORMAL.INV(0.5,0,1)');
    expect(Number(result)).toBeCloseTo(1, 2);
  });

  it('should correctly evaluate STANDARDIZE function', () => {
    expect(evaluate('=STANDARDIZE(10,5,2)')).toBe('2.5');
  });

  it('should correctly evaluate WEIBULL.DIST function', () => {
    // WEIBULL.DIST(1, 1, 1, 1) — CDF = 1 - e^(-1) ≈ 0.6321
    const result = evaluate('=WEIBULL.DIST(1,1,1,1)');
    expect(Number(result)).toBeCloseTo(0.6321, 3);
  });

  it('should correctly evaluate POISSON.DIST function', () => {
    // POISSON.DIST(2, 5, 0) — PMF: P(X=2) for λ=5
    const result = evaluate('=POISSON.DIST(2,5,0)');
    expect(Number(result)).toBeCloseTo(0.0842, 3);
  });

  it('should correctly evaluate BINOM.DIST function', () => {
    // BINOM.DIST(3, 10, 0.5, 0) — PMF: P(X=3) for n=10, p=0.5
    const result = evaluate('=BINOM.DIST(3,10,0.5,0)');
    expect(Number(result)).toBeCloseTo(0.1172, 3);
  });

  // --- Batch 19: More distribution functions ---
  it('should correctly evaluate EXPON.DIST function', () => {
    // EXPON.DIST(1, 1, 1) — CDF of exponential with λ=1 at x=1 = 1-e^(-1)
    const result = evaluate('=EXPON.DIST(1,1,1)');
    expect(Number(result)).toBeCloseTo(0.6321, 3);
  });

  it('should correctly evaluate CONFIDENCE.NORM function', () => {
    // CONFIDENCE.NORM(0.05, 2.5, 50) — 95% CI half-width
    const result = evaluate('=CONFIDENCE.NORM(0.05,2.5,50)');
    expect(Number(result)).toBeCloseTo(0.6929, 2);
  });

  it('should correctly evaluate CHISQ.DIST function', () => {
    // CHISQ.DIST(3.84, 1, 1) — CDF at 3.84 with 1 df ≈ 0.95
    const result = evaluate('=CHISQ.DIST(3.84,1,1)');
    expect(Number(result)).toBeCloseTo(0.95, 1);
  });

  it('should correctly evaluate CHISQ.INV function', () => {
    // CHISQ.INV(0.95, 1) ≈ 3.84
    const result = evaluate('=CHISQ.INV(0.95,1)');
    expect(Number(result)).toBeCloseTo(3.84, 1);
  });

  it('should correctly evaluate T.DIST function', () => {
    // T.DIST(0, 10, 1) — CDF at 0 for t-distribution = 0.5
    const result = evaluate('=T.DIST(0,10,1)');
    expect(Number(result)).toBeCloseTo(0.5, 4);
  });

  it('should correctly evaluate T.INV function', () => {
    // T.INV(0.5, 10) = 0 (median of t-distribution)
    const result = evaluate('=T.INV(0.5,10)');
    expect(Number(result)).toBeCloseTo(0, 2);
  });

  it('should correctly evaluate HYPGEOM.DIST function', () => {
    // HYPGEOM.DIST(1, 4, 8, 20, 0) — PMF: 1 success in 4 draws from population with 8 successes out of 20
    const result = evaluate('=HYPGEOM.DIST(1,4,8,20,0)');
    expect(Number(result)).toBeCloseTo(0.3633, 3);
  });

  it('should correctly evaluate NEGBINOM.DIST function', () => {
    // NEGBINOM.DIST(1, 1, 0.5, 0) — PMF: 1 failure before 1 success with p=0.5
    const result = evaluate('=NEGBINOM.DIST(1,1,0.5,0)');
    expect(Number(result)).toBeCloseTo(0.25, 4);
  });

  it('should correctly evaluate CONFIDENCE.T function', () => {
    // CONFIDENCE.T(0.05, 1, 50)
    const result = evaluate('=CONFIDENCE.T(0.05,1,50)');
    expect(Number(result)).toBeGreaterThan(0);
    expect(Number(result)).toBeLessThan(1);
  });

  // --- Batch 20: Math/Engineering functions ---
  it('should correctly evaluate ARABIC function', () => {
    expect(evaluate('=ARABIC("XIV")')).toBe('14');
    expect(evaluate('=ARABIC("MCMXCIX")')).toBe('1999');
    expect(evaluate('=ARABIC("IV")')).toBe('4');
  });

  it('should correctly evaluate ROMAN function', () => {
    expect(evaluate('=ROMAN(14)')).toBe('XIV');
    expect(evaluate('=ROMAN(1999)')).toBe('MCMXCIX');
    expect(evaluate('=ROMAN(4)')).toBe('IV');
  });

  it('should correctly evaluate MULTINOMIAL function', () => {
    // MULTINOMIAL(2, 3, 4) = 9! / (2!*3!*4!) = 1260
    expect(evaluate('=MULTINOMIAL(2,3,4)')).toBe('1260');
  });

  it('should correctly evaluate SERIESSUM function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '1' } as Cell);
    grid.set('A2', { v: '1' } as Cell);
    grid.set('A3', { v: '1' } as Cell);
    // SERIESSUM(2, 0, 1, {1,1,1}) = 1*2^0 + 1*2^1 + 1*2^2 = 1+2+4 = 7
    expect(evaluate('=SERIESSUM(2,0,1,A1:A3)', grid)).toBe('7');
  });

  it('should correctly evaluate DELTA function', () => {
    expect(evaluate('=DELTA(5,5)')).toBe('1');
    expect(evaluate('=DELTA(5,4)')).toBe('0');
    expect(evaluate('=DELTA(0)')).toBe('1');
  });

  it('should correctly evaluate GESTEP function', () => {
    expect(evaluate('=GESTEP(5,4)')).toBe('1');
    expect(evaluate('=GESTEP(3,4)')).toBe('0');
    expect(evaluate('=GESTEP(0)')).toBe('1');
  });

  it('should correctly evaluate ERF function', () => {
    expect(Number(evaluate('=ERF(0)'))).toBeCloseTo(0, 8);
    expect(Number(evaluate('=ERF(1)'))).toBeCloseTo(0.8427, 3);
  });

  it('should correctly evaluate ERFC function', () => {
    expect(Number(evaluate('=ERFC(0)'))).toBeCloseTo(1, 8);
    expect(Number(evaluate('=ERFC(1)'))).toBeCloseTo(0.1573, 3);
  });

  // --- Batch 21: More Financial functions ---
  it('should correctly evaluate XNPV function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '-10000' } as Cell);
    grid.set('A2', { v: '3000' } as Cell);
    grid.set('A3', { v: '4200' } as Cell);
    grid.set('A4', { v: '6800' } as Cell);
    grid.set('B1', { v: '2024-01-01' } as Cell);
    grid.set('B2', { v: '2024-07-01' } as Cell);
    grid.set('B3', { v: '2025-01-01' } as Cell);
    grid.set('B4', { v: '2025-07-01' } as Cell);
    const result = evaluate('=XNPV(0.1,A1:A4,B1:B4)', grid);
    expect(Number(result)).toBeGreaterThan(0);
  });

  it('should correctly evaluate SYD function', () => {
    // SYD(10000, 1000, 5, 1) = (10000-1000) * 5 / 15 = 3000
    expect(evaluate('=SYD(10000,1000,5,1)')).toBe('3000');
    // SYD(10000, 1000, 5, 5) = (10000-1000) * 1 / 15 = 600
    expect(evaluate('=SYD(10000,1000,5,5)')).toBe('600');
  });

  it('should correctly evaluate MIRR function', () => {
    const grid: Grid = new Map<string, Cell>();
    grid.set('A1', { v: '-10000' } as Cell);
    grid.set('A2', { v: '5000' } as Cell);
    grid.set('A3', { v: '6000' } as Cell);
    grid.set('A4', { v: '7000' } as Cell);
    const result = evaluate('=MIRR(A1:A4,0.1,0.12)', grid);
    expect(Number(result)).toBeGreaterThan(0);
  });

  it('should correctly evaluate DOLLARDE function', () => {
    // DOLLARDE(1.02, 16) — price of 1 and 2/16 = 1.125
    const result = evaluate('=DOLLARDE(1.02,16)');
    expect(Number(result)).toBeCloseTo(1.125, 3);
  });

  it('should correctly evaluate DOLLARFR function', () => {
    // DOLLARFR(1.125, 16) — back to fractional = 1.02
    const result = evaluate('=DOLLARFR(1.125,16)');
    expect(Number(result)).toBeCloseTo(1.02, 3);
  });

  it('should correctly evaluate ENCODEURL function', () => {
    expect(evaluate('=ENCODEURL("hello world")')).toBe('hello%20world');
    expect(evaluate('=ENCODEURL("a&b=c")')).toBe('a%26b%3Dc');
    expect(evaluate('=ENCODEURL("https://example.com")')).toBe(
      'https%3A%2F%2Fexample.com',
    );
  });

  it('should correctly evaluate ISURL function', () => {
    expect(evaluate('=ISURL("https://example.com")')).toBe('true');
    expect(evaluate('=ISURL("http://test.org/path")')).toBe('true');
    expect(evaluate('=ISURL("ftp://files.com")')).toBe('true');
    expect(evaluate('=ISURL("not a url")')).toBe('false');
    expect(evaluate('=ISURL("example.com")')).toBe('false');
  });

  it('should correctly evaluate ISFORMULA function', () => {
    const grid = new Map([
      ['A1', { v: '10', f: '=5+5' } as Cell],
      ['A2', { v: 'hello' } as Cell],
    ]);
    expect(evaluate('=ISFORMULA(A1)', grid)).toBe('true');
    expect(evaluate('=ISFORMULA(A2)', grid)).toBe('false');
    expect(evaluate('=ISFORMULA(A3)', grid)).toBe('false');
  });

  it('should correctly evaluate FORMULATEXT function', () => {
    const grid = new Map([
      ['A1', { v: '10', f: '=5+5' } as Cell],
      ['A2', { v: 'hello' } as Cell],
    ]);
    expect(evaluate('=FORMULATEXT(A1)', grid)).toBe('=5+5');
    expect(evaluate('=FORMULATEXT(A2)', grid)).toBe('#N/A!');
  });

  it('should correctly evaluate CEILING.MATH function', () => {
    expect(evaluate('=CEILING.MATH(4.3)')).toBe('5');
    expect(evaluate('=CEILING.MATH(6.7,2)')).toBe('8');
    expect(evaluate('=CEILING.MATH(0-4.3,2,0)')).toBe('-4');
    expect(evaluate('=CEILING.MATH(0-4.3,2,1)')).toBe('-6');
  });

  it('should correctly evaluate FLOOR.MATH function', () => {
    expect(evaluate('=FLOOR.MATH(4.7)')).toBe('4');
    expect(evaluate('=FLOOR.MATH(6.7,2)')).toBe('6');
    expect(evaluate('=FLOOR.MATH(0-4.3,2,0)')).toBe('-6');
    expect(evaluate('=FLOOR.MATH(0-4.3,2,1)')).toBe('-4');
  });

  it('should correctly evaluate CEILING.PRECISE function', () => {
    expect(evaluate('=CEILING.PRECISE(4.3)')).toBe('5');
    expect(evaluate('=CEILING.PRECISE(0-4.3,2)')).toBe('-4');
    expect(evaluate('=CEILING.PRECISE(4.3,2)')).toBe('6');
  });

  it('should correctly evaluate FLOOR.PRECISE function', () => {
    expect(evaluate('=FLOOR.PRECISE(4.7)')).toBe('4');
    expect(evaluate('=FLOOR.PRECISE(0-4.3,2)')).toBe('-6');
    expect(evaluate('=FLOOR.PRECISE(4.7,2)')).toBe('4');
  });

  it('should correctly evaluate COVAR function', () => {
    const grid = new Map([
      ['A1', { v: '3' } as Cell],
      ['A2', { v: '2' } as Cell],
      ['A3', { v: '4' } as Cell],
      ['A4', { v: '5' } as Cell],
      ['A5', { v: '6' } as Cell],
      ['B1', { v: '9' } as Cell],
      ['B2', { v: '7' } as Cell],
      ['B3', { v: '12' } as Cell],
      ['B4', { v: '15' } as Cell],
      ['B5', { v: '17' } as Cell],
    ]);
    const result = evaluate('=COVAR(A1:A5,B1:B5)', grid);
    expect(Number(result)).toBeCloseTo(5.2, 1);
  });

  it('should correctly evaluate COVARIANCE.S function', () => {
    const grid = new Map([
      ['A1', { v: '3' } as Cell],
      ['A2', { v: '2' } as Cell],
      ['A3', { v: '4' } as Cell],
      ['A4', { v: '5' } as Cell],
      ['A5', { v: '6' } as Cell],
      ['B1', { v: '9' } as Cell],
      ['B2', { v: '7' } as Cell],
      ['B3', { v: '12' } as Cell],
      ['B4', { v: '15' } as Cell],
      ['B5', { v: '17' } as Cell],
    ]);
    const result = evaluate('=COVARIANCE.S(A1:A5,B1:B5)', grid);
    expect(Number(result)).toBeCloseTo(6.5, 1);
  });

  it('should correctly evaluate RSQ function', () => {
    const grid = new Map([
      ['A1', { v: '2' } as Cell],
      ['A2', { v: '3' } as Cell],
      ['A3', { v: '9' } as Cell],
      ['A4', { v: '1' } as Cell],
      ['A5', { v: '8' } as Cell],
      ['B1', { v: '6' } as Cell],
      ['B2', { v: '5' } as Cell],
      ['B3', { v: '11' } as Cell],
      ['B4', { v: '7' } as Cell],
      ['B5', { v: '5' } as Cell],
    ]);
    const result = evaluate('=RSQ(A1:A5,B1:B5)', grid);
    expect(Number(result)).toBeCloseTo(0.2089, 2);
  });

  it('should correctly evaluate SUMX2MY2 function', () => {
    const grid = new Map([
      ['A1', { v: '2' } as Cell],
      ['A2', { v: '3' } as Cell],
      ['A3', { v: '4' } as Cell],
      ['B1', { v: '5' } as Cell],
      ['B2', { v: '6' } as Cell],
      ['B3', { v: '7' } as Cell],
    ]);
    // (2²-5²)+(3²-6²)+(4²-7²) = -21-27-33 = -81
    const result = evaluate('=SUMX2MY2(A1:A3,B1:B3)', grid);
    expect(Number(result)).toBe(-81);
  });

  it('should correctly evaluate SUMX2PY2 function', () => {
    const grid = new Map([
      ['A1', { v: '2' } as Cell],
      ['A2', { v: '3' } as Cell],
      ['A3', { v: '4' } as Cell],
      ['B1', { v: '5' } as Cell],
      ['B2', { v: '6' } as Cell],
      ['B3', { v: '7' } as Cell],
    ]);
    // (4+9+16) + (25+36+49) = 29 + 110 = 139
    const result = evaluate('=SUMX2PY2(A1:A3,B1:B3)', grid);
    expect(Number(result)).toBe(139);
  });

  it('should correctly evaluate SUMXMY2 function', () => {
    const grid = new Map([
      ['A1', { v: '2' } as Cell],
      ['A2', { v: '3' } as Cell],
      ['A3', { v: '4' } as Cell],
      ['B1', { v: '5' } as Cell],
      ['B2', { v: '6' } as Cell],
      ['B3', { v: '7' } as Cell],
    ]);
    // (2-5)² + (3-6)² + (4-7)² = 9 + 9 + 9 = 27
    const result = evaluate('=SUMXMY2(A1:A3,B1:B3)', grid);
    expect(Number(result)).toBe(27);
  });

  it('should correctly evaluate PERCENTILE.EXC function', () => {
    const grid = new Map([
      ['A1', { v: '1' } as Cell],
      ['A2', { v: '2' } as Cell],
      ['A3', { v: '3' } as Cell],
      ['A4', { v: '4' } as Cell],
    ]);
    const result = evaluate('=PERCENTILE.EXC(A1:A4,0.4)', grid);
    expect(Number(result)).toBe(2);
  });

  it('should correctly evaluate QUARTILE.EXC function', () => {
    const grid = new Map([
      ['A1', { v: '1' } as Cell],
      ['A2', { v: '2' } as Cell],
      ['A3', { v: '3' } as Cell],
      ['A4', { v: '4' } as Cell],
      ['A5', { v: '5' } as Cell],
      ['A6', { v: '6' } as Cell],
    ]);
    const result = evaluate('=QUARTILE.EXC(A1:A6,1)', grid);
    expect(Number(result)).toBeCloseTo(1.75, 2);
  });

  it('should correctly evaluate RANK.AVG function', () => {
    const grid = new Map([
      ['A1', { v: '3' } as Cell],
      ['A2', { v: '5' } as Cell],
      ['A3', { v: '3' } as Cell],
      ['A4', { v: '7' } as Cell],
    ]);
    // Descending: 7=1st, 5=2nd, 3 tied 3rd&4th → avg 3.5
    const result = evaluate('=RANK.AVG(3,A1:A4)', grid);
    expect(Number(result)).toBe(3.5);
  });

  it('should correctly evaluate PERCENTRANK function', () => {
    const grid = new Map([
      ['A1', { v: '1' } as Cell],
      ['A2', { v: '2' } as Cell],
      ['A3', { v: '3' } as Cell],
      ['A4', { v: '4' } as Cell],
      ['A5', { v: '5' } as Cell],
    ]);
    const result = evaluate('=PERCENTRANK(A1:A5,3)', grid);
    expect(Number(result)).toBe(0.5);
  });

  it('should correctly evaluate PERCENTRANK.EXC function', () => {
    const grid = new Map([
      ['A1', { v: '1' } as Cell],
      ['A2', { v: '2' } as Cell],
      ['A3', { v: '3' } as Cell],
      ['A4', { v: '4' } as Cell],
      ['A5', { v: '5' } as Cell],
    ]);
    const result = evaluate('=PERCENTRANK.EXC(A1:A5,3)', grid);
    expect(Number(result)).toBe(0.5);
  });

  it('should correctly evaluate BETA.DIST function', () => {
    // BETA.DIST(0.5, 2, 5, TRUE) — CDF
    const result = evaluate('=BETA.DIST(0.5,2,5,TRUE)', undefined);
    expect(Number(result)).toBeCloseTo(0.8906, 3);
  });

  it('should correctly evaluate BETA.INV function', () => {
    // BETA.INV(0.8906, 2, 5)
    const result = evaluate('=BETA.INV(0.8906,2,5)', undefined);
    expect(Number(result)).toBeCloseTo(0.5, 1);
  });

  it('should correctly evaluate F.DIST function', () => {
    // F.DIST(2, 5, 10, TRUE)
    const result = evaluate('=F.DIST(2,5,10,TRUE)', undefined);
    expect(Number(result)).toBeCloseTo(0.8358, 2);
  });

  it('should correctly evaluate F.INV function', () => {
    // F.INV(0.85, 5, 10)
    const result = evaluate('=F.INV(0.85,5,10)', undefined);
    expect(Number(result)).toBeCloseTo(2.0922, 2);
  });

  it('should correctly evaluate STEYX function', () => {
    const grid = new Map([
      ['A1', { v: '2' } as Cell],
      ['A2', { v: '3' } as Cell],
      ['A3', { v: '9' } as Cell],
      ['A4', { v: '1' } as Cell],
      ['A5', { v: '8' } as Cell],
      ['B1', { v: '6' } as Cell],
      ['B2', { v: '5' } as Cell],
      ['B3', { v: '11' } as Cell],
      ['B4', { v: '7' } as Cell],
      ['B5', { v: '5' } as Cell],
    ]);
    const result = evaluate('=STEYX(A1:A5,B1:B5)', grid);
    expect(Number(result)).toBeCloseTo(3.7456, 2);
  });

  it('should correctly evaluate GAMMA.DIST function', () => {
    // CDF: GAMMA.DIST(2, 3, 2, TRUE) = P(3, 1) ≈ 0.0803
    const result = evaluate('=GAMMA.DIST(2,3,2,TRUE)', undefined);
    expect(Number(result)).toBeCloseTo(0.0803, 2);
    // PDF
    const result2 = evaluate('=GAMMA.DIST(2,3,2,FALSE)', undefined);
    expect(Number(result2)).toBeCloseTo(0.0902, 2);
  });

  it('should correctly evaluate GAMMA.INV function', () => {
    const result = evaluate('=GAMMA.INV(0.0803,3,2)', undefined);
    expect(Number(result)).toBeCloseTo(2, 0);
  });

  it('should correctly evaluate CHISQ.DIST.RT function', () => {
    // Right-tail: P(X > 9.488) with df=4 should be about 0.05
    const result = evaluate('=CHISQ.DIST.RT(9.488,4)', undefined);
    expect(Number(result)).toBeCloseTo(0.05, 2);
  });

  it('should correctly evaluate CHISQ.INV.RT function', () => {
    const result = evaluate('=CHISQ.INV.RT(0.05,4)', undefined);
    expect(Number(result)).toBeCloseTo(9.488, 1);
  });

  it('should correctly evaluate T.DIST.RT function', () => {
    // Right tail of t(10) at x=2 ≈ 0.0368
    const result = evaluate('=T.DIST.RT(2,10)', undefined);
    expect(Number(result)).toBeCloseTo(0.0368, 2);
  });

  it('should correctly evaluate T.DIST.2T function', () => {
    // Two-tailed at x=2, df=10 ≈ 0.0734
    const result = evaluate('=T.DIST.2T(2,10)', undefined);
    expect(Number(result)).toBeCloseTo(0.0734, 2);
  });

  it('should correctly evaluate T.INV.2T function', () => {
    const result = evaluate('=T.INV.2T(0.05,10)', undefined);
    expect(Number(result)).toBeCloseTo(2.228, 2);
  });

  it('should correctly evaluate F.DIST.RT function', () => {
    const result = evaluate('=F.DIST.RT(2,5,10)', undefined);
    expect(Number(result)).toBeCloseTo(0.1642, 2);
  });

  it('should correctly evaluate F.INV.RT function', () => {
    const result = evaluate('=F.INV.RT(0.05,5,10)', undefined);
    expect(Number(result)).toBeCloseTo(3.3258, 2);
  });

  it('should correctly evaluate BINOM.INV function', () => {
    // BINOM.INV(10, 0.5, 0.75) — smallest k where CDF >= 0.75
    const result = evaluate('=BINOM.INV(10,0.5,0.75)', undefined);
    expect(Number(result)).toBe(6);
  });

  it('should correctly evaluate TEXTBEFORE function', () => {
    expect(evaluate('=TEXTBEFORE("hello-world","-")')).toBe('hello');
    expect(evaluate('=TEXTBEFORE("a/b/c","/",2)')).toBe('a/b');
    expect(evaluate('=TEXTBEFORE("a/b/c","/",0-1)')).toBe('a/b');
  });

  it('should correctly evaluate TEXTAFTER function', () => {
    expect(evaluate('=TEXTAFTER("hello-world","-")')).toBe('world');
    expect(evaluate('=TEXTAFTER("a/b/c","/",2)')).toBe('c');
    expect(evaluate('=TEXTAFTER("a/b/c","/",0-1)')).toBe('c');
  });

  it('should correctly evaluate VALUETOTEXT function', () => {
    expect(evaluate('=VALUETOTEXT(123)')).toBe('123');
    expect(evaluate('=VALUETOTEXT("hello",0)')).toBe('hello');
    expect(evaluate('=VALUETOTEXT("hello",1)')).toBe('"hello"');
  });

  it('should correctly evaluate SEQUENCE function', () => {
    // Single cell: returns start value
    expect(evaluate('=SEQUENCE(5)')).toBe('1');
    expect(evaluate('=SEQUENCE(5,1,10,2)')).toBe('10');
  });

  it('should correctly evaluate RANDARRAY function', () => {
    const result = Number(evaluate('=RANDARRAY(1,1,1,10,TRUE)'));
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(10);
    expect(result).toBe(Math.floor(result));
  });

  it('should correctly evaluate SORT function', () => {
    const grid = new Map([
      ['A1', { v: '5' } as Cell],
      ['A2', { v: '2' } as Cell],
      ['A3', { v: '8' } as Cell],
      ['A4', { v: '1' } as Cell],
    ]);
    // Single cell: returns first sorted value (ascending)
    expect(evaluate('=SORT(A1:A4)', grid)).toBe('1');
  });

  it('should correctly evaluate UNIQUE function', () => {
    const grid = new Map([
      ['A1', { v: '5' } as Cell],
      ['A2', { v: '5' } as Cell],
      ['A3', { v: '3' } as Cell],
    ]);
    // Single cell: returns first value
    expect(evaluate('=UNIQUE(A1:A3)', grid)).toBe('5');
  });

  it('should correctly evaluate FLATTEN function', () => {
    const grid = new Map([
      ['A1', { v: '10' } as Cell],
      ['A2', { v: '20' } as Cell],
    ]);
    expect(evaluate('=FLATTEN(A1:A2)', grid)).toBe('10');
  });

  it('should correctly evaluate TRANSPOSE function', () => {
    const grid = new Map([
      ['A1', { v: '42' } as Cell],
    ]);
    expect(evaluate('=TRANSPOSE(A1)', grid)).toBe('42');
  });

  it('should correctly evaluate NORM.S.DIST function', () => {
    // CDF at z=0 should be 0.5
    expect(Number(evaluate('=NORM.S.DIST(0,TRUE)'))).toBeCloseTo(0.5, 4);
    // CDF at z=1.96 ≈ 0.975
    expect(Number(evaluate('=NORM.S.DIST(1.96,TRUE)'))).toBeCloseTo(0.975, 2);
    // PDF at z=0 ≈ 0.3989
    expect(Number(evaluate('=NORM.S.DIST(0,FALSE)'))).toBeCloseTo(0.3989, 3);
  });

  it('should correctly evaluate NORM.S.INV function', () => {
    expect(Number(evaluate('=NORM.S.INV(0.5)'))).toBeCloseTo(0, 4);
    expect(Number(evaluate('=NORM.S.INV(0.975)'))).toBeCloseTo(1.96, 2);
  });

  it('should correctly evaluate SUBTOTAL function', () => {
    const grid = new Map([
      ['A1', { v: '10' } as Cell],
      ['A2', { v: '20' } as Cell],
      ['A3', { v: '30' } as Cell],
    ]);
    // 9=SUM
    expect(evaluate('=SUBTOTAL(9,A1:A3)', grid)).toBe('60');
    // 1=AVERAGE
    expect(evaluate('=SUBTOTAL(1,A1:A3)', grid)).toBe('20');
    // 2=COUNT
    expect(evaluate('=SUBTOTAL(2,A1:A3)', grid)).toBe('3');
    // 4=MAX
    expect(evaluate('=SUBTOTAL(4,A1:A3)', grid)).toBe('30');
    // 5=MIN
    expect(evaluate('=SUBTOTAL(5,A1:A3)', grid)).toBe('10');
    // 109=SUM (ignore hidden, same behavior)
    expect(evaluate('=SUBTOTAL(109,A1:A3)', grid)).toBe('60');
  });

  it('should correctly evaluate SKEW function', () => {
    const grid = new Map([
      ['A1', { v: '3' } as Cell],
      ['A2', { v: '4' } as Cell],
      ['A3', { v: '5' } as Cell],
      ['A4', { v: '2' } as Cell],
      ['A5', { v: '3' } as Cell],
      ['A6', { v: '4' } as Cell],
      ['A7', { v: '5' } as Cell],
      ['A8', { v: '6' } as Cell],
      ['A9', { v: '4' } as Cell],
      ['A10', { v: '7' } as Cell],
    ]);
    const result = evaluate('=SKEW(A1:A10)', grid);
    expect(Number(result)).toBeCloseTo(0.359, 2);
  });

  it('should correctly evaluate KURT function', () => {
    const grid = new Map([
      ['A1', { v: '3' } as Cell],
      ['A2', { v: '4' } as Cell],
      ['A3', { v: '5' } as Cell],
      ['A4', { v: '2' } as Cell],
      ['A5', { v: '3' } as Cell],
      ['A6', { v: '4' } as Cell],
      ['A7', { v: '5' } as Cell],
      ['A8', { v: '6' } as Cell],
      ['A9', { v: '4' } as Cell],
      ['A10', { v: '7' } as Cell],
    ]);
    const result = evaluate('=KURT(A1:A10)', grid);
    // Excess kurtosis for near-normal data is close to 0
    expect(Number(result)).toBeCloseTo(-0.152, 1);
  });

  it('should correctly evaluate VARA function', () => {
    // VARA(1, 2, 3) = same as VAR for numbers = 1
    expect(Number(evaluate('=VARA(1,2,3)'))).toBe(1);
  });

  it('should correctly evaluate VARPA function', () => {
    // VARPA(1, 2, 3) = population variance = 2/3
    expect(Number(evaluate('=VARPA(1,2,3)'))).toBeCloseTo(0.6667, 3);
  });

  it('should correctly evaluate ISREF function', () => {
    const grid = new Map([['A1', { v: '10' } as Cell]]);
    expect(evaluate('=ISREF(A1)', grid)).toBe('true');
    expect(evaluate('=ISREF(5)')).toBe('false');
    expect(evaluate('=ISREF("text")')).toBe('false');
  });

  it('should correctly evaluate SHEET and SHEETS functions', () => {
    expect(evaluate('=SHEET()')).toBe('1');
    expect(evaluate('=SHEETS()')).toBe('1');
  });

  it('should correctly evaluate MDETERM function', () => {
    const grid = new Map([
      ['A1', { v: '1' } as Cell],
      ['B1', { v: '2' } as Cell],
      ['A2', { v: '3' } as Cell],
      ['B2', { v: '4' } as Cell],
    ]);
    // det([[1,2],[3,4]]) = 1*4 - 2*3 = -2
    expect(Number(evaluate('=MDETERM(A1:B2)', grid))).toBe(-2);
  });

  it('should correctly evaluate PROB function', () => {
    const grid = new Map([
      ['A1', { v: '0' } as Cell],
      ['A2', { v: '1' } as Cell],
      ['A3', { v: '2' } as Cell],
      ['A4', { v: '3' } as Cell],
      ['B1', { v: '0.2' } as Cell],
      ['B2', { v: '0.3' } as Cell],
      ['B3', { v: '0.1' } as Cell],
      ['B4', { v: '0.4' } as Cell],
    ]);
    // P(1 <= X <= 3) = 0.3 + 0.1 + 0.4 = 0.8
    const result = evaluate('=PROB(A1:A4,B1:B4,1,3)', grid);
    expect(Number(result)).toBeCloseTo(0.8, 4);
  });

  it('should correctly evaluate CONVERT function', () => {
    // Length: 1 mile = 1.60934 km
    expect(Number(evaluate('=CONVERT(1,"mi","km")'))).toBeCloseTo(1.60934, 3);
    // Temperature: 32°F = 0°C
    expect(Number(evaluate('=CONVERT(32,"F","C")'))).toBeCloseTo(0, 4);
    // Temperature: 100°C = 212°F
    expect(Number(evaluate('=CONVERT(100,"C","F")'))).toBeCloseTo(212, 4);
    // Mass: 1 kg = 2.205 lbm
    expect(Number(evaluate('=CONVERT(1,"kg","lbm")'))).toBeCloseTo(2.2046, 2);
    // Time: 1 hr = 3600 sec
    expect(Number(evaluate('=CONVERT(1,"hr","sec")'))).toBe(3600);
  });

  it('should correctly evaluate BITAND, BITOR, BITXOR functions', () => {
    expect(evaluate('=BITAND(5,3)')).toBe('1');
    expect(evaluate('=BITOR(5,3)')).toBe('7');
    expect(evaluate('=BITXOR(5,3)')).toBe('6');
    expect(evaluate('=BITAND(15,7)')).toBe('7');
    expect(evaluate('=BITOR(12,10)')).toBe('14');
    expect(evaluate('=BITXOR(12,10)')).toBe('6');
  });

  it('should correctly evaluate BITLSHIFT and BITRSHIFT functions', () => {
    expect(evaluate('=BITLSHIFT(4,2)')).toBe('16');
    expect(evaluate('=BITRSHIFT(16,2)')).toBe('4');
    expect(evaluate('=BITLSHIFT(1,10)')).toBe('1024');
    expect(evaluate('=BITRSHIFT(1024,10)')).toBe('1');
  });

  it('should correctly evaluate HEX2DEC and DEC2HEX functions', () => {
    expect(evaluate('=HEX2DEC("FF")')).toBe('255');
    expect(evaluate('=HEX2DEC("A")')).toBe('10');
    expect(evaluate('=HEX2DEC("1F")')).toBe('31');
    expect(evaluate('=DEC2HEX(255)')).toBe('FF');
    expect(evaluate('=DEC2HEX(10)')).toBe('A');
    expect(evaluate('=DEC2HEX(31,4)')).toBe('001F');
  });

  it('should correctly evaluate BIN2DEC and DEC2BIN functions', () => {
    expect(evaluate('=BIN2DEC("1010")')).toBe('10');
    expect(evaluate('=BIN2DEC("11111111")')).toBe('255');
    expect(evaluate('=DEC2BIN(10)')).toBe('1010');
    expect(evaluate('=DEC2BIN(255)')).toBe('11111111');
    expect(evaluate('=DEC2BIN(5,8)')).toBe('00000101');
  });

  it('should correctly evaluate OCT2DEC and DEC2OCT functions', () => {
    expect(evaluate('=OCT2DEC("77")')).toBe('63');
    expect(evaluate('=OCT2DEC("12")')).toBe('10');
    expect(evaluate('=DEC2OCT(63)')).toBe('77');
    expect(evaluate('=DEC2OCT(8)')).toBe('10');
    expect(evaluate('=DEC2OCT(10,4)')).toBe('0012');
  });

  it('should correctly evaluate COMPLEX function', () => {
    expect(evaluate('=COMPLEX(3,4)')).toBe('3+4i');
    expect(evaluate('=COMPLEX(3,0)')).toBe('3');
    expect(evaluate('=COMPLEX(0,4)')).toBe('4i');
    expect(evaluate('=COMPLEX(0,1)')).toBe('i');
    expect(evaluate('=COMPLEX(0,0-1)')).toBe('-i');
    expect(evaluate('=COMPLEX(1,0-1)')).toBe('1-i');
    expect(evaluate('=COMPLEX(3,4,"j")')).toBe('3+4j');
  });

  it('should correctly evaluate IMREAL, IMAGINARY, IMABS functions', () => {
    expect(evaluate('=IMREAL("3+4i")')).toBe('3');
    expect(evaluate('=IMAGINARY("3+4i")')).toBe('4');
    expect(evaluate('=IMABS("3+4i")')).toBe('5');
    expect(evaluate('=IMREAL("5")')).toBe('5');
    expect(evaluate('=IMAGINARY("5")')).toBe('0');
    expect(evaluate('=IMREAL("2i")')).toBe('0');
    expect(evaluate('=IMAGINARY("2i")')).toBe('2');
  });

  it('should correctly evaluate IMSUM and IMSUB functions', () => {
    expect(evaluate('=IMSUM("3+4i","1+2i")')).toBe('4+6i');
    expect(evaluate('=IMSUM("1+i","2+3i","3+4i")')).toBe('6+8i');
    expect(evaluate('=IMSUB("5+3i","2+i")')).toBe('3+2i');
    expect(evaluate('=IMSUB("1+i","1+i")')).toBe('0');
  });

  it('should correctly evaluate IMPRODUCT and IMDIV functions', () => {
    // (1+2i)*(3+4i) = 3+4i+6i+8i² = 3+10i-8 = -5+10i
    expect(evaluate('=IMPRODUCT("1+2i","3+4i")')).toBe('-5+10i');
    // (10+5i)/(3+4i) = (10+5i)(3-4i)/(9+16) = (30-40i+15i-20i²)/25 = (50-25i)/25 = 2-i
    expect(evaluate('=IMDIV("10+5i","3+4i")')).toBe('2-i');
  });

  it('should correctly evaluate IMCONJUGATE function', () => {
    expect(evaluate('=IMCONJUGATE("3+4i")')).toBe('3-4i');
    expect(evaluate('=IMCONJUGATE("3-4i")')).toBe('3+4i');
    expect(evaluate('=IMCONJUGATE("5")')).toBe('5');
  });

  it('should correctly evaluate IMARGUMENT function', () => {
    // arg(1+i) = PI/4
    expect(Number(evaluate('=IMARGUMENT("1+i")'))).toBeCloseTo(Math.PI / 4, 10);
    // arg(1) = 0
    expect(Number(evaluate('=IMARGUMENT("1")'))).toBe(0);
  });

  it('should correctly evaluate IMPOWER function', () => {
    // (1+i)^2 = 2i — use IMREAL/IMAGINARY to check numerically
    expect(Number(evaluate('=IMREAL(IMPOWER("1+i",2))'))).toBeCloseTo(0, 10);
    expect(Number(evaluate('=IMAGINARY(IMPOWER("1+i",2))'))).toBeCloseTo(2, 10);
    // (2)^3 = 8
    expect(evaluate('=IMPOWER("2",3)')).toBe('8');
  });

  it('should correctly evaluate IMSQRT function', () => {
    // sqrt(4) = 2
    expect(evaluate('=IMSQRT("4")')).toBe('2');
    // sqrt(-1) = i
    const sqrtNeg1 = evaluate('=IMSQRT("-1")');
    expect(sqrtNeg1).toBe('i');
  });

  it('should correctly evaluate IMEXP function', () => {
    // e^0 = 1
    expect(evaluate('=IMEXP("0")')).toBe('1');
    // e^1 = e
    expect(Number(evaluate('=IMEXP("1")'))).toBeCloseTo(Math.E, 10);
  });

  it('should correctly evaluate IMLN function', () => {
    // ln(1) = 0
    expect(evaluate('=IMLN("1")')).toBe('0');
    // ln(e) = 1
    const lnE = evaluate('=IMLN("' + Math.E + '")');
    expect(Number(lnE)).toBeCloseTo(1, 10);
  });

  it('should correctly evaluate IMLOG2 and IMLOG10 functions', () => {
    // log2(8) = 3
    expect(Number(evaluate('=IMLOG2("8")'))).toBeCloseTo(3, 10);
    // log10(100) = 2
    expect(Number(evaluate('=IMLOG10("100")'))).toBeCloseTo(2, 10);
  });

  it('should correctly evaluate IMSIN and IMCOS functions', () => {
    // sin(0) = 0, cos(0) = 1
    expect(evaluate('=IMSIN("0")')).toBe('0');
    expect(evaluate('=IMCOS("0")')).toBe('1');
    // sin(PI/2) ≈ 1
    const sinPiHalf = evaluate('=IMSIN("' + (Math.PI / 2) + '")');
    expect(Number(sinPiHalf)).toBeCloseTo(1, 10);
  });

  it('should correctly evaluate IMTAN function', () => {
    // tan(0) = 0
    expect(evaluate('=IMTAN("0")')).toBe('0');
  });

  it('should correctly evaluate IMSINH and IMCOSH functions', () => {
    // sinh(0) = 0, cosh(0) = 1
    expect(evaluate('=IMSINH("0")')).toBe('0');
    expect(evaluate('=IMCOSH("0")')).toBe('1');
    // sinh(1) ≈ 1.1752
    expect(Number(evaluate('=IMSINH("1")'))).toBeCloseTo(Math.sinh(1), 10);
    // cosh(1) ≈ 1.5431
    expect(Number(evaluate('=IMCOSH("1")'))).toBeCloseTo(Math.cosh(1), 10);
  });

  it('should correctly evaluate IMSEC, IMCSC, IMCOT functions', () => {
    // sec(0) = 1/cos(0) = 1
    expect(evaluate('=IMSEC("0")')).toBe('1');
    // csc(PI/2) = 1/sin(PI/2) = 1
    expect(Number(evaluate('=IMCSC("' + (Math.PI / 2) + '")'))).toBeCloseTo(1, 10);
  });

  it('should correctly evaluate HEX2BIN, HEX2OCT functions', () => {
    expect(evaluate('=HEX2BIN("F")')).toBe('1111');
    expect(evaluate('=HEX2BIN("A",8)')).toBe('00001010');
    expect(evaluate('=HEX2OCT("FF")')).toBe('377');
  });

  it('should correctly evaluate BIN2HEX, BIN2OCT functions', () => {
    expect(evaluate('=BIN2HEX("1111")')).toBe('F');
    expect(evaluate('=BIN2HEX("1010",4)')).toBe('000A');
    expect(evaluate('=BIN2OCT("1111")')).toBe('17');
  });

  it('should correctly evaluate OCT2HEX, OCT2BIN functions', () => {
    expect(evaluate('=OCT2HEX("77")')).toBe('3F');
    expect(evaluate('=OCT2HEX("12",4)')).toBe('000A');
    expect(evaluate('=OCT2BIN("17")')).toBe('1111');
    expect(evaluate('=OCT2BIN("7",8)')).toBe('00000111');
  });

  it('should correctly evaluate BESSELJ function', () => {
    // J0(0) = 1
    expect(Number(evaluate('=BESSELJ(0,0)'))).toBeCloseTo(1, 10);
    // J0(1) ≈ 0.7652
    expect(Number(evaluate('=BESSELJ(1,0)'))).toBeCloseTo(0.7652, 3);
    // J1(1) ≈ 0.4401
    expect(Number(evaluate('=BESSELJ(1,1)'))).toBeCloseTo(0.4401, 3);
  });

  it('should correctly evaluate BESSELY function', () => {
    // Y0(1) ≈ 0.0883
    expect(Number(evaluate('=BESSELY(1,0)'))).toBeCloseTo(0.0883, 3);
    // Y1(1) ≈ -0.7812
    expect(Number(evaluate('=BESSELY(1,1)'))).toBeCloseTo(-0.7812, 3);
  });

  it('should correctly evaluate BESSELI function', () => {
    // I0(0) = 1
    expect(Number(evaluate('=BESSELI(0,0)'))).toBeCloseTo(1, 10);
    // I0(1) ≈ 1.2661
    expect(Number(evaluate('=BESSELI(1,0)'))).toBeCloseTo(1.2661, 3);
    // I1(1) ≈ 0.5652
    expect(Number(evaluate('=BESSELI(1,1)'))).toBeCloseTo(0.5652, 3);
  });

  it('should correctly evaluate BESSELK function', () => {
    // K0(1) ≈ 0.4211
    expect(Number(evaluate('=BESSELK(1,0)'))).toBeCloseTo(0.4211, 3);
    // K1(1) ≈ 0.6019
    expect(Number(evaluate('=BESSELK(1,1)'))).toBeCloseTo(0.6019, 3);
  });

  it('should correctly evaluate ACCRINT function', () => {
    // ACCRINT(issue, first, settlement, rate, par, freq)
    // 1000 par, 10% rate, semiannual, ~0.5 year = 50
    expect(Number(evaluate('=ACCRINT("2024-01-01","2024-07-01","2024-07-01",0.1,1000,2)'))).toBeCloseTo(50, 0);
  });

  it('should correctly evaluate ACCRINTM function', () => {
    // 1000 par, 10% rate, ~0.5 year = 50
    expect(Number(evaluate('=ACCRINTM("2024-01-01","2024-07-01",0.1,1000)'))).toBeCloseTo(50, 0);
  });

  it('should correctly evaluate COUPNUM function', () => {
    // 2 years, semiannual = 4 coupons
    expect(evaluate('=COUPNUM("2024-01-15","2026-01-15",2)')).toBe('4');
  });

  it('should correctly evaluate DISC and PRICEDISC functions', () => {
    // DISC: (100-98)/100 / yearfrac ≈ some rate
    const disc = Number(evaluate('=DISC("2024-01-01","2025-01-01",98,100)'));
    expect(disc).toBeCloseTo(0.02, 2);
    // PRICEDISC: redemption * (1 - discount * yearfrac)
    // 100 * (1 - 0.02 * 1) = 98
    const price = Number(evaluate('=PRICEDISC("2024-01-01","2025-01-01",0.02,100)'));
    expect(price).toBeCloseTo(98, 0);
  });

  it('should correctly evaluate YIELDDISC function', () => {
    // (100-98)/98 / yearfrac
    const yld = Number(evaluate('=YIELDDISC("2024-01-01","2025-01-01",98,100)'));
    expect(yld).toBeCloseTo(0.0204, 2);
  });

  it('should correctly evaluate DURATION function', () => {
    // Simple bond: settlement, maturity, coupon, yield, frequency
    const dur = Number(evaluate('=DURATION("2024-01-01","2027-01-01",0.08,0.09,2)'));
    expect(dur).toBeGreaterThan(2);
    expect(dur).toBeLessThan(3);
  });

  it('should correctly evaluate MDURATION function', () => {
    const mdur = Number(evaluate('=MDURATION("2024-01-01","2027-01-01",0.08,0.09,2)'));
    expect(mdur).toBeGreaterThan(2);
    expect(mdur).toBeLessThan(3);
  });

  it('should correctly evaluate RECEIVED function', () => {
    // investment / (1 - discount * yearfrac)
    // 1000 / (1 - 0.05 * 1) = 1000 / 0.95 ≈ 1052.63
    expect(Number(evaluate('=RECEIVED("2024-01-01","2025-01-01",1000,0.05)'))).toBeCloseTo(1052.63, 0);
  });

  it('should correctly evaluate INTRATE function', () => {
    // (redemption - investment) / investment / yearfrac
    // (1050 - 1000) / 1000 / 1 = 0.05
    expect(Number(evaluate('=INTRATE("2024-01-01","2025-01-01",1000,1050)'))).toBeCloseTo(0.05, 4);
  });

  it('should correctly evaluate PRICE and YIELD functions', () => {
    // A bond priced near par
    const price = Number(evaluate('=PRICE("2024-01-01","2027-01-01",0.05,0.05,100,2)'));
    expect(price).toBeCloseTo(100, 0);
    // YIELD should recover the yield from a price
    const yld = Number(evaluate('=YIELD("2024-01-01","2027-01-01",0.05,' + price.toFixed(6) + ',100,2)'));
    expect(yld).toBeCloseTo(0.05, 2);
  });

  it('should correctly evaluate PRICEMAT and YIELDMAT functions', () => {
    const price = Number(evaluate('=PRICEMAT("2024-06-01","2025-06-01","2024-01-01",0.05,0.06)'));
    expect(price).toBeGreaterThan(90);
    expect(price).toBeLessThan(110);
  });

  it('should correctly evaluate ISPMT function', () => {
    // ISPMT(rate, period, nper, pv) = pv * rate * (period/nper - 1)
    expect(Number(evaluate('=ISPMT(0.1,1,3,8000000)'))).toBeCloseTo(-533333.33, 0);
  });

  it('should correctly evaluate PDURATION function', () => {
    // PDURATION(0.025, 2000, 2200) = ln(2200/2000) / ln(1.025)
    expect(Number(evaluate('=PDURATION(0.025,2000,2200)'))).toBeCloseTo(3.86, 1);
  });

  it('should correctly evaluate RRI function', () => {
    // RRI(nper, pv, fv) = (fv/pv)^(1/nper) - 1
    expect(Number(evaluate('=RRI(96,10000,11000)'))).toBeCloseTo(0.000989, 4);
  });

  it('should correctly evaluate FVSCHEDULE function', () => {
    const grid = new Map([
      ['A1', { v: '0.09' } as Cell],
      ['A2', { v: '0.11' } as Cell],
      ['A3', { v: '0.1' } as Cell],
    ]);
    // 1 * (1.09) * (1.11) * (1.1) = 1.33089
    expect(Number(evaluate('=FVSCHEDULE(1,A1:A3)', grid))).toBeCloseTo(1.33089, 4);
  });

  it('should correctly evaluate DSUM, DCOUNT, DAVERAGE, DMAX, DMIN functions', () => {
    // Database: A1=Name, B1=Score, C1=Grade
    // A2=Alice, B2=90, C2=A
    // A3=Bob, B3=80, C3=B
    // A4=Alice, B4=85, C4=B
    // Criteria: E1=Name, E2=Alice
    const grid = new Map([
      ['A1', { v: 'Name' } as Cell],
      ['B1', { v: 'Score' } as Cell],
      ['C1', { v: 'Grade' } as Cell],
      ['A2', { v: 'Alice' } as Cell],
      ['B2', { v: '90' } as Cell],
      ['C2', { v: 'A' } as Cell],
      ['A3', { v: 'Bob' } as Cell],
      ['B3', { v: '80' } as Cell],
      ['C3', { v: 'B' } as Cell],
      ['A4', { v: 'Alice' } as Cell],
      ['B4', { v: '85' } as Cell],
      ['C4', { v: 'B' } as Cell],
      ['E1', { v: 'Name' } as Cell],
      ['E2', { v: 'Alice' } as Cell],
    ]);
    // DSUM: sum Score for Alice = 90+85 = 175
    expect(evaluate('=DSUM(A1:C4,"Score",E1:E2)', grid)).toBe('175');
    // DCOUNT: count numeric values for Alice = 2
    expect(evaluate('=DCOUNT(A1:C4,"Score",E1:E2)', grid)).toBe('2');
    // DAVERAGE: avg = 87.5
    expect(evaluate('=DAVERAGE(A1:C4,"Score",E1:E2)', grid)).toBe('87.5');
    // DMAX: max = 90
    expect(evaluate('=DMAX(A1:C4,"Score",E1:E2)', grid)).toBe('90');
    // DMIN: min = 85
    expect(evaluate('=DMIN(A1:C4,"Score",E1:E2)', grid)).toBe('85');
  });

  it('should correctly evaluate DGET and DPRODUCT functions', () => {
    const grid = new Map([
      ['A1', { v: 'Name' } as Cell],
      ['B1', { v: 'Score' } as Cell],
      ['A2', { v: 'Alice' } as Cell],
      ['B2', { v: '90' } as Cell],
      ['A3', { v: 'Bob' } as Cell],
      ['B3', { v: '80' } as Cell],
      ['E1', { v: 'Name' } as Cell],
      ['E2', { v: 'Bob' } as Cell],
    ]);
    // DGET: exactly one match
    expect(evaluate('=DGET(A1:B3,"Score",E1:E2)', grid)).toBe('80');
    // DPRODUCT: product for Bob = 80
    expect(evaluate('=DPRODUCT(A1:B3,"Score",E1:E2)', grid)).toBe('80');
  });

  it('should correctly evaluate TREND and LINEST functions', () => {
    const grid = new Map([
      ['A1', { v: '1' } as Cell],
      ['A2', { v: '2' } as Cell],
      ['A3', { v: '3' } as Cell],
      ['B1', { v: '2' } as Cell],
      ['B2', { v: '4' } as Cell],
      ['B3', { v: '6' } as Cell],
    ]);
    // y = 2x, slope = 2
    expect(Number(evaluate('=LINEST(B1:B3,A1:A3)', grid))).toBeCloseTo(2, 10);
    // TREND at x=4 = 8
    expect(Number(evaluate('=TREND(B1:B3,A1:A3,4)', grid))).toBeCloseTo(8, 10);
  });

  it('should correctly evaluate GROWTH and LOGEST functions', () => {
    const grid = new Map([
      ['A1', { v: '1' } as Cell],
      ['A2', { v: '2' } as Cell],
      ['A3', { v: '3' } as Cell],
      ['B1', { v: '2' } as Cell],
      ['B2', { v: '4' } as Cell],
      ['B3', { v: '8' } as Cell],
    ]);
    // y ≈ 1 * 2^x, growth rate ≈ 2
    expect(Number(evaluate('=LOGEST(B1:B3,A1:A3)', grid))).toBeCloseTo(2, 1);
  });

  it('should correctly evaluate FREQUENCY function', () => {
    const grid = new Map([
      ['A1', { v: '1' } as Cell],
      ['A2', { v: '3' } as Cell],
      ['A3', { v: '5' } as Cell],
      ['A4', { v: '7' } as Cell],
      ['A5', { v: '9' } as Cell],
      ['B1', { v: '4' } as Cell],
      ['B2', { v: '8' } as Cell],
    ]);
    // values <= 4: 1,3 → count 2
    expect(evaluate('=FREQUENCY(A1:A5,B1:B2)', grid)).toBe('2');
  });

  it('should correctly evaluate MODE.MULT function', () => {
    const grid = new Map([
      ['A1', { v: '1' } as Cell],
      ['A2', { v: '2' } as Cell],
      ['A3', { v: '2' } as Cell],
      ['A4', { v: '3' } as Cell],
      ['A5', { v: '3' } as Cell],
    ]);
    // Both 2 and 3 appear twice; smallest mode = 2
    expect(evaluate('=MODE.MULT(A1:A5)', grid)).toBe('2');
  });

  it('should correctly evaluate AGGREGATE function', () => {
    const grid = new Map([
      ['A1', { v: '10' } as Cell],
      ['A2', { v: '20' } as Cell],
      ['A3', { v: '30' } as Cell],
    ]);
    // function_num 9 = SUM, options=6 (ignore errors)
    expect(evaluate('=AGGREGATE(9,6,A1:A3)', grid)).toBe('60');
    // function_num 1 = AVERAGE
    expect(evaluate('=AGGREGATE(1,6,A1:A3)', grid)).toBe('20');
  });

  it('should correctly evaluate COMBINA function', () => {
    // COMBINA(4,2) = C(5,2) = 10
    expect(evaluate('=COMBINA(4,2)')).toBe('10');
    // COMBINA(10,3) = C(12,3) = 220
    expect(evaluate('=COMBINA(10,3)')).toBe('220');
  });

  it('should correctly evaluate PERMUTATIONA function', () => {
    // PERMUTATIONA(3,2) = 3^2 = 9
    expect(evaluate('=PERMUTATIONA(3,2)')).toBe('9');
    expect(evaluate('=PERMUTATIONA(2,4)')).toBe('16');
  });

  it('should correctly evaluate T.TEST function', () => {
    const grid = new Map([
      ['A1', { v: '3' } as Cell],
      ['A2', { v: '4' } as Cell],
      ['A3', { v: '5' } as Cell],
      ['B1', { v: '6' } as Cell],
      ['B2', { v: '7' } as Cell],
      ['B3', { v: '8' } as Cell],
    ]);
    // T.TEST with equal means shifted by 3 should give a small p-value
    const pval = Number(evaluate('=T.TEST(A1:A3,B1:B3,2,2)', grid));
    expect(pval).toBeGreaterThan(0);
    expect(pval).toBeLessThan(0.1);
  });

  it('should correctly evaluate Z.TEST function', () => {
    const grid = new Map([
      ['A1', { v: '3' } as Cell],
      ['A2', { v: '4' } as Cell],
      ['A3', { v: '5' } as Cell],
      ['A4', { v: '6' } as Cell],
      ['A5', { v: '7' } as Cell],
    ]);
    // Z.TEST(data, 4) — test against mu=4
    const pval = Number(evaluate('=Z.TEST(A1:A5,4)', grid));
    expect(pval).toBeGreaterThan(0);
    expect(pval).toBeLessThan(1);
  });

  it('should correctly evaluate AREAS function', () => {
    expect(evaluate('=AREAS(A1:B2)')).toBe('1');
  });

  it('should correctly evaluate CELL function', () => {
    const grid = new Map<string, Cell>();
    expect(evaluate('=CELL("row",B3)', grid)).toBe('3');
    expect(evaluate('=CELL("col",B3)', grid)).toBe('2');
    expect(evaluate('=CELL("address",B3)', grid)).toBe('$B$3');
  });

  it('should correctly evaluate MMULT function', () => {
    const grid = new Map<string, Cell>();
    // 2x2 matrix A: [[1,2],[3,4]]
    grid.set('A1', { v: '1' } as Cell);
    grid.set('B1', { v: '2' } as Cell);
    grid.set('A2', { v: '3' } as Cell);
    grid.set('B2', { v: '4' } as Cell);
    // 2x2 matrix B: [[5,6],[7,8]]
    grid.set('C1', { v: '5' } as Cell);
    grid.set('D1', { v: '6' } as Cell);
    grid.set('C2', { v: '7' } as Cell);
    grid.set('D2', { v: '8' } as Cell);
    // Result top-left: 1*5 + 2*7 = 19
    expect(evaluate('=MMULT(A1:B2,C1:D2)', grid)).toBe('19');
  });

  it('should correctly evaluate MINVERSE function', () => {
    const grid = new Map<string, Cell>();
    // 2x2 identity matrix
    grid.set('A1', { v: '1' } as Cell);
    grid.set('B1', { v: '0' } as Cell);
    grid.set('A2', { v: '0' } as Cell);
    grid.set('B2', { v: '1' } as Cell);
    // Inverse of identity is identity, top-left = 1
    expect(evaluate('=MINVERSE(A1:B2)', grid)).toBe('1');
  });

  it('should correctly evaluate XMATCH function', () => {
    const grid = new Map<string, Cell>();
    grid.set('A1', { v: 'apple' } as Cell);
    grid.set('A2', { v: 'banana' } as Cell);
    grid.set('A3', { v: 'cherry' } as Cell);
    expect(evaluate('=XMATCH("banana",A1:A3)', grid)).toBe('2');
    expect(evaluate('=XMATCH("cherry",A1:A3)', grid)).toBe('3');
  });

  it('should correctly evaluate TOCOL function', () => {
    const grid = new Map<string, Cell>();
    grid.set('A1', { v: '1' } as Cell);
    grid.set('B1', { v: '2' } as Cell);
    grid.set('A2', { v: '3' } as Cell);
    grid.set('B2', { v: '4' } as Cell);
    // Returns first value of flattened range
    expect(evaluate('=TOCOL(A1:B2)', grid)).toBe('1');
  });

  it('should correctly evaluate TOROW function', () => {
    const grid = new Map<string, Cell>();
    grid.set('A1', { v: '10' } as Cell);
    grid.set('A2', { v: '20' } as Cell);
    expect(evaluate('=TOROW(A1:A2)', grid)).toBe('10');
  });

  it('should correctly evaluate TEXTSPLIT function', () => {
    expect(evaluate('=TEXTSPLIT("a,b,c",",")')).toBe('a');
    expect(evaluate('=TEXTSPLIT("hello world"," ")')).toBe('hello');
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
