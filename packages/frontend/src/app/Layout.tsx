import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { matchPath, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { IconFolder, IconSettings, IconDatabase } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import { useEffect, useMemo } from "react";

/** Declarative route → title mapping. First match wins. */
const ROUTE_TITLES: Array<{ path: string; title: string }> = [
  { path: "/w/:workspaceId/datasources", title: "Data Sources" },
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
            title: "Data Sources",
            url: `/w/${workspaceSlug}/datasources`,
            icon: IconDatabase,
          },
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
  }, [workspaceSlug]);

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
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col h-full">
              <Outlet />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
