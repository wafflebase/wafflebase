import { remapIndex } from './shifting';

/**
 * A size the view computed from an index's content, with the axis ID the
 * index had when it was computed.
 */
type FittedSize = { size: number; id?: string };

/**
 * `DimensionIndex` manages variable row or column sizes.
 *
 * An index's size comes from three layers, each keyed by 1-based index:
 *
 * - stored: sizes somebody chose, as the document records them. `setSize`
 *   and `clear` write this layer, and a reload from the store replaces it.
 * - fitted: sizes the view computed from the content (fit to data). They are
 *   never written to the document, so a reload must not drop them; each
 *   carries the axis ID it was fitted for, so `realignFitted` can follow the
 *   row when somebody else's insert, delete or move renumbers it.
 * - hidden: indices drawn at zero size, whatever the other layers hold, so
 *   showing them again needs nothing put back.
 *
 * `getSize` is 0 for a hidden index, else the stored size, else the fitted
 * size, else the default.
 */
export class DimensionIndex {
  private customSizes: Map<number, number>;
  private fittedSizes: Map<number, FittedSize> = new Map();
  private hidden: Set<number> = new Set();
  private renumberings = 0;
  private defaultSize: number;
  private cacheDirty = true;
  private sortedIndices: number[] = [];
  private sortedSizes: number[] = [];
  private prefixDeltas: number[] = [];
  private customStarts: number[] = [];

  constructor(defaultSize: number) {
    this.defaultSize = defaultSize;
    this.customSizes = new Map();
  }

  /**
   * `getSize` returns the size for the given 1-based index.
   */
  getSize(index: number): number {
    if (this.hidden.has(index)) {
      return 0;
    }
    return (
      this.customSizes.get(index) ??
      this.fittedSizes.get(index)?.size ??
      this.defaultSize
    );
  }

  /**
   * `setSize` sets a stored size for the given 1-based index, and drops its
   * fitted size: a chosen size overrules a computed one. That holds for the
   * default too, which the stored layer keeps no entry for and so could not
   * otherwise hide a fitted size under it.
   */
  setSize(index: number, size: number): void {
    if (size === this.defaultSize) {
      this.customSizes.delete(index);
    } else {
      this.customSizes.set(index, size);
    }
    this.fittedSizes.delete(index);
    this.cacheDirty = true;
  }

  /**
   * `getDefaultSize` returns the default size.
   */
  getDefaultSize(): number {
    return this.defaultSize;
  }

  /**
   * `getFittedSize` returns the fitted size of the given 1-based index, if it
   * has one.
   */
  getFittedSize(index: number): number | undefined {
    return this.fittedSizes.get(index)?.size;
  }

  /**
   * `setFittedSize` sets the fitted size of the given 1-based index, and the
   * axis ID the index has now. The default size removes the entry.
   */
  setFittedSize(index: number, size: number, id?: string): void {
    if (size === this.defaultSize) {
      this.clearFittedSize(index);
      return;
    }
    this.fittedSizes.set(index, id === undefined ? { size } : { size, id });
    this.cacheDirty = true;
  }

  /**
   * `clearFittedSize` removes the fitted size of the given 1-based index.
   * Returns whether there was one.
   */
  clearFittedSize(index: number): boolean {
    if (!this.fittedSizes.delete(index)) {
      return false;
    }
    this.cacheDirty = true;
    return true;
  }

  /**
   * `getFittedIndices` returns the indices that have a fitted size.
   */
  getFittedIndices(): Array<number> {
    return Array.from(this.fittedSizes.keys());
  }

  /**
   * `hasFittedSizes` returns whether any index has a fitted size.
   */
  hasFittedSizes(): boolean {
    return this.fittedSizes.size > 0;
  }

  /**
   * `clearFitted` removes every fitted size.
   */
  clearFitted(): void {
    if (this.fittedSizes.size === 0) {
      return;
    }
    this.fittedSizes.clear();
    this.cacheDirty = true;
  }

