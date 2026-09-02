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
 * Is the public tier open for business?
 *
 * One function, consulted by **both** `submit` and `review`'s approve arm, so
 * merge order cannot open the gallery by accident. Phase 3 lands as four PRs
 * and only the last one lifts this; without it, 3a alone would already be a
 * complete path to `visibility: 'public', status: 'listed'` — and
 * `GET /templates?scope=public` ships unauthenticated, so such an approval
 * would be world-enumerable the moment it happened.
 *
 * Fails closed for the same reason `assertPublishable` does: a publisher told
 * "ok" would believe their template was in a gallery that nothing reviews.
 */
export const PUBLIC_TIER_OPEN = false;

export function assertPublicTierOpen(): void {
  if (PUBLIC_TIER_OPEN) return;
  throw new BadRequestException(
    'The public template gallery is not available yet',
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
