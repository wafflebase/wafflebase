/**
 * Turning one intent into file writes — and a batch of them into ONE composition.
 *
 * A layout intent is applied by `inject.mjs` against the anchor's file; a token intent
 * is planned by the configured `TokenAdapter` and applied through `./tokens`. With no
 * adapter configured a token intent is still refused with a note rather than
 * mis-handled: §3 makes that the permanent state for any project outside the support
 * matrix, not a stub.
 *
 * `composeIntents` is shared by `/validate` and `/commit` on purpose. The whole
 * value of validation is answering "would a save succeed right now?", which is
 * only trustworthy if it runs the exact composition the save will. Two
 * implementations would drift, and the drift would surface as a save failing after
 * validation passed.
 */

import fs from 'node:fs';
import { layoutFileOf, type MutateRequest } from './protocol.ts';
import type { PathGuard } from './paths.ts';
import type { Tracker } from './tracked.ts';
import type { TokenAdapter } from './options.ts';
import { applyTokenPlan, planTokenIntent, TOKEN_KINDS } from './tokens.ts';

/** The subset of `inject.mjs` this module calls. Loaded dynamically by the host. */
export interface Injector {
  applyLayoutProps(text: string, intent: unknown): LayoutResult;
  applyLayoutInsert(text: string, intent: unknown): LayoutResult;
  applyLayoutRemove(text: string, intent: unknown): LayoutResult;
  applyClassRewrite(text: string, intent: unknown): LayoutResult;
  insertImport(text: string, spec: unknown): LayoutResult;
  removeImport(text: string, spec: unknown): LayoutResult;
  unifiedDiff(before: string, after: string, context?: number): string;
}

interface LayoutResult {
  located: boolean;
  text: string;
  reason?: string;
  removedText?: string;
  removedIndex?: number;
  parentPath?: number[];
}

export interface IntentOutcome {
  located: boolean;
  reason?: string;
  /** Echoed by `layout-remove` so the client can store its inverse payload. */
  removedText?: string;
  removedIndex?: number;
  parentPath?: number[];
}

const LAYOUT_KINDS = new Set(['layout-props', 'layout-insert', 'layout-remove']);

/** A short human label for the transaction log and the client's history list. */
export function labelOf(intent: MutateRequest): string {
  switch (intent.kind) {
    case 'layout-props':
      return `layout props ${intent.anchor?.tag ?? ''}`.trim();
    case 'layout-insert':
      return `insert into ${intent.parent?.tag ?? ''}`.trim();
    case 'layout-remove':
      return `remove ${intent.anchor?.tag ?? ''}`.trim();
    case 'class-rewrite':
      return `classes ${intent.cvaName ?? ''}${intent.axis ? `.${intent.axis}` : ''}`.trim();
    // Token labels name the VARIABLE, not the file. The transaction log and the
    // client's history list are the only readers, and "semantic.ts" is the same string
    // for every colour edit in wafflebase's pipeline — useless for telling two entries
    // apart. The path is what distinguishes them.
    case 'token-value':
      return `token ${(intent.path ?? []).join('.')}`;
    case 'token-rebind':
      return `rebind ${(intent.path ?? []).join('.')} → ${intent.tokenValue ?? ''}`;
    case 'palette-value':
      return `palette ${(intent.path ?? []).join('.')}`;
    case 'token-add':
    case 'member-add':
      return `add token ${intent.kebabKey ?? intent.camelKey ?? ''}`;
    case 'member-remove':
      return `drop token ${intent.kebabKey ?? intent.camelKey ?? ''}`;
    default:
      return intent.kind ?? 'unknown';
  }
}

export interface IntentContext {
  guard: PathGuard;
  tracker: Tracker;
  injector: Injector;
  tokens: TokenAdapter | null;
}

/**
 * One message for the no-adapter case, shared by the file-set and apply paths.
 *
 * They are reached separately — `/mutate` resolves files first, `scene-patch` applies
 * straight in — and two hand-written copies drifted in 8a: one named the option to pass
 * and the other did not, so the same misconfiguration produced two different
 * explanations depending on which endpoint the client happened to hit.
 */
export const NO_ADAPTER =
  'no token adapter configured — token editing is unavailable in this project ' +
  '(pass `tokens:` to designEditor())';

/**
 * The files one intent touches.
 *
 * For a layout intent that is the ANCHOR's file, never `intent.file` — a layout
 * intent addresses a node, and the node's file is a property of its anchor. This is
 * also what makes the three layout kinds identical for DOM and Canvas scenes.
 */
