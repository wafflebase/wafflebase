import { useEffect } from "react";
import { useLocation } from "react-router-dom";

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
    const pagePath = location.pathname + location.search;
    window.gtag("event", "page_view", {
      page_path: pagePath,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [location]);

  return null;
}
