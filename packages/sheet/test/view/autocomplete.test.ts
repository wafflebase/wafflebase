import { describe, it, expect } from 'vitest';
import { getAutocompleteContext } from '../../src/view/autocomplete';

describe('getAutocompleteContext', () => {
  it('should detect function name prefix', () => {
    const ctx = getAutocompleteContext('=SU', 3);
    expect(ctx).toEqual({ type: 'function-name', prefix: 'SU' });
  });

  it('should detect single-letter prefix', () => {
    const ctx = getAutocompleteContext('=S', 2);
    expect(ctx).toEqual({ type: 'function-name', prefix: 'S' });
  });

  it('should detect argument context at argIndex 0', () => {
    const ctx = getAutocompleteContext('=SUM(', 5);
    expect(ctx).toEqual({ type: 'argument', funcName: 'SUM', argIndex: 0 });
  });

  it('should detect argument context at argIndex 1', () => {
    const ctx = getAutocompleteContext('=SUM(1,', 7);
    expect(ctx).toEqual({ type: 'argument', funcName: 'SUM', argIndex: 1 });
  });

  it('should detect argument context at argIndex 2', () => {
    const ctx = getAutocompleteContext('=SUM(1,2,', 9);
    expect(ctx).toEqual({ type: 'argument', funcName: 'SUM', argIndex: 2 });
  });

  it('should handle nested functions — inner function', () => {
    const ctx = getAutocompleteContext('=SUM(IF(', 8);
    expect(ctx).toEqual({ type: 'argument', funcName: 'IF', argIndex: 0 });
  });

  it('should handle nested functions — back in outer after close paren', () => {
    const ctx = getAutocompleteContext('=SUM(IF(1,2),', 13);
    expect(ctx).toEqual({ type: 'argument', funcName: 'SUM', argIndex: 1 });
  });

  it('should return none for simple arithmetic', () => {
    const ctx = getAutocompleteContext('=1+2', 4);
    expect(ctx).toEqual({ type: 'none' });
  });

  it('should return none for non-formula text', () => {
    const ctx = getAutocompleteContext('hello', 5);
    expect(ctx).toEqual({ type: 'none' });
  });

  it('should return none for empty formula', () => {
    const ctx = getAutocompleteContext('=', 1);
    expect(ctx).toEqual({ type: 'none' });
  });

  it('should detect function name after operator', () => {
    const ctx = getAutocompleteContext('=1+SU', 5);
    expect(ctx).toEqual({ type: 'function-name', prefix: 'SU' });
  });

  it('should detect argument in function after operator', () => {
    const ctx = getAutocompleteContext('=1+SUM(', 7);
    expect(ctx).toEqual({ type: 'argument', funcName: 'SUM', argIndex: 0 });
  });

  it('should handle lowercase function names', () => {
    const ctx = getAutocompleteContext('=sum(', 5);
    expect(ctx).toEqual({ type: 'argument', funcName: 'SUM', argIndex: 0 });
  });

  it('should detect function name with lowercase prefix', () => {
    const ctx = getAutocompleteContext('=su', 3);
    expect(ctx).toEqual({ type: 'function-name', prefix: 'su' });
  });

  it('should handle cursor in middle of text', () => {
    const ctx = getAutocompleteContext('=SUM(1,2)', 7);
    expect(ctx).toEqual({ type: 'argument', funcName: 'SUM', argIndex: 1 });
  });

  it('should handle deeply nested functions', () => {
    const ctx = getAutocompleteContext('=SUM(IF(AND(', 12);
    expect(ctx).toEqual({ type: 'argument', funcName: 'AND', argIndex: 0 });
  });
});
