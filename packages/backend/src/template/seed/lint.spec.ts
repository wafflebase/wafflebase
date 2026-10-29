import { estimateMeasurer, lintSlides } from '@wafflebase/slides';
import { TEMPLATE_CATALOG } from './catalog';
import { LINT_BASELINE, type LintBaselineEntry } from './lint-baseline';

/**
 * Seed-template regression gate for the slide linter
 * (docs/design/slides/slides-lint.md). Every slides template is linted;
 * the test fails only on a finding that is not in `lint-baseline.ts`, so
 * a template edit that introduces a new overlap or contrast problem is
 * caught, while the known ones stay recorded with their reason. An entry
 * that no longer matches anything also fails, so the baseline cannot rot.
 *
 * Keyed on template slug + slide number + rule + element text, not ids:
 * seed slide ids come from a module-wide counter and element ids are
 * random, so neither survives a catalogue edit.
 */
const key = (e: Omit<LintBaselineEntry, 'reason'>) =>
  `${e.template} s${e.slide} ${e.rule} "${e.text}"`;

function lintCatalog(): string[] {
  const keys: string[] = [];
  for (const t of TEMPLATE_CATALOG) {
    if (t.content.kind !== 'slides') continue;
    for (const f of lintSlides(t.content.document, { measurer: estimateMeasurer() })) {
      if (f.severity === 'info') continue;
      keys.push(
        key({ template: t.slug, slide: f.slideIndex + 1, rule: f.rule, text: f.text ?? '' }),
      );
    }
  }
  return keys;
}

describe('seed slide templates pass the slide linter', () => {
  const entries = LINT_BASELINE;
  const found = lintCatalog();

  it('every baseline entry carries a reason', () => {
    for (const e of entries) expect(e.reason.trim()).not.toBe('');
  });

  it('has no findings beyond the baseline', () => {
    // A multiset: one baseline entry accepts one finding, so a second
    // element with the same text on the same slide is still caught.
    const remaining = new Map<string, number>();
    for (const k of entries.map(key)) remaining.set(k, (remaining.get(k) ?? 0) + 1);
    const extra = found.filter((k) => {
      const n = remaining.get(k) ?? 0;
      if (n === 0) return true;
      remaining.set(k, n - 1);
      return false;
    });
    expect(extra).toEqual([]);
  });

  it('has no stale baseline entries', () => {
    const seen = new Set(found);
    expect(entries.map(key).filter((k) => !seen.has(k))).toEqual([]);
  });
});
