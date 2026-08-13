/**
 * Wire ⇄ adapter translation, and the CSS-regen gate.
 *
 * This is the plugin's whole knowledge of the token pipeline. Everything specific to
 * how a project stores tokens lives behind `TokenAdapter`; what is left here is
 * validating a request that came from a browser, resolving the files a plan touches,
 * and deciding whether a write needs the project's emitter re-run.
 *
 * Compare `design-editor-local-plugin.md` §6's "where the seam actually falls" table:
 * the prototype had seven token couplings threaded through `mutationBridge`,
 * `filesForIntent`, `applyIntentToCache` and `restoreTransaction` — four wafflebase file
 * paths, two regexes over `packages/core/**`, and a `FAMILY` table of naming functions.
 * All seven are gone. `isTokenSource` below is the replacement for both regexes, and it
 * asks the adapter rather than matching a pattern.
 */

import type { MutateRequest } from './protocol.ts';
import type { PathGuard } from './paths.ts';
import type { TokenAdapter, TokenEdit, TokenFamily, TokenWrite } from '../tokens/adapter.ts';
import { camelToKebab, normaliseSource } from '../tokens/adapter.ts';

/**
 * Wire kinds that address a token rather than a JSX node.
 *
 * `token-add` is the legacy alias for `member-add` on the semantic family — carried
 * over because the prototype's client emits it, and dropping it would turn a working
 * request into "unknown intent kind" for no gain.
 */
export const TOKEN_KINDS: ReadonlySet<string> = new Set([
  'token-value',
  'token-add',
  'token-rebind',
  'palette-value',
  'member-add',
  'member-remove',
]);

const MEMBER_KINDS: ReadonlySet<string> = new Set(['member-add', 'member-remove', 'token-add']);

const FAMILIES: ReadonlySet<string> = new Set(['semantic', 'palette', 'radius', 'typo']);

/** `token-add` predates the family field and always meant the semantic family. */
const familyOf = (intent: MutateRequest): TokenFamily => {
  if (intent.kind === 'token-add') return 'semantic';
  if (intent.kind === 'palette-value') return 'palette';
  const f = intent.family;
  return f && FAMILIES.has(f) ? f : 'semantic';
};

/**
 * Validate and normalise one wire request into a `TokenEdit`.
 *
 * EVERY FIELD HERE ARRIVED FROM A WEB PAGE, so this is the only place that turns the
 * protocol's flat optionals into something an adapter can trust. The prototype passed
 * the raw request through and each branch defaulted `?? ''` on its own, which meant a
 * request missing `camelKey` created a token named the empty string rather than being
 * refused.
 */
export function tokenEditOf(intent: MutateRequest): TokenEdit | { error: string } {
  const family = familyOf(intent);

  if (MEMBER_KINDS.has(intent.kind ?? '')) {
    const camelKey = (intent.camelKey ?? '').trim();
    if (!camelKey) return { error: `${intent.kind} requires \`camelKey\`` };
    // The naming rule is checked here rather than in each adapter: a key that is not a
    // plain identifier cannot be a TypeScript property, and interpolated into CSS it
    // would let a request write arbitrary declaration text.
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(camelKey)) {
      return { error: `invalid token key: ${camelKey}` };
    }
    const kebabKey = (intent.kebabKey ?? camelToKebab(camelKey)).trim();
    if (!/^[a-z][a-z0-9-]*$/.test(kebabKey)) {
      return { error: `invalid token name: ${kebabKey}` };
    }

    if (intent.kind === 'member-remove') {
      return { kind: 'remove-member', family, camelKey, kebabKey };
    }
    const value = intent.tokenValue ?? '';
    if (!value.trim()) return { error: `${intent.kind} requires \`tokenValue\`` };
    return { kind: 'add-member', family, camelKey, kebabKey, value };
  }

  // token-value / token-rebind / palette-value
  const path = intent.path ?? [];
  if (!path.length) return { error: `${intent.kind} requires \`path\`` };
  if (path.some((p) => typeof p !== 'string' || !p.trim())) {
    return { error: '`path` segments must be non-empty strings' };
  }
  const value = intent.tokenValue;
  if (value == null) return { error: `${intent.kind} requires \`tokenValue\`` };

  // `constName` doubles as the theme selector in wafflebase's own pipeline, where the
  // semantic family is stored as two consts named `light` and `dark`. Any other const
  // (`radius`, `typography`) is single-theme and reads as the base.
  const theme = intent.constName === 'dark' ? 'dark' : 'light';

  return {
    kind: 'set-value',
    family,
    theme,
    path,
    // The LAST segment is the leaf being edited; earlier ones are the containers it
    // sits in. Joining all of them would name `light-primary` for a token whose
    // property is `--primary`.
    kebabKey: camelToKebab(path[path.length - 1]),
    value,
    // A rebind points one token at another, which is an expression by definition — the
    // wire signals it through the KIND, and `valueKind` is only consulted otherwise.
    valueKind: intent.kind === 'token-rebind' ? 'expression' : (intent.valueKind ?? 'literal'),
    constName: intent.constName,
  };
}

