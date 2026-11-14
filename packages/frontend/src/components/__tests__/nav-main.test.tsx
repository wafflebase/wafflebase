/**
 * The sidebar highlights the current page whether the workspace URL carries
 * its slug or its id. The items are built from the slug, so before the fix an
 * id URL (`/w/<uuid>/settings`) left every item unhighlighted.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { NavMain } from "@/components/nav-main";
import { TooltipProvider } from "@/components/ui/tooltip";

// jsdom ships no matchMedia; `SidebarProvider` reads it via `useIsMobile()`.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const workspace = { id: "6f1c0d2e-uuid", slug: "team" };
const Icon = () => null;
const items = [
  { title: "Documents", url: "/w/team", icon: Icon },
  { title: "Trash", url: "/w/team/trash", icon: Icon },
  { title: "Settings", url: "/w/team/settings", icon: Icon },
];

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <SidebarProvider>
          <NavMain items={items} workspace={workspace} />
        </SidebarProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
  return (title: string) =>
    screen.getByRole("link", { name: title }).getAttribute("data-active");
}

describe("NavMain active state", () => {
  it("highlights the item on a slug URL", () => {
    const active = renderAt("/w/team/settings");
    expect(active("Settings")).toBe("true");
    expect(active("Documents")).toBe("false");
  });

  it("highlights the same item on an id URL", () => {
    const active = renderAt(`/w/${workspace.id}/settings`);
    expect(active("Settings")).toBe("true");
    expect(active("Documents")).toBe("false");
  });

  it("highlights Documents on the bare id root, not a sibling", () => {
    const active = renderAt(`/w/${workspace.id}`);
    expect(active("Documents")).toBe("true");
    expect(active("Trash")).toBe("false");
  });

  it("does not rewrite a different workspace's id", () => {
    const active = renderAt("/w/other-id/settings");
    expect(active("Settings")).toBe("false");
  });
});
