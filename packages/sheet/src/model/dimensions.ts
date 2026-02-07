/**
 * `DimensionIndex` manages variable row or column sizes.
 * Stores custom sizes in a Map (1-based index → pixels).
 * Indices without a custom size use the default.
 */
export class DimensionIndex {
  private customSizes: Map<number, number>;
  private defaultSize: number;

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
    for (const [i, size] of this.customSizes) {
      if (i < index) {
        offset += size - this.defaultSize;
      }
    }
    return offset;
  }

  /**
   * `findIndex` returns the 1-based index for a given pixel offset.
   * Uses the custom sizes to find the correct index.
   */
  findIndex(offset: number): number {
    if (this.customSizes.size === 0) {
      return Math.floor(offset / this.defaultSize) + 1;
    }

    // Sort custom indices for sequential scan
    const sorted = Array.from(this.customSizes.entries()).sort(
      (a, b) => a[0] - b[0],
    );

    let accumulated = 0;
    let lastChecked = 0;

    for (const [idx, size] of sorted) {
      // Fill default-sized items between lastChecked and idx
      const gapCount = idx - 1 - lastChecked;
      const gapEnd = accumulated + gapCount * this.defaultSize;
      if (offset < gapEnd) {
        return lastChecked + Math.floor((offset - accumulated) / this.defaultSize) + 1;
      }
      accumulated = gapEnd;

      // Check this custom-sized item
      if (offset < accumulated + size) {
        return idx;
      }
      accumulated += size;
      lastChecked = idx;
    }

    // Past all custom sizes, remaining are default
    return lastChecked + Math.floor((offset - accumulated) / this.defaultSize) + 1;
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
  }

  /**
   * `clear` removes all custom sizes.
   */
  clear(): void {
    this.customSizes.clear();
  }

  /**
   * `hasCustomSizes` returns whether any custom sizes are set.
   */
  hasCustomSizes(): boolean {
    return this.customSizes.size > 0;
  }
}
