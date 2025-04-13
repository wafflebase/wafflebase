import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { Outlet, useLocation } from "react-router-dom";
import { IconFolder, IconSettings, IconUsers } from "@tabler/icons-react";

const items = {
  main: [
    {
      title: "Documents",
      url: "/",
      icon: IconFolder,
    },
    {
      title: "Members",
      url: "/members",
      icon: IconUsers,
    },
  ],
  secondary: [
    {
      title: "Settings",
      url: "/settings",
      icon: IconSettings,
    },
  ],
};

export default function Layout() {
  const location = useLocation();
  const title =
    items.main.find((item) => item.url === location.pathname)?.title ||
    items.secondary.find((item) => item.url === location.pathname)?.title ||
    "";

  return (
    <SidebarProvider>
      <AppSidebar variant="inset" items={items} />
      <SidebarInset>
        <SiteHeader title={title} />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <Outlet />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
