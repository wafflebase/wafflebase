import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { YorkieProvider, DocumentProvider, useDocument } from "@yorkie-js/react";
import { resolveShareLink, ResolvedShareLink } from "@/api/share-links";
import { fetchMe } from "@/api/auth";
import { Loader } from "@/components/loader";
import SheetView from "@/app/spreadsheet/sheet-view";
import {
  SpreadsheetDocument,
  initialSpreadsheetDocument,
} from "@/types/worksheet";
import type { UserPresence as UserPresenceType } from "@/types/users";

function SharedDocumentLayout({
  resolved,
}: {
  resolved: ResolvedShareLink;
}) {
  const readOnly = resolved.role === "viewer";
  const { doc } =
    useDocument<SpreadsheetDocument, UserPresenceType>();

  if (!doc) {
    return <Loader />;
  }

  const root = doc.getRoot();
  const tabId =
    root.tabOrder && root.tabOrder.length > 0 ? root.tabOrder[0] : "tab-1";

  return (
    <div className="flex h-screen w-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <h1 className="text-base font-medium">{resolved.title}</h1>
        {readOnly && (
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            View only
          </span>
        )}
      </header>
      <div className="flex flex-1 flex-col">
        <SheetView tabId={tabId} readOnly={readOnly} />
      </div>
    </div>
  );
}

function SharedDocumentInner({
  resolved,
}: {
  resolved: ResolvedShareLink;
}) {
  const { data: currentUser } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  });

  const presence = {
    username: currentUser?.username || "Anonymous",
    email: currentUser?.email || "",
    photo: currentUser?.photo || "",
  };

  return (
    <YorkieProvider
      apiKey={import.meta.env.VITE_YORKIE_API_KEY}
      metadata={{ userID: presence.username }}
    >
      <DocumentProvider
        docKey={`sheet-${resolved.documentId}`}
        initialRoot={initialSpreadsheetDocument}
        initialPresence={presence}
        enableDevtools={import.meta.env.DEV}
      >
        <SharedDocumentLayout resolved={resolved} />
      </DocumentProvider>
    </YorkieProvider>
  );
}

export function SharedDocument() {
  const { token } = useParams<{ token: string }>();
  const [resolved, setResolved] = useState<ResolvedShareLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setError("No share token provided");
      setLoading(false);
      return;
    }

    resolveShareLink(token)
      .then((data) => {
        setResolved(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Invalid or expired link");
        setLoading(false);
      });
  }, [token]);

  if (loading) {
    return <Loader />;
  }

  if (error || !resolved) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-2">Link unavailable</h1>
          <p className="text-muted-foreground">{error || "Invalid or expired link"}</p>
        </div>
      </div>
    );
  }

  return <SharedDocumentInner resolved={resolved} />;
}

export default SharedDocument;
