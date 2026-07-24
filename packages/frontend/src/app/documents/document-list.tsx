import {
  ComponentType,
  FormEvent,
  MouseEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Column,
  ColumnDef,
  ColumnFiltersState,
  OnChangeFn,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Download,
  FileDown,
  FileText,
  Folder as FolderIcon,
  FolderOutput,
  Image as ImageIcon,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  Presentation,
  Sheet,
  Trash2,
  X,
} from "lucide-react";
import { IconFileTypePdf } from "@tabler/icons-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { Document, DocumentType, Folder } from "@/types/documents";
import {
  allManageable,
  decodeDocDrag,
  encodeDocDrag,
  isDocDrag,
} from "./document-bulk";
import { DocumentPresenceAvatars } from "./document-presence-avatars";
import { FolderBreadcrumb } from "./folder-breadcrumb";
import { folderPath } from "./folder-path";
import {
  compareDates,
  formatRelativeTime,
  getDocumentPath,
  lastModified,
  matchesSearch,
  matchesTypes,
} from "./document-list-utils";
import {
  createDocument,
  deleteDocuments,
  moveDocuments,
  renameDocument,
} from "@/api/documents";
import {
  createFolder,
  deleteFolder,
  fetchFolders,
  moveFolder,
  renameFolder,
} from "@/api/folders";
import {
  createWorkspaceDocument,
  fetchWorkspaces,
  type Workspace,
} from "@/api/workspaces";
import { downloadDocumentFile } from "@/api/download-file";
import { UploadPanel } from "./upload-panel";
import { useWindowFileDrop } from "./use-window-file-drop";
import { enqueue, startUploads } from "./upload-queue";
import { pickFiles } from "./pick-files";
import { ImageThumb } from "./image-thumb";

/**
 * A single row of the unified list: either a folder or a document. Folders and
 * documents share one `@tanstack/react-table` so they read as one list of
 * objects rather than a floating folder section above the file table.
 */
type ListRow =
  | { kind: "folder"; item: Folder }
  | { kind: "doc"; item: Document };

/** Selection key for a row — kind-prefixed so folder and doc ids never clash. */
const rowKey = (row: ListRow) => `${row.kind}:${row.item.id}`;

/** Display title of a row (folder name or document title). */
const rowTitle = (row: ListRow): string =>
  row.kind === "folder" ? row.item.name : row.item.title;

/** The value used for the row's "Modified" column. */
const rowModified = (row: ListRow): string =>
  row.kind === "folder" ? row.item.createdAt : lastModified(row.item);

/** The value used for the row's "Created" column. */
const rowCreated = (row: ListRow): string => row.item.createdAt;

const DOC_KEY_PREFIX = "doc:";
const FOLDER_KEY_PREFIX = "folder:";

/**
 * Single source of truth for each document type's label, icon, and color.
 * The title cell and the filter chips both derive from this so a new type
 * needs one edit, not several.
 */
const TYPE_META: Record<
  DocumentType,
  { label: string; Icon: ComponentType<{ className?: string }>; color: string }
> = {
  sheet: { label: "Sheets", Icon: Sheet, color: "text-green-600" },
  doc: { label: "Docs", Icon: FileText, color: "text-blue-500" },
  note: { label: "Note", Icon: NotebookPen, color: "text-purple-500" },
  slides: { label: "Slides", Icon: Presentation, color: "text-orange-500" },
  pdf: { label: "PDF", Icon: IconFileTypePdf, color: "text-red-500" },
  image: { label: "Images", Icon: ImageIcon, color: "text-pink-500" },
};

/** Document types offered as filter chips, in display order. */
const TYPE_OPTIONS: ReadonlyArray<DocumentType> = [
  "sheet",
  "doc",
  "note",
  "slides",
  "pdf",
  "image",
];

/**
 * Clickable column header that toggles this column's sort and shows the
 * active direction. Reused across the sortable columns.
 */
function SortableHeader<TData>({
  column,
  children,
  align = "left",
}: {
  column: Column<TData, unknown>;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const sorted = column.getIsSorted();
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <Button
        variant="ghost"
        size="sm"
        className={`h-8 ${align === "right" ? "-mr-3" : "-ml-3"}`}
        onClick={column.getToggleSortingHandler()}
      >
        {children}
        {sorted === "asc" ? (
          <ArrowUp className="ml-1 h-3.5 w-3.5" />
        ) : sorted === "desc" ? (
          <ArrowDown className="ml-1 h-3.5 w-3.5" />
        ) : (
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 opacity-40" />
        )}
      </Button>
    </div>
  );
}

/**
 * A right-aligned, time-based sortable column rendering a relative timestamp
 * (e.g. "3 days ago"). Used by the Modified column.
 */
