import { useEffect, useRef } from "react";
import {
  getVisitorId,
  newSessionId,
  sendViewEvents,
  type ViewEventType,
} from "@/api/analytics";

const HEARTBEAT_MS = 30_000;

interface Options {
  shareToken: string;
  enabled: boolean;
  /** Current tab/slide identifier; a change emits a `tabchange` event. */
  target?: string;
}

/**
 * Records a share-link viewing session: open on mount, periodic heartbeat
 * while the tab is visible, tabchange on target change, and close (via
 * sendBeacon) on teardown. All sends are fire-and-forget.
 */
export function useViewAnalytics({ shareToken, enabled, target }: Options): void {
  const sessionRef = useRef<string>("");
  const visitorRef = useRef<string>("");
  const lastTarget = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!enabled || !shareToken) return;
    const sessionId = newSessionId();
    const visitorId = getVisitorId();
    sessionRef.current = sessionId;
    visitorRef.current = visitorId;
    lastTarget.current = target;

    const emit = (eventType: ViewEventType, beacon = false) =>
      sendViewEvents({
        shareToken,
        sessionId,
        visitorId,
        eventType,
        target: lastTarget.current,
        beacon,
      });

    emit("open");

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") emit("heartbeat");
    }, HEARTBEAT_MS);

    const onHide = () => emit("close", true);
    window.addEventListener("pagehide", onHide);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", onHide);
      emit("close", true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareToken, enabled]);

  // Emit tabchange when the target changes within an open session.
  useEffect(() => {
    if (!enabled || !sessionRef.current) return;
    if (target === lastTarget.current) return;
    lastTarget.current = target;
    sendViewEvents({
      shareToken,
      sessionId: sessionRef.current,
      visitorId: visitorRef.current,
      eventType: "tabchange",
      target,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
}
