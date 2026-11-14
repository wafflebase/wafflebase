import { Link, useLocation } from "react-router-dom";
import { useCallback } from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { NavItem } from "@/types/nav-items";

/**
 * Rewrite a `/w/<id>/…` pathname to `/w/<slug>/…`.
 *
 * The nav items are built from the workspace's slug, but a workspace route
 * resolves by id as well (an old link, a redirect that only knew the id).
 * Comparing the raw pathname against slug URLs left every item unhighlighted
 * on an id URL, so the comparison runs on the slug form of both.
 */
function canonicalWorkspacePath(
  pathname: string,
  workspace?: { id: string; slug: string },
): string {
  if (!workspace || workspace.id === workspace.slug) return pathname;
  const idRoot = `/w/${workspace.id}`;
  if (pathname === idRoot || pathname.startsWith(idRoot + "/")) {
    return `/w/${workspace.slug}` + pathname.slice(idRoot.length);
  }
  return pathname;
}

/**
 * Renders the NavMain component.
 */
export function NavMain({
  items,
  workspace,
}: {
  items: Array<NavItem>;
  /** The workspace the items are scoped to, so an id URL still matches. */
  workspace?: { id: string; slug: string };
}) {
  const location = useLocation();
  const { setOpenMobile, isMobile } = useSidebar();

  const isActive = useCallback(
    (url: string, allUrls: string[]) => {
      const pathname = canonicalWorkspacePath(location.pathname, workspace);
      if (pathname === url) return true;
      if (!pathname.startsWith(url + "/")) return false;
      // If another nav item's URL is a more specific match, this one is not active.
      return !allUrls.some(
        (other) =>
          other !== url &&
          other.startsWith(url + "/") &&
          (pathname === other || pathname.startsWith(other + "/")),
      );
    },
    [location.pathname, workspace],
  );

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                tooltip={item.title}
                isActive={isActive(
                  item.url,
                  items.map((i) => i.url),
                )}
              >
                <Link
                  to={item.url}
                  onClick={() => {
                    if (isMobile) setOpenMobile(false);
                  }}
                >
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
