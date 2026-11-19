import { readFileSync } from 'node:fs';

/**
 * `wafflebase slides critique-check` — the deterministic half of the
 * deck-author loop's design-critic lane (issue #1112).
 *
 * The critic itself is an agent following `skills/deck-critic.md`: it looks
 * at the rendered slides and writes findings. Nothing here calls a model.
 * This module only checks that a round's findings are well-formed, counts
 * them, and applies the stop rule, so the loop ends on a rule the author
 * cannot argue with rather than on how the author feels about the deck.
 * Design: docs/design/slides/deck-critic.md.
 */

export const CRITIQUE_SEVERITIES = ['major', 'minor'] as const;
export type CritiqueSeverity = (typeof CRITIQUE_SEVERITIES)[number];

/** The rubric's categories, in the order `deck-critic.md` lists them. */
export const CRITIQUE_CATEGORIES = [
  'hierarchy',
  'density',
  'alignment-spacing',
  'type-scale',
  'contrast',
  'visual-variety',
  'faithfulness',
  'curation',
  'skill-rules',
  'pptx-parity',
] as const;
export type CritiqueCategory = (typeof CRITIQUE_CATEGORIES)[number];

/** `slideId` value for a finding about the deck as a whole. */
export const DECK_WIDE = 'deck';

export interface CritiqueFinding {
  /** The slide's id, or `"deck"` for a deck-wide finding. */
  slideId: string;
  severity: CritiqueSeverity;
  category: CritiqueCategory;
  /** What is wrong, as seen in the render. */
  problem: string;
  /** What the author should change. */
  fix: string;
}

export interface Critique {
  /** 1-based critic round, when the file records it. */
  round?: number;
  findings: CritiqueFinding[];
}

const FINDING_KEYS = ['slideId', 'severity', 'category', 'problem', 'fix'];
const ROOT_KEYS = ['round', 'findings'];

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Validate a parsed findings file: `{ round?, findings: [...] }`, or a bare
 * findings array. Unknown keys are refused, not ignored — a misspelt
 * `severty` would otherwise drop a finding out of every count. Returns every
 * problem at once so the critic can fix its output in one pass.
 */
export function validateCritique(
  data: unknown,
): { ok: true; critique: Critique } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  let round: number | undefined;
  let list: unknown;
  if (Array.isArray(data)) {
    list = data;
  } else if (data !== null && typeof data === 'object') {
    const root = data as Record<string, unknown>;
    for (const k of Object.keys(root)) {
      if (!ROOT_KEYS.includes(k)) errors.push(`unknown key "${k}" (allowed: ${ROOT_KEYS.join(', ')})`);
    }
    if (root.round !== undefined) {
      if (Number.isInteger(root.round) && (root.round as number) >= 1) round = root.round as number;
      else errors.push('"round" must be a positive integer');
    }
    list = root.findings;
    if (!Array.isArray(list)) errors.push('"findings" must be an array');
  } else {
    errors.push('expected { "findings": [...] } or a findings array');
  }

  const findings: CritiqueFinding[] = [];
  if (Array.isArray(list)) {
    list.forEach((f, i) => {
      const at = `findings[${i}]`;
      if (f === null || typeof f !== 'object' || Array.isArray(f)) {
        errors.push(`${at}: must be an object`);
        return;
      }
      const o = f as Record<string, unknown>;
      const before = errors.length;
      for (const k of Object.keys(o)) {
        if (!FINDING_KEYS.includes(k)) errors.push(`${at}: unknown key "${k}"`);
      }
      if (!nonEmpty(o.slideId)) errors.push(`${at}: "slideId" must be a non-empty string`);
      if (!CRITIQUE_SEVERITIES.includes(o.severity as CritiqueSeverity)) {
        errors.push(`${at}: "severity" must be one of ${CRITIQUE_SEVERITIES.join(', ')}`);
      }
      if (!CRITIQUE_CATEGORIES.includes(o.category as CritiqueCategory)) {
        errors.push(`${at}: "category" must be one of ${CRITIQUE_CATEGORIES.join(', ')}`);
      }
      for (const k of ['problem', 'fix'] as const) {
        if (!nonEmpty(o[k])) errors.push(`${at}: "${k}" must be a non-empty string`);
      }
      if (errors.length === before) findings.push(o as unknown as CritiqueFinding);
    });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, critique: { round, findings } };
}