export function filesForIntent(
  ctx: IntentContext,
  intent: MutateRequest,
): { files: { rel: string; abs: string }[] } | { error: string } {
  if (TOKEN_KINDS.has(intent.kind ?? '')) {
    if (!ctx.tokens) return { error: NO_ADAPTER };
    const plan = planTokenIntent(ctx.tokens, ctx.guard, intent);
    if ('error' in plan) return { error: plan.error };
    return { files: plan.files };
  }

  const rel = LAYOUT_KINDS.has(intent.kind ?? '')
    ? ((intent.anchor ?? intent.parent)?.file ?? '')
    : (intent.file ?? '');

  const r = ctx.guard.resolveSafe(rel);
  if ('error' in r) return { error: r.error };
  return { files: [{ rel: ctx.guard.relOf(r.abs), abs: r.abs }] };
}

/**
 * Apply one intent against an in-memory text cache (abs → current text), so a
 * batch's edits to the same file COMPOSE rather than the second overwriting the
 * first. On success the cache is updated; on a locate failure it is left untouched,
 * which is what lets a partially-failing batch still be all-or-nothing.
 */
export async function applyIntentToCache(
  ctx: IntentContext,
  intent: MutateRequest,
  cache: Map<string, string>,
): Promise<IntentOutcome> {
  const get = (abs: string) => cache.get(abs) ?? '';

  if (LAYOUT_KINDS.has(intent.kind ?? '')) {
    const anchor = intent.anchor ?? intent.parent;
    if (!anchor?.file) return { located: false, reason: 'layout intents require an anchor' };
    // Through the guard, not `path.resolve`. `composeIntents` has already resolved
    // this file, but `scene-patch` calls straight in with an intent staged from the
    // browser — so this is the only check on that path, and an absolute or escaping
    // `anchor.file` would otherwise key the cache by a path outside the root.
    const resolved = ctx.guard.resolveSafe(anchor.file);
    if ('error' in resolved) return { located: false, reason: resolved.error };
    const abs = resolved.abs;

    // Resolution (path hint → fpx → fp → refuse) and the structural-op guard both
    // live in `resolveNode`, server-side, because the client's `SceneMeta` can be
    // stale — the same reason `/validate` shares this code with `/commit`.
    let res: LayoutResult;
    if (intent.kind === 'layout-props') {
      res = ctx.injector.applyLayoutProps(get(abs), {
        anchor,
        sets: intent.sets,
        classOps: intent.classOps,
        text: intent.text,
      });
    } else if (intent.kind === 'layout-insert') {
      res = ctx.injector.applyLayoutInsert(get(abs), {
        parent: intent.parent,
        index: intent.index ?? 0,
        raw: intent.raw ?? '',
        verbatim: intent.verbatim,
      });
    } else {
      // `anchor`, not `intent.anchor`: a remove addressed only through `parent` would
      // otherwise hand the injector `undefined` after we just validated the parent's
      // file, and the refusal would name a missing anchor rather than the real reason.
      res = ctx.injector.applyLayoutRemove(get(abs), { anchor });
    }
    if (!res.located) return { located: false, reason: res.reason };

    // Import maintenance is BEST-EFFORT and reported, never fatal. An insert whose
    // import already exists is a legitimate no-op; a removal's specifier is dropped
    // only when nothing else references it, because a stray unused import is
    // harmless while a missing one breaks the build.
    let text = res.text;
    const notes: string[] = [];
    for (const spec of intent.imports ?? []) {
      const r =
        intent.kind === 'layout-remove'
          ? ctx.injector.removeImport(text, spec)
          : ctx.injector.insertImport(text, spec);
      if (r.located) text = r.text;
      else if (r.reason) notes.push(`${spec.module}: ${r.reason}`);
    }

    cache.set(abs, text);
    const reason = [res.reason, notes.length ? `imports — ${notes.join('; ')}` : '']
      .filter(Boolean)
      .join('; ');
    return {
      located: true,
      reason: reason || undefined,
      removedText: res.removedText,
      removedIndex: res.removedIndex,
      parentPath: res.parentPath,
    };
  }

  if (intent.kind === 'class-rewrite') {
    const r = ctx.guard.resolveSafe(intent.file ?? '');
    if ('error' in r) return { located: false, reason: r.error };
    const res = ctx.injector.applyClassRewrite(get(r.abs), {
      cvaName: intent.cvaName,
      axis: intent.axis,
      value: intent.value,
      replacements: intent.replacements,
      additions: intent.additions,
      removals: intent.removals,
    });
    if (!res.located) return { located: false, reason: res.reason };
    cache.set(r.abs, res.text);
    return { located: true, reason: res.reason };
  }

  if (TOKEN_KINDS.has(intent.kind ?? '')) {
    if (!ctx.tokens) return { located: false, reason: NO_ADAPTER };
    // Re-planned rather than threaded through from `filesForIntent`. `plan()` is
    // required to be deterministic (see `TokenAdapter.plan`), and this path is also
    // reached WITHOUT a preceding `filesForIntent` — `scene-patch` applies staged
    // intents straight in — so there is no plan to be handed one.
    const plan = planTokenIntent(ctx.tokens, ctx.guard, intent);
    if ('error' in plan) return { located: false, reason: plan.error };
    return applyTokenPlan(plan, ctx.guard, cache);
  }

  return { located: false, reason: `unknown intent kind: ${intent.kind ?? '(none)'}` };
}

