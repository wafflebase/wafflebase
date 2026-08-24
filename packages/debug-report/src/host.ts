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

import type { Bundle, DebugItem, Environment, Point, Target } from './types';

// `DraftResult` and `ItemDraft` live in `draft.ts`, with the schema the call is
// held to and the operations the reporter performs on the result. Re-exported
// here so a host implementer needs one import for the whole seam — note that
// `draft()` below returns the RAW answer, not this validated shape.
export type { DraftResult, ItemDraft } from './draft';

export type SendResult =
  | { ok: true; ref: string }
  | { ok: false; error: string };

/**
 * One capture, as it travels.
 *
 * Read back out of the store at handover time rather than held in the bundle:
 * the bundle is metadata that has to stay small enough for `localStorage`, and
 * the images are megabytes.
 */
export type CapturePayload = { id: string; dataUrl: string };

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
  /**
   * Ask for issue text and a proposed grouping.
   *
   * Returns the RAW answer, deliberately untyped: it comes from a model, and the
   * only thing that may interpret it is `parseDraftResult`, at the boundary.
   * Declaring the validated shape here would have been a lie every
   * implementation told — the wire form is flat, `DraftResult` is not — and a
   * second host honouring the declaration would produce a payload the parser
   * silently drops every draft from.
   */
  draft(items: readonly DebugItem[]): Promise<unknown>;
  send(bundle: Bundle, captures: readonly CapturePayload[]): Promise<SendResult>;
}
