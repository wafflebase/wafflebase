import { describe, expect, it } from 'vitest';
import { DimensionIndex } from '../../src/model/worksheet/dimensions';

const Default = 24;

describe('DimensionIndex layers', () => {
  it('draws a stored size over a fitted one, and a fitted one over the default', () => {
    const dim = new DimensionIndex(Default);
    dim.setFittedSize(2, 60, 'b');
    dim.setFittedSize(3, 60, 'c');
    dim.setSize(3, 40);

    expect(dim.getSize(1)).toBe(Default);
    expect(dim.getSize(2)).toBe(60);
    expect(dim.getSize(3)).toBe(40);
  });

  it('lets a stored write, the default included, drop the fitted size under it', () => {
    const dim = new DimensionIndex(Default);
    dim.setFittedSize(2, 60, 'b');
    dim.setFittedSize(3, 60, 'c');

    dim.setSize(2, 40);
    // The stored layer keeps no entry for the default, so without dropping
    // the fitted size it would show straight through.
    dim.setSize(3, Default);

    expect(dim.getFittedSize(2)).toBeUndefined();
    expect(dim.getSize(3)).toBe(Default);
    expect(dim.getFittedIndices()).toEqual([]);
  });

  it('clears only the stored layer', () => {
    const dim = new DimensionIndex(Default);
    dim.setSize(1, 40);
    dim.setFittedSize(2, 60, 'b');
    dim.setHidden([3]);

    dim.clear();

    expect(dim.getSize(1)).toBe(Default);
    expect(dim.getSize(2)).toBe(60);
    expect(dim.getSize(3)).toBe(0);
    expect(dim.getOffset(4)).toBe(Default + 60);
  });

  it('draws a hidden index at zero and gives it back its size once shown', () => {
    const dim = new DimensionIndex(Default);
    dim.setSize(1, 40);
    dim.setFittedSize(2, 60, 'b');

    expect(dim.setHidden([1, 2])).toBe(true);
    expect([dim.getSize(1), dim.getSize(2), dim.getOffset(3)]).toEqual([
      0, 0, 0,
    ]);

    expect(dim.setHidden([])).toBe(true);
    expect([dim.getSize(1), dim.getSize(2)]).toEqual([40, 60]);
  });

  it('reports whether setHidden changed which indices are hidden', () => {
    const dim = new DimensionIndex(Default);
    expect(dim.setHidden([])).toBe(false);
    dim.setHidden([2, 4]);

    expect(dim.setHidden(new Set([4, 2]))).toBe(false);
    expect(dim.setHidden([2, 5])).toBe(true);
  });

  it('removes a fitted size set to the default', () => {
    const dim = new DimensionIndex(Default);
    dim.setFittedSize(2, 60, 'b');

    dim.setFittedSize(2, Default, 'b');

    expect(dim.hasFittedSizes()).toBe(false);
  });

  it('says whether clearFittedSize removed anything', () => {
    const dim = new DimensionIndex(Default);
    dim.setFittedSize(2, 60, 'b');

    expect(dim.clearFittedSize(2)).toBe(true);
    expect(dim.clearFittedSize(2)).toBe(false);
  });

  it('clears every fitted size, and nothing else', () => {
    const dim = new DimensionIndex(Default);
    dim.setSize(1, 40);
    dim.setFittedSize(2, 60, 'b');
    dim.setHidden([3]);

    dim.clearFitted();

    expect(dim.hasFittedSizes()).toBe(false);
    expect([dim.getSize(1), dim.getSize(2), dim.getSize(3)]).toEqual([
      40,
      Default,
      0,
    ]);
  });

  it('counts what may renumber the indices, and nothing else', () => {
    const dim = new DimensionIndex(Default);
    dim.setFittedSize(2, 60, 'b');
    dim.setSize(1, 40);
    dim.setHidden([4]);
    dim.clearFitted();
    dim.setFittedSize(2, 60, 'b');
    dim.realignFitted(['a', 'b']);
    expect(dim.getRenumberings()).toBe(0);

    dim.shift(1, 1);
    dim.move(1, 1, 4);
    // `b` now sits at 2 in the index, but at 1 in this order.
    dim.realignFitted(['b']);
    // A reload from the store, which may bring in a peer's renumbering.
    dim.clear();
    expect(dim.getRenumberings()).toBe(4);
  });

  describe('realignFitted', () => {
    it('moves each fitted size to where its axis ID now sits', () => {
      const dim = new DimensionIndex(Default);
      dim.setFittedSize(2, 60, 'b');
      dim.setFittedSize(4, 80, 'd');

      // Two rows inserted above `b`, and `d` moved to the top.
      expect(dim.realignFitted(['d', 'x', 'y', 'a', 'b', 'c'])).toBe(true);

      expect(dim.getFittedIndices().sort()).toEqual([1, 5]);
      expect(dim.getSize(1)).toBe(80);
      expect(dim.getSize(5)).toBe(60);
      expect(dim.getOffset(6)).toBe(3 * Default + 80 + 60);
    });

    it('drops a fitted size whose axis ID is gone', () => {
      const dim = new DimensionIndex(Default);
      dim.setFittedSize(2, 60, 'b');

      expect(dim.realignFitted(['a', 'c'])).toBe(true);

      expect(dim.hasFittedSizes()).toBe(false);
    });

    it('reports nothing moved when every ID is already in place', () => {
      const dim = new DimensionIndex(Default);
      dim.setFittedSize(2, 60, 'b');

      expect(dim.realignFitted(['a', 'b', 'c'])).toBe(false);
      expect(dim.getSize(2)).toBe(60);
    });

    it('leaves everything in place without a row order', () => {
      const dim = new DimensionIndex(Default);
      dim.setFittedSize(2, 60, 'b');

      expect(dim.realignFitted([])).toBe(false);
      expect(dim.getSize(2)).toBe(60);
    });

    it('keeps a fitted size that has no axis ID where it is, unless a moved one lands there', () => {
      const dim = new DimensionIndex(Default);
      dim.setFittedSize(1, 40);
      dim.setFittedSize(3, 50);
      dim.setFittedSize(5, 60, 'e');

      dim.realignFitted(['e', 'a', 'b', 'c', 'd']);

      expect(dim.getSize(1)).toBe(60);
      expect(dim.getSize(3)).toBe(50);
      expect(dim.getSize(5)).toBe(Default);
    });
  });
});

