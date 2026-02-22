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
    (url: string) => {
      const pathname = location.pathname;
      return pathname === url || pathname.startsWith(url + "/");
    },
    [location.pathname]
  );

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={isActive(item.url)}
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
