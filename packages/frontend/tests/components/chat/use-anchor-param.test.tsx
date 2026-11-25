import { act, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { encodeAnchor } from "@/components/chat/document-link";
import { useAnchorParam } from "@/components/chat/use-anchor-param";

const slide = (slideId: string) => encodeAnchor({ slideId });

function setup(url: string, ready = true) {
  const apply = vi.fn();
  let navigate!: ReturnType<typeof useNavigate>;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  const hook = renderHook(
    ({ ready }: { ready: boolean }) => {
      navigate = useNavigate();
      useAnchorParam("slides", ready, apply);
    },
    { wrapper, initialProps: { ready } },
  );
  return { apply, hook, go: (to: string) => act(() => navigate(to)) };
}

describe("useAnchorParam", () => {
  it("applies a decoded anchor once, however often the page re-renders", () => {
    const { apply, hook } = setup(`/p/d1?at=${slide("s2")}`);
    hook.rerender({ ready: true });
    hook.rerender({ ready: true });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ slideId: "s2" });
  });

  it("waits until the editor is ready", () => {
    const { apply, hook } = setup(`/p/d1?at=${slide("s2")}`, false);
    expect(apply).not.toHaveBeenCalled();
    hook.rerender({ ready: true });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("applies a new value, not the same one again", () => {
    const { apply, go } = setup(`/p/d1?at=${slide("s2")}`);
    go(`/p/d1?at=${slide("s3")}&chat=c1`);
    go(`/p/d1?at=${slide("s3")}`);
    expect(apply.mock.calls.map(([a]) => a.slideId)).toEqual(["s2", "s3"]);
  });

  it("ignores garbage and another type's anchor", () => {
    const sheet = encodeAnchor({ tabId: "t", rowId: "r", colId: "c", rowSpan: 1, colSpan: 1 });
    expect(setup("/p/d1?at=%%%").apply).not.toHaveBeenCalled();
    expect(setup(`/p/d1?at=${sheet}`).apply).not.toHaveBeenCalled();
    expect(setup("/p/d1").apply).not.toHaveBeenCalled();
  });
});
