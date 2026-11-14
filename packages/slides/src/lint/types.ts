import type { TextMeasurer } from '@wafflebase/docs';

/** The rules {@link lintSlides} knows. One file per rule under `rules/`. */
export type LintRuleId =
  | 'contrast'
  | 'out-of-bounds'
  | 'overlap'
  | 'edge-margin'
  | 'min-font'
  | 'overflow'
  | 'token-wrap'
  | 'empty-region'
  | 'inset-inconsistent';

/**
 * `error` — almost certainly visible to a viewer (unreadable text, text
 * cut off). `warning` — likely a problem, but intent is plausible.
 * `info` — worth a look; never fails anything on its own.
 */
export type LintSeverity = 'error' | 'warning' | 'info';

export type Finding = {
  rule: LintRuleId;
  severity: LintSeverity;
  slideId: string;
  /** 0-based position of the slide in the deck, for humans and CLIs. */
  slideIndex: number;
  elementId?: string;
  /** The element's text, first 40 characters — a stable handle for humans and allowlists. */
  text?: string;
  message: string;
};

export type LintOptions = {
  /**
   * Text width measurer — `CanvasTextMeasurer` in a browser, fontkit or
   * {@link estimateMeasurer} in Node. Rules that lay text out (`overflow`,
   * and the ink box `edge-margin` and `contrast` read) fall back to
   * {@link estimateMeasurer} when absent.
   */
  measurer?: TextMeasurer;
  /** Rules to run. Default: all of them. */
  rules?: LintRuleId[];
  /** Element ids to skip entirely. */
  ignoreElementIds?: string[];
  /**
   * Overlap is reported when the intersection covers at least this fraction
   * of the smaller element's area. Default 0.15.
   */
  overlapMinFraction?: number;
  /** Required distance from the slide edge, in inches. Default 0.5. */
  edgeMarginInches?: number;
  /** Smallest readable text, in slide points (see `slidePt`). Default 12. */
  minFontPt?: number;
  /** Smallest readable footer text, in slide points. Default 9. */
  minFooterFontPt?: number;
  /** Pixels an element may poke past the slide before it counts. Default 2. */
  boundsTolerance?: number;
  /** Pixels of slack before laid-out text counts as overflow. Default 1. */
  overflowTolerance?: number;
  /**
   * `empty-region`: a content slide is reported (info) when the empty band
   * below its content covers at least this fraction of the safe area's
   * height. Default 0.45.
   */
  emptyRegionMinFraction?: number;
  /** `empty-region`: the band fraction at which the finding becomes a warning. Default 0.7. */
  emptyRegionWarnFraction?: number;
  /**
   * `inset-inconsistent`: pixels a card's text inset may differ from its
   * sibling cards' before it counts. Default 8.
   */
  insetTolerance?: number;
};
