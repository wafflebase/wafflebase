/**
 * Assembling the thing that crosses the boundary.
 *
 * A bundle is what leaves the browser: the items, the grouping the reporter
 * approved, and the environment they were observed in. Building it is separate
 * from sending it because what goes in is a policy decision — the build SHA
 * without which an agent does not know which code it is reading, the route with
 * document ids already removed, the captures that were actually stored rather
 * than the ones that were attempted.
 *
 * Design: `docs/design/debug-report.md`.
 */

import { BUNDLE_SCHEMA, type Bundle, type DebugItem, type Environment, type ProposedGroup } from './types';

export type BuildBundleInput = {
  sessionId: string;
  items: readonly DebugItem[];
  env: Environment;
  groups?: readonly ProposedGroup[];
  now?: () => number;
};

/**
 * Build a bundle from a confirmed session.
 *
 * Discarded items are left out here rather than earlier: the reporter can change
 * their mind while reviewing, so the list stays whole until the moment it is
 * handed over. Groups are filtered to the items that survive, so an approved
 * shape can never name something that is not being sent.
 */
export function buildBundle(input: BuildBundleInput): Bundle {
  const items = input.items.filter((item) => item.disposition !== 'discard');
  const kept = new Set(items.map((item) => item.id));
  const groups = (input.groups ?? [])
    .map((group) => ({
      ...group,
      itemIds: group.itemIds.filter((id) => kept.has(id)),
    }))
    .filter((group) => group.itemIds.length > 0);

  return {
    schema: BUNDLE_SCHEMA,
    sessionId: input.sessionId,
    createdAt: (input.now ?? (() => Date.now()))(),
    env: input.env,
    items,
    ...(groups.length > 0 ? { groups } : {}),
  };
}

export type BundleSummary = {
  items: number;
  verify: number;
  publish: number;
  discarded: number;
  captures: number;
  groups: number;
  agentCandidates: number;
};

/** What the panel says it is about to send. */
export function summariseBundle(
  items: readonly DebugItem[],
  groups: readonly ProposedGroup[] = [],
): BundleSummary {
  const kept = items.filter((item) => item.disposition !== 'discard');
  return {
    items: kept.length,
    verify: kept.filter((item) => item.disposition === 'verify').length,
    publish: kept.filter((item) => item.disposition === 'publish').length,
    discarded: items.length - kept.length,
    captures: kept.filter((item) => item.capture).length,
    groups: groups.filter((group) =>
      group.itemIds.some((id) => kept.some((item) => item.id === id)),
    ).length,
    agentCandidates: kept.filter((item) => item.agentCandidate).length,
  };
}

/**
 * The environment, read from a browser.
 *
 * `buildSha` comes from the host rather than from here, because only the host
 * knows it: in development the dev server stamps it, and in a deployment the
 * build does. An absent SHA is reported as absent rather than guessed — an agent
 * reading yesterday's code because a bundle implied it would be worse than one
 * that knows it does not know.
 */
export function readEnvironment(options: {
  route: string;
  buildSha?: string;
  theme: string;
  documentType?: string;
  role?: string;
  win?: Pick<Window, 'innerWidth' | 'innerHeight' | 'devicePixelRatio' | 'navigator'>;
}): Environment {
  const win = options.win ?? (typeof window === 'undefined' ? undefined : window);
  return {
    ...(options.buildSha ? { buildSha: options.buildSha } : {}),
    route: options.route,
    viewport: { w: win?.innerWidth ?? 0, h: win?.innerHeight ?? 0 },
    dpr: win?.devicePixelRatio && win.devicePixelRatio > 0 ? win.devicePixelRatio : 1,
    theme: options.theme,
    userAgent: win?.navigator?.userAgent ?? 'unknown',
    ...(options.documentType ? { documentType: options.documentType } : {}),
    ...(options.role ? { role: options.role } : {}),
  };
}
