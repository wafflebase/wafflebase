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
} from "lucide-react";
import { IconFileTypePdf } from "@tabler/icons-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
  deleteDocument,
  moveDocument,
  renameDocument,
} from "@/api/documents";
import {
  createFolder,
  deleteFolder,
  fetchFolders,
  renameFolder,
} from "@/api/folders";
import {
  createWorkspaceDocument,
  fetchWorkspaces,
  type Workspace,
} from "@/api/workspaces";
import { UploadPanel } from "./upload-panel";
import { useWindowFileDrop } from "./use-window-file-drop";
import { enqueue, startUploads } from "./upload-queue";
import { pickFiles } from "./pick-files";
import { ImageThumb } from "./image-thumb";

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
  accessor: (doc: Document) => string,
): ColumnDef<Document> {
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
  const columns: Array<ColumnDef<Document>> = [
    {
      accessorKey: "id",
      header: "ID",
      enableHiding: true,
    },
    {
      accessorKey: "title",
      header: ({ column }) => (
        <SortableHeader column={column}>Title</SortableHeader>
      ),
      filterFn: (row, _columnId, filterValue) =>
        matchesSearch(row.original, String(filterValue ?? "")),
      cell: ({ row }) => {
        const { Icon, color } = TYPE_META[row.original.type];
        return (
          <div className="flex items-center gap-2">
            {row.original.type === "image" ? (
              <ImageThumb documentId={String(row.original.id)} />
            ) : (
              <Icon className={`h-4 w-4 shrink-0 ${color}`} />
            )}
            <span className="capitalize">{row.getValue("title")}</span>
            {/* Live "currently editing" avatars sit next to the title rather
                than in their own column. Presentational only — Title still
                sorts by its own value. */}
            <DocumentPresenceAvatars editors={row.original.editors} />
          </div>
        );
      },
    },
    {
      id: "owner",
      accessorFn: (doc) => doc.author?.username ?? "",
      header: ({ column }) => (
        <SortableHeader column={column}>Owner</SortableHeader>
      ),
      cell: ({ row }) => {
        const author = row.original.author;
        if (!author) {
          return <span className="text-muted-foreground">—</span>;
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
    dateColumn("updatedAt", "Modified", (doc) => lastModified(doc)),
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e: MouseEvent<HTMLElement>) => {
                  e.stopPropagation();
                  setRenamingDoc({
                    id: String(row.getValue("id")),
                    title: row.getValue("title"),
                  });
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Rename
              </DropdownMenuItem>
              {row.original.canManage && (
                <DropdownMenuItem
                  onClick={(e: MouseEvent<HTMLElement>) => {
                    e.stopPropagation();
                    setMovingDoc({
                      id: String(row.getValue("id")),
                      title: row.getValue("title"),
                      workspaceId: row.original.workspaceId,
                    });
                    setTargetWorkspaceId(row.original.workspaceId);
                    setTargetFolderId(null);
                  }}
                >
                  <FolderOutput className="mr-2 h-4 w-4" />
                  Move to...
                </DropdownMenuItem>
              )}
              {row.original.canManage && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={(e: MouseEvent<HTMLElement>) => {
                    e.stopPropagation();
                    setDeletingDoc({
                      id: String(row.getValue("id")),
                      title: row.getValue("title"),
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

  const [deletingDoc, setDeletingDoc] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [renamingDoc, setRenamingDoc] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [movingDoc, setMovingDoc] = useState<{
    id: string;
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
  const [deletingFolder, setDeletingFolder] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
    enabled: movingDoc !== null,
  });

  const { data: moveTargetFolders = [] } = useQuery<Folder[]>({
    queryKey: ["workspaces", targetWorkspaceId, "folders"],
    queryFn: () => fetchFolders(targetWorkspaceId),
    enabled: movingDoc !== null && !!targetWorkspaceId,
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

  const deleteDocumentMutation = useMutation({
    mutationFn: async (id: string) => await deleteDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      if (workspaceId) {
        queryClient.invalidateQueries({
          queryKey: ["workspaces", workspaceId, "documents"],
        });
      }
    },
  });

  const renameDocumentMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) =>
      await renameDocument(id, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      if (workspaceId) {
        queryClient.invalidateQueries({
          queryKey: ["workspaces", workspaceId, "documents"],
        });
      }
      setRenamingDoc(null);
    },
  });

  const moveDocumentMutation = useMutation({
    mutationFn: async ({
      id,
      workspaceId: targetId,
      folderId: targetFid,
    }: {
      id: string;
      workspaceId?: string;
      folderId?: string | null;
    }) =>
      await moveDocument(id, { workspaceId: targetId, folderId: targetFid }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Document moved successfully");
      setMovingDoc(null);
      setTargetWorkspaceId("");
      setTargetFolderId(null);
    },
    onError: () => {
      toast.error("Failed to move document");
    },
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

  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) => deleteFolder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "folders"],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "documents"],
      });
      setDeletingFolder(null);
    },
    onError: () =>
      toast.error(
        "Failed to delete folder. Only the workspace owner or folder owner can delete it.",
      ),
  });

  // Default to most-recently-modified first (Google-Drive-style).
  const [sorting, setSorting] = useState<SortingState>([
    { id: "updatedAt", desc: true },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    id: false,
  });
  const [rowSelection, setRowSelection] = useState({});
  const [typeFilters, setTypeFilters] = useState<Set<DocumentType>>(new Set());

  const toggleType = (type: DocumentType) => {
    setTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // Type-chip filtering happens before the table so it composes cleanly with
  // the text search and column sorting the table already owns.
  const filteredData = useMemo(
    () => data.filter((doc) => matchesTypes(doc, typeFilters)),
    [data, typeFilters],
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    // Stabilize row identity across the presence-driven 5 s poll so React
    // reconciles rows by document id instead of array index — keeps any
    // open dropdown / dialog rooted in the row from remounting.
    getRowId: (row) => String(row.id),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
  });

  // Direct children of the current folder, rendered as a section above the
  // documents table. Folders never mix into the sortable/filterable table
  // row model — keeping them separate avoids a union row type over columns.
  const childFolders = folders.filter(
    (f) => (f.parentId ?? null) === (folderId ?? null),
  );

  return (
    <>
      <div className="w-full">
      {workspaceId && onNavigateFolder && (
        <div className="pt-2">
          <FolderBreadcrumb
            folders={folders}
            folderId={folderId}
            onNavigate={onNavigateFolder}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 py-4">
        <Input
          placeholder="Search by title..."
          aria-label="Search documents by title"
          value={(table.getColumn("title")?.getFilterValue() as string) ?? ""}
          onChange={(e) =>
            table.getColumn("title")?.setFilterValue(e.target.value)
          }
          className="w-full max-w-xs"
        />
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
      {workspaceId && onNavigateFolder && childFolders.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {childFolders.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2 rounded-md border pl-3 pr-1 py-2 text-sm hover:bg-muted"
            >
              <button
                type="button"
                onClick={() => onNavigateFolder(f.id)}
                className="flex flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{f.name}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    aria-label={`Actions for ${f.name}`}
                  >
                    <span className="sr-only">Open menu</span>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() =>
                      setRenamingFolder({ id: f.id, name: f.name })
                    }
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() =>
                      setDeletingFolder({ id: f.id, name: f.name })
                    }
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}
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
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${String(row.getValue("title") ?? "document")}`}
                  className="cursor-pointer hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  onClick={(e: MouseEvent<HTMLElement>) => {
                    if ((e.target as HTMLElement).closest("input, button")) {
                      return;
                    }
                    navigate(getDocumentPath(row.original));
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    if ((e.target as HTMLElement).closest("input, button")) {
                      return;
                    }
                    e.preventDefault();
                    navigate(getDocumentPath(row.original));
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
              ))
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
        open={movingDoc !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMovingDoc(null);
            setTargetWorkspaceId("");
            setTargetFolderId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move Document</DialogTitle>
            <DialogDescription>
              Select a workspace and folder to move &ldquo;{movingDoc?.title}
              &rdquo; to.
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
                setMovingDoc(null);
                setTargetWorkspaceId("");
                setTargetFolderId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={
                !targetWorkspaceId || moveDocumentMutation.isPending
              }
              onClick={() => {
                if (movingDoc && targetWorkspaceId) {
                  moveDocumentMutation.mutate({
                    id: movingDoc.id,
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
        open={deletingDoc !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingDoc(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Document</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deletingDoc?.title}
              &rdquo;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeletingDoc(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteDocumentMutation.isPending}
              onClick={() => {
                if (deletingDoc) {
                  deleteDocumentMutation.mutate(deletingDoc.id, {
                    onSuccess: () => setDeletingDoc(null),
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

      <Dialog
        open={deletingFolder !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingFolder(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete folder</DialogTitle>
            <DialogDescription>
              Delete &ldquo;{deletingFolder?.name}&rdquo;? Documents inside it
              (and any subfolders&apos; documents) move back to the workspace
              root — they are not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeletingFolder(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteFolderMutation.isPending}
              onClick={() => {
                if (deletingFolder) {
                  deleteFolderMutation.mutate(deletingFolder.id);
                }
              }}
            >
              Delete
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
