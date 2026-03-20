import * as React from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronsUpDown, Grid2x2PlusIcon, PlusIcon } from "lucide-react";

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
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NavItem } from "@/types/nav-items";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchMe } from "@/api/auth";
import type { Workspace } from "@/api/workspaces";
import { createWorkspace } from "@/api/workspaces";

/**
 * Renders the AppSidebar component.
 */
export function AppSidebar({
  items,
  workspaces,
  currentWorkspace,
  onWorkspaceChange,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  items: {
    main: Array<NavItem>;
    secondary: Array<NavItem>;
  };
  workspaces?: Workspace[];
  currentWorkspace?: Workspace;
  onWorkspaceChange?: (id: string) => void;
}) {
  const { setOpenMobile, isMobile } = useSidebar();
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const queryClient = useQueryClient();
  const createWorkspaceMutation = useMutation({
    mutationFn: (name: string) => createWorkspace({ name }),
    onSuccess: (ws) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      onWorkspaceChange?.(ws.slug);
      setDialogOpen(false);
      setNewName("");
    },
  });

  const handleCreateSubmit = () => {
    const trimmed = newName.trim();
    if (trimmed) {
      createWorkspaceMutation.mutate(trimmed);
    }
  };

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
                <Grid2x2PlusIcon className="!size-5" />
                <span className="text-base font-semibold">Wafflebase</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {workspaces && workspaces.length > 0 && (
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="w-full justify-between">
                    <span className="truncate text-sm">
                      {currentWorkspace?.name || "Select workspace"}
                    </span>
                    <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {workspaces.map((ws) => (
                    <DropdownMenuItem
                      key={ws.id}
                      onClick={() => {
                        onWorkspaceChange?.(ws.slug);
                        if (isMobile) setOpenMobile(false);
                      }}
                      className={
                        ws.id === currentWorkspace?.id ? "bg-accent" : ""
                      }
                    >
                      {ws.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onClick={() => setDialogOpen(true)}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    New workspace
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={items.main} />
        <NavSecondary items={items.secondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={me!} />
      </SidebarFooter>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateSubmit();
            }}
          >
            <Input
              placeholder="Workspace name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!newName.trim() || createWorkspaceMutation.isPending}
              >
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Sidebar>
  );
}
