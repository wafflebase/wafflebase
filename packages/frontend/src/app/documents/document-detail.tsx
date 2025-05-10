import { DocumentProvider, YorkieProvider } from "@yorkie-js/react";
import { useParams } from "react-router-dom";
import SheetView from "@/app/spreadsheet/sheet-view";
import { initialWorksheet } from "@/types/worksheet";
import { useQuery } from "@tanstack/react-query";
import { User } from "@/types/users";

export function DocumentDetail() {
  const { id } = useParams();

  const { data: user } = useQuery<User>({
    queryKey: ["me"],
    enabled: true,
    staleTime: Infinity,
  });

  // NOTE(hackerwins): Fetch the document from the server using the id.
  // NOTE(hackerwins): instead of using the document id, consider using hash-based key.
  return (
    <YorkieProvider
      apiKey={import.meta.env.VITE_YORKIE_API_KEY}
      metadata={{ userID: user?.username || "anonymous-user" }}
    >
      <DocumentProvider docKey={`sheet-${id}`} initialRoot={initialWorksheet}>
        <SheetView />
      </DocumentProvider>
    </YorkieProvider>
  );
}

export default DocumentDetail;
