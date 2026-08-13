/**
 * The `TokenAdapter` contract — the seam 8a declared and this PR makes real.
 *
 * 8a shipped this interface with `unknown` in every payload position, which was
 * honest about implementing nothing but is not a seam anybody could implement
 * against. The types here are the substance of that promise.
 *
 * WHY THIS FILE HAS NO IMPORT FROM `../plugin/`. `src/tokens/` is the half a
 * consumer — including wafflebase's own `design-sandbox` in 8c — writes an adapter
 * against. If the contract imported the wire protocol, writing an adapter would mean
 * depending on the bridge's request shape, and the wire's field names would become
 * part of the adapter API. Translation from `MutateRequest` to `TokenEdit` therefore
 * lives on the plugin side, in `../plugin/tokens.ts`, and this file is the boundary.
 *
 * See `design-editor-local-plugin.md` §4 for why `plan()` returns a LIST: wafflebase's
 * own pipeline needs a coordinated three-point write (source const → emitter array →
 * `@theme inline` alias), and a single-write return type would have made its own
 * reference implementation inexpressible.
 */

/**
 * How the editor groups tokens for authoring.
 *
 * Defined HERE rather than in the wire protocol because families are a property of a
 * token pipeline, not of the transport — and because an adapter has to enumerate them
 * in `read()` without knowing anything about HTTP. The four names come from
 * wafflebase's own pipeline, where each is a separate file; `cssVariables` maps all
 * four onto one stylesheet, which is the clearest evidence that the grouping is a UI
 * concept rather than a storage one.
 */
export type TokenFamily = 'semantic' | 'palette' | 'radius' | 'typo';

/**
 * `primaryForeground` → `primary-foreground`, `gray100` → `gray-100`.
 *
 * Part of the CONTRACT, not of any one implementation: `TokenEdit.kebabKey` is defined
 * as the result of this function, so it lives beside that definition. The prototype had
 * it in two places — `vite.config.ts`'s `FAMILY` table and `edits.ts` — which is the
 * duplication the `kebabKey` field exists to end.
 *
 * A run of digits is ONE group. The prototype's version broke on every character
 * (`/[A-Z0-9]/`), so `gray100` became `gray-1-0-0` — and a numeric scale is the most
 * ordinary thing a shadcn project has. Single-digit keys are unaffected (`chart1` →
 * `chart-1` either way), which is why wafflebase's own `--chart-1…5` never exposed it.
 */
export const camelToKebab = (s: string): string =>
  s.replace(/[A-Z]|\d+/g, (m) => `-${m.toLowerCase()}`);

/**
 * Normalise a configured path to the form `sources()` must return.
 *
 * Strips a leading `./` and collapses `\` to `/`, so it matches what the plugin's path
 * guard produces from an absolute path. Deliberately not `path.normalize` — this file is
 * the contract and stays free of node imports so an adapter can be written against it
 * anywhere.
 */
