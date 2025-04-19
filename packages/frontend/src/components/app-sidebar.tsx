import * as React from "react";
import { Link } from "react-router-dom";
import { IconInnerShadowTop } from "@tabler/icons-react";

import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { NavItem } from "@/types/nav-items";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/api/auth";

export function AppSidebar({
  items,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  items: {
    main: Array<NavItem>;
    secondary: Array<NavItem>;
  };
}) {
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  });

  if (isLoading) {
    return null;
  }

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <Link to="/">
                <IconInnerShadowTop className="!size-5" />
                <span className="text-base font-semibold">Wafflebase</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={items.main} />
        <NavSecondary items={items.secondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={me!} />
      </SidebarFooter>
    </Sidebar>
  );
}
