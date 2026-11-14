import { IconDotsVertical, IconLogout, IconSun, IconMoon } from "@tabler/icons-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AVATAR_INITIALS_CLASS,
  AVATAR_SIZE_CLASS,
  avatarInitials,
} from "@/components/avatar-size";
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
export function NavUser({ user }: { user: User }) {
  const { isMobile } = useSidebar();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  // The same circle and initials rule as the editor presence stack, so the
  // signed-in user reads as one person across the sidebar and the header.
  const initials = avatarInitials(user.username);
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
              <Avatar className={AVATAR_SIZE_CLASS[32]}>
                {user.photo && (
                  <AvatarImage src={user.photo} alt={user.username} />
                )}
                <AvatarFallback className={AVATAR_INITIALS_CLASS[32]}>
                  {initials}
                </AvatarFallback>
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
                <Avatar className={AVATAR_SIZE_CLASS[32]}>
                  {user.photo && (
                    <AvatarImage src={user.photo} alt={user.username} />
                  )}
                  <AvatarFallback className={AVATAR_INITIALS_CLASS[32]}>
                    {initials}
                  </AvatarFallback>
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
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
