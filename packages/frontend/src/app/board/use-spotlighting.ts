import { useEffect, useState } from "react";
import type { BoardPresenceController } from "./board-presence";

/** Whether this user is spotlighting, kept in sync with presence. */
export function useSpotlighting(presence: BoardPresenceController | null): boolean {
  const [on, setOn] = useState(() => presence?.isSpotlighting() ?? false);
  useEffect(() => {
    if (!presence) return;
    setOn(presence.isSpotlighting());
    return presence.subscribe(() => setOn(presence.isSpotlighting()));
  }, [presence]);
  return on;
}
