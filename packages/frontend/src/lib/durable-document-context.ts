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
