/**
 * Resolved page selection produced by {@link parsePageRange}.
 *
 * `pages` is the deduplicated set of 1-based page numbers requested by
 * the user, after clamping to the document's actual page count.
 *
 * `warnings` collects clamp/duplicate notices the caller should emit to
 * stderr (parsing succeeded; the user just asked for pages that don't
 * exist). Hard errors throw instead — see {@link parsePageRange}.
 */
export interface PageRange {
  pages: ReadonlySet<number>;
  warnings: ReadonlyArray<string>;
}

const SINGLE = /^\d+$/;
const RANGE = /^(\d+)-(\d+)$/;

/**
 * Parse a `--pages` flag value (e.g., `"1-3,5,7-9"`) against a known
 * page count.
 *
 * Throws `Error` on malformed input — empty strings, non-numeric tokens,
 * a `0` page (1-based), or a reversed range (`"3-1"`). Out-of-range
 * upper bounds are *not* errors: they get clamped to `totalPages` with a
 * stderr-bound warning string in the result. Tokens whose entire range
 * sits past `totalPages` collapse to no pages with a warning, never an
 * error — this lets `--pages 1-99` work on a 3-page doc.
 *
 * `totalPages` of 0 is a valid input (empty doc) and yields an empty set
 * with a single "document has no pages" warning, regardless of input.
 */
export function parsePageRange(input: string, totalPages: number): PageRange {
  if (totalPages < 0) {
    throw new Error(`parsePageRange: totalPages must be ≥ 0, got ${totalPages}`);
  }

  const trimmed = input.trim();
  if (trimmed === '') {
    throw new Error('Page range is empty.');
  }

  const tokens = trimmed.split(',').map((t) => t.trim());
  for (const tok of tokens) {
    if (tok === '') {
      throw new Error(`Empty token in page range "${input}"`);
    }
  }

  const pages = new Set<number>();
  const warnings: string[] = [];

  if (totalPages === 0) {
    warnings.push('Document has no pages.');
    return { pages, warnings };
  }

  for (const tok of tokens) {
    if (SINGLE.test(tok)) {
      const n = Number(tok);
      if (n < 1) {
        throw new Error(`Page numbers are 1-based; got "${tok}"`);
      }
      if (n > totalPages) {
        warnings.push(
          `Page ${n} is beyond document end (${totalPages}); ignored.`,
        );
        continue;
      }
      pages.add(n);
      continue;
    }

    const m = RANGE.exec(tok);
    if (!m) {
      throw new Error(`Invalid page token "${tok}" in "${input}"`);
    }
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (lo < 1 || hi < 1) {
      throw new Error(`Page numbers are 1-based; got "${tok}"`);
    }
    if (lo > hi) {
      throw new Error(`Reversed range "${tok}" — start must be ≤ end.`);
    }
    if (lo > totalPages) {
      warnings.push(
        `Range ${tok} starts beyond document end (${totalPages}); ignored.`,
      );
      continue;
    }
    const clampedHi = Math.min(hi, totalPages);
    if (clampedHi < hi) {
      warnings.push(
        `Range ${tok} clamped to ${lo}-${clampedHi} (document has ${totalPages} pages).`,
      );
    }
    for (let p = lo; p <= clampedHi; p++) pages.add(p);
  }

  return { pages, warnings };
}
