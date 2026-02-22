import { useQuery } from "@tanstack/react-query";
import { fetchDocuments } from "@/api/documents";
import { isAuthExpiredError } from "@/api/auth";
import { Document } from "@/types/documents";
import { DocumentList } from "@/app/documents/document-list";

/**
 * Renders the documents page entry component.
 */
export default function Page() {
  const {
    data: documents = [],
    isLoading,
    isError,
    error,
  } = useQuery<Array<Document>>({
    queryKey: ["documents"],
    queryFn: fetchDocuments,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-gray-500 text-lg">Loading documents...</p>
      </div>
    );
  }

  if (isError) {
    if (isAuthExpiredError(error)) {
      return null;
    }
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-red-500 text-lg">Failed to load documents.</p>
        <p className="text-gray-400">Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <DocumentList data={documents} />
    </div>
  );
}
