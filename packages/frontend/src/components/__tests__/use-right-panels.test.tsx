import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRightPanels } from "../use-right-panels";

function open(result: { current: ReturnType<typeof useRightPanels> }) {
  const { commentsOpen, historyOpen, chatOpen } = result.current;
  return { comments: commentsOpen, history: historyOpen, chat: chatOpen };
}

describe("useRightPanels", () => {
  it("starts with every panel closed", () => {
    const { result } = renderHook(() => useRightPanels(false));
    expect(open(result)).toEqual({ comments: false, history: false, chat: false });
  });

  it("closes comments and history when chat opens", () => {
    const { result } = renderHook(() => useRightPanels(false));
    act(() => result.current.setCommentsOpen(true));
    act(() => result.current.setHistoryOpen(true));
    act(() => result.current.setChatOpen(true));
    expect(open(result)).toEqual({ comments: false, history: false, chat: true });
  });

  it("closes chat when comments or history opens", () => {
    const { result } = renderHook(() => useRightPanels(false));
    act(() => result.current.setChatOpen(true));
    act(() => result.current.setCommentsOpen(true));
    expect(open(result)).toEqual({ comments: true, history: false, chat: false });

    act(() => result.current.setChatOpen(true));
    act(() => result.current.setHistoryOpen(true));
    expect(open(result)).toEqual({ comments: false, history: true, chat: false });
  });

  it("keeps comments and history open together on desktop", () => {
    const { result } = renderHook(() => useRightPanels(false));
    act(() => result.current.setCommentsOpen(true));
    act(() => result.current.setHistoryOpen(true));
    expect(open(result)).toEqual({ comments: true, history: true, chat: false });
  });

  it("keeps only the latest of comments and history on a phone", () => {
    const { result } = renderHook(() => useRightPanels(true));
    act(() => result.current.setCommentsOpen(true));
    act(() => result.current.setHistoryOpen(true));
    expect(open(result)).toEqual({ comments: false, history: true, chat: false });
  });

  it("accepts an updater, as useState's setter does", () => {
    const { result } = renderHook(() => useRightPanels(false));
    act(() => result.current.setCommentsOpen((v) => !v));
    expect(result.current.commentsOpen).toBe(true);
    act(() => result.current.setChatOpen(true));
    act(() => result.current.setChatOpen((v) => !v));
    expect(open(result)).toEqual({ comments: false, history: false, chat: false });
  });

  it("closing a panel leaves the others alone", () => {
    const { result } = renderHook(() => useRightPanels(false));
    act(() => result.current.setCommentsOpen(true));
    act(() => result.current.setHistoryOpen(true));
    act(() => result.current.setHistoryOpen(false));
    expect(open(result)).toEqual({ comments: true, history: false, chat: false });
  });

  it("keeps setter identity across renders", () => {
    const { result, rerender } = renderHook(() => useRightPanels(false));
    const first = result.current;
    act(() => result.current.setCommentsOpen(true));
    rerender();
    expect(result.current.setCommentsOpen).toBe(first.setCommentsOpen);
    expect(result.current.setChatOpen).toBe(first.setChatOpen);
  });
});
