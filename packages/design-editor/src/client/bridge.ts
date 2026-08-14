/**
 * Browser client for the plugin's JSON API.
 *
 * NOT A PORT. The prototype's `src/sandbox/mutate.ts` called `/__design-sdk/*` and
 * four endpoints that do not exist in the shipped bridge — `/introspect` (now
 * `/tokens`, and adapter-supplied rather than reading four `packages/core` paths),
 * `/history` (now `/transactions`), plus `/metadata` and `/scene-preview`, which
 * belong to the scene runtime and land with it. It also redeclared the intent and
 * result types the server already owns. This is written against the routes that
 * exist, importing those types instead of copying them.
 *
 * TWO RULES THE WHOLE FILE FOLLOWS.
 *
 * 1. Nothing throws. A dev server that is down, restarting, or answering HTML is the
 *    ordinary case here, not an exception — the editor stays open across restarts.
 *    Every method resolves to `{ ok: false, error }`, so a caller never needs a
 *    try/catch to keep the UI alive.
 * 2. `ok` is the server's word, not the transport's. A 409 from `/commit` carries
 *    per-intent results the editor renders; treating a non-2xx as a thrown failure
 *    would discard exactly the part the user needs to see.
 */

import { API_BASE } from '../base.ts';
// Type-only, all of them. `verbatimModuleSyntax` erases these outright, so importing
// from modules that reach `node:fs` costs the browser bundle nothing — and the
// alternative, hand-copied shapes, is how a client starts lying about the server.
import type { FrameSide, MutateRequest, MutateResult, Transaction } from '../plugin/protocol.ts';
import type { TransactionSummary } from '../plugin/transactions.ts';
import type { ExternalChange } from '../plugin/tracked.ts';
import type { AliasEntry } from '../plugin/aliases.ts';
import type { TokenFamilyMeta, TokenBindings, TokenVars } from '../tokens/adapter.ts';

/** The subset of `fetch` this client uses. Injectable so tests need no server. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface BridgeClientOptions {
  /**
   * API root. Defaults to the plugin's own mount.
   *
   * Configurable because the editor shell is not always same-origin with the dev
   * server it edits — a shell served from one port driving a project on another is
   * the case this exists for.
   */
  base?: string;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
}

/** Every response carries these two; `error` is present only when `ok` is false. */
export interface BridgeResult {
  ok: boolean;
  error?: string;
}

export interface HealthResult extends BridgeResult {
  root?: string;
  scenes?: string | null;
  providers?: string | null;
  /** `'configured'` or null — null greys the token panels rather than hiding them. */
  tokens?: 'configured' | null;
  /**
   * The consumer's import aliases, root-relative — what `resolveImport` needs to
   * turn `@/components/badge` into a file. Config, so it never changes for the life
   * of the dev server; the client reads it once.
   */
  aliases?: AliasEntry[];
  /**
   * Bumps once per external change to a watched file. Staged edits captured the text
   * they expect to find, so any bump means re-validate rather than trust them.
   */
  fsRevision?: number;
  externalChanges?: ExternalChange[];
  safelist?: number;
}

export interface TokensResult extends BridgeResult {
  /** null when the consumer configured no `TokenAdapter`; `reason` says so. */
  adapter?: 'configured' | null;
  reason?: string;
  sources?: string[];
  vars?: TokenVars;
  utilities?: string[];
  families?: TokenFamilyMeta[];
  bindings?: TokenBindings;
}

export interface PreviewTokensResult extends BridgeResult {
  light?: Record<string, string>;
  dark?: Record<string, string>;
  /** On-disk values, so the client can override only what actually moved. */
  base?: { light: Record<string, string>; dark: Record<string, string> };
  results?: MutateResult[];
}

/**
 * The whole `/mutate` response.
 *
 * Not to be confused with the server's `MutateResult`, which is ONE intent's verdict
 * and appears inside `results` on the batch routes. This route takes a single intent,
 * so it reports that verdict inline as `located`.
 */
export interface MutateResponse extends BridgeResult {
  located?: boolean;
  diff?: string;
  files?: string[];
  backup?: string | null;
  txnId?: number;
  regenerated?: boolean;
  regenError?: string;
  notes?: string[];
  /** `layout-remove` dry run: the span it would cut, i.e. the inverse's payload. */
  removedText?: string;
  removedIndex?: number;
  parentPath?: number[];
}

export interface ValidateResult extends BridgeResult {
  results?: MutateResult[];
  fsRevision?: number;
}

export interface CommitResult extends BridgeResult {
  diff?: string;
  files?: string[];
  backup?: string | null;
  txnId?: number;
  results?: MutateResult[];
  regenerated?: boolean;
  regenError?: string;
}

export interface TransactionsResult extends BridgeResult {
  undo?: TransactionSummary[];
  redo?: TransactionSummary[];
}

export interface UndoRedoResult extends BridgeResult {
  txnId?: number;
  files?: string[];
  regenerated?: boolean;
  regenError?: string;
}