export interface TokenPlan {
  writes: TokenWrite[];
  /** Distinct root-relative files, in first-touched order. */
  files: { rel: string; abs: string }[];
}

/**
 * Plan a token intent and resolve every file it names.
 *
 * The guard runs over the ADAPTER's output, not only over client input. An adapter is
 * consumer code — in 8c, wafflebase's own — and a plan naming `../../etc/hosts` must be
 * refused at the same boundary a browser request would be. Trusting it because it is
 * "our" code is how the write boundary stops being one.
 */
export function planTokenIntent(
  adapter: TokenAdapter,
  guard: PathGuard,
  intent: MutateRequest,
): TokenPlan | { error: string } {
  const edit = tokenEditOf(intent);
  if ('error' in edit) return edit;

  const planned = adapter.plan(edit);
  if ('error' in planned) return planned;
  if (!planned.length) {
    // An empty plan would compose to "applied, nothing changed", which reads to the
    // client as a successful edit. Say what actually happened instead.
    return { error: `the token adapter planned no writes for ${intent.kind}` };
  }

  const files: { rel: string; abs: string }[] = [];
  const seen = new Set<string>();
  for (const w of planned) {
    const r = guard.resolveSafe(w.file);
    if ('error' in r) return { error: `${w.file}: ${r.error}` };
    if (seen.has(r.abs)) continue;
    seen.add(r.abs);
    files.push({ rel: guard.relOf(r.abs), abs: r.abs });
  }
  return { writes: planned, files };
}

/**
 * Apply a planned token edit against the shared text cache.
 *
 * Sequential and awaited, which is load-bearing: `cssVariables` plans three writes to
 * ONE stylesheet (base block, dark block, `@theme` alias), so each must see what the
 * previous left behind. Applying them in parallel — or against the pristine text —
 * would have the last write silently discard the first two.
 */
export async function applyTokenPlan(
  plan: TokenPlan,
  guard: PathGuard,
  cache: Map<string, string>,
): Promise<{ located: boolean; reason?: string }> {
  const notes: string[] = [];
  /**
   * Staged separately, and merged into the shared cache only once every required write
   * has landed.
   *
   * `applyIntentToCache` promises the cache is left UNTOUCHED on a locate failure — that
   * is what lets a partially-failing batch still be all-or-nothing. A token plan is
   * several writes, so writing them straight into the shared cache would break that
   * promise from the inside: a three-write `add-member` whose third write is required and
   * fails would leave the first two staged, and the next intent in the batch would then
   * compose on top of a half-created token.
   */
  const staged = new Map<string, string>();
  const current = (abs: string) => staged.get(abs) ?? cache.get(abs) ?? '';

  for (const w of plan.writes) {
    const r = guard.resolveSafe(w.file);
    if ('error' in r) return { located: false, reason: `${w.file}: ${r.error}` };
    const res = await w.apply(current(r.abs));
    if (res.located) {
      staged.set(r.abs, res.text);
      continue;
    }
    if (w.required) {
      return { located: false, reason: res.reason ?? `could not apply ${w.label}` };
    }
    notes.push(`${w.label} skipped: ${res.reason ?? 'not located'}`);
  }

  for (const [abs, text] of staged) cache.set(abs, text);
  return { located: true, reason: notes.length ? notes.join('; ') : undefined };
}

/**
 * Does writing this file require the project's emitter to be re-run?
 *
 * Replaces `isTokenSourcePath` — `/packages\/core\/(src\/tokens\/|scripts\/build-css)/`
 * — which no foreign project matches and which was also wrong in the other direction: it
 * matched by PATTERN, so a file that merely looked like a token source triggered a
 * regeneration. Asking the adapter is both portable and exact.
 */
export const isTokenSource = (adapter: TokenAdapter | null, rel: string): boolean =>
  // Both sides normalised. `sources()` is contractually normalised already, but it is
  // consumer code and a `./` prefix silently matched nothing rather than failing loudly —
  // which cost the regen gate and the preview patch before it was noticed.
  !!adapter && adapter.sources().map(normaliseSource).includes(normaliseSource(rel));

/**
 * Re-run the emitter if this write touched a token source and the adapter has one.
 *
 * A pipeline with no `regenerate()` is not a failure and must not report as one:
 * `cssVariables` writes the stylesheet the host already serves, so there is nothing to
 * re-run and Vite's own CSS HMR publishes the change. `ran: false` distinguishes that
 * from an emitter that ran and failed.
 */
export async function maybeRegenerate(
  adapter: TokenAdapter | null,
  writtenRels: string[],
): Promise<{ ran: boolean; ok?: boolean; error?: string; artifacts?: string[] }> {
  if (!adapter?.regenerate) return { ran: false };
  if (!writtenRels.some((rel) => isTokenSource(adapter, rel))) return { ran: false };
  try {
    const r = await adapter.regenerate();
    return { ran: true, ok: r.ok, error: r.error, artifacts: r.artifacts };
  } catch (err) {
    // A throwing emitter is reported as a failed regeneration, not propagated. It runs
    // AFTER the write has landed, so letting it escape would answer a successful save with
    // "the bridge broke" and lose both the txn id and the file list.
    return { ran: true, ok: false, error: String(err) };
  }
}
