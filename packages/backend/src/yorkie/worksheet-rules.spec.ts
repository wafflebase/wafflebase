import { BadRequestException } from '@nestjs/common';
import { parseConditionalFormats, parseDataValidations } from './worksheet-rules';

const CF = {
  id: 'r1',
  ranges: [[{ r: 0, c: 0 }, { r: 0, c: 0 }]],
  op: 'isEmpty',
  style: { b: true },
};
const DV = {
  id: 'v1',
  ranges: [[{ r: 0, c: 0 }, { r: 0, c: 0 }]],
  kind: 'checkbox',
};

describe('worksheet-rules validators', () => {
  describe('parseConditionalFormats', () => {
    it('accepts a valid rule array (normalized)', () => {
      const out = parseConditionalFormats({ rules: [CF] });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ id: 'r1', op: 'isEmpty' });
    });
    it('rejects a missing or non-array rules', () => {
      expect(() => parseConditionalFormats({})).toThrow(BadRequestException);
      expect(() => parseConditionalFormats({ rules: {} })).toThrow(
        BadRequestException,
      );
    });
    it('rejects an invalid rule (bad operator)', () => {
      expect(() =>
        parseConditionalFormats({ rules: [{ ...CF, op: 'nope' }] }),
      ).toThrow(BadRequestException);
    });
  });

  describe('parseDataValidations', () => {
    it('accepts a valid rule array', () => {
      const out = parseDataValidations({ rules: [DV] });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ id: 'v1', kind: 'checkbox' });
    });
    it('rejects an invalid rule (bad kind)', () => {
      expect(() =>
        parseDataValidations({ rules: [{ ...DV, kind: 'nope' }] }),
      ).toThrow(BadRequestException);
    });
  });
});
