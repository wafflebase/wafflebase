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

  const currentWorkspaceId = workspaceId || workspaces[0]?.id;

  const items = useMemo(() => {
    if (currentWorkspaceId) {
      return {
        main: [
          {
            title: "Documents",
            url: `/w/${currentWorkspaceId}`,
            icon: IconFolder,
          },
          {
            title: "Data Sources",
            url: `/w/${currentWorkspaceId}/datasources`,
            icon: IconDatabase,
          },
        ],
        secondary: [
          {
            title: "Settings",
            url: `/w/${currentWorkspaceId}/settings`,
            icon: IconSettings,
          },
        ],
      };
    }

    return {
      main: [
        { title: "Documents", url: "/documents", icon: IconFolder },
        { title: "Data Sources", url: "/datasources", icon: IconDatabase },
      ],
      secondary: [
        { title: "Settings", url: "/settings", icon: IconSettings },
      ],
    };
  }, [currentWorkspaceId]);

  const currentWorkspace = workspaces.find(
    (w) => w.id === currentWorkspaceId,
  );

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

  const handleWorkspaceChange = (id: string) => {
    // Determine the current sub-path and navigate to the same page in the new workspace
    if (location.pathname.endsWith("/datasources")) {
      navigate(`/w/${id}/datasources`);
    } else if (location.pathname.endsWith("/settings")) {
      navigate(`/w/${id}/settings`);
    } else {
      navigate(`/w/${id}`);
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
