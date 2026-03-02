import { describe, expect, it } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';

const setMobileEditCallback = (
  Worksheet.prototype as unknown as {
    setMobileEditCallback(
      cb: ((cellRef: string, value: string) => void) | null,
    ): void;
  }
).setMobileEditCallback;

describe('Worksheet mobile edit callback', () => {
  it('exposes setMobileEditCallback on the prototype', () => {
    expect(typeof setMobileEditCallback).toBe('function');
  });
});