  /**
   * `getRenumberings` counts the times the indices were renumbered: every
   * `shift` and `move`, and every `realignFitted` that moved a size. A caller
   * holding a copy of the axis order can tell from it whether this index
   * still lines up with that copy, without copying the order again.
   */
  getRenumberings(): number {
    return this.renumberings;
  }

  /**
   * `realignFitted` moves each fitted size to the index its axis ID has in
   * `order` (the axis IDs, first index first), and drops the ones whose ID is
   * gone. An insert, delete or move that reached this view through `shift` or
   * `move` is already accounted for; this catches the ones that did not — a
   * peer's, which only a reload from the store brings in.
   *
   * A size with no axis ID stays where it is, and so does everything when
   * `order` is empty: without IDs, the index is all there is to go by.
   * Returns whether any size moved or was dropped.
   */
  realignFitted(order: ReadonlyArray<string>): boolean {
    if (order.length === 0 || this.fittedSizes.size === 0) {
      return false;
    }

    let aligned = true;
    for (const [index, fitted] of this.fittedSizes) {
      if (fitted.id !== undefined && order[index - 1] !== fitted.id) {
        aligned = false;
        break;
      }
    }
    if (aligned) {
      return false;
    }

    const positions = new Map<string, number>();
    for (let i = 0; i < order.length; i++) {
      positions.set(order[i], i + 1);
    }
    const next = new Map<number, FittedSize>();
    // Sizes with an ID go in last, so one that moved onto an index wins over
    // an ID-less size left there.
    for (const [index, fitted] of this.fittedSizes) {
      if (fitted.id === undefined) {
        next.set(index, fitted);
      }
    }
    for (const fitted of this.fittedSizes.values()) {
      if (fitted.id === undefined) {
        continue;
      }
      const index = positions.get(fitted.id);
      if (index !== undefined) {
        next.set(index, fitted);
      }
    }

    this.fittedSizes = next;
    this.renumberings++;
    this.cacheDirty = true;
    return true;
  }

  /**
   * `setHidden` makes exactly `indices` the hidden ones. Returns whether that
   * changed which are.
   */
  setHidden(indices: Iterable<number>): boolean {
    const next = new Set(indices);
    if (
      next.size === this.hidden.size &&
      Array.from(next).every((index) => this.hidden.has(index))
    ) {
      return false;
    }
    this.hidden = next;
    this.cacheDirty = true;
    return true;
  }

  /**
   * `getOffset` returns the pixel offset of the start of the given 1-based index.
   * For performance, computes as: (index-1) * defaultSize + sum of custom deltas before index.
   */
  getOffset(index: number): number {
    let offset = (index - 1) * this.defaultSize;
    if (this.isUniform()) return offset;

    this.ensureCache();
    const pos = this.lowerBound(this.sortedIndices, index) - 1;
    if (pos >= 0) {
      offset += this.prefixDeltas[pos];
    }
    return offset;
  }

  /**
   * `findIndex` returns the 1-based index for a given pixel offset.
   * Uses the custom sizes to find the correct index.
   */
  findIndex(offset: number): number {
    if (offset < 0) return 1;

    if (this.isUniform()) {
      return Math.floor(offset / this.defaultSize) + 1;
    }

    // Not uniform, so the cache holds at least one index: every stored and
    // fitted entry differs from the default, and a hidden index is 0.
    this.ensureCache();
    const firstCustomStart = this.customStarts[0];
    if (offset < firstCustomStart) {
      return Math.floor(offset / this.defaultSize) + 1;
    }

    const customPos = this.upperBound(this.customStarts, offset) - 1;
    const customIndex = this.sortedIndices[customPos];
    const customStart = this.customStarts[customPos];
    const customSize = this.sortedSizes[customPos];

    if (offset < customStart + customSize) {
      return customIndex;
    }

    const gapOffset = offset - (customStart + customSize);
    return customIndex + 1 + Math.floor(gapOffset / this.defaultSize);
  }

