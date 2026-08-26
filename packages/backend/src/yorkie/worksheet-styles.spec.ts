import { BadRequestException } from '@nestjs/common';
import { parseRangeStyles, parseSheetStyle } from './worksheet-styles';

const PATCH = {
  range: [
    { r: 0, c: 0 },
    { r: 2, c: 2 },
  ],
  style: { b: true },
};

describe('worksheet-styles validators', () => {
  describe('parseRangeStyles', () => {
    it('accepts a valid patch array', () => {
      const out = parseRangeStyles({ rangeStyles: [PATCH] });
      expect(out).toHaveLength(1);
      expect(out[0].style).toMatchObject({ b: true });
    });
    it('rejects a non-array or an invalid patch', () => {
      expect(() => parseRangeStyles({})).toThrow(BadRequestException);
      expect(() =>
        parseRangeStyles({ rangeStyles: [{ style: { b: true } }] }),
      ).toThrow(BadRequestException);
    });
  });

  describe('parseSheetStyle', () => {
    it('accepts a style and null (clear)', () => {
      expect(parseSheetStyle({ style: { b: true } })).toMatchObject({
        b: true,
      });
      expect(parseSheetStyle({ style: null })).toBeNull();
    });
    it('rejects an unknown style field', () => {
      expect(() => parseSheetStyle({ style: { bogus: 1 } })).toThrow(
        BadRequestException,
      );
    });
    it('rejects an omitted or undefined style rather than clearing', () => {
      expect(() => parseSheetStyle({})).toThrow(BadRequestException);
      expect(() => parseSheetStyle({ styls: { b: true } })).toThrow(
        BadRequestException,
      );
      expect(() => parseSheetStyle({ style: undefined })).toThrow(
        BadRequestException,
      );
    });
  });
});
