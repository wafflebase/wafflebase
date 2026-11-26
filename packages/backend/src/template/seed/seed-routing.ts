import type { SeedDocumentType, TemplateSeed } from './types';

/**
 * Which operator command publishes which seed type — TEMPORARY, until the
 * Phase 2 offline thumbnail renderers land
 * (docs/design/template-catalog-scaling.md §3).
 *
 * `sync:templates` publishes slides and note seeds headlessly. Sheet, doc and
 * board seeds have no offline renderer yet, and sync will not publish an
 * icon-only card, so the Playwright `register:templates` command remains
 * their path. Each command refuses the other's types: two writers of one
 * listing would fight over its card. Delete this split, and
 * `register-templates.ts`, once every type renders offline.
 */
const REGISTER_TEMPLATE_TYPES: ReadonlySet<SeedDocumentType> = new Set([
  'sheet',
  'doc',
  'board',
]);

/** Why `register:templates` must not handle `seed`, or `null` when it may. */
export function registerRefusal(seed: TemplateSeed): string | null {
  if (REGISTER_TEMPLATE_TYPES.has(seed.content.kind)) return null;
  return (
    `${seed.content.kind} seeds are published by ` +
    '`pnpm backend sync:templates`, not this command'
  );
}

/**
 * What `sync:templates` tells the operator about a seed it skips for want of
 * a thumbnail: where that seed goes instead, when anywhere.
 */
export function syncSkipHint(seed: TemplateSeed): string {
  return REGISTER_TEMPLATE_TYPES.has(seed.content.kind)
    ? `; publish ${seed.content.kind} seeds with \`pnpm backend register:templates\` until the Phase 2 renderers land`
    : '';
}
