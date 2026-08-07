import { File as FileIcon } from "lucide-react";
import { formatFileSize } from "@/app/documents/file-meta";
import { formatRelativeTime } from "@/app/documents/document-list-utils";

/**
 * The body of a `file` document — a blob with no dedicated viewer. Deliberately
 * static: the download control lives in the shell header beside Share, matching
 * the image layout, so this stays presentational and testable without a router
 * or query client.
 */
export function GenericFileView({
  title,
  fileId,
  fileSize,
  createdAt,
}: {
  title: string;
  fileId?: string;
  fileSize?: number;
  createdAt?: string;
}) {
  const ext = fileId?.includes(".")
    ? (fileId.split(".").pop() as string).toUpperCase()
    : "FILE";

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-lg border bg-background p-8 text-center">
        <div className="relative">
          <FileIcon className="h-20 w-20 text-slate-400" strokeWidth={1} />
          <span className="absolute inset-x-0 bottom-4 text-[10px] font-semibold tracking-wider text-slate-600">
            {ext}
          </span>
        </div>
        <div className="min-w-0 w-full">
          <p className="truncate font-medium" title={title}>
            {title}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatFileSize(fileSize)}
            {createdAt ? ` · ${formatRelativeTime(createdAt)}` : ""}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          No preview available. Use Download in the header to save this file.
        </p>
      </div>
    </div>
  );
}
