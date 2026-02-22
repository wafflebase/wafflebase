import { MouseEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Plug,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

import type { DataSource } from "@/types/datasource";
import { deleteDataSource, testDataSourceConnection } from "@/api/datasources";
import { isAuthExpiredError } from "@/api/auth";
import { DataSourceDialog } from "@/components/datasource-dialog";
import { DataSourceEditDialog } from "./datasource-edit-dialog";
import { toast } from "sonner";

/**
 * Renders the DataSourceList component.
 */
export function DataSourceList({ data }: { data: DataSource[] }) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingDs, setEditingDs] = useState<DataSource | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, boolean | null>
  >({});

  const deleteDataSourceMutation = useMutation({
    mutationFn: async (id: string) => await deleteDataSource(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["datasources"] });
      toast.success("DataSource deleted");
    },
    onError: (error) => {
      if (isAuthExpiredError(error)) return;
      toast.error("Failed to delete datasource");
    },
  });

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    setTestResults((prev) => ({ ...prev, [id]: null }));
    try {
      const result = await testDataSourceConnection(id);
      setTestResults((prev) => ({ ...prev, [id]: result.success }));
      if (result.success) {
        toast.success("Connection successful");
      } else {
        toast.error(`Connection failed: ${result.error}`);
      }
    } catch (error) {
      if (isAuthExpiredError(error)) return;
      setTestResults((prev) => ({ ...prev, [id]: false }));
      toast.error("Failed to test connection");
    } finally {
      setTestingId(null);
    }
  };

  const columns: Array<ColumnDef<DataSource>> = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div className="font-medium">{row.getValue("name")}</div>
      ),
    },
    {
      id: "connection",
      header: "Connection",
      cell: ({ row }) => {
        const ds = row.original;
        return (
          <div className="text-sm text-muted-foreground">
            {ds.host}:{ds.port}/{ds.database}
          </div>
        );
      },
    },
    {
      accessorKey: "username",
      header: "User",
      cell: ({ row }) => (
        <div className="text-sm">{row.getValue("username")}</div>
      ),
    },
    {
      id: "ssl",
      header: "SSL",
      cell: ({ row }) =>
        row.original.sslEnabled ? <Badge variant="secondary">SSL</Badge> : null,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const id = row.original.id;
        const result = testResults[id];
        if (testingId === id) {
          return (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          );
        }
        if (result === true) {
          return <CheckCircle2 className="h-4 w-4 text-green-500" />;
        }
        if (result === false) {
          return <XCircle className="h-4 w-4 text-red-500" />;
        }
        return <span className="text-sm text-muted-foreground">—</span>;
      },
    },
    {
      accessorKey: "createdAt",
      header: () => <div className="text-right">Created</div>,
      cell: ({ row }) => {
        const createdAt = row.getValue<string>("createdAt");
        const formatted = formatDistanceToNow(new Date(createdAt), {
          includeSeconds: true,
          addSuffix: true,
        });
        return <div className="text-right text-sm">{formatted}</div>;
      },
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const ds = row.original;
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
                  handleTestConnection(ds.id);
                }}
              >
                <Plug className="mr-2 h-4 w-4" />
                Test Connection
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e: MouseEvent<HTMLElement>) => {
                  e.stopPropagation();
                  setEditingDs(ds);
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-500 focus:text-red-500"
                onClick={(e: MouseEvent<HTMLElement>) => {
                  e.stopPropagation();
                  deleteDataSourceMutation.mutate(ds.id);
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

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
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
          placeholder="Filter by name..."
          value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
          onChange={(e) =>
            table.getColumn("name")?.setFilterValue(e.target.value)
          }
          className="max-w-sm"
        />
        <Button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New DataSource
        </Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
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
                  className="h-24 text-center"
                >
                  No datasources yet. Create one to get started.
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

      <DataSourceDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={() => {
          setShowCreate(false);
          queryClient.invalidateQueries({ queryKey: ["datasources"] });
        }}
      />

      <DataSourceEditDialog
        datasource={editingDs}
        open={editingDs !== null}
        onOpenChange={(open: boolean) => {
          if (!open) setEditingDs(null);
        }}
        onSaved={() => {
          setEditingDs(null);
          queryClient.invalidateQueries({ queryKey: ["datasources"] });
        }}
      />
    </div>
  );
}
