/**
 * The slides editor needs the width the app sidebar takes: at 1024px the
 * sidebar + thumbnail rail + Format panel left the slide ~295px wide. The
 * hook collapses the sidebar below the breakpoint without touching the
 * user's own choice, which comes back once the viewport is wide again.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { useAutoCollapseSidebar } from "./use-auto-collapse-sidebar";

type Listener = () => void;
const listeners = new Set<Listener>();

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  listeners.forEach((l) => l());
}

beforeEach(() => {
  listeners.clear();
  window.matchMedia = ((query: string) => ({
    get matches() {
      const max = /max-width:\s*(\d+)px/.exec(query);
      return max ? window.innerWidth <= Number(max[1]) : false;
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  document.cookie = "sidebar_state=; path=/; max-age=0";
});

afterEach(() => setViewport(1024));

function Probe() {
  const { open, setOpen } = useSidebar();
  return (
    <>
      <span data-testid="state">{open ? "open" : "closed"}</span>
      <button onClick={() => setOpen(!open)}>toggle</button>
    </>
  );
}

function Host() {
  const sidebar = useAutoCollapseSidebar();
  return (
    <SidebarProvider open={sidebar.open} onOpenChange={sidebar.onOpenChange}>
      <Probe />
    </SidebarProvider>
  );
}

const state = () => screen.getByTestId("state").textContent;

describe("useAutoCollapseSidebar", () => {
  it("collapses below 1280px without writing the sidebar cookie", () => {
    setViewport(1024);
    render(<Host />);
    expect(state()).toBe("closed");
    expect(document.cookie).not.toContain("sidebar_state");
  });

  it("stays open at 1280px and wider", () => {
    setViewport(1280);
    render(<Host />);
    expect(state()).toBe("open");
  });

  it("lets the user expand it while narrow", () => {
    setViewport(1024);
    render(<Host />);
    act(() => screen.getByText("toggle").click());
    expect(state()).toBe("open");
  });

  it("restores the preference when the viewport grows back", () => {
    setViewport(1440);
    render(<Host />);
    act(() => setViewport(1024));
    expect(state()).toBe("closed");
    act(() => setViewport(1440));
    expect(state()).toBe("open");
  });

  it("keeps a wide-viewport collapse across a narrow round trip", () => {
    setViewport(1440);
    render(<Host />);
    act(() => screen.getByText("toggle").click());
    expect(state()).toBe("closed");
    act(() => setViewport(1024));
    act(() => screen.getByText("toggle").click()); // temporary expand
    expect(state()).toBe("open");
    act(() => setViewport(1440));
    expect(state()).toBe("closed");
  });

  it("re-collapses on the next narrow entry after a temporary expand", () => {
    setViewport(1024);
    render(<Host />);
    act(() => screen.getByText("toggle").click());
    act(() => setViewport(1440));
    act(() => setViewport(1024));
    expect(state()).toBe("closed");
  });
});
