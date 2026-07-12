import { Buffer } from 'node:buffer';
import * as fontkit from 'fontkit';
import type { Font, FontCollection } from 'fontkit';
import type { TextMeasurer, ResolvedFont } from '@wafflebase/docs';

/**
 * Variant key for the in-memory font cache. Lowercased family name plus
 * weight/style ensures `'Helvetica'` and `'helvetica'` resolve to the same
 * registered buffer — Canvas measurement is case-insensitive on family
 * lookups, so we mirror that here so the CLI matches browser pagination.
 */
function variantKey(
  family: string,
  weight: ResolvedFont['weight'],
  style: ResolvedFont['style'],
): string {
  return `${family.toLowerCase()}|${weight}|${style}`;
}

export interface FontkitMeasurerOptions {
  /**
   * Width per character in em-units used when no font is registered for
   * the requested variant. Multiplied by `font.size` to produce a px value.
   * Defaults to `0.5` — a coarse proportional-font approximation that
   * keeps pagination from collapsing to zero when a font is missing.
   *
   * Callers that pre-load every font referenced by a document never hit
   * this path; the fallback exists so a single missing variant does not
   * crash the CLI mid-pagination.
   */
  fallbackEmWidth?: number;
}

/**
 * `TextMeasurer` backed by `fontkit` for use in Node CLI contexts where
 * no Canvas 2D API is available. Width is computed as
 * `glyphRun.advanceWidth ÷ unitsPerEm × size` for each registered font.
 *
 * Measurement is synchronous; callers must `register()` every font
 * variant they need *before* invoking `paginateLayout` / `measureWidth`.
 * Loading is async (file/network IO) but the layout pipeline is not, so
 * we split the two phases.
 */
export class FontkitMeasurer implements TextMeasurer {
  private readonly fonts = new Map<string, Font>();
  private readonly fallbackEmWidth: number;

  constructor(opts: FontkitMeasurerOptions = {}) {
    this.fallbackEmWidth = opts.fallbackEmWidth ?? 0.5;
  }

  /**
   * Register a font buffer for a specific variant. Subsequent
   * `measureWidth` calls whose `(family, weight, style)` matches will use
   * this font's metrics. A `FontCollection` (.ttc) input is rejected
   * here — the caller must pick the desired face out of the collection
   * first to keep the cache key unambiguous.
   */
  register(
    family: string,
    weight: ResolvedFont['weight'],
    style: ResolvedFont['style'],
    buffer: Uint8Array | ArrayBuffer | Buffer,
  ): void {
    const buf = toBuffer(buffer);
    const parsed = fontkit.create(buf) as Font | FontCollection;
    if ('fonts' in parsed) {
      throw new Error(
        `FontkitMeasurer.register("${family}"): TrueType collections (.ttc) ` +
          `must be split into individual faces before registration.`,
      );
    }
    this.fonts.set(variantKey(family, weight, style), parsed);
  }

  /** True when the variant has a registered font (no fallback path). */
  has(
    family: string,
    weight: ResolvedFont['weight'],
    style: ResolvedFont['style'],
  ): boolean {
    return this.fonts.has(variantKey(family, weight, style));
  }

  measureWidth(text: string, font: ResolvedFont): number {
    if (text.length === 0) return 0;
    const spacing = font.letterSpacing ? font.letterSpacing * text.length : 0;
    const f = this.fonts.get(variantKey(font.family, font.weight, font.style));
    if (!f) return text.length * this.fallbackEmWidth * font.size + spacing;
    const run = f.layout(text);
    return (run.advanceWidth / f.unitsPerEm) * font.size + spacing;
  }
}

function toBuffer(input: Uint8Array | ArrayBuffer | Buffer): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(new Uint8Array(input));
  return Buffer.from(input);
}
