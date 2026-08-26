import { BadRequestException } from '@nestjs/common';
import {
  parseIndexKeyedSizes,
  parseIndexKeyedStyles,
} from './worksheet-dimensions';

describe('worksheet-dimensions validators', () => {
  describe('parseIndexKeyedStyles', () => {
    it('accepts index-keyed styles and null clears', () => {
      const out = parseIndexKeyedStyles(
        { columnStyles: { '1': { b: true }, '2': null } },
        'columnStyles',
      );
      expect(out.get('1')).toMatchObject({ b: true });
      expect(out.get('2')).toBeNull();
    });

    it('rejects a non-object body or map', () => {
      expect(() => parseIndexKeyedStyles({}, 'columnStyles')).toThrow(
        BadRequestException,
      );
      expect(() =>
        parseIndexKeyedStyles({ columnStyles: [] }, 'columnStyles'),
      ).toThrow(BadRequestException);
    });

    it('rejects a non-integer / non-positive index key', () => {
      expect(() =>
        parseIndexKeyedStyles(
          { columnStyles: { '0': { b: true } } },
          'columnStyles',
        ),
      ).toThrow(BadRequestException);
      expect(() =>
        parseIndexKeyedStyles(
          { columnStyles: { A: { b: true } } },
          'columnStyles',
        ),
      ).toThrow(BadRequestException);
    });

    it('rejects an invalid style field', () => {
      expect(() =>
        parseIndexKeyedStyles(
          { columnStyles: { '1': { bogus: 1 } } },
          'columnStyles',
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('parseIndexKeyedSizes', () => {
    it('accepts positive numbers and null clears', () => {
      const out = parseIndexKeyedSizes(
        { columnWidths: { '1': 120, '2': null } },
        'columnWidths',
      );
      expect(out.get('1')).toBe(120);
      expect(out.get('2')).toBeNull();
    });

    it('rejects a non-positive or non-numeric size', () => {
      expect(() =>
        parseIndexKeyedSizes({ columnWidths: { '1': 0 } }, 'columnWidths'),
      ).toThrow(BadRequestException);
      expect(() =>
        parseIndexKeyedSizes({ columnWidths: { '1': 'wide' } }, 'columnWidths'),
      ).toThrow(BadRequestException);
    });
  });
});
