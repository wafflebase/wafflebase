import { lazy, Suspense, type ComponentProps } from "react";

const HistoryPanelImpl = lazy(() =>
  import("./history-panel").then((module) => ({
    default: module.HistoryPanel,
  })),
);

/**
 * Code-split wrapper around {@link import('./history-panel').HistoryPanel}.
 *
 * The panel is the *only* consumer of `@radix-ui/react-alert-dialog` and
 * `@radix-ui/react-scroll-area` in the app. Imported statically by the five
 * editor routes — which is how it started — both libraries would ship in
 * every editor chunk even on the majority of visits where the panel is
 * never opened. `RevisionPreviewOverlay` was already lazy for the same
 * reason (it pulls in three engine packages); this makes the panel match.
 *
 * The five call sites import this rather than each declaring their own
 * `lazy()`, so all five share one chunk instead of five.
 */
export function LazyHistoryPanel(
  props: ComponentProps<typeof HistoryPanelImpl>,
) {
  return (
    <Suspense fallback={null}>
      <HistoryPanelImpl {...props} />
    </Suspense>
  );
}

export default LazyHistoryPanel;
