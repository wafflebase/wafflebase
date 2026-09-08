import type { NoteSelection, NoteStore } from './store.js';

/**
 * Every `NoteStore` member that only reads (or subscribes).
 *
 * This is an allowlist of **readers**, and the direction is the point — the
 * same reasoning as `packages/docs/src/store/read-only.ts`. A denylist of
 * mutators has to be extended by whoever adds the next one, and a list nobody
 * remembers to extend fails *open*: the new write forwards and the gate still
 * reads as complete. Listing readers inverts that failure — a member added
 * tomorrow is not here, so it is neutered by default, and the cost of
 * forgetting to add a genuine reader is `undefined` at its call site: loud,
 * local, and harmless to the document.
 *
 * The subscriptions belong here. They are how a viewer sees a peer's edits
 * arrive, so neutering them would leave a read-only mount frozen at the text
 * it loaded with — which is not a safer state, just a broken one.
 */
const NOTE_STORE_READERS: ReadonlySet<string | symbol> = new Set([
  'getText',
  'getAuthorSpans',
  'getPeerSelections',
  'canUndo',
  'canRedo',
  'subscribeRemote',
  'subscribePresence',
]);

/**
 * `undo` / `redo` return a selection rather than `void`, so they cannot share
 * the mutators' single `noop`: a caller that dispatched `undefined` into
 * `applyRestoredSelection` would read a missing selection as "leave the caret
 * alone" by luck rather than by contract.
 */
const HISTORY_METHODS: ReadonlySet<string | symbol> = new Set(['undo', 'redo']);

/**
 * Proxies this module produced, so wrapping an already-guarded store is a
 * no-op instead of a second layer. Both the engine (`initialize`) and the
 * frontend mount guard their handle, and they must be free to do so
 * independently — neither can see whether the other already did.
 */
const READ_ONLY_VIEWS = new WeakSet<NoteStore>();

/**
 * A `NoteStore` view whose reads work and whose writes do nothing.
 *
 * The editor's read-only mode neuters the view: `EditorState.readOnly` makes
 * commands decline, and a `changeFilter` drops every non-remote transaction. But
 * a *store handle* walks around all of that — `editText`, `batch`, `undo` and
 * `setLocalSelection` are CRDT writes that never pass through a CodeMirror
 * transaction, which is exactly why `runHistory()` in `view/editor.ts` needed a
 * hand-written `readOnly` guard of its own. This wrapper is the general form of
 * that guard: on a viewer mount there is no reachable write, whether or not the
 * next write path remembers to check a flag.
 *
 * That matters more than a client-side flag usually would, because the
 * server-side check behind it — the Yorkie auth webhook — ships in shadow mode
 * by default (`YORKIE_AUTH_WEBHOOK_ENFORCE`), so with the default
 * configuration this is the write boundary rather than a convenience in front
 * of one.
 *
 * A Proxy rather than a hand-written delegate, for the reasons the docs wrapper
 * gives, and with the same traps — because this is an access-control boundary,
 * the ways around a bare `get` have to be covered too:
 *
 * - `getPrototypeOf` is nulled, or `Object.getPrototypeOf(store).editText
 *   .call(store, …)` reaches the target: `YorkieNoteStore`'s methods all live
 *   on its class prototype.
 * - Data properties are hidden rather than forwarded. Every `NoteStore` member
 *   is a method, so nothing legitimate is lost — and `YorkieNoteStore.doc` is
 *   the raw Yorkie handle, whose `update()` is the documented write path. That
 *   field is the widest hole here, reachable without so much as a method call.
 * - `set` / `defineProperty` / `deleteProperty` refuse, so a member cannot be
 *   replaced or removed to expose what is behind it (`vi.spyOn` uses
 *   `defineProperty`, so trapping only `set` is not enough).
 * - `setPrototypeOf` and `preventExtensions` refuse rather than forwarding to
 *   the real store, which is a complete escape / a proxy-invariant break
 *   respectively.
 *
 * A *called* mutator is a silent no-op: a viewer holding a handle that throws
 * turns a denied write into a broken screen, and read-only is a state the UI is
 * expected to be usable in. The property traps are the louder behaviour (they
 * throw in strict mode), which is right for them — assigning onto a store
 * handle is never something the app does.
 */
