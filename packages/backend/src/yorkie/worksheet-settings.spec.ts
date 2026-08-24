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
    // The frozen quadrants render every frozen row and column with no viewport
    // clipping, so an out-of-grid freeze means the UI never paints — and the
    // user cannot reach the freeze menu to undo it.
    it('rejects a freeze past the end of the grid', () => {
      expect(() => parseFreeze({ rows: 1000001 })).toThrow(
        BadRequestException,
      );
      expect(() => parseFreeze({ cols: 18279 })).toThrow(BadRequestException);
      expect(parseFreeze({ rows: 1000000, cols: 18278 })).toEqual({
        rows: 1000000,
        cols: 18278,
      });
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
    // Indices are 1-based, matching `Sheet.loadHiddenState`, which keeps only
    // `>= 1`. Accepting 0 and letting the engine drop it is what would make
    // every index look off by one, with a round-trip that hides the mismatch.
    it('rejects index 0 rather than letting the engine drop it', () => {
      expect(() => parseHidden({ rows: [0] })).toThrow(BadRequestException);
      expect(() => parseHidden({ columns: [0] })).toThrow(BadRequestException);
      expect(parseHidden({ rows: [1] })).toEqual({ rows: [1], columns: [] });
    });
    it('rejects an index past the end of the grid', () => {
      expect(() => parseHidden({ rows: [1000001] })).toThrow(
        BadRequestException,
      );
      expect(() => parseHidden({ columns: [18279] })).toThrow(
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

    // `Sheet.rebuildMergeCoverMap` calls `parseRef` on every key with no
    // try/catch, so a key this validator accepts and `parseRef` rejects is not
    // a bad request — it is a tab that throws on load for every collaborator,
    // permanently, recoverable only through another API call.
    it.each([['1'], ['foo'], [''], ['A'], ['__proto__'], ['A1:B2']])(
      'rejects %p as a merge key',
      (key) => {
        expect(() =>
          parseMerges({ merges: { [key]: { rs: 1, cs: 1 } } }),
        ).toThrow(BadRequestException);
      },
    );

    // Built with JSON.parse, not an object literal: `{ __proto__: x }` sets the
    // prototype and creates no own key, so a literal cannot reproduce this at
    // all. The request body reaches the controller via JSON.parse, which does
    // create an own `__proto__` property — so this is the shape that matters.
    it('rejects a __proto__ key from a JSON body', () => {
      const body = JSON.parse('{"merges":{"__proto__":{"rs":1,"cs":1}}}');
      expect(() => parseMerges(body)).toThrow(BadRequestException);
      expect(({} as Record<string, unknown>).rs).toBeUndefined();
    });

    // `rebuildMergeCoverMap` walks `rs * cs` on every document load and stores
    // one Map entry per covered cell, so an unbounded span is not a large
    // merge — it is a document nobody can open again.
    it('rejects a span that covers more cells than the ceiling', () => {
      expect(() =>
        parseMerges({ merges: { A1: { rs: 1000000, cs: 18278 } } }),
      ).toThrow(BadRequestException);
      expect(() =>
        parseMerges({ merges: { A1: { rs: 100001, cs: 1 } } }),
      ).toThrow(BadRequestException);
      expect(parseMerges({ merges: { A1: { rs: 100000, cs: 1 } } })).toEqual({
        A1: { rs: 100000, cs: 1 },
      });
    });

    it('rejects a span that runs past the end of the grid', () => {
      expect(() =>
        parseMerges({ merges: { A1000000: { rs: 2, cs: 1 } } }),
      ).toThrow(BadRequestException);
    });
  });
});
