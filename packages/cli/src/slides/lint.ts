import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import {
  applyAllowlist,
  layoutReport,
  lintSlides,
  type AllowlistEntry,
  type Finding,
  type LintRuleId,
  type LintSeverity,
  type SlidesDocument,
} from '@wafflebase/slides/node';
import { importPptx } from './pptx-import.js';

/**
 * `wafflebase slides layout-report` / `slides lint` — the cheap, deterministic
 * checks of the deck-authoring loop. Both run in Node on the slides layout
 * engine (no browser, no render): `layout-report` reports what each element looks
 * like once laid out, `lint` flags what looks broken. Line breaks come from
 * a font-free width estimate, so a finding is a reason to look, and the
 * PNG render (`slides render`, or the frontend's offline `render:slides`)
 * is the final word. Design: docs/design/slides/slides-lint.md.
 */

export const LINT_RULES: LintRuleId[] = [
  'overflow',
  'out-of-bounds',
  'overlap',
  'contrast',
  'min-font',
  'edge-margin',
];

const SEVERITY_RANK: Record<LintSeverity, number> = { info: 0, warning: 1, error: 2 };

/**
 * Read a deck from a local file: a `.pptx` (parsed with the same importer
 * `slides import` uses, images inlined) or a `.json` `SlidesDocument` — as
 * written by `slides content --format json`, or wrapped as `{ document }`.
 */
export async function readDeckFile(file: string): Promise<SlidesDocument> {
  const bytes = readFileSync(file);
  if (extname(file).toLowerCase() === '.pptx') {
    return (await importPptx(new Uint8Array(bytes))).document;
  }
  const parsed = JSON.parse(bytes.toString('utf8')) as
    | SlidesDocument
    | { document: SlidesDocument };
  const doc = 'document' in parsed ? parsed.document : parsed;
  if (!doc || !Array.isArray((doc as SlidesDocument).slides)) {
    throw new Error(`${file} is not a slides document (no "slides" array)`);
  }
  return doc;
}

/** `slides layout-report` rows: one per element, flat so `--format table` reads well. */
export function layoutRows(doc: SlidesDocument, slide?: number) {
  return layoutReport(doc)
    .filter((s) => slide === undefined || s.slideIndex === slide - 1)
    .flatMap((s) =>
      s.elements.map((e) => ({
        slide: s.slideIndex + 1,
        element: e.elementId,
        type: e.type,
        x: e.box.x,
        y: e.box.y,
        w: e.box.w,
        h: e.box.h,
        visible: e.visibleFraction,
        autofit: e.text?.autofit ?? '',
        lines: e.text?.lines ?? '',
        textHeight: e.text?.height ?? '',
        boxHeight: e.text?.boxHeight ?? '',
        shrink: e.text?.shrinkScale ?? '',
        overflows: e.text ? e.text.overflows : '',
      })),
    );
}

export function parseRules(raw: string | undefined): LintRuleId[] | undefined {
  if (raw === undefined) return undefined;
  const rules = raw.split(',').map((r) => r.trim()).filter(Boolean);
  const unknown = rules.filter((r) => !LINT_RULES.includes(r as LintRuleId));
  if (unknown.length > 0) {
    throw new Error(`unknown rule(s): ${unknown.join(', ')} (known: ${LINT_RULES.join(', ')})`);
  }
  return rules as LintRuleId[];
}

export function parseFailOn(raw: string | undefined): LintSeverity | 'never' {
  const v = raw ?? 'never';
  if (v === 'never' || v in SEVERITY_RANK) return v as LintSeverity | 'never';
  throw new Error(`--fail-on must be one of error, warning, info, never (got "${raw}")`);
}

/**
 * An allowlist file: `[{ rule, slideId, elementId? | text?, reason }]`. Every entry
 * needs a non-empty reason — the list records decisions, it is not a mute
 * button.
 */
export function readAllowlist(file: string): AllowlistEntry[] {
  const entries = JSON.parse(readFileSync(file, 'utf8')) as AllowlistEntry[];
  if (!Array.isArray(entries)) throw new Error(`${file}: allowlist must be a JSON array`);
  entries.forEach((e, i) => {
    if (!e?.rule || !e.slideId || typeof e.reason !== 'string' || e.reason.trim() === '') {
      throw new Error(`${file}[${i}]: an entry needs rule, slideId and a non-empty reason`);
    }
  });
  return entries;
}

export interface LintRunResult {
  rows: Array<{
    slide: number;
    rule: string;
    severity: LintSeverity;
    element: string;
    text: string;
    message: string;
  }>;
  allowed: Finding[];
  /** Exit code under `--fail-on`: 1 when an open finding reaches it. */
  exitCode: number;
}

export function runLint(
  doc: SlidesDocument,
  opts: {
    rules?: LintRuleId[];
    allowlist?: AllowlistEntry[];
    failOn: LintSeverity | 'never';
    slide?: number;
  },
): LintRunResult {
  const findings = lintSlides(doc, { rules: opts.rules }).filter(
    (f) => opts.slide === undefined || f.slideIndex === opts.slide - 1,
  );
  const { open, allowed } = applyAllowlist(findings, opts.allowlist ?? []);
  const fails =
    opts.failOn !== 'never' &&
    open.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[opts.failOn as LintSeverity]);
  return {
    rows: open.map((f) => ({
      slide: f.slideIndex + 1,
      rule: f.rule,
      severity: f.severity,
      element: f.elementId ?? '',
      text: f.text ?? '',
      message: f.message,
    })),
    allowed,
    exitCode: fails ? 1 : 0,
  };
}
