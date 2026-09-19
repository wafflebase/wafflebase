import { createContext, createElement, useContext, type ReactNode } from "react";
import type { WafflebaseDocStore } from "./wafflebase-doc-store";

/**
 * What the durable client publishes to the view under it.
 *
 * Design: `docs/design/offline-local-persistence.md` § The chip.
 *
 * Two consumers, and they need different halves of it: the loss watch needs
 * the store, so it can tell it which removals are losses, and the sync chip
 * needs the boolean, because `saved-locally` — the one row this feature
 * changes, and in the design's words its entire user-facing value — is
 * unreachable without it.
 *
 * A module of its own rather than an export of `durable-yorkie-provider.tsx`
 * so that reading durability costs nothing but React: the chip is mounted on
 * every editor, including the ones that never persist, and it should not have
 * to pull the Yorkie provider in to ask.
 */
export interface DurableDocumentValue {
  /** The store this document's client is writing through. */
  store: WafflebaseDocStore;
  /**
   * Whether unsent work for this document is actually on this device's disk.
   *
   * True while the durable client is mounted and nothing has told us
   * otherwise; false once the SDK reports that it dropped local changes, since
   * from then on the entry the chip would be promising has been removed.
   */
  durable: boolean;
  /** Called when the SDK reports that it gave up on local work. */
  reportLoss(): void;
  /**
   * Called when the SDK reports that it has stopped persisting this document —
   * its snapshot is too large or too slow to write. Distinct from a loss:
   * nothing was dropped, so nothing is archived; the document simply is not on
   * disk any more and the chip must stop saying it is.
   */
  reportPersistDisabled(): void;
}

const DurableDocumentContext = createContext<DurableDocumentValue | undefined>(
  undefined,
);

/**
 * Publishes a durable document's store and status to everything under it.
 *
 * `createElement` rather than JSX so this stays a `.ts` module — see the note
 * on the file above.
 */
export function DurableDocumentScope({
  value,
  children,
}: {
  value: DurableDocumentValue;
  children: ReactNode;
}) {
  return createElement(DurableDocumentContext.Provider, { value }, children);
}

/** The durable client's context, or `undefined` on every non-durable document. */
export function useDurableDocumentContext(): DurableDocumentValue | undefined {
  return useContext(DurableDocumentContext);
}

/**
 * Whether this document's unsent work is on disk.
 *
 * Deliberately answers `false` outside a durable client rather than throwing:
 * the chip is mounted on every editor, and the overwhelmingly common case —
 * the opt-in declined — must read as today's behavior with no caller change.
 */
export function useDocumentDurability(): boolean {
  return useContext(DurableDocumentContext)?.durable ?? false;
}

/**
 * Why this document's unsent work is not on disk.
 *
 * `docs/design/offline-local-persistence.md` § What the user sees gives a row
 * per cause and then requires: "Its tooltip must name which case applies."
 * Every row collapses to the same chip state, so the reason is the only thing
 * that differs — and the user always learns *that* the guarantee lapsed even
 * when the cause is one we did not anticipate.
 *
 * Published from two places, because no single one knows them all.
 * `CollabDocumentProvider` knows why it never mounted a durable client at all;
 * `DurableYorkieProvider` knows what went wrong under one it did mount, and
 * being nested, its value wins.
 */
export type DurabilityLapse =
  /** The pinned `@yorkie-js/react` cannot carry a client key. */
  | "unsupported"
  /** A share link, or another subtree that must never persist. */
  | "not-permitted"
  /** Offline saving is switched off on this device. */
  | "not-enabled"
  /** Another tab won the election and is the one saving. */
  | "another-tab"
  /** The SDK gave up on reconciling work that was already stored. */
  | "dropped"
  /** The document is too large or too slow to snapshot. */
  | "too-large"
  /** The origin is out of storage, even after eviction. */
  | "out-of-space"
  /** The store is refusing writes for some other reason. */
  | "write-failed";

const DurabilityLapseContext = createContext<DurabilityLapse | undefined>(
  undefined,
);

/**
 * Publishes why durability lapsed (or `undefined` while it has not).
 *
 * A nested scope with **no** answer inherits the enclosing one rather than
 * blanking it. Two scopes are mounted on a durable document —
 * `CollabDocumentProvider`'s and, under it, `DurableYorkieProvider`'s — and the
 * rule the design states is that the deeper one wins *where it has an answer*.
 * Read literally, `value: lapse` made "no answer" an answer: whichever scope
 * happened to be innermost erased the other's reason, silently and with nothing
 * to observe it by. Inheriting is what makes the documented rule the
 * implemented one no matter which way round the two end up nested.
 */
export function DurabilityLapseScope({
  lapse,
  children,
}: {
  lapse?: DurabilityLapse;
  children: ReactNode;
}) {
  const inherited = useContext(DurabilityLapseContext);
  return createElement(
    DurabilityLapseContext.Provider,
    { value: lapse ?? inherited },
    children,
  );
}

/**
 * Why durability lapsed here, or `undefined` when it has not — which is also
 * the answer anywhere the scope was never mounted, so the chip degrades to its
 * pre-offline wording rather than inventing a cause.
 */
export function useDurabilityLapse(): DurabilityLapse | undefined {
  return useContext(DurabilityLapseContext);
}