export function readOnlyNoteStore(store: NoteStore): NoteStore {
  if (READ_ONLY_VIEWS.has(store)) return store;

  // Memoized per underlying function so `s.getText === s.getText` holds, which
  // is what keeps a member usable as a dependency or a map key.
  const members = new Map<string | symbol, { raw: unknown; view: unknown }>();
  const noop = (): void => {};
  const noHistory = (): NoteSelection | null => null;

  const readOnlyView = new Proxy(store, {
    get(target, prop) {
      const raw = Reflect.get(target, prop) as unknown;
      // A proxy may not hide a non-configurable, non-writable own data
      // property — returning anything but its real value is a `TypeError`. The
      // traps below already make that exception; `get` has to make it too, or
      // the traps disagree and a plain spread throws. Neither store
      // implementation has such a property today (both keep ordinary class
      // fields, which are configurable), so this is about the traps staying one
      // rule rather than about anything reachable now.
      const own = Reflect.getOwnPropertyDescriptor(target, prop);
      if (own && own.configurable === false && own.writable === false) {
        return own.value as unknown;
      }

      if (typeof raw !== 'function') return undefined;

      const cached = members.get(prop);
      if (cached && cached.raw === raw) return cached.view;

      let view: unknown;
      if (NOTE_STORE_READERS.has(prop)) {
        view = (raw as (...args: unknown[]) => unknown).bind(target);
      } else if (HISTORY_METHODS.has(prop)) {
        view = noHistory;
      } else if (prop === 'batch') {
        // `batch(fn)` is a grouping seam, not a write of its own. A bare no-op
        // would swallow `fn` whole, so a caller that batches reads would
        // silently get none of them. Run the body; each write inside it is
        // neutered on its own way through this same proxy — which is what makes
        // `noteSync`'s `batch(() => editText(…))` inert without the sync plugin
        // knowing anything about read-only.
        view = (fn: () => void): void => {
          fn();
        };
      } else {
        // The remaining mutators (`editText`, `recordSelectionForHistory`,
        // `setLocalSelection`) all return void, so one shared no-op is
        // signature-compatible. `setLocalSelection` is included deliberately:
        // publishing a caret is a `doc.update` like any other, and a viewer's
        // caret is not something a read-only mount owes its peers.
        view = noop;
      }

      members.set(prop, { raw, view });
      return view;
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
    getPrototypeOf: () => null,
    setPrototypeOf: () => false,
    preventExtensions: () => false,
    isExtensible: () => true,
    // `in` does not consult `ownKeys`, so without this a hidden field still
    // answers `true` while `Object.keys` reports nothing. Report what `get`
    // will actually hand back, so the two agree.
    has(target, prop) {
      if (
        Reflect.getOwnPropertyDescriptor(target, prop)?.configurable === false
      ) {
        return true;
      }
      return typeof Reflect.get(target, prop) === 'function';
    },
    // Hiding a field from `get` is not enough on its own: a descriptor read
    // carries the value with it, and `Object.keys` and spread both enumerate
    // before they read. Both traps report nothing — except a non-configurable
    // own property, which a proxy may not hide.
    getOwnPropertyDescriptor(target, prop) {
      const desc = Reflect.getOwnPropertyDescriptor(target, prop);
      return desc && desc.configurable === false ? desc : undefined;
    },
    ownKeys(target) {
      return Reflect.ownKeys(target).filter(
        (key) =>
          Reflect.getOwnPropertyDescriptor(target, key)?.configurable === false,
      );
    },
  });

  READ_ONLY_VIEWS.add(readOnlyView);
  return readOnlyView;
}
