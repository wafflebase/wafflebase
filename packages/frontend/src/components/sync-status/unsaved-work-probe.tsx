import { useUnsavedWorkProbe } from "./use-unsaved-work-probe";

/**
 * {@link useUnsavedWorkProbe} as a component, for trees that show no chip.
 * Must be rendered inside a `DocumentProvider`.
 *
 * Its own file because `react-refresh/only-export-components` refuses a
 * module that exports both a hook and a component — the same split
 * `navigation-guard` already uses.
 */
export function UnsavedWorkProbe(): null {
  useUnsavedWorkProbe();
  return null;
}
