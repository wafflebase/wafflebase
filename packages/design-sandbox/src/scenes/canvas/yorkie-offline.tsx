/**
 * yorkie-offline.tsx — CP4's substitute for `@yorkie-js/react`.
 *
 * Every canvas scene page imports `@yorkie-js/react` directly
 * (`DocumentProvider`, `useDocument`, `usePresences`, and `YorkieProvider` one
 * level up in `PrivateRoute.tsx`, which canvas scenes don't go through — see
 * below). `vite.config.ts`'s `yorkieOffline()` plugin redirects every import
 * of that specifier, dev-server-wide, to THIS file — so scene code runs
 * completely unmodified; only what it attaches to changes.
 *
 * THE FINDING THIS FILE RESTS ON, verified against `@yorkie-js/sdk@0.7.13`
 * with a standalone probe before writing any of this: a `Document` that is
 * never attached to a `Client` (`status: "detached"`) is still fully
 * functional. `update()` works for both the root and presence callbacks,
 * `Tree`/`Text` construction works, local `subscribe()` events fire, and
 * `doc.history.canUndo()` answers. The SDK's own type declaration says as
 * much: "`Document` is a CRDT-based data type... we can represent the model
 * of the application and edit it even while offline." Only the `Client`
 * touches the network — activate, attach, watch — so this file mocks the
 * REACT BINDING that would have attached a document. It does not fake a
 * WebSocket and it does not fake a document; the `Document` constructed
 * below is the real thing, genuinely editable, just never attached.
 *
 * WHY THIS FILE RE-EXPORTS THE REAL MODULE RATHER THAN REIMPLEMENTING IT.
 * `@yorkie-js/react`'s dist bundles its OWN copy of `@yorkie-js/sdk` (857 KB,
 * zero external imports) — confirmed by inspecting the published dist, and
 * already documented as a live trap in
 * `packages/frontend/src/types/notes-document.ts`: content created from
 * `@yorkie-js/sdk`'s `Text` is a DIFFERENT CLASS from `@yorkie-js/react`'s
 * `Text`, and `client.attach` (in production) recognizes CRDT values via
 * `instanceof` against its OWN bundled classes. Reimplementing `Document`
 * here would reintroduce that exact class-identity split one level up — this
 * file `export *`s the real module (reached through the `__wb-real` escape
 * specifier `yorkieOffline()` maps back to the genuine package) so every
 * class scene code touches is the SAME one production uses, and only the
 * symbols that assume a live connection are overridden below.
 *
 * ---------------------------------------------------------------------------
 * THE ONE-REALM INVARIANT — the correctness property this whole file rests on.
 *
 * `@yorkie-js/react` does NOT export `Document` (verified: it exports exactly
 * `Counter, Text, Tree, SyncMode` plus the hooks/providers). So the `Document`
 * constructed below can only come from `@yorkie-js/sdk` — the STANDALONE copy,
 * a different realm from the one react bundles.
 *
 * That matters because the SDK's `buildCRDTElement` dispatches on
 * `value instanceof Text` / `instanceof Tree`, and its fallthrough is a
 * SILENT `CRDTObject.create(...)` — not a throw. A CRDT value from the wrong
 * realm is therefore not rejected; it is quietly flattened into a plain
 * object. Measured, on this exact pair of installed packages:
 *
 *   react-realm `new Text()` into an sdk-realm Document
 *     -> root.content becomes {"context":null,"text":null}
 *     -> the next `.edit()` throws "root.content.edit is not a function"
 *
 * — byte-for-byte the symptom `notes-document.ts` warns about. Worse, both
 * `docs-view.tsx#ensureTree` and `notes-view.tsx#ensureText` treat a
 * non-CRDT `root.content` as "needs initializing" and REPLACE it with an
 * empty Tree/Text, so a realm slip does not just fail — it silently wipes
 * whatever fixture was seeded and renders a blank document.
 *
 * The invariant, therefore: EVERY CRDT value class reachable by scene code
 * must come from the SAME realm as the `Document` above — the sdk one. Scene
 * code imports `Tree`/`Text` from `@yorkie-js/react`, which `yorkieOffline()`
 * redirects here, so the re-export below is what enforces it. It deliberately
 * SHADOWS the `export *` (per spec, a local export wins over a star export),
 * flipping those three classes from react's realm to the sdk's.
 *
 * WHY THIS STILL MATCHES PRODUCTION'S RENDER. Both packages are 0.7.13 and
 * react's bundle is a verbatim copy of the same SDK source, so the two realms
 * are behaviourally identical — only their class IDENTITIES differ. Production
 * is uniformly react-realm (its Document comes from react's bundled client);
 * the sandbox is uniformly sdk-realm. Same code, same resulting CRDT, same
 * pixels. What breaks is never "which copy" but MIXING the two, which is
 * exactly what this re-export prevents.
 *
 * `Counter` is included for completeness — no scene constructs one today, but
 * it is the third class `buildCRDTElement` dispatches on, and leaving it in
 * the wrong realm would be a trap primed for whoever adds the first one.
 * ---------------------------------------------------------------------------
 *
 * WHAT IS OVERRIDDEN, AND WHY THOSE FOUR AND NO OTHERS. A repo-wide grep of
 * every `@yorkie-js/react` import in `packages/frontend/src` turns up exactly
 * four runtime symbols in use: `YorkieProvider` (once, in `PrivateRoute.tsx`
 * — the real app shell, which canvas scenes never route through, so it is
 * overridden here for prop-shape parity rather than because scene code reaches
 * it), `DocumentProvider`, `useDocument`, and `usePresences`. Nothing in
 * scope calls `useRoot`, `useConnection`, `useRevisions`, `useRemoveDocument`,
 * `useYorkie`, or `useYorkieDoc` — those pass through via `export *` as the
 * REAL implementations, which read a React Context this file's
 * `DocumentProvider` does not populate (see the real dist's `DocumentContext`
 * / `useDocumentStore` pair). If anything ever calls one, it throws "must be
 * used within a DocumentProvider" — loud and attributable via the frame's
 * error boundary, exactly the "no silent failures" discipline the rest of
 * this package already follows (the `fetch` kill-switch's "a miss is a hard
 * failure" is the same shape of decision). Building no-ops for hooks nothing
 * calls today would be speculative complexity for a case that cannot occur.
 *
 * THE PRESENCE LIMITATION. Presence writes do not stick on a detached
 * document — verified in the same probe: calling `presence.set(...)` inside
 * `doc.update()` leaves `doc.getMyPresence()` empty afterward. `getPresences()`
 * still returns one entry (the local actor, with an empty presence object),
 * which would render as a confusing phantom avatar rather than useful
 * information, so `usePresences()` below always returns `[]` rather than
 * forwarding that entry. Presence is a collaboration surface, not a design
 * one — this sandbox has no use for it, and the honest empty state is less
 * misleading than a blank chip.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  Document,
  StreamConnectionStatus,
  type Indexable,
  type JSONObject,
  type Presence,
} from "@yorkie-js/sdk";
import { seedSheetsFixture } from './seed-sheets.ts';
import { seedDocsFixture } from './seed-docs.ts';
import { seedNotesFixture } from './seed-notes.ts';

// The real `@yorkie-js/react` — SyncMode, the channel hooks, and the
// now-unused-but-still-exported hooks discussed above. See `yorkieOffline()`
// in vite.config.ts for how `__wb-real` resolves.
export * from "@yorkie-js/react/__wb-real";

// THE ONE-REALM INVARIANT (see the header). These three shadow the star
// export above so that every CRDT value scene code constructs shares a realm
// with the `Document` this file creates. Removing this line does not fail
// loudly — it silently degrades seeded content to plain objects, which the
// engines' own `ensureTree`/`ensureText` then overwrite with an empty
// document. `scripts/smoke-canvas.ts` pins it for that reason.
export { Tree, Text, Counter } from "@yorkie-js/sdk";

/**
 * CP4.3 — the canvas fixture seam.
 *
 * A canvas scene's own page (`document-detail.tsx`, `docs-detail.tsx`, ...)
 * is unmodified frontend source, so it always constructs its `Document` with
 * PRODUCTION's `initialRoot` factory (`initialSpreadsheetDocument()`, an
 * empty sheet; `initialDocsRoot()`, one blank paragraph; ...). That is a
 * legitimate but visually uninteresting starting state, so each
 * `seed-<engine>.ts` module (`src/scenes/canvas/`) exports a richer fixture
 * function, keyed here by the exact `docKey` its scene constructs
 * (`sheet-fixture`, `doc-fixture`, `note-fixture` — the manifest's `/s/`,
 * `/d/`, `/n/` fixture routes all resolve `useParams().id === "fixture"`).
 *
 * Mirrors the DOM scenes' own fixture design: plain, URL-keyed data
 * substituted at the boundary a scene can't otherwise reach into
 * (`fetch-fixtures.ts` substitutes at `window.fetch`; this substitutes at
 * `Document` construction, because a canvas scene has no fetch call to
 * intercept for "what does this document contain").
 *
 * IMPORTED DIRECTLY, deliberately not the other way around (a seed module
 * calling into a registration function here). `yorkie-offline.tsx` is
 * ALWAYS resolved to one canonical, unqualified module id — that is the
 * whole point of `yorkieOffline()`'s plugin redirect (see vite.config.ts).
 * A `seed-sheets.ts` that imported FROM here via a relative path would
 * instead resolve through `scenePatch()`'s default frame-query propagation
 * (since a relative specifier doesn't match the plugin's exact-string
 * checks), landing on a SEPARATE, `?wbFrame=`-qualified module instance —
 * a registration written into one `Map` and read from another, silently
 * never found. Importing downward avoids the question entirely: nothing
 * ever needs to reach `yorkie-offline.tsx` except through the one specifier
 * the plugin already owns.
 *
 * `slides-editor` has NO seed, deliberately: `initialSlidesRoot()` returns
 * `{}`, and the ACTUAL shape (theme, one blank slide, layouts) is backfilled
 * by production's own `ensureSlidesRoot()` when `slides-view.tsx` mounts.
 * Hand-constructing a `YorkieSlide`/theme/master/layout tree here would
 * duplicate that logic with no other implementation to check it against, for
 * a nested schema this file has no other reason to know the shape of.
 * Trusting the real initializer is the same "reuse the real code path,
 * substitute only data" rule the rest of this package already follows — it
 * is simply that here, "the real code path" already produces a valid (if
 * plain) result on its own.
 */
