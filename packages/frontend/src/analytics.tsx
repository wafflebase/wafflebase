import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { redactCapabilityTokens } from "@/lib/redact-url";

type GtagFn = (
  command: "event" | "config" | "js" | "set",
  ...args: unknown[]
) => void;

declare global {
  interface Window {
    gtag?: GtagFn;
  }
}

const GA_ID = import.meta.env.VITE_GA_ID as string | undefined;

export function AnalyticsTracker() {
  const location = useLocation();

  useEffect(() => {
    if (!GA_ID || typeof window.gtag !== "function") return;
    // `/shared/:token` and `/invite/:token` ARE credentials, so the raw path
    // must not be reported: a page_view would hand the whole capability to
    // Google, where it is retained and queryable. Same helper, and the same
    // reasoning, as the Sentry scrubber in `sentry.ts`.
    const pagePath = redactCapabilityTokens(
      location.pathname + location.search
    );
    window.gtag("event", "page_view", {
      page_path: pagePath,
      page_location: redactCapabilityTokens(window.location.href),
      page_title: document.title,
    });
  }, [location]);

  return null;
}