/** Read and validate a findings file; throws with every problem listed. */
export function readCritique(file: string): Critique {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message}`);
  }
  const r = validateCritique(data);
  if (!r.ok) throw new Error(`${file}: invalid critique\n  ${r.errors.join('\n  ')}`);
  return r.critique;
}

export interface CritiqueCounts {
  major: number;
  minor: number;
  byCategory: Partial<Record<CritiqueCategory, { major: number; minor: number }>>;
}

export function summarizeCritique(c: Critique): CritiqueCounts {
  const counts: CritiqueCounts = { major: 0, minor: 0, byCategory: {} };
  for (const f of c.findings) {
    counts[f.severity]++;
    const cat = (counts.byCategory[f.category] ??= { major: 0, minor: 0 });
    cat[f.severity]++;
  }
  return counts;
}

export type StopReason =
  | 'max-rounds'
  | 'major-open'
  | 'clean'
  | 'polish-round'
  | 'minor-decreasing'
  | 'minor-plateau';

export interface RoundDecision {
  verdict: 'continue' | 'stop';
  reason: StopReason;
  /** Stopping with major findings still open: hand the deck to a human. */
  escalate: boolean;
}

/**
 * The stop rule. Majors always earn another round (until the cap). Once
 * majors reach zero the loop does not stop on the spot — that would drop
 * every minor finding — but runs while the minor count keeps falling: the
 * first major-free round always gets one polish round, later ones continue
 * only while minors decrease. The cap wins over everything.
 */
export function decideNextRound(
  current: { major: number; minor: number },
  previous: { major: number; minor: number } | undefined,
  round: number,
  maxRounds: number,
): RoundDecision {
  if (round >= maxRounds) {
    return { verdict: 'stop', reason: 'max-rounds', escalate: current.major > 0 };
  }
  if (current.major > 0) return { verdict: 'continue', reason: 'major-open', escalate: false };
  if (current.minor === 0) return { verdict: 'stop', reason: 'clean', escalate: false };
  if (previous === undefined || previous.major > 0) {
    // The first round with no majors: one polish round on the minors.
    return { verdict: 'continue', reason: 'polish-round', escalate: false };
  }
  if (current.minor < previous.minor) {
    return { verdict: 'continue', reason: 'minor-decreasing', escalate: false };
  }
  return { verdict: 'stop', reason: 'minor-plateau', escalate: false };
}

export function parsePositiveInt(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer (got "${raw}")`);
  return n;
}

/** The `critique-check` result: one flat record so `--format table` reads well. */
export function runCritiqueCheck(opts: {
  current: Critique;
  previous?: Critique;
  round?: number;
  maxRounds?: number;
}) {
  const maxRounds = opts.maxRounds ?? 3;
  const round =
    opts.round ??
    opts.current.round ??
    (opts.previous ? (opts.previous.round ?? 1) + 1 : 1);
  const cur = summarizeCritique(opts.current);
  const prev = opts.previous ? summarizeCritique(opts.previous) : undefined;
  const decision = decideNextRound(cur, prev, round, maxRounds);
  return {
    verdict: decision.verdict,
    reason: decision.reason,
    escalate: decision.escalate,
    round,
    maxRounds,
    major: cur.major,
    minor: cur.minor,
    previousMajor: prev?.major ?? null,
    previousMinor: prev?.minor ?? null,
    byCategory: cur.byCategory,
  };
}