export interface ComposedIntents {
  /** abs → pristine text, for the transaction's `before`. */
  before: Map<string, string>;
  /** abs → composed text, for the write and the diff. */
  cache: Map<string, string>;
  relOf: Map<string, string>;
  results: (IntentOutcome & { label: string; file: string })[];
}

/**
 * Apply a BATCH against one shared cache. Writes nothing.
 *
 * Sequential rather than parallel, and that is load-bearing: two intents editing
 * the same file must see each other's output, which means each has to observe the
 * cache the previous one left behind.
 */
export async function composeIntents(
  ctx: IntentContext,
  intents: MutateRequest[],
): Promise<ComposedIntents> {
  const before = new Map<string, string>();
  const cache = new Map<string, string>();
  const relOf = new Map<string, string>();
  const results: ComposedIntents['results'] = [];

  for (const intent of intents) {
    const label = labelOf(intent);
    // A layout intent carries its file on the ANCHOR, so reporting `intent.file`
    // here named `''` for exactly the intents most likely to be refused — the
    // client then showed a failure with no file attached.
    const reportedFile = layoutFileOf(intent) ?? intent.file ?? '';
    const rf = filesForIntent(ctx, intent);
    if ('error' in rf) {
      results.push({ located: false, reason: rf.error, label, file: reportedFile });
      continue;
    }

    let missing = false;
    for (const { rel, abs } of rf.files) {
      relOf.set(abs, rel);
      if (cache.has(abs)) continue;
      if (!fs.existsSync(abs)) {
        results.push({ located: false, reason: `file not found: ${rel}`, label, file: rel });
        missing = true;
        break;
      }
      const txt = await ctx.tracker.read(abs);
      before.set(abs, txt);
      cache.set(abs, txt);
    }
    if (missing) continue;

    const out = await applyIntentToCache(ctx, intent, cache);
    results.push({ ...out, label, file: rf.files[0]?.rel ?? '' });
  }

  return { before, cache, relOf, results };
}

/**
 * One intent, computed against the real filesystem — the `/mutate` path.
 *
 * Kept as a thin wrapper over `composeIntents` rather than a second
 * implementation, so a single intent and a batch of one cannot disagree.
 */
export async function computeIntent(
  ctx: IntentContext,
  intent: MutateRequest,
): Promise<
  | { error: string; status: number }
  | (IntentOutcome & { files: { rel: string; abs: string; before: string; after: string }[] })
> {
  const rf = filesForIntent(ctx, intent);
  if ('error' in rf) return { error: rf.error, status: 400 };
  for (const { rel, abs } of rf.files) {
    if (!fs.existsSync(abs)) return { error: `file not found: ${rel}`, status: 404 };
  }

  const composed = await composeIntents(ctx, [intent]);
  const r = composed.results[0];
  return {
    located: r.located,
    reason: r.reason,
    // A `layout-remove` dry-run is how the client learns the EXACT span to store as
    // this edit's inverse payload — the layout analogue of a token edit's
    // `oldValue`, and what makes undo-past-save byte-identical.
    removedText: r.removedText,
    removedIndex: r.removedIndex,
    parentPath: r.parentPath,
    files: rf.files.map((f) => ({
      ...f,
      before: composed.before.get(f.abs) ?? '',
      after: composed.cache.get(f.abs) ?? composed.before.get(f.abs) ?? '',
    })),
  };
}
