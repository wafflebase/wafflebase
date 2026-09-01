import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconChartBar,
  IconDatabase,
  IconFolder,
  IconLayoutGrid,
  IconSettings,
} from "@tabler/icons-react";
import { fetchAnalyticsEnabled } from "@/api/workspaces";
import type { NavItem } from "@/types/nav-items";

export interface NavItems {
  main: Array<NavItem>;
  secondary: Array<NavItem>;
}

/**
 * The app sidebar's workspace navigation, as one list.
 *
 * The editor routes (`/s/:id`, `/d/:id`, …) sit outside `app/Layout.tsx`, so
 * each mounts its own `AppSidebar`. They used to build this list inline, which
 * is how Templates and Analytics ended up visible on the workspace routes and
 * nowhere else. Everything that renders `AppSidebar` reads it from here now.
 *
 * `workspaceSlug` is undefined until the current workspace resolves (an editor
 * learns it from the document it just fetched). That fallback keeps the
 * workspace-less `/documents` · `/datasources` · `/settings` routes, and omits
 * Templates and Analytics because they exist only under `/w/:workspaceId`.
 */
export function useWorkspaceNavItems(workspaceSlug?: string): NavItems {
  // Hide the Analytics entry when the deployment has no analytics warehouse
  // configured (StarRocks unset). Shared by react-query key across every
  // shell, so mounting an editor costs no extra request.
  const { data: analyticsEnabled = false } = useQuery({
    queryKey: ["analytics", "enabled"],
    queryFn: fetchAnalyticsEnabled,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    if (!workspaceSlug) {
      return {
        main: [
          { title: "Documents", url: "/documents", icon: IconFolder },
          { title: "Data Sources", url: "/datasources", icon: IconDatabase },
          { title: "Settings", url: "/settings", icon: IconSettings },
        ],
        secondary: [],
      };
    }

    const root = `/w/${workspaceSlug}`;
    return {
      main: [
        { title: "Documents", url: root, icon: IconFolder },
        { title: "Templates", url: `${root}/templates`, icon: IconLayoutGrid },
        {
          title: "Data Sources",
          url: `${root}/datasources`,
          icon: IconDatabase,
        },
        ...(analyticsEnabled
          ? [
              {
                title: "Analytics",
                url: `${root}/analytics`,
                icon: IconChartBar,
              },
            ]
          : []),
        { title: "Settings", url: `${root}/settings`, icon: IconSettings },
      ],
      secondary: [],
    };
  }, [workspaceSlug, analyticsEnabled]);
}
