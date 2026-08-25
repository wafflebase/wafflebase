import { BadRequestException } from '@nestjs/common';
import {
  normalizeConditionalFormatRule,
  normalizeDataValidationRule,
} from '@wafflebase/sheets';
import type {
  ConditionalFormatRule,
  DataValidationRule,
} from '@wafflebase/sheets';

function extractRules(body: unknown): unknown[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('body must be an object { rules: [...] }');
  }
  const rules = (body as Record<string, unknown>).rules;
  if (!Array.isArray(rules)) {
    throw new BadRequestException("'rules' must be an array");
  }
  return rules;
}

/**
 * Validate a `{ rules: ConditionalFormatRule[] }` body. Each rule is run
 * through the sheets-engine `normalizeConditionalFormatRule` (the same
 * validator the editor uses), which returns `undefined` for an invalid rule;
 * those are rejected with a 400. The normalized (plain) rules are returned.
 */
export function parseConditionalFormats(body: unknown): ConditionalFormatRule[] {
  return extractRules(body).map((raw, i) => {
    const normalized = normalizeConditionalFormatRule(
      raw as ConditionalFormatRule,
    );
    if (!normalized) {
      throw new BadRequestException(
        `rules[${i}] is not a valid conditional format rule`,
      );
    }
    return normalized;
  });
}

/** Validate a `{ rules: DataValidationRule[] }` body via the engine normalizer. */
export function parseDataValidations(body: unknown): DataValidationRule[] {
  return extractRules(body).map((raw, i) => {
    const normalized = normalizeDataValidationRule(raw as DataValidationRule);
    if (!normalized) {
      throw new BadRequestException(
        `rules[${i}] is not a valid data validation rule`,
      );
    }
    return normalized;
  });
}
