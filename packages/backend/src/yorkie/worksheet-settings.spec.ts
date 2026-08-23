import { BadRequestException } from '@nestjs/common';
import { parseFreeze, parseHidden, parseMerges } from './worksheet-settings';

describe('worksheet-settings validators', () => {
  describe('parseFreeze', () => {
    it('accepts rows/cols and defaults missing to 0', () => {
      expect(parseFreeze({ rows: 2 })).toEqual({ rows: 2, cols: 0 });
      expect(parseFreeze({})).toEqual({ rows: 0, cols: 0 });
    });
    it('rejects negative or non-integer values', () => {
      expect(() => parseFreeze({ rows: -1 })).toThrow(BadRequestException);
      expect(() => parseFreeze({ cols: 1.5 })).toThrow(BadRequestException);
    });
  });

  describe('parseHidden', () => {
    it('accepts index arrays and defaults to empty', () => {
      expect(parseHidden({ rows: [1, 3] })).toEqual({
        rows: [1, 3],
        columns: [],
      });
    });
    it('rejects a non-array or a bad element', () => {
      expect(() => parseHidden({ rows: 5 })).toThrow(BadRequestException);
      expect(() => parseHidden({ columns: [1, -2] })).toThrow(
        BadRequestException,
      );
    });
  });

  describe('parseMerges', () => {
    it('accepts a valid merges map', () => {
      expect(parseMerges({ merges: { A1: { rs: 2, cs: 3 } } })).toEqual({
        A1: { rs: 2, cs: 3 },
      });
    });
    it('rejects a missing merges map or a bad span', () => {
      expect(() => parseMerges({})).toThrow(BadRequestException);
      expect(() => parseMerges({ merges: { A1: { rs: 0, cs: 1 } } })).toThrow(
        BadRequestException,
      );
    });
  });
});
