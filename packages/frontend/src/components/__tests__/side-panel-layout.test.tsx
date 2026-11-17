import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useOnePanelOnMobile } from "../side-panel-layout";

function usePanels(isMobile: boolean) {
  const comments = useState(false);
  const history = useState(false);
  useOnePanelOnMobile(isMobile, comments, history);
  return { comments, history };
}

describe("useOnePanelOnMobile", () => {
  it("closes the other panel when one opens on a phone", () => {
    const { result } = renderHook(() => usePanels(true));
    act(() => result.current.comments[1](true));
    act(() => result.current.history[1](true));
    expect(result.current.comments[0]).toBe(false);
    expect(result.current.history[0]).toBe(true);
    act(() => result.current.comments[1](true));
    expect(result.current.comments[0]).toBe(true);
    expect(result.current.history[0]).toBe(false);
  });

  it("keeps both open on desktop, then one once the viewport narrows", () => {
    const { result, rerender } = renderHook(({ m }) => usePanels(m), {
      initialProps: { m: false },
    });
    act(() => result.current.comments[1](true));
    act(() => result.current.history[1](true));
    expect(result.current.comments[0]).toBe(true);
    expect(result.current.history[0]).toBe(true);
    rerender({ m: true });
    expect(result.current.comments[0]).toBe(true);
    expect(result.current.history[0]).toBe(false);
  });
});
