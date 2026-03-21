import { remapIndex } from './shifting';

/**
 * `DimensionIndex` manages variable row or column sizes.
 * Stores custom sizes in a Map (1-based index → pixels).
 * Indices without a custom size use the default.
 */
export class DimensionIndex {
  private customSizes: Map<number, number>;
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
    return this.customSizes.get(index) ?? this.defaultSize;
  }

  /**
   * `setSize` sets a custom size for the given 1-based index.
   */
  setSize(index: number, size: number): void {
    if (size === this.defaultSize) {
      this.customSizes.delete(index);
    } else {
      this.customSizes.set(index, size);
    }
    this.cacheDirty = true;
  }

  /**
   * `getDefaultSize` returns the default size.
   */
  getDefaultSize(): number {
    return this.defaultSize;
  }

  /**
   * `getOffset` returns the pixel offset of the start of the given 1-based index.
   * For performance, computes as: (index-1) * defaultSize + sum of custom deltas before index.
   */
  getOffset(index: number): number {
    let offset = (index - 1) * this.defaultSize;
    if (this.customSizes.size === 0) return offset;

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

    if (this.customSizes.size === 0) {
      return Math.floor(offset / this.defaultSize) + 1;
    }

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
   * `shift` shifts custom size keys on insert/delete.
   * Integrates with Phase 1 row/column insertion and deletion.
   */
  shift(index: number, count: number): void {
    const newSizes = new Map<number, number>();

    for (const [i, size] of this.customSizes) {
      if (count > 0) {
        // Insert: shift keys at or after index
        if (i >= index) {
          newSizes.set(i + count, size);
        } else {
          newSizes.set(i, size);
        }
      } else {
        // Delete: count < 0
        const absCount = Math.abs(count);
        if (i >= index && i < index + absCount) {
          // In deleted zone — drop it
        } else if (i >= index + absCount) {
          newSizes.set(i + count, size);
        } else {
          newSizes.set(i, size);
        }
      }
    }

    this.customSizes = newSizes;
    this.cacheDirty = true;
  }

  /**
   * `move` remaps custom size keys after moving `count` items from `src` to before `dst`.
   */
  move(src: number, count: number, dst: number): void {
    const newSizes = new Map<number, number>();

    for (const [i, size] of this.customSizes) {
      newSizes.set(remapIndex(i, src, count, dst), size);
    }

    this.customSizes = newSizes;
    this.cacheDirty = true;
  }

  /**
   * `clear` removes all custom sizes.
   */
  clear(): void {
    this.customSizes.clear();
    this.cacheDirty = true;
  }

  /**
   * `hasCustomSizes` returns whether any custom sizes are set.
   */
  hasCustomSizes(): boolean {
    return this.customSizes.size > 0;
  }

  private ensureCache(): void {
    if (!this.cacheDirty) {
      return;
    }

    if (this.customSizes.size === 0) {
      this.sortedIndices = [];
      this.sortedSizes = [];
      this.prefixDeltas = [];
      this.customStarts = [];
      this.cacheDirty = false;
      return;
    }

    const sorted = Array.from(this.customSizes.entries()).sort(
      (a, b) => a[0] - b[0],
    );

    this.sortedIndices = [];
    this.sortedSizes = [];
    this.prefixDeltas = [];
    this.customStarts = [];

    let accumulatedDelta = 0;
    for (const [index, size] of sorted) {
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
