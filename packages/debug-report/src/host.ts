/**
 * The seam between the core and whatever is hosting it.
 *
 * Everything environment-shaped lives behind this interface: which route we are
 * on, which build is running, how a point becomes a semantic address, who
 * writes the draft, and where a confirmed bundle goes. Two hosts are planned
 * and a third is possible — the dev Vite plugin (writes to `.wb-reports/`), the
 * deployed app (posts to the backend mailbox), and the design editor embedding
 * the same loop — so SP1 becomes SP2 by substituting an implementation rather
 * than by rewriting the client.
 *
 * The interface is deliberately the whole contract: nothing in the core reads
 * `window.location`, `import.meta.env` or `fetch` directly. That is what makes
 * the session and store testable without a browser, and what keeps a host from
 * having to defeat a hard-coded assumption.
 *
 * `draft` is the only call that reaches a model, and it is tool-free and
 * output-only by design — see the credentials section of
 * `docs/design/debug-report.md`. It never receives repository access, so a
 * grouping proposal it returns cannot know which files an item touches; forced
 * coupling is applied later, on the repository side.
 *
 * Design: `docs/design/debug-report.md`.
 */

import type {
  Bundle,
  DebugItem,
  Draft,
  Environment,
  Point,
  ProposedGroup,
  Target,
} from './types';

/** One drafted item, paired with the item it belongs to. */
export type ItemDraft = { itemId: string; draft: Draft };

/**
 * The draft call's output.
 *
 * `proposedGroups` covers ELECTIVE coupling only (same kind, same risk class),
 * because that is all the items themselves can support. The panel renders it as
 * PR cards the reporter can detach from, split and merge — never as file paths,
 * which the browser has no way to know.
 */
export type DraftResult = {
  drafts: ItemDraft[];
  proposedGroups: ProposedGroup[];
};

export type SendResult =
  | { ok: true; ref: string }
  | { ok: false; error: string };

/**
 * Everything the core needs from its environment.
 *
 * `locate` returns `undefined` when no engine locator can answer the point.
 * That is a normal outcome, not an error: per SP0 finding 4 the caller then
 * captures a small region around the cursor rather than falling back to the
 * container, which would produce a photograph of the whole surface and say
 * nothing about which cell.
 *
 * `draft` may reject or return empty when no model key is configured. The panel
 * then shows the reporter's own sentences and the pipeline still runs — one
 * item per PR. Drafting is an accelerator, never a dependency.
 */
export interface HostAdapter {
  /** Current route, with document ids already anonymised. */
  route(): string;
  /**
   * The build the reporter is looking at. Without it the agent does not know
   * which code to read, and a report against a stale bundle is worse than none.
   */
  buildSha(): string | undefined;
  theme(): string;
  /** Everything else about the observation environment. */
  environment(): Environment;
  locate(point: Point): Promise<Target | undefined>;
  draft(items: readonly DebugItem[]): Promise<DraftResult>;
  send(bundle: Bundle): Promise<SendResult>;
}