/**
 * A reference for `DimensionIndex`: each layer is a plain array with one slot
 * per index, an insert, delete or move is a `splice`, an offset is a running
 * sum and `findIndex` a linear scan. Nothing here shares code or structure
 * with the real index, which keeps sorted entries and prefix sums.
 */
class ReferenceDimensions {
  stored: Array<number | undefined> = [];
  fitted: Array<{ size: number; id?: string } | undefined> = [];
  hidden: Array<boolean> = [];

  constructor(
    readonly defaultSize: number,
    readonly length: number,
  ) {
    this.stored = new Array(length).fill(undefined);
    this.fitted = new Array(length).fill(undefined);
    this.hidden = new Array(length).fill(false);
  }

  size(index: number): number {
    if (this.hidden[index - 1]) return 0;
    return (
      this.stored[index - 1] ?? this.fitted[index - 1]?.size ?? this.defaultSize
    );
  }

  offset(index: number): number {
    let sum = 0;
    for (let i = 1; i < index; i++) sum += this.size(i);
    return sum;
  }

  find(offset: number): number {
    if (offset < 0) return 1;
    let start = 0;
    for (let i = 1; ; i++) {
      const size = this.size(i);
      if (offset < start + size) return i;
      start += size;
    }
  }

  setSize(index: number, size: number) {
    this.stored[index - 1] = size === this.defaultSize ? undefined : size;
    this.fitted[index - 1] = undefined;
  }

  setFitted(index: number, size: number, id?: string) {
    this.fitted[index - 1] =
      size === this.defaultSize ? undefined : { size, id };
  }

  private eachLayer(apply: (layer: Array<unknown>, empty: unknown) => void) {
    apply(this.stored, undefined);
    apply(this.fitted, undefined);
    apply(this.hidden, false);
    for (const layer of [this.stored, this.fitted, this.hidden]) {
      layer.length = this.length;
    }
  }

  shift(index: number, count: number) {
    this.eachLayer((layer, empty) => {
      if (count > 0) {
        layer.splice(index - 1, 0, ...new Array(count).fill(empty));
      } else {
        layer.splice(index - 1, -count);
        layer.push(...new Array(-count).fill(empty));
      }
    });
  }

  move(src: number, count: number, dst: number) {
    this.eachLayer((layer) => {
      const block = layer.splice(src - 1, count);
      const at = dst <= src ? dst - 1 : dst - 1 - count;
      layer.splice(at, 0, ...block);
    });
  }

  realign(order: Array<string>) {
    if (order.length === 0) return;
    const next = this.fitted.map((each) =>
      each && each.id === undefined ? each : undefined,
    );
    for (const each of this.fitted) {
      if (each?.id === undefined) continue;
      const at = order.indexOf(each.id);
      if (at >= 0) next[at] = each;
    }
    this.fitted = next;
  }
}

