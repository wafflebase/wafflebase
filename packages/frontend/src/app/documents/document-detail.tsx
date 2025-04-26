import { DocumentProvider } from "@yorkie-js/react";
import { useParams } from "react-router-dom";
import SheetView from "@/app/spreadsheet/sheet-view";
import { initialWorksheet } from "@/types/worksheet";

export function DocumentDetail() {
  const { id } = useParams();
  // NOTE(hackerwins): Fetch the document from the server using the id.
  // NOTE(hackerwins): instead of using the document id, consider using hash-based key.
  return (
    <DocumentProvider docKey={`sheet-${id}`} initialRoot={initialWorksheet}>
      <SheetView />
    </DocumentProvider>
  );
}

export default DocumentDetail;
