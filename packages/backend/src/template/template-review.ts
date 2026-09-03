import { BadRequestException } from '@nestjs/common';

/**
 * The review states a listing can hold — see docs/design/template-gallery.md.
 *
 * They are a property of the *submission*, never of the audience. `visibility`
 * stays the effective tier through review and becomes `public` only when a
 * reviewer approves, which is what makes submitting observably a no-op for
 * everyone already holding the listing's link.
 */
export const TEMPLATE_STATUSES = [
  'listed',
  'pending',
  'rejected',
  'removed',
] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const REVIEW_DECISIONS = ['approve', 'reject', 'takedown'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/**
 * Why someone flagged a listing. A closed list because it routes a reviewer's
 * attention — "copyright" and "broken" are different queues in practice, even
 * when they share one screen.
 */
export const REPORT_REASONS = [
  'copyright',
  'inappropriate',
  'broken',
  'spam',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/**
 * Is the public tier open for business?
 *
 * One function, consulted by **both** `submit` and `review`'s approve arm, so
 * merge order could not open the gallery by accident while it was being built.
 * It is `true` now that the pipeline behind it exists: review with a reviewer
 * allowlist, a takedown state, the bait-and-switch defence, the license grant,
 * report intake, and the ranking guards.
 *
 * Kept as a constant rather than deleted, and rather than made configuration.
 * As a constant it is the one line to flip if the gallery ever has to be shut
 * — a moderation incident, a migration — without reverting a feature or
 * teaching every deployment a new setting. As configuration it would be a way
 * for a deployment to open a gallery whose preconditions it has not met, which
 * is what {@link assertYorkieAuthEnforced} exists to prevent.
 */
export const PUBLIC_TIER_OPEN = true;

export function assertPublicTierOpen(): void {
  if (PUBLIC_TIER_OPEN) return;
  throw new BadRequestException(
    'The public template gallery is not available yet',
  );
}

/**
 * The public tier additionally requires the Yorkie auth webhook to be
 * **enforcing**, not merely configured.
 *
 * Publishing publicly hands `previewToken` to every visitor, and in the
 * webhook's default shadow mode that token is enough to *write* to the
 * document — Yorkie logs the decision it would have made and allows the push
 * anyway. Two consequences, and the second is the one that decides this:
 * anonymous visitors could edit the content of every public template, and
 * because an edit returns a listing to review, one cheap request per card would
 * empty the gallery into a queue only a human on the allowlist can drain.
 *
 * So the gallery's safety rests on a setting that lives outside this feature,
 * and the honest thing is to refuse rather than to document the dependency and
 * hope. Checked at `submit` and `approve` alongside {@link assertPublicTierOpen}.
 */
export function assertYorkieAuthEnforced(enforce: string | undefined): void {
  if (enforce === 'true') return;
  throw new BadRequestException(
    'The public template gallery requires YORKIE_AUTH_WEBHOOK_ENFORCE=true: ' +
      'without it a preview token also grants write access to the document',
  );
}

/**
 * The public tier also requires that *somebody* can review.
 *
 * Without this, a deployment with the webhook enforcing but no reviewer ids
 * configured accepts a submission, moves the listing to `pending` — and strands
 * it: `submit` refuses a resubmission ("already under review"), nothing can
 * pass `TemplateReviewerGuard` to decide it, and the publisher is told nothing.
 * That is exactly the "believes their template is in a gallery that nothing
 * reviews" failure the tier gate exists to prevent, reached by a different
 * door.
 */
export function assertReviewersConfigured(raw: string | undefined): void {
  if (parseReviewerIds(raw).size > 0) return;
  throw new BadRequestException(
    'The public template gallery has no reviewers configured ' +
      '(WAFFLEBASE_TEMPLATE_REVIEWER_IDS), so a submission could never be decided',
  );
}

/**
 * Who may decide a submission, read from `WAFFLEBASE_TEMPLATE_REVIEWER_IDS`
 * (comma-separated user ids).
 *
 * Configuration rather than a database role because there is no admin surface
 * in this deployment and building one is a larger project than this feature.
 * **An unset or empty value means nobody**, which keeps the gallery shut on a
 * deployment that never configured anything — the same direction every other
 * gate in this feature fails in. Anything unparseable is dropped rather than
 * defaulting to a user id, since the failure mode of a typo must not be
 * "grants review authority to user 0".
 */
export function parseReviewerIds(raw: string | undefined): Set<number> {
  if (!raw) return new Set();
  const ids = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^[0-9]+$/.test(part))
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return new Set(ids);
}

/**
 * Which decisions a listing in `status` may receive.
 *
 * A takedown is reachable from `listed` because that is the state a public
 * listing sits in when a report arrives; approve and reject are reachable only
 * from `pending`, because deciding a submission nobody made is meaningless.
 * `removed` is terminal here — reinstating a taken-down listing is deliberately
 * not a reviewer action, since nothing in this phase distinguishes "the
 * complaint was wrong" from "the complaint was forgotten".
 */
export function assertDecisionAllowed(
  status: string,
  decision: ReviewDecision,
): void {
  const allowed: Record<ReviewDecision, readonly string[]> = {
    approve: ['pending'],
    reject: ['pending'],
    takedown: ['listed', 'pending', 'rejected'],
  };
  if (allowed[decision].includes(status)) return;
  throw new BadRequestException(
    `A template in "${status}" cannot be ${decision}d`,
  );
}