/** A small deterministic PRNG, so a failing run can be replayed by seed. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) =>
    lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(items: Array<T>): T => items[int(0, items.length - 1)];
  return { next, int, pick };
}

describe('DimensionIndex against a reference', () => {
  // Indices the operations touch stay well inside `Span`, so nothing a shift
  // pushes past the reference's arrays ever matters.
  const Touched = 30;
  const Span = 80;

  for (let seed = 1; seed <= 150; seed++) {
    it(`agrees on sizes, offsets and lookups (seed ${seed})`, () => {
      const rng = random(seed);
      const dim = new DimensionIndex(Default);
      const ref = new ReferenceDimensions(Default, Span);
      // The axis IDs, as a store would hold them: local edits renumber them
      // together with the index, a peer's edit only here.
      let order = Array.from({ length: Span }, (_, i) => `id${i}`);
      let fresh = 0;
      const sizes = [0, 1, Default, Default + 1, 40, 60, 101];
      const log: Array<string> = [];

      for (let step = 0; step < 40; step++) {
        const op = rng.int(0, 9);
        if (op <= 1) {
          const index = rng.int(1, Touched);
          const size = rng.pick(sizes);
          log.push(`setSize(${index}, ${size})`);
          dim.setSize(index, size);
          ref.setSize(index, size);
        } else if (op <= 3) {
          const index = rng.int(1, Touched);
          const size = rng.pick(sizes.filter((each) => each > 0));
          const id = rng.next() < 0.9 ? order[index - 1] : undefined;
          log.push(`setFittedSize(${index}, ${size}, ${id})`);
          dim.setFittedSize(index, size, id);
          ref.setFitted(index, size, id);
        } else if (op === 4) {
          const hidden = Array.from({ length: rng.int(0, 4) }, () =>
            rng.int(1, Touched),
          );
          log.push(`setHidden([${hidden}])`);
          dim.setHidden(hidden);
          ref.hidden = ref.hidden.map((_, i) => hidden.includes(i + 1));
        } else if (op === 5) {
          const index = rng.int(1, Touched);
          const count = rng.next() < 0.5 ? rng.int(1, 3) : -rng.int(1, 3);
          log.push(`shift(${index}, ${count})`);
          dim.shift(index, count);
          ref.shift(index, count);
          if (count > 0) {
            const added = Array.from({ length: count }, () => `new${fresh++}`);
            order.splice(index - 1, 0, ...added);
          } else {
            order.splice(index - 1, -count);
          }
        } else if (op === 6) {
          const count = rng.int(1, 3);
          const src = rng.int(1, Touched - count);
          let dst = rng.int(1, Touched);
          if (dst >= src && dst <= src + count) dst = src + count + 1;
          log.push(`move(${src}, ${count}, ${dst})`);
          dim.move(src, count, dst);
          ref.move(src, count, dst);
          const block = order.splice(src - 1, count);
          order.splice(dst <= src ? dst - 1 : dst - 1 - count, 0, ...block);
        } else if (op === 7) {
          // A peer's insert, delete or move: only the row order changes, and
          // the index catches up through `realignFitted`.
          const next = [...order];
          const at = rng.int(0, Touched - 1);
          const kind = rng.int(0, 2);
          if (kind === 0) next.splice(at, 0, `peer${fresh++}`);
          else if (kind === 1) next.splice(at, 1);
          else next.splice(rng.int(0, Touched - 1), 0, ...next.splice(at, 1));
          order = next;
          log.push(
            `realignFitted(peer ${['insert', 'delete', 'move'][kind]} at ${at + 1})`,
          );
          dim.realignFitted(order);
          ref.realign(order);
        } else if (op === 8) {
          log.push('clear()');
          dim.clear();
          ref.stored = ref.stored.map(() => undefined);
        } else {
          const index = rng.int(1, Touched);
          log.push(`clearFittedSize(${index})`);
          dim.clearFittedSize(index);
          ref.fitted[index - 1] = undefined;
        }

        // Compared in bulk, so a mismatch reports every index at once along
        // with the operations that led to it.
        const actual = {
          sizes: [] as number[],
          offsets: [] as number[],
          found: [] as number[],
        };
        const expected = {
          sizes: [] as number[],
          offsets: [] as number[],
          found: [] as number[],
        };
        for (let index = 1; index <= Touched + 5; index++) {
          actual.sizes.push(dim.getSize(index));
          expected.sizes.push(ref.size(index));
          actual.offsets.push(dim.getOffset(index));
          expected.offsets.push(ref.offset(index));
        }
        const end = ref.offset(Touched + 5);
        for (let offset = -1; offset <= end; offset += rng.int(1, 9)) {
          actual.found.push(dim.findIndex(offset));
          expected.found.push(ref.find(offset));
        }
        expect(actual, `seed ${seed}, after:\n  ${log.join('\n  ')}`).toEqual(
          expected,
        );
      }
    });
  }
});
