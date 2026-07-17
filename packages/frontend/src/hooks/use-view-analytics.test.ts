// jsdom + react-dom is available in this repo's test environment, but
// @testing-library/react's renderHook requires the React "act environment"
// flag to be set, or it throws/warns about updates not wrapped in act().
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sent: { eventType: string; target?: string }[] = [];
vi.mock("@/api/analytics", () => ({
  sendViewEvents: (i: { eventType: string; target?: string }) => sent.push(i),
  getVisitorId: () => "v-1",
  newSessionId: () => "s-1",
}));

import { renderHook, act } from "@testing-library/react";
import { useViewAnalytics } from "./use-view-analytics";

describe("useViewAnalytics", () => {
  beforeEach(() => { sent.length = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("emits open on mount and close on unmount", () => {
    const { unmount } = renderHook(() =>
      useViewAnalytics({ shareToken: "tok", enabled: true }),
    );
    expect(sent.map((s) => s.eventType)).toContain("open");
    act(() => unmount());
    expect(sent.map((s) => s.eventType)).toContain("close");
  });

  it("emits heartbeat on the 30s interval", () => {
    renderHook(() => useViewAnalytics({ shareToken: "tok", enabled: true }));
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(sent.filter((s) => s.eventType === "heartbeat").length).toBeGreaterThanOrEqual(1);
  });

  it("does nothing when disabled", () => {
    renderHook(() => useViewAnalytics({ shareToken: "tok", enabled: false }));
    expect(sent).toHaveLength(0);
  });
});
