import type { Folder } from "@/types/documents";
import { folderPath } from "./folder-path";

/**
 * Breadcrumb trail from the workspace root down to the current folder.
 * Each segment (including "All documents") navigates via `onNavigate`.
 */
export function FolderBreadcrumb({
  folders,
  folderId,
  onNavigate,
}: {
  folders: Folder[];
  folderId: string | null;
  onNavigate: (id: string | null) => void;
}) {
  const path = folderPath(folders, folderId);
  return (
    <nav
      aria-label="Folder breadcrumb"
      className="flex items-center gap-1 text-sm text-muted-foreground"
    >
      <button
        type="button"
        className="hover:text-foreground"
        onClick={() => onNavigate(null)}
      >
        All documents
      </button>
      {path.map((f) => (
        <span key={f.id} className="flex items-center gap-1">
          <span aria-hidden>/</span>
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => onNavigate(f.id)}
          >
            {f.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
