import type { HitResult } from './hit-test-elements';

type Listener = () => void;

/**
 * Result of `pickAtScope`: either the element id at the level the user
 * clicked within the current scope, or an indication that the hit landed
 * outside the scope entirely.
 */
type PickResult =
  | { kind: 'inside'; id: string }
  | { kind: 'outside' };

/**
 * Given a hit and the current selection scope, return the id at the
 * level the click should select, or `{ kind: 'outside' }` if the hit
 * is not inside the scope (caller should reset scope and re-run).
 *
 * Rules:
 * - `scope = []` → the outermost ancestor of the hit element (ancestorPath[0]).
 * - `scope = [g1, g2, ...]` → verify ancestorPath starts with scope, then
 *   return `ancestorPath[scope.length]` (the direct child of the deepest
 *   scoped group).  If ancestorPath does not start with scope the hit is
 *   outside and the caller must reset scope and re-evaluate.
 */
function pickAtScope(
  hit: HitResult,
  scope: readonly string[],
): PickResult {
  if (scope.length === 0) {
    // No drill-in active — always pick the outermost element.
    return { kind: 'inside', id: hit.ancestorPath[0] };
  }

  // Verify that the hit lives inside the scoped group chain.
  for (let i = 0; i < scope.length; i++) {
    if (hit.ancestorPath[i] !== scope[i]) {
      return { kind: 'outside' };
    }
  }

  // ancestorPath[scope.length] is the direct child of the innermost
  // scoped group — that is what the user interacts with at this scope level.
  return { kind: 'inside', id: hit.ancestorPath[scope.length] };
}

/**
 * Transient editor selection state. Holds the ordered list of
 * currently-selected element ids and notifies subscribers on change.
 *
 * Selection is editor-local, not stored in the SlidesDocument:
 * other users see selections via Phase 4 presence, not via Yorkie.
 *
 * The `scope` field tracks the ancestor-group chain the user has drilled
 * into (Google Slides style). `scope = []` means the slide root; each
 * entry is a group id, outer → inner. `ids` always refers to elements at
 * the scope level (direct children of the innermost scoped group, or
 * slide-root elements when scope is empty).
 */
export class Selection {
  private ids: string[] = [];
  private scope_: string[] = [];
  private listeners = new Set<Listener>();

  // ---------------------------------------------------------------------------
  // Existing API (unchanged)
  // ---------------------------------------------------------------------------

  get(): readonly string[] {
    return this.ids;
  }

  has(id: string): boolean {
    return this.ids.includes(id);
  }

  set(next: readonly string[]): void {
    if (sameOrder(this.ids, next)) return;
    this.ids = [...next];
    this.notify();
  }

  toggle(id: string): void {
    const i = this.ids.indexOf(id);
    if (i === -1) {
      this.ids = [...this.ids, id];
    } else {
      this.ids = [...this.ids.slice(0, i), ...this.ids.slice(i + 1)];
    }
    this.notify();
  }

  clear(): void {
    if (this.ids.length === 0) return;
    this.ids = [];
    this.notify();
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ---------------------------------------------------------------------------
  // Scope / drill-in API (Task 8)
  // ---------------------------------------------------------------------------

  /** Current drill-in scope: ancestor group ids, outer → inner. */
  getScope(): readonly string[] {
    return this.scope_;
  }

  /**
   * Directly set the scope. Notifies subscribers.
   * Primarily used by tests and external callers that need to prime the scope
   * without going through a click interaction.
   */
  setScope(next: readonly string[]): void {
    if (sameOrder(this.scope_, next)) return;
    this.scope_ = [...next];
    this.notify();
  }

  /**
   * Apply a single click at the given hit result.
   *
   * Rules (mirrors Google Slides click behaviour):
   * - `hit === null` — clear scope and ids (click on empty canvas).
   * - Shift+click within scope — toggle the appropriate-level id, leave scope.
   * - Plain click within scope — replace ids with the hit element at scope level.
   * - Hit outside current scope — reset scope to [] then re-evaluate the click.
   */
  click(hit: HitResult | null, mods: { shift?: boolean }): void {
    if (hit === null) {
      this.applyState([], []);
      return;
    }

    const result = pickAtScope(hit, this.scope_);

    if (result.kind === 'outside') {
      // The hit is not inside the drilled-in group. Exit scope and retry from
      // the root so the user can select whatever slide-root element they clicked.
      const rootResult = pickAtScope(hit, []);
      this.applyState([], rootResult.kind === 'inside' ? [rootResult.id] : []);
      return;
    }

    const id = result.id;
    if (mods.shift) {
      // Toggle the id within the current scope; scope itself does not change.
      const i = this.ids.indexOf(id);
      const nextIds =
        i === -1
          ? [...this.ids, id]
          : [...this.ids.slice(0, i), ...this.ids.slice(i + 1)];
      this.applyState(this.scope_, nextIds);
    } else {
      this.applyState(this.scope_, [id]);
    }
  }

  /**
   * Apply a double-click. Drills in one level if the hit is inside a group.
   *
   * Rules:
   * - `hit === null` — same as click (clear everything).
   * - If the element at the current scope level is a leaf (no further nesting
   *   past scope), treat as a plain click (no-op on scope).
   * - Otherwise descend exactly one level: add the hit's element at the current
   *   scope level to scope, then pick the element one level deeper.
   */
  doubleClick(hit: HitResult | null): void {
    if (hit === null) {
      this.applyState([], []);
      return;
    }

    const result = pickAtScope(hit, this.scope_);

    if (result.kind === 'outside') {
      // Reset scope and re-evaluate as a normal click.
      const rootResult = pickAtScope(hit, []);
      this.applyState([], rootResult.kind === 'inside' ? [rootResult.id] : []);
      return;
    }

    // How many path entries are left beyond the current scope level?
    // scope.length + 1 is the "picked" element; if ancestorPath has nothing
    // deeper than that, we are already at the leaf — treat as click.
    const picked = result.id;
    const nextScopeDepth = this.scope_.length + 1;

    if (hit.ancestorPath.length <= nextScopeDepth) {
      // Already at the deepest available level — no further drill-in possible.
      this.applyState(this.scope_, [picked]);
      return;
    }

    // Drill in: extend scope by the picked element, then select the element
    // one level deeper.
    const newScope = [...this.scope_, picked];
    const deeperResult = pickAtScope(hit, newScope);
    const deepId =
      deeperResult.kind === 'inside' ? deeperResult.id : picked;
    this.applyState(newScope, [deepId]);
  }

  /**
   * Pop one level off the scope and clear ids.
   * No-op if scope is already empty (we are at the slide root).
   */
  escape(): void {
    if (this.scope_.length === 0) return;
    this.applyState(this.scope_.slice(0, -1), []);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Atomically apply a new (scope, ids) pair and fire exactly one
   * notification if either changed.
   */
  private applyState(nextScope: readonly string[], nextIds: readonly string[]): void {
    const scopeChanged = !sameOrder(this.scope_, nextScope);
    const idsChanged   = !sameOrder(this.ids,    nextIds);
    if (!scopeChanged && !idsChanged) return;
    if (scopeChanged) this.scope_ = [...nextScope];
    if (idsChanged)   this.ids    = [...nextIds];
    this.notify();
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
