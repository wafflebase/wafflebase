import { Link, useLocation } from "react-router-dom";
import { useCallback } from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { NavItem } from "@/types/nav-items";

/**
 * Renders the NavMain component.
 */
export function NavMain({ items }: { items: Array<NavItem> }) {
  const location = useLocation();

  const isActive = useCallback(
    (url: string, allUrls: string[]) => {
      const pathname = location.pathname;
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
    [location.pathname],
  );

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={isActive(
                  item.url,
                  items.map((i) => i.url),
                )}
              >
                <Link to={item.url} className="flex items-center gap-2">
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
