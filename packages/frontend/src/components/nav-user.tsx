import { useState } from "react";
import {
  IconDotsVertical,
  IconLogout,
  IconSettings,
  IconSun,
  IconMoon,
} from "@tabler/icons-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SettingsDialog } from "@/components/settings-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useTheme } from "@/components/theme-provider";
import { logout } from "@/api/auth";
import { User } from "@/types/users";

/**
 * Renders the NavUser component.
 */
function getInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function NavUser({ user }: { user: User }) {
  const { isMobile } = useSidebar();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const initials = getInitials(user.username);
  // Held here rather than inside the dialog: the menu unmounts on select and
  // takes focus with it, which closes a dialog whose open state it owns.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const handleLogout = async () => {
    await logout();
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground cursor-pointer"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.photo} alt={user.username} />
                <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.username}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {user.email}
                </span>
              </div>
              <IconDotsVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={user.photo} alt={user.username} />
                  <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.username}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* This device's settings — appearance, dates, offline saving.
                The sidebar's Settings is the workspace's, a different page
                about a different thing; the two are told apart by which
                surface they hang off rather than by their names. Before the
                split there was one entry for both, and which one it reached
                depended on whether the route had resolved a workspace. */}
            <DropdownMenuItem
              onClick={() => setSettingsOpen(true)}
              className="cursor-pointer"
            >
              <IconSettings />
              Settings
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem
              checked={isDark}
              onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
              onSelect={(e) => e.preventDefault()}
              className="cursor-pointer"
            >
              {isDark ? <IconMoon className="size-4" /> : <IconSun className="size-4" />}
              Dark mode
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
              <IconLogout />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Outside the menu, which has unmounted by the time this is open. */}
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
