import type { DocStore } from './store.js';

/**
 * Every `DocStore` member that only reads.
 *
 * This is an allowlist of **readers**, and the direction is the whole point.
 * `DocStore` is 8 readers and some 36 mutators, and it is the mutator side
 * that grows — `batch()` arrived with the named-style undo work, `applyStyles`
 * and `insertBlocksAfter` with the paste and font-size passes. A list of
 * mutators to deny would have to be extended by whoever adds the 37th, and a
 * list nobody remembers to extend fails *open*: the new write forwards, and
 * the gate still reads as complete. That is exactly how `MUTATING_METHODS` in
 * `view/editor.ts` came to be missing `getStore`/`getDoc` in the first place
 * (issue #989).
 *
 * Listing readers inverts the failure: a member added tomorrow is not here, so
 * it is neutered by default. The cost of forgetting to add a genuine *reader*
 * is a read that returns `undefined` at its call site — loud, local, and
 * harmless to the document.
 */
const DOC_STORE_READERS: ReadonlySet<string | symbol> = new Set([
  'getDocument',
  'getBlock',
  'getPageSetup',
  'getDocStyles',
  'getHeader',
  'getFooter',
  'canUndo',
  'canRedo',
]);

/**
 * A `DocStore` view whose reads work and whose writes do nothing.
 *
 * The editor's read-only mode neuters `EditorAPI`'s mutating commands, but a
 * store handle walks around all of that: `getStore()` and `getDoc()` hand out
 * objects with their own mutators, and until this existed a viewer share link
 * could reach ~30 of them. That matters more than a client-side flag usually
 * would, because the server-side check behind it — the Yorkie auth webhook —
 * ships in shadow mode by default (`YORKIE_AUTH_WEBHOOK_ENFORCE`), so with the
 * default configuration this flag is the write boundary rather than a
 * convenience in front of one.
 *
 * A Proxy rather than a hand-written delegate for the same reason
 * `pageSetupGuardedStore` is one: a delegate needs a line per interface member
 * just to stay a working store, and a missed one is `undefined` at the call
 * site. But unlike that wrapper this *is* an access-control boundary, so the
 * traps have to cover the ways around a bare `get`:
 *
 * - `getPrototypeOf` is nulled, or `Object.getPrototypeOf(store).insertText
 *   .call(store, …)` reaches the target — `YorkieDocStore`'s methods live on
 *   its class prototype, so they are all reachable that way.
 * - `set` and `defineProperty` both refuse. Trapping only `set` leaves the
 *   `defineProperty` door open, which is not hypothetical: it is what
 *   `vi.spyOn` uses.
 * - `deleteProperty` refuses, so a member cannot be removed to expose
 *   something behind it.
 *
 * A *called* mutator is a silent no-op, matching how `MUTATING_METHODS`
 * neuters the command surface: a viewer holding a handle that throws turns a
 * denied write into a broken screen, and read-only mode is a state the UI is
 * expected to be usable in. Refusing the three property traps is the louder
 * behaviour (they throw in strict mode), which is right for them — assigning
 * onto a store handle is never something the app does, only something reaching
 * around the view would do.
 */
export function readOnlyDocStore(store: DocStore): DocStore {
  // Memoized per underlying function so `s.canUndo === s.canUndo` holds — the
  // same reason `pageSetupGuardedStore` memoizes, and what keeps a member
  // usable as a dependency or a map key.
  const members = new Map<string | symbol, { raw: unknown; view: unknown }>();
  const noop = (): void => {};

  return new Proxy(store, {
    get(target, prop) {
      const raw = Reflect.get(target, prop) as unknown;
      // A proxy may not hide a non-configurable, non-writable own data
      // property — returning anything but its real value is a `TypeError`.
      // The three traps below already make that exception; `get` has to
      // make it too, or the four disagree and a plain spread throws. No
      // store has such a property today (both keep ordinary class fields,
      // which are configurable), so this is about the four traps staying
      // one rule rather than about anything reachable now.
      const own = Reflect.getOwnPropertyDescriptor(target, prop);
      if (own && own.configurable === false && own.writable === false) {
        return own.value as unknown;
      }

      // Data properties are hidden, not forwarded. Every member of `DocStore`
      // is a method, so nothing legitimate is lost — and what an
      // implementation keeps in a field is its live state: `MemDocStore.doc`
      // is the internal `Document`, and `YorkieDocStore.doc` is the CRDT
      // handle, whose `update()` is the documented write path. Forwarding
      // those would have left a wider hole than the prototype one below,
      // reachable without so much as a method call.
      if (typeof raw !== 'function') return undefined;

      const cached = members.get(prop);
      if (cached && cached.raw === raw) return cached.view;

      let view: unknown;
      if (DOC_STORE_READERS.has(prop)) {
        view = (raw as (...args: unknown[]) => unknown).bind(target);
      } else if (prop === 'batch') {
        // `batch(fn)` is a grouping seam, not a write of its own. A bare no-op
        // would swallow `fn` whole, so a caller that batches reads — a
        // perfectly reasonable thing for a viewer to do — would silently get
        // none of them. Run the body; each write inside it is neutered on its
        // own way through this same proxy.
        view = (fn: () => void): void => {
          fn();
        };
      } else {
        // Every mutator on `DocStore` returns void, so one shared no-op is
        // signature-compatible with all of them.
        view = noop;
      }

      members.set(prop, { raw, view });
      return view;
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
    getPrototypeOf: () => null,
    // Reporting a null prototype is not the same as refusing to be given
    // one. `setPrototypeOf` forwards to the *target* if it is left
    // untrapped, which is a complete escape: plant an accessor on the
    // chain, read it, and the getter runs with `this` bound to the real
    // store, because `Reflect.get(target, prop)` defaults its receiver to
    // the target. From there every own field and prototype method is in
    // hand, and the handle still reports a null prototype afterwards.
    setPrototypeOf: () => false,
    // `preventExtensions` forwards the same way, and making the target
    // non-extensible would leave the two traps below violating a proxy
    // invariant — every later `Object.keys` / spread / descriptor read
    // throws a `TypeError`. `Object.freeze(handle)` is the realistic way
    // in: it runs `preventExtensions` first, so the damage lands on the
    // real store and only then does the call fail.
    preventExtensions: () => false,
    isExtensible: () => true,
    // `in` does not consult `ownKeys`, so without this a hidden field still
    // answers `true` while `Object.keys` reports nothing. Report what `get`
    // will actually hand back, so the two agree. Note this trap is for
    // external holders of the handle: the `x in store` feature detection
    // inside `view/editor.ts` runs against the raw store, never this one.
    has(target, prop) {
      if (Reflect.getOwnPropertyDescriptor(target, prop)?.configurable === false) {
        return true;
      }
      return typeof Reflect.get(target, prop) === 'function';
    },
    // Hiding a field from `get` is not enough on its own: a descriptor read
    // carries the value with it, and `Object.keys` and spread both enumerate
    // before they read. Both traps report nothing — except for a
    // non-configurable own property, which a proxy may not hide (the invariant
    // is enforced with a `TypeError`), and which neither store implementation
    // has.
    getOwnPropertyDescriptor(target, prop) {
      const desc = Reflect.getOwnPropertyDescriptor(target, prop);
      return desc && desc.configurable === false ? desc : undefined;
    },
    ownKeys(target) {
      return Reflect.ownKeys(target).filter(
        (key) => Reflect.getOwnPropertyDescriptor(target, key)?.configurable === false,
      );
    },
  });
}
