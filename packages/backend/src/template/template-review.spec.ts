import { BadRequestException } from '@nestjs/common';
import {
  assertDecisionAllowed,
  assertPublicTierOpen,
  assertYorkieAuthEnforced,
  parseReviewerIds,
  PUBLIC_TIER_OPEN,
  REPORT_REASONS,
} from './template-review';

describe('parseReviewerIds', () => {
  it('is empty when unset, which is what keeps the gallery shut', () => {
    // A deployment that configures nothing has no reviewers, so every review
    // route refuses. The alternative — treating "unconfigured" as "anyone" —
    // is the one failure direction this feature cannot take.
    expect(parseReviewerIds(undefined).size).toBe(0);
    expect(parseReviewerIds('').size).toBe(0);
  });

  it('reads a comma-separated list, trimming space', () => {
    expect([...parseReviewerIds('7, 9,11')]).toEqual([7, 9, 11]);
  });

  it('drops anything that is not a positive integer', () => {
    // A typo must not resolve to a user id. `NaN` would be harmless but `0`
    // and `-1` are ids the parser could plausibly produce from junk, and
    // granting review authority to one of them is the failure this prevents.
    expect([...parseReviewerIds('7,abc,,0,-1,3.5,9')]).toEqual([7, 9]);
  });

  it('de-duplicates', () => {
    expect([...parseReviewerIds('7,7,7')]).toEqual([7]);
  });
});

describe('assertPublicTierOpen', () => {
  it('is open now that the pipeline behind it exists', () => {
    expect(() => assertPublicTierOpen()).not.toThrow();
  });

  it('is still the one line that shuts the gallery', () => {
    // Kept as a constant rather than deleted: a moderation incident or a
    // migration should be one line, not a feature revert. The service tests
    // cover that both `submit` and `approve` actually consult it.
    expect(PUBLIC_TIER_OPEN).toBe(true);
  });
});

describe('assertYorkieAuthEnforced', () => {
  it('accepts only an explicit true', () => {
    expect(() => assertYorkieAuthEnforced('true')).not.toThrow();
    for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
      expect(() => assertYorkieAuthEnforced(value)).toThrow(
        BadRequestException,
      );
    }
  });
});

describe('REPORT_REASONS', () => {
  it('is closed, because it routes a reviewer’s attention', () => {
    expect([...REPORT_REASONS]).toEqual([
      'copyright',
      'inappropriate',
      'broken',
      'spam',
      'other',
    ]);
  });
});

describe('assertDecisionAllowed', () => {
  it('decides only a submission that was made', () => {
    expect(() => assertDecisionAllowed('pending', 'approve')).not.toThrow();
    expect(() => assertDecisionAllowed('pending', 'reject')).not.toThrow();
    expect(() => assertDecisionAllowed('listed', 'approve')).toThrow(
      BadRequestException,
    );
    expect(() => assertDecisionAllowed('listed', 'reject')).toThrow(
      BadRequestException,
    );
  });

  it('takes down a submission still awaiting a decision', () => {
    // A report can arrive while a listing is under review — it is still
    // serving at its existing tier the whole time.
    expect(() => assertDecisionAllowed('pending', 'takedown')).not.toThrow();
  });

  it('takes down a listing that is already listed', () => {
    // The state a public listing sits in when a report arrives — a takedown
    // that only worked on pending submissions would be useless.
    expect(() => assertDecisionAllowed('listed', 'takedown')).not.toThrow();
  });

  it('treats removed as terminal', () => {
    // Nothing in this phase distinguishes "the complaint was wrong" from "the
    // complaint was forgotten", so reinstating is deliberately not a decision.
    for (const decision of ['approve', 'reject', 'takedown'] as const) {
      expect(() => assertDecisionAllowed('removed', decision)).toThrow(
        BadRequestException,
      );
    }
  });
});

describe('assertDecisionAllowed from rejected', () => {
  it('refuses to approve or reject a submission already decided', () => {
    // A rejection is not a pending question. The publisher revises and calls
    // `submit` again, which moves the row back to `pending`.
    expect(() => assertDecisionAllowed('rejected', 'approve')).toThrow(
      BadRequestException,
    );
    expect(() => assertDecisionAllowed('rejected', 'reject')).toThrow(
      BadRequestException,
    );
  });

  it('still allows a takedown', () => {
    // A rejected listing keeps working at its old tier, so it is still
    // content a report can arrive about.
    expect(() => assertDecisionAllowed('rejected', 'takedown')).not.toThrow();
  });
});