function dateColumn(
  id: string,
  label: string,
  accessor: (row: ListRow) => string,
): ColumnDef<ListRow> {
  return {
    id,
    accessorFn: accessor,
    header: ({ column }) => (
      <SortableHeader column={column} align="right">
        {label}
      </SortableHeader>
    ),
    sortingFn: (a, b, colId) =>
      compareDates(a.getValue<string>(colId), b.getValue<string>(colId)),
    cell: ({ row }) => (
      <div className="text-right font-medium">
        {formatRelativeTime(row.getValue<string>(id))}
      </div>
    ),
  };
}

/**
 * The four file-import entries shared by both "New" dropdown copies (the
 * toolbar one and the empty-state one). Each opens a multi-select picker
 * filtered to its type and routes the result through `onImport`, which
 * queues the batch for background upload instead of importing inline.
 */
function ImportMenuItems({
  onImport,
}: {
  onImport: (accept: string) => void;
}) {
  return (
    <>
      <DropdownMenuItem onClick={() => onImport(".xlsx")}>
        <FileDown className="mr-2 h-4 w-4 text-green-600" />
        Import XLSX
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onImport(".docx")}>
        <FileDown className="mr-2 h-4 w-4 text-blue-500" />
        Import DOCX
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onImport(".pptx")}>
        <FileDown className="mr-2 h-4 w-4 text-orange-500" />
        Import PPTX
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onImport(".pdf")}>
        <IconFileTypePdf className="mr-2 h-4 w-4 text-red-500" />
        Upload PDF
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => onImport(".png,.jpg,.jpeg,.gif,.webp")}
      >
        <ImageIcon className="mr-2 h-4 w-4 text-pink-500" />
        Upload Image
      </DropdownMenuItem>
    </>
  );
}

/**
 * Renders the DocumentList component.
 */
