import type { Folder } from "@/types/documents";
import { folderPath } from "./folder-path";

/**
 * Breadcrumb trail from the workspace root down to the current folder.
 * Each segment (including the "Home" root) navigates via `onNavigate`.
 */
export function FolderBreadcrumb({
  folders,
  folderId,
  onNavigate,
  onDropDocs,
}: {
  folders: Folder[];
  folderId: string | null;
  onNavigate: (id: string | null) => void;
  onDropDocs?: (targetFolderId: string | null, dataTransfer: DataTransfer) => void;
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
        onDragOver={(e) => onDropDocs && e.preventDefault()}
        onDrop={(e) => onDropDocs?.(null, e.dataTransfer)}
      >
        Home
      </button>
      {path.map((f) => (
        <span key={f.id} className="flex items-center gap-1">
          <span aria-hidden>/</span>
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => onNavigate(f.id)}
            onDragOver={(e) => onDropDocs && e.preventDefault()}
            onDrop={(e) => onDropDocs?.(f.id, e.dataTransfer)}
          >
            {f.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
