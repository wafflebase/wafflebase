import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { matchPath, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  IconFolder,
  IconLayoutGrid,
  IconSettings,
  IconDatabase,
  IconChartBar,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchWorkspaces,
  fetchAnalyticsEnabled,
  type Workspace,
} from "@/api/workspaces";
import { useEffect, useMemo } from "react";
import { UploadPanel } from "@/app/documents/upload-panel";

/** Declarative route → title mapping. First match wins. */
const ROUTE_TITLES: Array<{ path: string; title: string }> = [
  { path: "/w/:workspaceId/datasources", title: "Data Sources" },
  { path: "/w/:workspaceId/analytics", title: "Analytics" },
  { path: "/w/:workspaceId/analytics/:id", title: "Document Analytics" },
  { path: "/w/:workspaceId/templates", title: "Templates" },
  { path: "/w/:workspaceId/settings", title: "Settings" },
  { path: "/w/:workspaceId", title: "Documents" },
  { path: "/datasources", title: "Data Sources" },
  { path: "/settings", title: "Settings" },
  { path: "/documents", title: "Documents" },
  { path: "/", title: "Documents" },
];

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

  // Hide the Analytics nav entry when the deployment has no analytics
  // warehouse configured (StarRocks unset).
  const { data: analyticsEnabled = false } = useQuery({
    queryKey: ["analytics", "enabled"],
    queryFn: fetchAnalyticsEnabled,
    staleTime: 5 * 60 * 1000,
  });

  const currentWorkspace = workspaces.find(
    (w) => w.slug === workspaceId || w.id === workspaceId,
  );
  const workspaceSlug =
    currentWorkspace?.slug || workspaceId || workspaces[0]?.slug;

  const items = useMemo(() => {
    if (workspaceSlug) {
      return {
        main: [
          {
            title: "Documents",
            url: `/w/${workspaceSlug}`,
            icon: IconFolder,
          },
          {
            title: "Templates",
            url: `/w/${workspaceSlug}/templates`,
            icon: IconLayoutGrid,
          },
          {
            title: "Data Sources",
            url: `/w/${workspaceSlug}/datasources`,
            icon: IconDatabase,
          },
          ...(analyticsEnabled
            ? [
                {
                  title: "Analytics",
                  url: `/w/${workspaceSlug}/analytics`,
                  icon: IconChartBar,
                },
              ]
            : []),
          {
            title: "Settings",
            url: `/w/${workspaceSlug}/settings`,
            icon: IconSettings,
          },
        ],
        secondary: [],
      };
    }

    return {
      main: [
        { title: "Documents", url: "/documents", icon: IconFolder },
        { title: "Data Sources", url: "/datasources", icon: IconDatabase },
        { title: "Settings", url: "/settings", icon: IconSettings },
      ],
      secondary: [],
    };
  }, [workspaceSlug, analyticsEnabled]);

  const title =
    ROUTE_TITLES.find((r) => matchPath(r.path, location.pathname))?.title ?? "";

  useEffect(() => {
    document.title = title ? `${title} — Wafflebase` : "Wafflebase";
  }, [title]);

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
          navigation between Documents / Data Sources / Analytics / Settings,
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
