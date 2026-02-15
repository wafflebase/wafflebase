import { DocumentProvider } from "@yorkie-js/react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/api/auth";
import { Loader } from "@/components/loader";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { UserPresence } from "@/components/user-presence";
import { ShareDialog } from "@/components/share-dialog";
import { usePresenceUpdater } from "@/hooks/use-presence-updater";
import { IconFolder, IconSettings } from "@tabler/icons-react";
import SheetView from "@/app/spreadsheet/sheet-view";
import { initialWorksheet } from "@/types/worksheet";

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

function DocumentLayout({ documentId }: { documentId: string }) {
  usePresenceUpdater();

  return (
    <SidebarProvider>
      <AppSidebar variant="inset" items={items} />
      <SidebarInset>
        <SiteHeader title="Spreadsheet">
          <div className="flex items-center gap-2">
            <ShareDialog documentId={documentId} />
            <UserPresence />
          </div>
        </SiteHeader>
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col h-full">
              <SheetView />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function DocumentDetail() {
  const { id } = useParams();

  const {
    data: currentUser,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  if (isLoading) {
    return <Loader />;
  }

  if (isError || !currentUser) {
    return <div>User not found</div>;
  }

  // Ensure all user data is available
  if (!currentUser.username || !currentUser.email) {
    return <Loader />;
  }

  // NOTE(hackerwins): Fetch the document from the server using the id.
  // NOTE(hackerwins): instead of using the document id, consider using hash-based key.
  return (
    <DocumentProvider
      docKey={`sheet-${id}`}
      initialRoot={initialWorksheet}
      initialPresence={{
        username: currentUser.username,
        email: currentUser.email,
        photo: currentUser.photo || "",
      }}
    >
      <DocumentLayout documentId={id!} />
    </DocumentProvider>
  );
}

export default DocumentDetail;