  /**
   * `shift` shifts every layer's keys on insert/delete.
   * Integrates with Phase 1 row/column insertion and deletion.
   */
  shift(index: number, count: number): void {
    const remap = (i: number): number | undefined => {
      if (i < index) {
        return i;
      }
      // Delete: drop what sits in the deleted zone.
      if (count < 0 && i < index - count) {
        return undefined;
      }
      return i + count;
    };

    this.customSizes = remapKeys(this.customSizes, remap);
    this.fittedSizes = remapKeys(this.fittedSizes, remap);
    this.hidden = remapSet(this.hidden, remap);
    this.renumberings++;
    this.cacheDirty = true;
  }

  /**
   * `move` remaps every layer's keys after moving `count` items from `src` to before `dst`.
   */
  move(src: number, count: number, dst: number): void {
    const remap = (i: number) => remapIndex(i, src, count, dst);

    this.customSizes = remapKeys(this.customSizes, remap);
    this.fittedSizes = remapKeys(this.fittedSizes, remap);
    this.hidden = remapSet(this.hidden, remap);
    this.renumberings++;
    this.cacheDirty = true;
  }

  /**
   * `clear` removes all stored sizes. Fitted sizes and hidden indices are not
   * stored, so they stay.
   */
  clear(): void {
    this.customSizes.clear();
    this.cacheDirty = true;
  }

  /**
   * `hasCustomSizes` returns whether any stored sizes are set.
   */
  hasCustomSizes(): boolean {
    return this.customSizes.size > 0;
  }

  /** Whether every index has the default size. */
  private isUniform(): boolean {
    return (
      this.customSizes.size === 0 &&
      this.fittedSizes.size === 0 &&
      this.hidden.size === 0
    );
  }

  private ensureCache(): void {
    if (!this.cacheDirty) {
      return;
    }

    this.sortedIndices = [];
    this.sortedSizes = [];
    this.prefixDeltas = [];
    this.customStarts = [];

    // The layers merged into one size per index; an index whose layers come
    // to the default contributes nothing, as if it had no entry.
    const indices = new Set<number>(this.customSizes.keys());
    for (const index of this.fittedSizes.keys()) {
      indices.add(index);
    }
    for (const index of this.hidden) {
      indices.add(index);
    }
    const sorted = Array.from(indices).sort((a, b) => a - b);

    let accumulatedDelta = 0;
    for (const index of sorted) {
      const size = this.getSize(index);
      if (size === this.defaultSize) {
        continue;
      }
      this.sortedIndices.push(index);
      this.sortedSizes.push(size);
      this.customStarts.push((index - 1) * this.defaultSize + accumulatedDelta);
      accumulatedDelta += size - this.defaultSize;
      this.prefixDeltas.push(accumulatedDelta);
    }

    this.cacheDirty = false;
  }

  private lowerBound(array: number[], target: number): number {
    let left = 0;
    let right = array.length;
    while (left < right) {
      const mid = left + Math.floor((right - left) / 2);
      if (array[mid] < target) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    return left;
  }

  private upperBound(array: number[], target: number): number {
    let left = 0;
    let right = array.length;
    while (left < right) {
      const mid = left + Math.floor((right - left) / 2);
      if (array[mid] <= target) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    return left;
  }
}

/** `map` with each key passed through `remap`; `undefined` drops the entry. */
function remapKeys<T>(
  map: Map<number, T>,
  remap: (index: number) => number | undefined,
): Map<number, T> {
  const next = new Map<number, T>();
  for (const [index, value] of map) {
    const to = remap(index);
    if (to !== undefined) {
      next.set(to, value);
    }
  }
  return next;
}

/** `set` with each index passed through `remap`; `undefined` drops it. */
function remapSet(
  set: Set<number>,
  remap: (index: number) => number | undefined,
): Set<number> {
  const next = new Set<number>();
  for (const index of set) {
    const to = remap(index);
    if (to !== undefined) {
      next.add(to);
    }
  }
  return next;
}
