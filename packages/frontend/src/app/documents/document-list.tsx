import { FormEvent, MouseEvent, ReactNode, useMemo, useState } from "react";
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
  FileType2,
  FolderOutput,
  MoreHorizontal,
  Pencil,
  Plus,
  Presentation,
  Sheet,
  Trash2,
} from "lucide-react";

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

import type { Document, DocumentType } from "@/types/documents";
import { DocumentPresenceAvatars } from "./document-presence-avatars";
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
  createWorkspaceDocument,
  fetchWorkspaces,
  type Workspace,
} from "@/api/workspaces";
import { pickAndImportDocx } from "@/app/docs/docx-actions";
import { pickFile } from "@/app/docs/export-utils";
import { setPendingImport } from "@/app/docs/pending-imports";
import { uploadPdf } from "@/api/files";
import { pickAndImportPptx } from "@/app/slides/pptx-actions";
import { setPendingImport as setPendingPptxImport } from "@/app/slides/pending-imports";
import { pickAndImportXlsx } from "@/app/spreadsheet/xlsx-actions";
import { setPendingImport as setPendingXlsxImport } from "@/app/spreadsheet/pending-imports";

/**
 * Single source of truth for each document type's label, icon, and color.
 * The title cell and the filter chips both derive from this so a new type
 * needs one edit, not several.
 */
const TYPE_META: Record<
  DocumentType,
  { label: string; Icon: typeof Sheet; color: string }
> = {
  sheet: { label: "Sheets", Icon: Sheet, color: "text-green-600" },
  doc: { label: "Docs", Icon: FileText, color: "text-blue-500" },
  slides: { label: "Slides", Icon: Presentation, color: "text-orange-500" },
  pdf: { label: "PDF", Icon: FileType2, color: "text-red-500" },
};

