/**
 * Where the overlay attaches to the app.
 *
 * Inside the Router and OUTSIDE `Routes`, next to `<AnalyticsTracker />`: inside
 * so it can read the route, outside so it covers every editor surface without a
 * route entry of its own (`/d/:id`, `/p/:id`, `/s/:id`, `/b/:id` and `/n/:id`
 * are siblings under `Layout`, so anything mounted per-route would miss some of
 * them). The pattern is `analytics.tsx`, which is 31 lines for the same reason.
 *
 * DEV-gated at the import site in `App.tsx`, so none of this reaches a
 * production bundle until the deployed path exists (SP2).
 *
 * THIS FILE IS THE WHOLE WAFFLEBASE-SPECIFIC SURFACE of the reporter. The
 * overlay, the panel and the transport are `@wafflebase/debug-report/react`;
 * what an application has to supply is its route rules and its canvas locator,
 * and both arrive here as arguments.
 */

import { useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  createDevHost,
  DebugOverlay,
  DEBUG_SESSION_ID,
} from "@wafflebase/debug-report/react";
import { anonymiseRoute } from "./route";
import { locateOnSurface } from "./locate-surface";

export function DebugReportMount() {
  const location = useLocation();
  const route = anonymiseRoute(location.pathname, location.search);
  // The route is read on every render, so the host reads it through a ref-free
  // closure over the latest value rather than being rebuilt — rebuilding it
  // would restart the panel's drafting effect on every navigation.
  const routeRef = useRef(route);
  routeRef.current = route;
  const host = useMemo(() => createDevHost({ route: () => routeRef.current }), []);
  return (
    <DebugOverlay
      route={route}
      host={host}
      sessionId={DEBUG_SESSION_ID}
      locateOnCanvas={locateOnSurface}
    />
  );
}

export default DebugReportMount;