export interface CandidatesResult extends BridgeResult {
  added?: string[];
  /**
   * Classes the safelist refused, and whether it hit its ceiling.
   *
   * Both are reported, not swallowed: a rejected or capped class generates no rule,
   * so the preview renders unstyled and the cause is otherwise invisible. Found by
   * driving a live server — the first draft of this type had neither field.
   */
  rejected?: string[];
  capped?: boolean;
  total?: number;
}

export interface PlanResult extends BridgeResult {
  side?: FrameSide;
  count?: number;
}

export interface BridgeClient {
  health(): Promise<HealthResult>;
  tokens(): Promise<TokensResult>;
  previewTokens(intents: MutateRequest[]): Promise<PreviewTokensResult>;
  /** One intent. `dryRun` returns the diff and writes nothing. */
  mutate(intent: MutateRequest, opts?: { dryRun?: boolean }): Promise<MutateResponse>;
  /** Would a save succeed right now? Same composition `/commit` runs, no write. */
  validate(intents: MutateRequest[]): Promise<ValidateResult>;
  /** A batch as ONE undo unit. All-or-nothing: a 409 means nothing was written. */
  commit(intents: MutateRequest[], opts?: { dryRun?: boolean }): Promise<CommitResult>;
  transactions(): Promise<TransactionsResult>;
  undo(): Promise<UndoRedoResult>;
  redo(): Promise<UndoRedoResult>;
  /** Register runtime-composed Tailwind classes so a rule exists to apply. */
  candidates(classes: string[]): Promise<CandidatesResult>;
  /** Stage the intents a frame side renders. */
  plan(side: FrameSide, intents: MutateRequest[]): Promise<PlanResult>;
}

/** `Transaction` is re-exported so callers typing a history view need one import. */
export type { Transaction, TransactionSummary };

export function createBridgeClient(options: BridgeClientOptions = {}): BridgeClient {
  const base = (options.base ?? API_BASE).replace(/\/$/, '');
  // Resolved at call time, not at construction: a test that installs a fake `fetch`
  // after building the client still gets it, and so does a page whose polyfill loads
  // late.
  //
  // `globalThis.fetch(...)` is a METHOD call on purpose. Pulling the function out
  // first — `(options.fetch ?? globalThis.fetch)(…)` — calls it with no receiver,
  // which browsers are entitled to reject for a Window operation. NOT VERIFIED here:
  // this package's suite runs in Node, where the unbound form works, so no test
  // distinguishes the two. It costs nothing to keep the receiver, so it keeps it.
  const call: FetchLike = (url, init) =>
    options.fetch ? options.fetch(url, init) : globalThis.fetch(url, init);

  const request = async <T extends BridgeResult>(
    path: string,
    init?: RequestInit,
  ): Promise<T> => {
    let res: Response;
    try {
      res = await call(`${base}${path}`, init);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'bridge unreachable' } as T;
    }
    try {
      // Parsed whatever the status: see rule 2 — a 409 body is the useful part.
      return (await res.json()) as T;
    } catch {
      // A dev server that is up but not serving the bridge answers HTML here. The
      // status is the only thing worth reporting, and it is worth reporting: it
      // distinguishes "plugin not installed" (404) from "bridge threw" (500).
      return { ok: false, error: `unexpected response (${res.status})` } as T;
    }
  };

  const post = <T extends BridgeResult>(path: string, body: unknown): Promise<T> =>
    request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  return {
    health: () => request<HealthResult>('/health'),
    tokens: () => request<TokensResult>('/tokens'),
    previewTokens: (intents) => post<PreviewTokensResult>('/preview-tokens', { intents }),
    // `?? intent.dryRun`, not a bare override: `dryRun` is part of `MutateRequest`, so
    // `mutate({ …, dryRun: true })` is a type-valid call. Writing `opts?.dryRun` alone
    // replaced that with `undefined`, `JSON.stringify` dropped the key, and the server
    // defaulted to a REAL WRITE — a requested dry run silently editing the repository.
    mutate: (intent, opts) =>
      post<MutateResponse>('/mutate', { ...intent, dryRun: opts?.dryRun ?? intent.dryRun }),
    validate: (intents) => post<ValidateResult>('/validate', { intents }),
    commit: (intents, opts) => post<CommitResult>('/commit', { intents, dryRun: opts?.dryRun }),
    transactions: () => request<TransactionsResult>('/transactions'),
    undo: () => post<UndoRedoResult>('/undo', {}),
    redo: () => post<UndoRedoResult>('/redo', {}),
    candidates: (classes) =>
      // Short-circuited: the bridge treats an empty list as a no-op anyway, and the
      // editor calls this on every render.
      classes.length ? post<CandidatesResult>('/candidates', { classes }) : Promise.resolve({ ok: true, added: [] }),
    plan: (side, intents) => post<PlanResult>('/plan', { side, intents }),
  };
}
