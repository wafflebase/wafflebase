import { useSyncExternalStore } from "react";
import { getSnapshot, subscribe, type UploadItem } from "./upload-queue";

/**
 * Subscribe a component to the module-level upload queue.
 *
 * Uses `useSyncExternalStore` (not the `useState + useEffect` pattern) so a
 * mutation emitted between render and effect-subscription can't be missed:
 * the store's `getSnapshot` returns a stable array reference that only changes
 * on a real mutation, exactly what this hook requires.
 */
export function useUploadQueue(): readonly UploadItem[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}
