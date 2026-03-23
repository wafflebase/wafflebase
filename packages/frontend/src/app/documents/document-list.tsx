import { FormEvent, MouseEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
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
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  FileText,
  FolderOutput,
  MoreHorizontal,
  Pencil,
  Plus,
  Sheet,
  Trash2,
} from "lucide-react";

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

import type { Document, DocumentType } from "@/types/documents";
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

function getDocumentPath(doc: { id: number | string; type?: DocumentType }) {
  return doc.type === "doc" ? `/d/${doc.id}` : `/s/${doc.id}`;
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
      header: "Title",
      cell: ({ row }) => {
        const docType = row.original.type;
        return (
          <div className="flex items-center gap-2">
            {docType === "doc" ? (
              <FileText className="h-4 w-4 shrink-0 text-blue-500" />
            ) : (
              <Sheet className="h-4 w-4 shrink-0 text-green-600" />
            )}
            <span className="capitalize">{row.getValue("title")}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: () => <div className="text-right">Created At</div>,
      cell: ({ row }) => {
        const createdAt = row.getValue<string>("createdAt");
        const formatted = formatDistanceToNow(new Date(createdAt), {
          includeSeconds: true,
          addSuffix: true,
        });
        return <div className="text-right font-medium">{formatted}</div>;
      },
    },
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

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    id: false,
  });
  const [rowSelection, setRowSelection] = useState({});

  const table = useReactTable({
    data,
    columns,
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
      <div className="flex items-center justify-between py-4">
        <Input
          placeholder="Filter by title..."
          value={(table.getColumn("title")?.getFilterValue() as string) ?? ""}
          onChange={(e) =>
            table.getColumn("title")?.setFilterValue(e.target.value)
          }
          className="max-w-sm"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="flex items-center gap-2">
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
                  className="cursor-pointer hover:bg-muted"
                  onClick={(e: MouseEvent<HTMLElement>) => {
                    if ((e.target as HTMLElement).closest("input, button")) {
                      return;
                    }
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