export function DocumentList({
  data,
  workspaceId,
  folders = [],
  folderId = null,
  onNavigateFolder,
}: {
  data: Document[];
  workspaceId?: string;
  folders?: Folder[];
  folderId?: string | null;
  onNavigateFolder?: (id: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [deleting, setDeleting] = useState<{
    docIds: string[];
    folderIds: string[];
    title: string;
  } | null>(null);
  const [renamingDoc, setRenamingDoc] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [moving, setMoving] = useState<{
    docIds: string[];
    folderIds: string[];
    title: string;
    workspaceId: string;
  } | null>(null);
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string>("");
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // The current workspace's real UUID. Every document in a workspace-scoped
  // list shares it — used to gate folder moves (moveFolder has no workspace
  // param, so folders can only be reparented within their own workspace).
  const listWorkspaceId = data[0]?.workspaceId ?? "";

  // Folders that live directly under the folder currently being viewed.
  const childFolders = useMemo(
    () =>
      folders.filter((f) => (f.parentId ?? null) === (folderId ?? null)),
    [folders, folderId],
  );

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
    enabled: moving !== null,
  });

  const { data: moveTargetFolders = [] } = useQuery<Folder[]>({
    queryKey: ["workspaces", targetWorkspaceId, "folders"],
    queryFn: () => fetchFolders(targetWorkspaceId),
    enabled: moving !== null && !!targetWorkspaceId,
  });

  const createDocumentMutation = useMutation({
    mutationFn: async (data: { title: string; type?: DocumentType }) =>
      workspaceId
        ? await createWorkspaceDocument(workspaceId, {
            ...data,
            folderId: folderId ?? undefined,
          })
        : await createDocument(data),
    onSuccess: (doc) => navigate(getDocumentPath(doc)),
  });

  // Route a picked batch through the upload queue instead of the old
  // single-file pick -> import -> create -> navigate -> toast path. The
  // queue owns progress/errors/retry (see upload-queue.ts); we just refresh
  // the documents list as each item lands so new rows appear without a
  // manual reload.
  // Coalesce the documents-list refetch: items in a batch land one by one, so
  // invalidating per item would fire N (x2) refetches. Collect the affected
  // workspaces and flush a single invalidation on a short trailing debounce.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRefreshWorkspaces = useRef<Set<string>>(new Set());
  // Anchor row id for shift-click range selection. Stored as the row key
  // (not a row index) so it stays valid across re-sorts and type-filter changes
  // — it is resolved to the current row order at shift-click time.
  const lastSelectedId = useRef<string | null>(null);
  const scheduleListRefresh = useCallback(
    (wid?: string) => {
      if (wid) pendingRefreshWorkspaces.current.add(wid);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["documents"] });
        for (const id of pendingRefreshWorkspaces.current) {
          queryClient.invalidateQueries({
            queryKey: ["workspaces", id, "documents"],
          });
        }
        pendingRefreshWorkspaces.current.clear();
      }, 400);
    },
    [queryClient],
  );
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  const startBatch = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      // Pass the folder the list is currently viewing so dropped/picked files
      // land here, not the workspace root (matches the manual "New …" path).
      enqueue(files, workspaceId, folderId ?? undefined);
      // The settled callback keys off each item's OWN captured workspaceId,
      // not the closed-over one — a batch may finish after the user has
      // switched the list to another workspace, and startUploads keeps only
      // the latest callback, so it must not assume the current workspace.
      startUploads((item) => {
        if (item.status === "done") {
          scheduleListRefresh(item.workspaceId);
          if (item.warning) {
            toast.warning(`Imported "${item.fileName}" — ${item.warning}`);
          }
        } else if (item.status === "error") {
          toast.error(
            `Upload failed: ${item.fileName}${
              item.reason ? ` — ${item.reason}` : ""
            }`,
          );
        }
      });
    },
    [workspaceId, folderId, scheduleListRefresh],
  );

  // Google-Drive-style whole-window drop: a file dropped anywhere (not just on
  // the list) enqueues, and a stray drop never navigates the tab. See
  // useWindowFileDrop for the listener/overlay lifecycle.
  const dragging = useWindowFileDrop(startBatch);

  const handleImportPick = async (accept: string) => {
    startBatch(await pickFiles(accept));
  };

  const invalidateLists = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    queryClient.invalidateQueries({ queryKey: ["workspaces"] });
  }, [queryClient]);

  // Delete documents and folders in one confirm. Folders are deleted
  // non-destructively server-side (their documents return to the workspace
  // root), so a mixed selection is safe.
  const deleteItemsMutation = useMutation({
    mutationFn: async ({
      docIds,
      folderIds,
    }: {
      docIds: string[];
      folderIds: string[];
    }) => {
      if (docIds.length) await deleteDocuments(docIds);
      await Promise.all(folderIds.map((id) => deleteFolder(id)));
    },
    onSuccess: (_res, vars) => {
      invalidateLists();
      deselect([
        ...vars.docIds.map((id) => DOC_KEY_PREFIX + id),
        ...vars.folderIds.map((id) => FOLDER_KEY_PREFIX + id),
      ]);
      setDeleting(null);
      const total = vars.docIds.length + vars.folderIds.length;
      toast.success(total > 1 ? `${total} items deleted` : "Deleted");
    },
    onError: () => toast.error("Failed to delete"),
  });

  const renameDocumentMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) =>
      await renameDocument(id, title),
    onSuccess: () => {
      invalidateLists();
      setRenamingDoc(null);
    },
  });

  // Move documents (possibly across workspaces) and folders (within the
  // current workspace only) in one confirm.
  const moveItemsMutation = useMutation({
    mutationFn: async ({
      docIds,
      folderIds,
      workspaceId: targetWs,
      folderId: targetFid,
    }: {
      docIds: string[];
      folderIds: string[];
      workspaceId: string;
      folderId: string | null;
    }) => {
      if (docIds.length) {
        await moveDocuments(docIds, {
          workspaceId: targetWs,
          folderId: targetFid,
        });
      }
      // moveFolder only reparents within a workspace, so folders move only when
      // the target workspace is their own. Cross-workspace folder moves are
      // skipped (surfaced as a warning in onSuccess).
      if (folderIds.length && targetWs === listWorkspaceId) {
        await Promise.all(folderIds.map((id) => moveFolder(id, targetFid)));
      }
    },
    onSuccess: (_res, vars) => {
      invalidateLists();
      const moved =
        vars.docIds.length +
        (vars.workspaceId === listWorkspaceId ? vars.folderIds.length : 0);
      toast.success(moved > 1 ? `${moved} items moved` : "Moved");
      if (vars.folderIds.length && vars.workspaceId !== listWorkspaceId) {
        toast.warning(
          "Folders can't move to another workspace — only the documents moved.",
        );
      }
      setMoving(null);
      setTargetWorkspaceId("");
      setTargetFolderId(null);
      deselect([
        ...vars.docIds.map((id) => DOC_KEY_PREFIX + id),
        ...vars.folderIds.map((id) => FOLDER_KEY_PREFIX + id),
      ]);
    },
    onError: () => toast.error("Failed to move"),
  });

  // Document-only move used by drag-and-drop onto a folder row and onto the
  // breadcrumb root. Kept separate from the dialog path (which can also carry
  // folders) so a drag never accidentally reparents folders.
  const moveDocumentsMutation = useMutation({
    mutationFn: async ({
      ids,
      folderId: targetFid,
    }: {
      ids: string[];
      folderId?: string | null;
    }) => await moveDocuments(ids, { folderId: targetFid }),
    onSuccess: (_res, vars) => {
      invalidateLists();
      toast.success(
        vars.ids.length > 1
          ? `${vars.ids.length} documents moved`
          : "Document moved successfully",
      );
      deselect(vars.ids.map((id) => DOC_KEY_PREFIX + id));
    },
    onError: () => toast.error("Failed to move documents"),
  });

  const createFolderMutation = useMutation({
    mutationFn: (name: string) =>
      createFolder(workspaceId!, { name, parentId: folderId ?? null }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "folders"],
      });
      setCreatingFolder(false);
      setNewFolderName("");
    },
    onError: () => toast.error("Failed to create folder"),
  });

  const renameFolderMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameFolder(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "folders"],
      });
      setRenamingFolder(null);
    },
    onError: () => toast.error("Failed to rename folder"),
  });

  // Default to most-recently-modified first (Google-Drive-style). Folders are
  // pinned above documents by an always-primary `kind` sort injected below, so
  // this state only holds the user-controllable secondary sort.
  const [sorting, setSorting] = useState<SortingState>([
    { id: "updatedAt", desc: true },
  ]);
  const handleSortingChange: OnChangeFn<SortingState> = (updater) =>
    setSorting((prev) => {
      const prevFull: SortingState = [{ id: "kind", desc: false }, ...prev];
      const next =
        typeof updater === "function" ? updater(prevFull) : updater;
      // Strip the pinned `kind` entry so it never lands in user state; it is
      // re-prepended every render via `fullSorting`.
      return next.filter((s) => s.id !== "kind");
    });
  // Folders first (kind asc), then the user's chosen column — independent of
  // the user's sort direction, so folders stay on top either way.
  const fullSorting: SortingState = useMemo(
    () => [{ id: "kind", desc: false }, ...sorting],
    [sorting],
  );

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    kind: false,
  });
  const [rowSelection, setRowSelection] = useState({});

  // Reset the multi-selection when navigating to a different folder/workspace
  // so a stale selection can't leave the bulk bar showing disabled actions.
  useEffect(() => {
    setRowSelection({});
    lastSelectedId.current = null;
  }, [folderId, workspaceId]);

  const [typeFilters, setTypeFilters] = useState<Set<DocumentType>>(new Set());
  // Which folder row is currently under an in-flight document drag, for hover
  // highlighting.
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  const toggleType = (type: DocumentType) => {
    setTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const showFolders = !!workspaceId && !!onNavigateFolder;

  // The unified row model: folders (when this list supports them and no type
  // filter is active, since folders have no type) followed by documents. The
  // pinned `kind` sort keeps folders above documents regardless of the user's
  // chosen column, and type-chip filtering runs here so it composes cleanly
  // with the table's own text search and sorting.
  const rows = useMemo<ListRow[]>(() => {
    const folderRows: ListRow[] =
      showFolders && typeFilters.size === 0
        ? childFolders.map((f) => ({ kind: "folder", item: f }))
        : [];
    const docRows: ListRow[] = data
      .filter((doc) => matchesTypes(doc, typeFilters))
      .map((d) => ({ kind: "doc", item: d }));
    return [...folderRows, ...docRows];
  }, [showFolders, typeFilters, childFolders, data]);

  const columns: Array<ColumnDef<ListRow>> = [
    {
      id: "select",
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllRowsSelected()
              ? true
              : table.getIsSomeRowsSelected()
                ? "indeterminate"
                : false
          }
          onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Select all"
        />
      ),
      cell: ({ row, table }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          onClick={(e) => {
            e.stopPropagation();
            const rows = table.getSortedRowModel().rows;
            // Resolve the anchor to its CURRENT position, so a sort or filter
            // change between clicks can't select the wrong range.
            const anchorIdx = lastSelectedId.current
              ? rows.findIndex((r) => r.id === lastSelectedId.current)
              : -1;
            const idx = rows.findIndex((r) => r.id === row.id);
            if (e.shiftKey && anchorIdx !== -1 && idx !== -1) {
              e.preventDefault(); // suppress Radix's own toggle; we own the range write
              const [lo, hi] = [anchorIdx, idx].sort((a, b) => a - b);
              const next: Record<string, boolean> = {};
              for (let i = lo; i <= hi; i++) next[rows[i].id] = true;
              table.setRowSelection((prev) => ({ ...prev, ...next }));
            }
            lastSelectedId.current = row.id;
          }}
          aria-label={`Select ${rowTitle(row.original)}`}
        />
      ),
    },
    {
      id: "kind",
      accessorFn: (row) => (row.kind === "folder" ? 0 : 1),
      enableHiding: true,
    },
    {
      id: "title",
      accessorFn: (row) => rowTitle(row),
      header: ({ column }) => (
        <SortableHeader column={column}>Title</SortableHeader>
      ),
      filterFn: (row, _columnId, filterValue) =>
        matchesSearch(
          { title: rowTitle(row.original) },
          String(filterValue ?? ""),
        ),
      cell: ({ row }) => {
        const r = row.original;
        if (r.kind === "folder") {
          return (
            <div className="flex items-center gap-2">
              <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{r.item.name}</span>
            </div>
          );
        }
        const doc = r.item;
        const { Icon, color } = TYPE_META[doc.type];
        return (
          <div className="flex items-center gap-2">
            {doc.type === "image" ? (
              <ImageThumb documentId={String(doc.id)} />
            ) : (
              <Icon className={`h-4 w-4 shrink-0 ${color}`} />
            )}
            <span className="capitalize">{doc.title}</span>
            {/* Live "currently editing" avatars sit next to the title rather
                than in their own column. Presentational only — Title still
                sorts by its own value. */}
            <DocumentPresenceAvatars editors={doc.editors} />
          </div>
        );
      },
    },
    {
      id: "owner",
      accessorFn: (row) =>
        row.kind === "doc" ? (row.item.author?.username ?? "") : "",
      header: ({ column }) => (
        <SortableHeader column={column}>Owner</SortableHeader>
      ),
      cell: ({ row }) => {
        const r = row.original;
        const author = r.kind === "doc" ? r.item.author : null;
        if (!author) {
          return null;
        }
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <Avatar
                className="h-6 w-6"
                role="img"
                aria-label={author.username}
                title={author.username}
              >
                {author.photo && (
                  <AvatarImage src={author.photo} alt={author.username} />
                )}
                <AvatarFallback className="text-[10px]">
                  {author.username.slice(0, 2).toUpperCase() || "??"}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent>{author.username}</TooltipContent>
          </Tooltip>
        );
      },
    },
    dateColumn("updatedAt", "Modified", (row) => rowModified(row)),
    dateColumn("createdAt", "Created", (row) => rowCreated(row)),
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const r = row.original;
        if (r.kind === "folder") {
          const folder = r.item;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  aria-label={`Actions for ${folder.name}`}
                >
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(e: MouseEvent<HTMLElement>) => {
                    e.stopPropagation();
                    setRenamingFolder({ id: folder.id, name: folder.name });
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e: MouseEvent<HTMLElement>) => {
                    e.stopPropagation();
                    setMoving({
                      docIds: [],
                      folderIds: [folder.id],
                      title: folder.name,
                      workspaceId: listWorkspaceId,
                    });
                    setTargetWorkspaceId(listWorkspaceId);
                    setTargetFolderId(null);
                  }}
                >
                  <FolderOutput className="mr-2 h-4 w-4" />
                  Move to...
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={(e: MouseEvent<HTMLElement>) => {
                    e.stopPropagation();
                    setDeleting({
                      docIds: [],
                      folderIds: [folder.id],
                      title: folder.name,
                    });
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        }
        const doc = r.item;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(doc.type === "image" || doc.type === "pdf") && (
                <DropdownMenuItem
                  onClick={(e: MouseEvent<HTMLElement>) => {
                    e.stopPropagation();
                    handleDownload(doc);
                  }}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={(e: MouseEvent<HTMLElement>) => {
                  e.stopPropagation();
                  setRenamingDoc({ id: String(doc.id), title: doc.title });
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Rename
              </DropdownMenuItem>
              {doc.canManage && (
                <DropdownMenuItem
                  onClick={(e: MouseEvent<HTMLElement>) => {
                    e.stopPropagation();
                    setMoving({
                      docIds: [String(doc.id)],
                      folderIds: [],
                      title: doc.title,
                      workspaceId: doc.workspaceId,
                    });
                    setTargetWorkspaceId(doc.workspaceId);
                    setTargetFolderId(null);
                  }}
                >
                  <FolderOutput className="mr-2 h-4 w-4" />
                  Move to...
                </DropdownMenuItem>
              )}
              {doc.canManage && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={(e: MouseEvent<HTMLElement>) => {
                    e.stopPropagation();
                    setDeleting({
                      docIds: [String(doc.id)],
                      folderIds: [],
                      title: doc.title,
                    });
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const table = useReactTable({
    data: rows,
    columns,
    // Stabilize row identity across the presence-driven 5 s poll so React
    // reconciles rows by id instead of array index — keeps any open dropdown /
    // dialog rooted in the row from remounting. Kind-prefixed so a folder and a
    // document can never collide on a shared uuid.
    getRowId: (row) => rowKey(row),
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting: fullSorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
  });

  const selectedKeys = Object.keys(rowSelection);
  const selectedDocIds = selectedKeys
    .filter((k) => k.startsWith(DOC_KEY_PREFIX))
    .map((k) => k.slice(DOC_KEY_PREFIX.length));
  const selectedFolderIds = selectedKeys
    .filter((k) => k.startsWith(FOLDER_KEY_PREFIX))
    .map((k) => k.slice(FOLDER_KEY_PREFIX.length));
  const selectedCount = selectedKeys.length;

  // Resolve the selection against the FULL data set, not the filtered rows: a
  // type filter hides rows but does not deselect them, so gating the bulk
  // actions on filtered data would wrongly read a still-selected but hidden doc
  // as unmanageable. `manageableSource` covers every doc that can be selected.
  const manageableSource = data.map((d) => ({
    id: String(d.id),
    canManage: d.canManage ?? false,
  }));
  // Folders are always client-manageable (the folder menu offers rename/delete
  // unconditionally; the server is the real gate). So the bulk actions are
  // enabled when every selected DOCUMENT is manageable.
  const selectedCanManage =
    selectedDocIds.length === 0 ||
    allManageable(selectedDocIds, manageableSource);

  // Common source workspace of the selected documents (for the move dialog's
  // initial target); "" when the selection spans workspaces (only possible on
  // the global /documents list). Falls back to the current workspace when only
  // folders are selected.
  const selectedWorkspaceId = (() => {
    const set = data.filter((d) => selectedDocIds.includes(String(d.id)));
    const wss = new Set(set.map((d) => d.workspaceId));
    if (wss.size === 1) return [...wss][0];
    if (selectedDocIds.length === 0) return listWorkspaceId;
    return "";
  })();

  // Drop a set of selection keys (after a move/delete).
  const deselect = (keys: string[]) =>
    setRowSelection((prev) => {
      const next = { ...prev };
      for (const key of keys) delete next[key];
      return next;
    });

  const openBulkMove = () => {
    setMoving({
      docIds: selectedDocIds,
      folderIds: selectedFolderIds,
      title: `${selectedCount} items`,
      workspaceId: selectedWorkspaceId,
    });
    setTargetWorkspaceId(selectedWorkspaceId);
    setTargetFolderId(null);
  };

  // Move a set of dragged documents into `targetFolderId` (a folder id, or null
  // for the workspace root). Shared by folder rows and the breadcrumb.
  const dropDocsIntoFolder = (
    dt: DataTransfer,
    destinationFolderId: string | null,
  ) => {
    const ids = decodeDocDrag(dt);
    if (!ids || ids.length === 0 || !workspaceId) return;
    if (!allManageable(ids, manageableSource)) {
      toast.error("You can only move documents you own");
      return;
    }
    // Skip docs already in the destination — a no-op move would still bump
    // updatedAt and reshuffle the list.
    const toMove = ids.filter(
      (id) =>
        (data.find((d) => String(d.id) === id)?.folderId ?? null) !==
        destinationFolderId,
    );
    if (toMove.length === 0) return;
    // Same-workspace move: omit workspaceId so the server derives the target
    // workspace per document (the route `workspaceId` here may be a slug, which
    // the move DTO's @IsUUID would reject).
    moveDocumentsMutation.mutate({
      ids: toMove,
      folderId: destinationFolderId,
    });
  };

  // Download a single blob-backed document (pdf/image) through the authed file
  // endpoint. Other document types have nothing to download.
  const handleDownload = async (doc: Document) => {
    try {
      await downloadDocumentFile({ id: String(doc.id), title: doc.title });
    } catch {
      toast.error(`Failed to download "${doc.title}"`);
    }
  };

  // The pdf/image documents in the current selection — what a bulk "Download"
  // acts on.
  const downloadableSelected = data.filter(
    (d) =>
      selectedDocIds.includes(String(d.id)) &&
      (d.type === "image" || d.type === "pdf"),
  );

  const handleBulkDownload = async () => {
    for (const doc of downloadableSelected) {
      await handleDownload(doc);
    }
  };

  return (
    <>
      <div className="w-full">
      {showFolders && (
        <div className="pt-2">
          <FolderBreadcrumb
            folders={folders}
            folderId={folderId}
            onNavigate={onNavigateFolder}
            onDropDocs={(destFolderId, dt) =>
              dropDocsIntoFolder(dt, destFolderId)
            }
          />
        </div>
      )}
      <div className="flex flex-col gap-2 py-4 sm:flex-row sm:flex-nowrap sm:items-center">
        {selectedCount > 0 ? (
          // Selection mode: swap the toolbar's contents in place. Both states
          // keep the same layout at every width (one row on sm+, two rows on
          // mobile), so toggling a selection never changes the toolbar height.
          <>
            <div className="flex h-9 items-center">
              <span className="text-sm font-medium">
                {selectedCount} selected
              </span>
            </div>
            <div className="flex w-full items-center gap-1 sm:w-auto sm:flex-1 sm:justify-end">
              {downloadableSelected.length > 0 && (
                <Button variant="outline" onClick={handleBulkDownload}>
                  <Download className="mr-1 h-4 w-4" />
                  Download
                </Button>
              )}
              <Button
                variant="outline"
                disabled={!selectedCanManage}
                title={
                  selectedCanManage
                    ? undefined
                    : "You can only move documents you own"
                }
                onClick={openBulkMove}
              >
                <FolderOutput className="mr-1 h-4 w-4" />
                Move to…
              </Button>
              <Button
                variant="outline"
                className="text-destructive"
                disabled={!selectedCanManage}
                title={
                  selectedCanManage
                    ? undefined
                    : "You can only delete documents you own"
                }
                onClick={() =>
                  setDeleting({
                    docIds: selectedDocIds,
                    folderIds: selectedFolderIds,
                    title: `${selectedCount} items`,
                  })
                }
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Delete
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Clear selection"
                onClick={() => {
                  setRowSelection({});
                  lastSelectedId.current = null;
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </>
        ) : (
          <>
        <Input
          placeholder="Search by title..."
          aria-label="Search documents by title"
          value={(table.getColumn("title")?.getFilterValue() as string) ?? ""}
          onChange={(e) =>
            table.getColumn("title")?.setFilterValue(e.target.value)
          }
          className="w-full min-w-0 sm:max-w-xs"
        />
        <div className="flex w-full items-center gap-2 sm:w-auto sm:flex-1">
        <div className="flex items-center gap-1">
          {TYPE_OPTIONS.map((type) => {
            const { label, Icon, color } = TYPE_META[type];
            const active = typeFilters.has(type);
            return (
              <Tooltip key={type}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={active ? "secondary" : "outline"}
                    size="icon"
                    aria-pressed={active}
                    aria-label={`Filter by ${label}`}
                    onClick={() => toggleType(type)}
                    className={active ? undefined : "text-muted-foreground"}
                  >
                    <Icon className={`h-4 w-4 ${color}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="ml-auto flex items-center gap-2">
              <Plus className="w-4 h-4" />
              New
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() =>
                createDocumentMutation.mutate({ title: "New Sheet" })
              }
            >
              <Sheet className="mr-2 h-4 w-4 text-green-600" />
              New Sheet
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                createDocumentMutation.mutate({
                  title: "New Document",
                  type: "doc",
                })
              }
            >
              <FileText className="mr-2 h-4 w-4 text-blue-500" />
              New Document
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                createDocumentMutation.mutate({
                  title: "New Note",
                  type: "note",
                })
              }
            >
              <NotebookPen className="mr-2 h-4 w-4 text-purple-500" />
              New Note
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                createDocumentMutation.mutate({
                  title: "New Presentation",
                  type: "slides",
                })
              }
            >
              <Presentation className="mr-2 h-4 w-4 text-orange-500" />
              New Presentation
            </DropdownMenuItem>
            {workspaceId && (
              <DropdownMenuItem onClick={() => setCreatingFolder(true)}>
                <FolderIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                New folder
              </DropdownMenuItem>
            )}
            <ImportMenuItems onImport={handleImportPick} />
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
          </>
        )}
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => {
                const r = row.original;
                const isFolder = r.kind === "folder";
                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${rowTitle(r)}`}
                    className={`cursor-pointer hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                      isFolder && dragOverFolderId === r.item.id
                        ? "ring-2 ring-primary ring-inset"
                        : ""
                    }`}
                    draggable={!isFolder && r.item.canManage}
                    onDragStart={
                      isFolder
                        ? undefined
                        : (e) => {
                            const id = String(r.item.id);
                            const ids =
                              row.getIsSelected() && selectedDocIds.length > 0
                                ? selectedDocIds
                                : [id];
                            encodeDocDrag(e.dataTransfer, ids);
                          }
                    }
                    onDragOver={
                      isFolder
                        ? (e) => {
                            if (!isDocDrag(e.dataTransfer)) return;
                            e.preventDefault();
                            setDragOverFolderId(r.item.id);
                          }
                        : undefined
                    }
                    onDragLeave={
                      isFolder
                        ? () =>
                            setDragOverFolderId((cur) =>
                              cur === r.item.id ? null : cur,
                            )
                        : undefined
                    }
                    onDrop={
                      isFolder
                        ? (e) => {
                            setDragOverFolderId(null);
                            if (!isDocDrag(e.dataTransfer)) return;
                            e.preventDefault();
                            dropDocsIntoFolder(e.dataTransfer, r.item.id);
                          }
                        : undefined
                    }
                    onClick={(e: MouseEvent<HTMLElement>) => {
                      if ((e.target as HTMLElement).closest("input, button")) {
                        return;
                      }
                      if (isFolder) onNavigateFolder?.(r.item.id);
                      else navigate(getDocumentPath(r.item));
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      if ((e.target as HTMLElement).closest("input, button")) {
                        return;
                      }
                      e.preventDefault();
                      if (isFolder) onNavigateFolder?.(r.item.id);
                      else navigate(getDocumentPath(r.item));
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-48"
                >
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <FileText className="h-10 w-10 stroke-1" />
                    <p className="text-sm font-medium">No documents yet</p>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm">
                          <Plus className="w-4 h-4 mr-1" />
                          New
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          onClick={() =>
                            createDocumentMutation.mutate({
                              title: "New Sheet",
                            })
                          }
                        >
                          <Sheet className="mr-2 h-4 w-4 text-green-600" />
                          New Sheet
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            createDocumentMutation.mutate({
                              title: "New Document",
                              type: "doc",
                            })
                          }
                        >
                          <FileText className="mr-2 h-4 w-4 text-blue-500" />
                          New Document
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            createDocumentMutation.mutate({
                              title: "New Note",
                              type: "note",
                            })
                          }
                        >
                          <NotebookPen className="mr-2 h-4 w-4 text-purple-500" />
                          New Note
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            createDocumentMutation.mutate({
                              title: "New Presentation",
                              type: "slides",
                            })
                          }
                        >
                          <Presentation className="mr-2 h-4 w-4 text-orange-500" />
                          New Presentation
                        </DropdownMenuItem>
                        <ImportMenuItems onImport={handleImportPick} />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="flex-1" />
        <div className="space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>

      <Dialog
        open={renamingDoc !== null}
        onOpenChange={(open) => {
          if (!open) setRenamingDoc(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (!renamingDoc) return;
              const formData = new FormData(e.target as HTMLFormElement);
              const title = formData.get("title") as string;
              if (title.trim()) {
                renameDocumentMutation.mutate({
                  id: renamingDoc.id,
                  title: title.trim(),
                });
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename Document</DialogTitle>
              <DialogDescription>
                Enter a new name for this document.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="rename-title">Title</Label>
                <Input
                  id="rename-title"
                  name="title"
                  defaultValue={renamingDoc?.title ?? ""}
                  key={renamingDoc?.id}
                  autoFocus
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenamingDoc(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={renameDocumentMutation.isPending}>
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={moving !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMoving(null);
            setTargetWorkspaceId("");
            setTargetFolderId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move</DialogTitle>
            <DialogDescription>
              Select a workspace and folder to move &ldquo;{moving?.title}
              &rdquo; to.
              {moving && moving.folderIds.length > 0 && (
                <>
                  {" "}
                  Folders only move within their current workspace.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="move-workspace">Workspace</Label>
              <Select
                value={targetWorkspaceId}
                onValueChange={(v) => {
                  setTargetWorkspaceId(v);
                  setTargetFolderId(null);
                }}
              >
                <SelectTrigger id="move-workspace">
                  <SelectValue placeholder="Select a workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="move-folder">Folder</Label>
              <Select
                value={targetFolderId ?? "__root__"}
                onValueChange={(v) =>
                  setTargetFolderId(v === "__root__" ? null : v)
                }
              >
                <SelectTrigger id="move-folder">
                  <SelectValue placeholder="Home" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">Home</SelectItem>
                  {moveTargetFolders.map((f) => {
                    const depth = folderPath(moveTargetFolders, f.id).length - 1;
                    return (
                      <SelectItem key={f.id} value={f.id}>
                        {"  ".repeat(depth) + f.name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMoving(null);
                setTargetWorkspaceId("");
                setTargetFolderId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!targetWorkspaceId || moveItemsMutation.isPending}
              onClick={() => {
                if (moving && targetWorkspaceId) {
                  moveItemsMutation.mutate({
                    docIds: moving.docIds,
                    folderIds: moving.folderIds,
                    workspaceId: targetWorkspaceId,
                    folderId: targetFolderId,
                  });
                }
              }}
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete</DialogTitle>
            <DialogDescription>
              {deleting &&
              deleting.docIds.length + deleting.folderIds.length > 1
                ? `Delete ${
                    deleting.docIds.length + deleting.folderIds.length
                  } items?`
                : `Delete “${deleting?.title}”?`}{" "}
              {deleting && deleting.folderIds.length > 0
                ? "Documents inside deleted folders (and any subfolders' documents) move back to the workspace root — they are not deleted."
                : "This action cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleting(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteItemsMutation.isPending}
              onClick={() => {
                if (deleting) {
                  deleteItemsMutation.mutate({
                    docIds: deleting.docIds,
                    folderIds: deleting.folderIds,
                  });
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={creatingFolder}
        onOpenChange={(open) => {
          if (!open) {
            setCreatingFolder(false);
            setNewFolderName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="new-folder-name">Name</Label>
            <Input
              id="new-folder-name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newFolderName.trim()) {
                  createFolderMutation.mutate(newFolderName.trim());
                }
              }}
              placeholder="Untitled folder"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCreatingFolder(false);
                setNewFolderName("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!newFolderName.trim() || createFolderMutation.isPending}
              onClick={() => createFolderMutation.mutate(newFolderName.trim())}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renamingFolder !== null}
        onOpenChange={(open) => {
          if (!open) setRenamingFolder(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="rename-folder-name">Name</Label>
            <Input
              id="rename-folder-name"
              value={renamingFolder?.name ?? ""}
              onChange={(e) =>
                setRenamingFolder((p) =>
                  p ? { ...p, name: e.target.value } : p,
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && renamingFolder?.name.trim()) {
                  renameFolderMutation.mutate({
                    id: renamingFolder.id,
                    name: renamingFolder.name.trim(),
                  });
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenamingFolder(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                !renamingFolder?.name.trim() || renameFolderMutation.isPending
              }
              onClick={() => {
                if (renamingFolder?.name.trim()) {
                  renameFolderMutation.mutate({
                    id: renamingFolder.id,
                    name: renamingFolder.name.trim(),
                  });
                }
              }}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 m-2 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5">
          <span className="text-lg font-medium text-primary">
            Drop files to upload
          </span>
        </div>
      )}
      <UploadPanel />
    </>
  );
}
