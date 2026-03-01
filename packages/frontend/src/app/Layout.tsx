import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { IconFolder, IconSettings, IconDatabase } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import { useMemo } from "react";

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

  let title = "";
  if (
    location.pathname === "/" ||
    location.pathname === `/w/${workspaceId}` ||
    location.pathname === "/documents"
  ) {
    title = "Documents";
  } else if (
    location.pathname === `/w/${workspaceId}/datasources` ||
    location.pathname === "/datasources"
  ) {
    title = "Data Sources";
  } else if (
    location.pathname === `/w/${workspaceId}/settings` ||
    location.pathname === "/settings"
  ) {
    title = "Settings";
  }

  const handleWorkspaceChange = (slug: string) => {
    if (location.pathname.endsWith("/datasources")) {
      navigate(`/w/${slug}/datasources`);
    } else if (location.pathname.endsWith("/settings")) {
      navigate(`/w/${slug}/settings`);
    } else {
      navigate(`/w/${slug}`);
    }
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
