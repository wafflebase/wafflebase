/**
 * `overflow` — text that does not fit its box where the autofit mode says
 * it should.
 *
 * - `shrink`: the text is taller than its box even at the smallest scale
 *   the shrink engine allows — the box can never show all of it. `error`.
 * - `none`: at least one whole line paints outside the box. The canvas
 *   does not clip, so the text is still drawn; the finding says the box no
 *   longer describes where the text is, which is how authored-as-JSON decks
 *   end up with text running into the next element. `warning`. A box merely
 *   shorter than its one line's line-height (tight PPTX labels) is fine and
 *   not reported.
 * - `grow` (the default): the box grows with its text, so nothing to report
 *   here; text grown past the slide edge is `out-of-bounds`' to report.
 *
 * Any collision the overflowing text causes is reported by `overlap`, which
 * measures text by its ink rather than its frame.
 */
import type { Slide } from '../../model/presentation';
import { fmt, hasText, layoutText, textTarget, type DeckContext, type PlacedElement } from '../context';
import type { Finding } from '../types';

export function checkOverflow(
  slide: Slide,
  slideIndex: number,
  placed: PlacedElement[],
  ctx: DeckContext,
): Finding[] {
  const tol = ctx.opts.overflowTolerance;
  const findings: Finding[] = [];
  for (const p of placed) {
    if (!hasText(p.el)) continue;
    const mode = textTarget(p.el)?.body.autofit ?? 'grow';
    if (mode === 'grow') continue;
    const tl = layoutText(p.el, ctx);
    if (!tl || tl.textHeight <= tl.innerH + tol) continue;
    if (mode === 'shrink') {
      findings.push({
        rule: 'overflow',
        severity: 'error',
        slideId: slide.id,
        slideIndex,
        elementId: p.el.id,
        message: `text height ${fmt(tl.textHeight)}px exceeds box ${fmt(tl.innerH)}px even at shrink scale ${fmt(tl.shrinkScale)}`,
      });
    } else if (tl.linesOutside > 0) {
      findings.push({
        rule: 'overflow',
        severity: 'warning',
        slideId: slide.id,
        slideIndex,
        elementId: p.el.id,
        message:
          `${tl.linesOutside} of ${tl.lineCount} lines paint outside the box ` +
          `(text ${fmt(tl.textHeight)}px, box ${fmt(tl.innerH)}px, autofit none)`,
      });
    }
  }
  return findings;
}
