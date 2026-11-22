import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import { useEffect } from "react";
import { useWorkspaceNavItems } from "@/hooks/use-workspace-nav-items";
import { routeTitle } from "@/app/route-titles";
import { UploadPanel } from "@/app/documents/upload-panel";

/**
 * Renders the root app layout and providers.
 */
export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
  });

  const currentWorkspace = workspaces.find(
    (w) => w.slug === workspaceId || w.id === workspaceId,
  );
  const workspaceSlug =
    currentWorkspace?.slug || workspaceId || workspaces[0]?.slug;

  const items = useWorkspaceNavItems(workspaceSlug);

  const { title, pageOwnsTab } = routeTitle(location.pathname);

  useEffect(() => {
    if (pageOwnsTab) return;
    document.title = title ? `${title} — Wafflebase` : "Wafflebase";
  }, [title, pageOwnsTab]);

  // Clean up stale pointer-events style on body when Layout unmounts.
  // Radix UI Sheet (mobile sidebar) sets pointer-events: none on <body>
  // while open. If Layout unmounts during the Sheet close animation
  // (e.g. navigating to /:id which is outside Layout), the cleanup
  // callback never fires and clicks stay blocked permanently.
  useEffect(() => {
    return () => {
      document.body.style.removeProperty("pointer-events");
    };
  }, []);

  const handleWorkspaceChange = (slug: string) => {
    navigate(`/w/${slug}`);
  };

  return (
    <SidebarProvider>
      <AppSidebar
        variant="inset"
        items={items}
        workspaces={workspaces}
        currentWorkspace={currentWorkspace}
        onWorkspaceChange={handleWorkspaceChange}
      />
      <SidebarInset>
        <SiteHeader title={title} />
        <div className="flex flex-1 flex-col min-h-0 overflow-y-auto">
          <Outlet />
        </div>
      </SidebarInset>
      {/* The upload queue is an app-scoped module singleton, so its panel
          belongs to the shell, not to any one page. Rendered here it survives
          navigation between Documents / Chat / Analytics / Settings,
          so a background import (a Miro board can run for a minute) stays
          visible while the user works elsewhere — the whole point of moving
          that work off the modal.

          Deliberately NOT at the router root: the editor routes (/b/:id and
          friends) sit outside this Layout, and the board's minimap already
          owns the bottom-right corner this panel would land on. */}
      <UploadPanel />
    </SidebarProvider>
  );
}