const CANVAS_SEEDS: Record<string, (doc: Document<never, never>) => void> = {
  "sheet-fixture": seedSheetsFixture,
  "doc-fixture": seedDocsFixture,
  "note-fixture": seedNotesFixture,
};

export interface DocumentContextType<R, P extends Indexable = Indexable> {
  doc: Document<R, P> | undefined;
  root: JSONObject<R>;
  presences: Array<{ clientID: string; presence: P }>;
  connection: StreamConnectionStatus;
  update: (callback: (root: JSONObject<R>, presence: Presence<P>) => void) => void;
  loading: boolean;
  error: Error | undefined;
}

const OfflineDocumentContext = createContext<DocumentContextType<unknown, Indexable> | undefined>(
  undefined,
);

/**
 * A trivial pass-through. Nothing in scope calls `useYorkie()` (the only hook
 * that would need a context here), so there is nothing to set up — this
 * exists purely so a scene tree CAN mirror the real app's
 * `YorkieProvider > DocumentProvider` nesting if `SceneProviders` (CP4.3)
 * chooses to, for structural parity with `App.tsx`.
 */
export function YorkieProvider({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export interface OfflineDocumentProviderProps<R, P extends Indexable = Indexable> {
  docKey: string;
  initialRoot?: R;
  /** Accepted for prop-shape parity with the real provider; unused — see the presence limitation note above. */
  initialPresence?: P;
  /** Network-only concerns below, accepted and silently ignored. */
  enableDevtools?: boolean;
  syncMode?: unknown;
  documentPollInterval?: number;
  disableGC?: boolean;
  disablePresence?: boolean;
  children?: ReactNode;
}

export function DocumentProvider<R, P extends Indexable = Indexable>({
  docKey,
  initialRoot,
  children,
}: OfflineDocumentProviderProps<R, P>) {
  // ONE stable Document per mounted provider. A `useState` initialiser runs
  // exactly once per component instance — constructing a fresh `Document`
  // (and therefore a fresh identity) on every render would remount whatever
  // engine reads `doc` from context, which is the failure mode this guards
  // against.
  const [doc] = useState(() => {
    const d = new Document<R, P>(docKey);
    if (initialRoot) {
      // Mirrors the real `Client.attach()` path exactly (inspected in the
      // published dist): only keys the CRDT root does not already have get
      // seeded, and the seed is flushed from history afterward so it is not
      // itself an undoable step. The guard is a no-op for an always-fresh
      // document like this one, but keeping it is what makes this a faithful
      // mirror rather than a simplified guess.
      const crdtObject = d.getRootObject();
      const seed = initialRoot as Record<string, unknown>;
      d.update((root) => {
        for (const key of Object.keys(seed)) {
          if (!crdtObject.has(key)) {
            (root as Record<string, unknown>)[key] = seed[key];
          }
        }
      });
      d.clearHistory();
    }
    // The canvas-fixture seed runs UNCONDITIONALLY (no "only unset keys"
    // guard) if this docKey is registered — unlike `initialRoot` above, this
    // is not "fill in defaults for a brand-new document," it is "load this
    // scene's known fixture," and it is meant to REPLACE whatever the
    // page's own initialRoot factory produced. Also flushed from history for
    // the same reason: loading a fixture is not a user edit either.
    const seed = CANVAS_SEEDS[docKey];
    if (seed) {
      seed(d as unknown as Document<never, never>);
      d.clearHistory();
    }
    return d;
  });

  const [root, setRoot] = useState(() => doc.getRoot());

  useEffect(() => {
    // Root changes only. A presence subscription is deliberately omitted:
    // `usePresences()` always returns `[]` (see the file header), so there is
    // nothing for a presence-change event to feed.
    return doc.subscribe(() => setRoot(doc.getRoot()));
  }, [doc]);

  const [error, setError] = useState<Error | undefined>(undefined);

  const update = (callback: (root: JSONObject<R>, presence: Presence<P>) => void) => {
    try {
      doc.update(callback);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to update document"));
    }
  };

  const value: DocumentContextType<R, P> = {
    doc,
    root,
    presences: [],
    connection: StreamConnectionStatus.Disconnected,
    update,
    loading: false,
    error,
  };

  return (
    <OfflineDocumentContext.Provider value={value as DocumentContextType<unknown, Indexable>}>
      {children}
    </OfflineDocumentContext.Provider>
  );
}

export function useDocument<R, P extends Indexable = Indexable>(): DocumentContextType<R, P> {
  const ctx = useContext(OfflineDocumentContext);
  if (!ctx) throw new Error("useDocument must be used within a DocumentProvider");
  return ctx as unknown as DocumentContextType<R, P>;
}

export function usePresences<P extends Indexable = Indexable>(): Array<{
  clientID: string;
  presence: P;
}> {
  const ctx = useContext(OfflineDocumentContext);
  if (!ctx) throw new Error("usePresences must be used within a DocumentProvider");
  return [];
}
