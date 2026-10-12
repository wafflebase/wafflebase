/**
 * Deterministic slide linter: flags slides that look broken using only
 * the model, geometry and text measurement — no rendering, no vision
 * model. Node-safe; the `TextMeasurer` is injected.
 *
 * One file per rule under `rules/`. Findings are advisory: a rule reports
 * what is *likely* wrong, and an intentional finding is recorded in an
 * allowlist with a reason (see {@link applyAllowlist}) rather than tuned
 * away. Design: docs/design/slides/slides-lint.md.
 */
import type { Slide } from '../model/presentation';
import {
  buildContext,
  elementText,
  placeElements,
  type DeckContext,
  type LintableDeck,
  type PlacedElement,
} from './context';
import { checkContrast } from './rules/contrast';
import { checkEdgeMargin } from './rules/edge-margin';
import { checkMinFont } from './rules/min-font';
import { checkOutOfBounds } from './rules/out-of-bounds';
import { checkOverflow } from './rules/overflow';
import { checkOverlap } from './rules/overlap';
import type { Finding, LintOptions, LintRuleId } from './types';

type RuleCheck = (
  slide: Slide,
  slideIndex: number,
  placed: PlacedElement[],
  ctx: DeckContext,
) => Finding[];

/** Run order, which is also the order findings come back in per slide. */
const RULES: [LintRuleId, RuleCheck][] = [
  ['overflow', checkOverflow],
  ['out-of-bounds', checkOutOfBounds],
  ['overlap', checkOverlap],
  ['contrast', checkContrast],
  ['min-font', checkMinFont],
  ['edge-margin', checkEdgeMargin],
];

/**
 * Lint every slide of a deck. Pure and deterministic: findings are ordered
 * by slide, then rule (see `RULES`), then element paint order.
 */
export function lintSlides(doc: LintableDeck, options: LintOptions = {}): Finding[] {
  const ctx = buildContext(doc, options);
  const findings: Finding[] = [];
  doc.slides.forEach((slide, slideIndex) => {
    const placed = placeElements(slide, ctx);
    const byId = new Map(placed.map((p) => [p.el.id, p.el]));
    for (const [id, check] of RULES) {
      if (!ctx.opts.rules.includes(id)) continue;
      for (const f of check(slide, slideIndex, placed, ctx)) {
        const el = f.elementId ? byId.get(f.elementId) : undefined;
        const text = el ? elementText(el).slice(0, 40) : '';
        findings.push(text ? { ...f, text } : f);
      }
    }
  });
  return findings;
}

/**
 * One intentional finding. Matches on rule + slide, then the element: by
 * `elementId` when given, else by `text` (a prefix of the element's text —
 * the handle to use for a deck re-imported from PPTX, whose element ids are
 * regenerated on every import), else any element on that slide. `reason` is
 * required so an allowlist reads as a record of decisions, not a mute
 * button.
 */
export type AllowlistEntry = {
  rule: Finding['rule'];
  slideId: string;
  elementId?: string;
  text?: string;
  reason: string;
};

function matches(a: AllowlistEntry, f: Finding): boolean {
  if (a.rule !== f.rule || a.slideId !== f.slideId) return false;
  if (a.elementId !== undefined) return a.elementId === f.elementId;
  // `f.text` is cut to 40 characters; compare within that window.
  if (a.text !== undefined) return (f.text ?? '').startsWith(a.text.slice(0, 40));
  return true;
}

/** Split findings into those an allowlist accepts and those it does not. */
export function applyAllowlist(
  findings: Finding[],
  allowlist: AllowlistEntry[],
): { open: Finding[]; allowed: Finding[]; unused: AllowlistEntry[] } {
  const used = new Set<AllowlistEntry>();
  const open: Finding[] = [];
  const allowed: Finding[] = [];
  for (const f of findings) {
    const entry = allowlist.find((a) => matches(a, f));
    if (entry) {
      used.add(entry);
      allowed.push(f);
    } else {
      open.push(f);
    }
  }
  return { open, allowed, unused: allowlist.filter((a) => !used.has(a)) };
}

export type { LintableDeck } from './context';
export { estimateMeasurer } from './estimate-measurer';
export { layoutReport } from './layout-report';
export type { ElementLayout, SlideLayout } from './layout-report';
export type { Finding, LintOptions, LintRuleId, LintSeverity } from './types';