/** Document types offered as filter chips, in display order. */
const TYPE_OPTIONS: ReadonlyArray<DocumentType> = [
  "sheet",
  "doc",
  "slides",
  "pdf",
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
 * (e.g. "3 days ago"). Shared by the Created and Modified columns.
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
 * Renders the DocumentList component.
 */
export function DocumentList({
  data,
  workspaceId,
}: {
  data: Document[];
  workspaceId?: string;
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
            <Icon className={`h-4 w-4 shrink-0 ${color}`} />
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
    dateColumn("createdAt", "Created", (doc) => doc.createdAt),
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
              <DropdownMenuItem
                onClick={(e: MouseEvent<HTMLElement>) => {
                  e.stopPropagation();
                  setMovingDoc({
                    id: String(row.getValue("id")),
                    title: row.getValue("title"),
                    workspaceId: row.original.workspaceId,
                  });
                }}
              >
                <FolderOutput className="mr-2 h-4 w-4" />
                Move to...
              </DropdownMenuItem>
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

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
    enabled: movingDoc !== null,
  });

  const createDocumentMutation = useMutation({
    mutationFn: async (data: { title: string; type?: DocumentType }) =>
      workspaceId
        ? await createWorkspaceDocument(workspaceId, data)
        : await createDocument(data),
    onSuccess: (doc) => navigate(getDocumentPath(doc)),
  });

  const [importing, setImporting] = useState(false);

  // Lazily create (first tick) or update the import progress toast.
  // Returns the toast id so the caller can thread it to success/error.
  const updateImportToast = (
    toastId: string | number | undefined,
    title: string,
    done: number,
    total: number,
  ): string | number => {
    const description =
      total > 0
        ? `Uploading images ${Math.min(done, total)} / ${total}`
        : undefined;
    if (toastId === undefined) {
      return toast.loading(`Importing "${title}"…`, { description });
    }
    toast.loading(`Importing "${title}"…`, { id: toastId, description });
    return toastId;
  };

  const handleImportDocx = async () => {
    if (importing) return;
    setImporting(true);
    let toastId: string | number | undefined;
    try {
      const result = await pickAndImportDocx(({ done, total, fileName }) => {
        const title =
          fileName.replace(/\.docx$/i, "") || "Imported Document";
        toastId = updateImportToast(toastId, title, done, total);
      });
      if (!result) {
        if (toastId !== undefined) toast.dismiss(toastId);
        return;
      }

      const title =
        result.fileName.replace(/\.docx$/i, "") || "Imported Document";
      const created = workspaceId
        ? await createWorkspaceDocument(workspaceId, { title, type: "doc" })
        : await createDocument({ title, type: "doc" });

      setPendingImport(String(created.id), result.doc);
      const message = `Imported "${title}"`;
      if (toastId !== undefined) toast.success(message, { id: toastId });
      else toast.success(message);
      navigate(getDocumentPath(created));
    } catch (err) {
      console.error("DOCX import failed", err);
      const message =
        err instanceof Error ? `Import failed: ${err.message}` : "Import failed";
      if (toastId !== undefined) toast.error(message, { id: toastId });
      else toast.error(message);
    } finally {
      setImporting(false);
    }
  };

  const handleImportPptx = async () => {
    if (importing) return;
    setImporting(true);
    let toastId: string | number | undefined;
    try {
      const result = await pickAndImportPptx(({ done, total, fileName }) => {
        const title =
          fileName.replace(/\.pptx$/i, "") || "Imported Presentation";
        toastId = updateImportToast(toastId, title, done, total);
      });
      if (!result) {
        if (toastId !== undefined) toast.dismiss(toastId);
        return;
      }

      const title =
        result.fileName.replace(/\.pptx$/i, "") || "Imported Presentation";
      const created = workspaceId
        ? await createWorkspaceDocument(workspaceId, { title, type: "slides" })
        : await createDocument({ title, type: "slides" });

      setPendingPptxImport(String(created.id), result.document);
      const summary = result.report.summary();
      const message =
        summary === "Imported with no fallbacks."
          ? `Imported "${title}"`
          : `Imported "${title}" — ${summary}`;
      if (toastId !== undefined) toast.success(message, { id: toastId });
      else toast.success(message);
      navigate(getDocumentPath(created));
    } catch (err) {
      console.error("PPTX import failed", err);
      const message =
        err instanceof Error ? `Import failed: ${err.message}` : "Import failed";
      if (toastId !== undefined) toast.error(message, { id: toastId });
      else toast.error(message);
    } finally {
      setImporting(false);
    }
  };

  const handleImportXlsx = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const result = await pickAndImportXlsx();
      if (!result) return;

      const title = result.fileName.replace(/\.xlsx$/i, "") || "Imported Sheet";
      const created = workspaceId
        ? await createWorkspaceDocument(workspaceId, { title, type: "sheet" })
        : await createDocument({ title, type: "sheet" });

      setPendingXlsxImport(String(created.id), result.document);
      toast.success(
        result.document.tabOrder.length === 1
          ? `Imported "${title}"`
          : `Imported "${title}" with ${result.document.tabOrder.length} sheets`,
      );
      navigate(getDocumentPath(created));
    } catch (err) {
      console.error("XLSX import failed", err);
      toast.error(
        err instanceof Error ? `Import failed: ${err.message}` : "Import failed",
      );
    } finally {
      setImporting(false);
    }
  };

  const handleUploadPdf = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const file = await pickFile("application/pdf");
      if (!file) return;
      const { id: fileId } = await uploadPdf(file);
      const title = file.name.replace(/\.pdf$/i, "") || "Untitled PDF";
      const payload = { title, type: "pdf" as const, fileId };
      const created = workspaceId
        ? await createWorkspaceDocument(workspaceId, payload)
        : await createDocument(payload);
      navigate(getDocumentPath(created));
    } catch (err) {
      console.error("PDF upload failed", err);
      toast.error(
        err instanceof Error ? `Upload failed: ${err.message}` : "Upload failed",
      );
    } finally {
      setImporting(false);
    }
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
    }: {
      id: string;
      workspaceId: string;
    }) => await moveDocument(id, targetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Document moved successfully");
      setMovingDoc(null);
      setTargetWorkspaceId("");
    },
    onError: () => {
      toast.error("Failed to move document");
    },
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

  return (
    <div className="w-full">
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
              <Button
                key={type}
                type="button"
                variant={active ? "secondary" : "outline"}
                size="icon"
                aria-pressed={active}
                aria-label={`Filter by ${label}`}
                title={label}
                onClick={() => toggleType(type)}
                className={active ? undefined : "text-muted-foreground"}
              >
                <Icon className={`h-4 w-4 ${color}`} />
              </Button>
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
                  title: "New Presentation",
                  type: "slides",
                })
              }
            >
              <Presentation className="mr-2 h-4 w-4 text-orange-500" />
              New Presentation
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={importing}
              onClick={handleImportXlsx}
            >
              <FileDown className="mr-2 h-4 w-4 text-green-600" />
              Import XLSX
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={importing}
              onClick={handleImportDocx}
            >
              <FileDown className="mr-2 h-4 w-4 text-blue-500" />
              Import DOCX
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={importing}
              onClick={handleImportPptx}
            >
              <FileDown className="mr-2 h-4 w-4 text-orange-500" />
              Import PPTX
            </DropdownMenuItem>
            <DropdownMenuItem disabled={importing} onClick={handleUploadPdf}>
              <FileType2 className="mr-2 h-4 w-4 text-red-500" />
              Upload PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
                              title: "New Presentation",
                              type: "slides",
                            })
                          }
                        >
                          <Presentation className="mr-2 h-4 w-4 text-orange-500" />
                          New Presentation
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={importing}
                          onClick={handleImportXlsx}
                        >
                          <FileDown className="mr-2 h-4 w-4 text-green-600" />
                          Import XLSX
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={importing}
                          onClick={handleImportDocx}
                        >
                          <FileDown className="mr-2 h-4 w-4 text-blue-500" />
                          Import DOCX
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={importing}
                          onClick={handleImportPptx}
                        >
                          <FileDown className="mr-2 h-4 w-4 text-orange-500" />
                          Import PPTX
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={importing}
                          onClick={handleUploadPdf}
                        >
                          <FileType2 className="mr-2 h-4 w-4 text-red-500" />
                          Upload PDF
                        </DropdownMenuItem>
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
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move Document</DialogTitle>
            <DialogDescription>
              Select a workspace to move &ldquo;{movingDoc?.title}&rdquo; to.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="move-workspace">Workspace</Label>
              <Select
                value={targetWorkspaceId}
                onValueChange={setTargetWorkspaceId}
              >
                <SelectTrigger id="move-workspace">
                  <SelectValue placeholder="Select a workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces
                    .filter((w) => w.id !== movingDoc?.workspaceId)
                    .map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
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
    </div>
  );
}