export const normaliseSource = (p: string): string =>
  p.replace(/\\/g, '/').replace(/^\.\//, '');

/** One theme's resolved custom properties: `--background` → `oklch(1 0 0)`. */
export type TokenVars = Record<string, string>;

/**
 * What the editor renders and binds against.
 *
 * `light` is the base theme (`:root`) and `dark` the override, matching how both
 * pipelines actually store them — as a base block plus a delta, not as two complete
 * sets. A property absent from `dark` inherits, and the client must render it that
 * way rather than as empty.
 */
export interface TokenTree {
  vars: { light: TokenVars; dark: TokenVars };
  /**
   * Custom properties reachable as a utility class — the `@theme inline` aliases.
   *
   * Load-bearing for the UI, not decoration: a `:root` variable that is not aliased
   * generates no utility, so offering it as an editable token would produce a value
   * change with no visible effect. Empty when the project has no `@theme` block.
   */
  utilities: string[];
  /** Per-family authoring metadata. Replaces the client's compiled-in copy. */
  families: TokenFamilyMeta[];
}

/**
 * Everything the client needs to offer "add a token", as DATA.
 *
 * This is the half of §6's `src/sandbox/edits.ts:116-119` row that 8b can close. The
 * prototype duplicated the four token paths into client code and, worse, duplicated
 * the naming RULES as functions (`` cssVar: (k) => `--wb-${k}` ``) — and a function cannot
 * cross the wire, which is exactly why the copy existed. Encoding each rule as a
 * PREFIX makes it serializable, so the server can be the single source of it.
 *
 * All four of wafflebase's own families are prefix-plus-kebab, so nothing is lost in
 * the translation; that was checked against its `FAMILY` table rather than assumed.
 */
export interface TokenFamilyMeta {
  family: TokenFamily;
  /** Shown in the picker, e.g. `"Color"`. */
  label: string;
  /** Root-relative file a value edit for this family lands in. */
  file: string;
  /** Emitted custom property = this + the kebab key. `"--"`, `"--wb-"`, `"--font-"`. */
  cssVarPrefix: string;
  /** `@theme inline` alias = this + the kebab key. `"--color-"`, `"--radius-"`. */
  themeVarPrefix: string;
  /** Example utility the token unlocks = this + the kebab key. `"bg-"`, `"rounded-"`. */
  utilityPrefix: string;
  /** Placeholder for the value input, e.g. `"oklch(0.7 0.1 250)"`. */
  placeholder: string;
  /** Value a newly created token starts at. */
  defaultValue: string;
}

/**
 * A token edit, normalised.
 *
 * A discriminated union rather than the wire's flat optional fields, so an adapter
 * cannot receive a `set-value` with no `value` or an `add-member` with no key: the
 * validation happens once, in `../plugin/tokens.ts`, and every adapter is downstream
 * of it. The prototype passed the raw request through and each branch re-defaulted
 * `?? ''` on its own.
 */
export type TokenEdit =
  | {
      kind: 'set-value';
      family: TokenFamily;
      /** Which theme's block. `set-value` on a single-theme token uses `light`. */
      theme: 'light' | 'dark';
      /** Path within the family's source structure, e.g. `['primary']`. */
      path: string[];
      /**
       * The addressed leaf in kebab form, e.g. `primary-foreground`.
       *
       * Derived ONCE by the normaliser and handed to every adapter, so the camel→kebab
       * rule has a single implementation. An AST pipeline ignores this and walks `path`
       * + `constName`; a stylesheet pipeline ignores those and builds a property name
       * from this. Making each adapter re-derive it is how the prototype ended up with
       * the same rule written twice, once on each side of the wire.
       */
      kebabKey: string;
      value: string;
      /** `expression` writes the value verbatim — a palette rebind, not a literal. */
      valueKind: 'literal' | 'expression';
      /** The source const being edited, where the pipeline has one. */
      constName?: string;
    }
  | {
      kind: 'add-member';
      family: TokenFamily;
      camelKey: string;
      kebabKey: string;
      value: string;
    }
  | {
      kind: 'remove-member';
      family: TokenFamily;
      camelKey: string;
      kebabKey: string;
    };

export interface TokenWriteResult {
  located: boolean;
  text: string;
  /** Why it did not apply, or a note about how it did. Surfaced either way. */
  reason?: string;
}

/**
 * One file mutation a planned edit implies.
 *
 * The write OWNS its mutation (`apply`) rather than describing an operation the plugin
 * dispatches. That is the decision that keeps the seam generic: the alternative —
 * declarative ops — requires the plugin to understand emitter arrays, `@theme`
 * aliasing and const shapes, which are precisely the wafflebase-pipeline concepts
 * §6 exists to move OUT of the plugin. As written, the plugin's whole job is
 * resolve-read-apply-cache, and 8c's `wafflebaseCore` can call `inject.mjs` directly
 * without a single plugin change.
 */
export interface TokenWrite {
  /** Root-relative. Resolved through the path guard by the CALLER, never here. */
  file: string;
  /**
   * May be async, and the caller MUST await it in order.
   *
   * Sequential application is already the contract for composing a batch — two edits
   * to one file must each see what the previous one left — so awaiting here adds no new
   * ordering requirement. Allowing it is what lets an adapter reach a dynamically
   * imported helper without keeping module-level state to cache it in, which this
   * package avoids everywhere else for the same reason `paths.ts` has no module-level
   * root: two dev servers in one process must not share it.
   */
  apply(text: string): TokenWriteResult | Promise<TokenWriteResult>;
  /**
   * A failed REQUIRED write refuses the whole edit; a failed optional one is a note.
   *
   * Not a nicety — it is how the reference pipeline behaves and the reason this field
   * exists at all. The source const and the emitter entry are load-bearing (without
   * both, a new token either fails typecheck or silently never reaches the CSS), while
   * the `@theme inline` alias is best-effort: "already mapped" is a legitimate no-op,
   * and a project with no `@theme` block at all still gets a working token. Both of
   * those were confirmed against a real shadcn stylesheet before this was written.
   */
  required: boolean;
  /** Short description for the note a skipped optional write produces. */
  label: string;
}

/** The variable map a preview applies, or why it could not be produced. */
export interface TokenEmitResult {
  ok: boolean;
  error?: string;
  light?: TokenVars;
  dark?: TokenVars;
}

export interface TokenRegenResult {
  ok: boolean;
  error?: string;
  /**
   * Absolute paths whose module the plugin should invalidate and push afterwards.
   *
   * The adapter names them because only it knows where its emitter wrote. Wafflebase
   * generates `packages/core/dist/tokens.css`, which is outside the Vite root and
   * whose registration as a watch dependency is an implementation detail of the
   * Tailwind plugin — not something to bet the live-preview loop on.
   */
  artifacts?: string[];
}

export interface TokenAdapter {
  /**
   * Root-relative files whose change invalidates token state.
   *
   * Replaces the prototype's `WATCHED_RE` and `isTokenSourcePath` — two regexes over
   * `packages/core/**` that no foreign project matches. It is also the CSS-regen gate:
   * a commit re-emits when it wrote any file in this list, which is strictly more
   * accurate than a pattern match on the path.
   *
   * Paths must be NORMALISED — `src/index.css`, never `./src/index.css`. They are
   * compared by string against the root-relative paths the plugin derives from what it
   * wrote, and a `./` prefix silently matched nothing: the regen gate never fired and a
   * staged edit never reached the preview. `normaliseSource` is provided so an adapter
   * can hand its own configured option through it rather than re-deriving the rule.
   */
  sources(): string[];
  /** Read the current token tree. `readFile` takes a root-relative path. */
  read(readFile: (rel: string) => Promise<string>): Promise<TokenTree>;
  /**
   * Turn one normalised edit into the writes it implies — one file, or four.
   *
   * Returns `{error}` for an edit this pipeline cannot express (a family it does not
   * carry, a key that is not addressable), so the refusal reaches the user as a reason
   * rather than as an empty write list that would read as a successful no-op.
   *
   * MUST BE DETERMINISTIC and must not read the filesystem. It is called TWICE for one
   * edit: once to resolve the file set the request touches (before any of them are read)
   * and again to apply. It is also reached on the second path alone, when the scene
   * patcher applies a staged plan without resolving files first. An adapter that planned
   * differently on the two calls would have the plugin read one set of files and write
   * another.
   */
  plan(edit: TokenEdit): TokenWrite[] | { error: string };
  /**
   * Render the variable map these source texts produce, WITHOUT writing.
   *
   * Keyed by root-relative path; the plugin supplies every `sources()` entry, patched
   * where an edit touched it. This is what makes a live token preview possible: the
   * client diffs the patched map against the base one and applies only what moved.
   */
  emit(files: Record<string, string>): Promise<TokenEmitResult>;
  /**
   * Re-run the project's real emitter after a write.
   *
   * OPTIONAL, and absent from `cssVariables` on purpose: when tokens live in a
   * stylesheet the host already serves, the write IS the emission and Vite's own CSS
   * HMR publishes it. Wafflebase generates `tokens.css` from `.ts` sources, so it must
   * shell out to its build step — which is the only reason this method exists.
   */
  regenerate?(): Promise<TokenRegenResult>;
}
