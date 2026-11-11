import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LinkHoverCloseDelayMS, useLinkHoverCard } from "./use-link-hover-card";

/**
 * The card's lifecycle is driven by two sources that disagree about where the
 * pointer is: the engine, which only sees the grid's scroll container, and the
 * card itself. The case that matters is the order the browser delivers them
 * in when the pointer moves from a link cell into the card — the card's
 * `pointerenter` first, then the scroll container's `mouseleave`, which the
 * engine reports as `null` (#1124).
 */
const cellA = { sref: "C2", urls: ["https://www.naver.com/"] };
const cellB = { sref: "D5", urls: ["https://chatgpt.com/"] };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const elapse = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe("useLinkHoverCard", () => {
  it("opens on the cell the engine reports", () => {
    const { result } = renderHook(() => useLinkHoverCard());

    act(() => result.current.onEngineLinkHover(cellA));

    expect(result.current.linkHover).toEqual(cellA);
  });

  it("closes after the delay once the pointer leaves the cell", () => {
    const { result } = renderHook(() => useLinkHoverCard());
    act(() => result.current.onEngineLinkHover(cellA));

    act(() => result.current.onEngineLinkHover(null));
    elapse(LinkHoverCloseDelayMS - 1);
    expect(result.current.linkHover).toEqual(cellA);

    elapse(1);
    expect(result.current.linkHover).toBeNull();
  });

  it("stays open when the pointer crosses the gap into the card", () => {
    const { result } = renderHook(() => useLinkHoverCard());
    act(() => result.current.onEngineLinkHover(cellA));

    act(() => result.current.onEngineLinkHover(null));
    act(() => result.current.onCardPointerEnter());
    elapse(LinkHoverCloseDelayMS * 4);

    expect(result.current.linkHover).toEqual(cellA);
  });

  it("stays open when the grid's leave is reported after the card's enter", () => {
    const { result } = renderHook(() => useLinkHoverCard());
    act(() => result.current.onEngineLinkHover(cellA));

    // Straight from the cell into the card: `pointerenter` on the card, then
    // `mouseleave` on the scroll container → `resetLinkHover` → `null`.
    act(() => result.current.onCardPointerEnter());
    act(() => result.current.onEngineLinkHover(null));
    elapse(LinkHoverCloseDelayMS * 4);

    expect(result.current.linkHover).toEqual(cellA);
  });

  it("closes after the delay once the pointer leaves the card", () => {
    const { result } = renderHook(() => useLinkHoverCard());
    act(() => result.current.onEngineLinkHover(cellA));
    act(() => result.current.onCardPointerEnter());
    act(() => result.current.onEngineLinkHover(null));

    act(() => result.current.onCardPointerLeave());
    elapse(LinkHoverCloseDelayMS);

    expect(result.current.linkHover).toBeNull();
  });

  it("keeps the card when the pointer leaves it back onto the link cell", () => {
    const { result } = renderHook(() => useLinkHoverCard());
    act(() => result.current.onEngineLinkHover(cellA));
    act(() => result.current.onCardPointerEnter());

    act(() => result.current.onCardPointerLeave());
    act(() => result.current.onEngineLinkHover(cellA));
    elapse(LinkHoverCloseDelayMS * 4);

    expect(result.current.linkHover).toEqual(cellA);
  });

  it("forgets the pointer was in the card once the card has closed", () => {
    const { result } = renderHook(() => useLinkHoverCard());
    act(() => result.current.onEngineLinkHover(cellA));
    act(() => result.current.onCardPointerEnter());
    act(() => result.current.dismiss());

    act(() => result.current.onEngineLinkHover(cellB));
    act(() => result.current.onEngineLinkHover(null));
    elapse(LinkHoverCloseDelayMS);

    expect(result.current.linkHover).toBeNull();
  });

  it("dismisses at once and drops a pending close", () => {
    const { result } = renderHook(() => useLinkHoverCard());
    act(() => result.current.onEngineLinkHover(cellA));
    act(() => result.current.onEngineLinkHover(null));

    act(() => result.current.dismiss());
    expect(result.current.linkHover).toBeNull();

    act(() => result.current.onEngineLinkHover(cellB));
    elapse(LinkHoverCloseDelayMS * 4);
    expect(result.current.linkHover).toEqual(cellB);
  });
});
