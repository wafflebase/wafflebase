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
 */

import { useLocation } from "react-router-dom";
import { DebugOverlay } from "./overlay";
import { anonymiseRoute } from "./route";

export function DebugReportMount() {
  const location = useLocation();
  return <DebugOverlay route={anonymiseRoute(location.pathname, location.search)} />;
}

export default DebugReportMount;
