import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { Outlet, useLocation } from "react-router-dom";
import { IconFolder, IconSettings } from "@tabler/icons-react";

const items = {
  main: [
    {
      title: "Documents",
      url: "/",
      icon: IconFolder,
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

  let title = "";
  if (location.pathname === "/") {
    title = "Documents";
  } else if (location.pathname === "/settings") {
    title = "Settings";
  } else if (location.pathname.match(/^\/\d+$/)) {
    // Document page (e.g., "/123")
    title = "Spreadsheet";
  } else {
    title =
      items.secondary.find((item) => item.url === location.pathname)?.title ||
      items.main.find((item) => location.pathname.startsWith(item.url))
        ?.title ||
      "";
  }

  return (
    <SidebarProvider>
      <AppSidebar variant="inset" items={items} />
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
