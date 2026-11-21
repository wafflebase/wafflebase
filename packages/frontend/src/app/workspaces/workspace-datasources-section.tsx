import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Database,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isAuthExpiredError } from "@/api/auth";
import { fetchWorkspaceDataSources } from "@/api/workspaces";
import { deleteDataSource, testDataSourceConnection } from "@/api/datasources";
import { DataSourceDialog } from "@/components/datasource-dialog";
import { DataSourceEditDialog } from "@/components/datasource-edit-dialog";
import type { DataSource } from "@/types/datasource";

/** The `id` the settings page scrolls to for `#datasources`. */
export const DATASOURCES_SECTION_ID = "datasources";

/**
 * Workspace settings section for the workspace's database connections.
 *
 * Data sources are configured once and rarely touched again: the everyday
 * path — picking a connection for a SQL tab — is the sheet's
 * `DataSourceSelector`, which can also create one. So management lives here
 * beside API keys rather than behind its own sidebar entry. Every datasource
 * route is `assertMember`-gated, so the section is shown to every member.
 *
 * Rows are a list, not a table: a connection string is too long for a
 * phone-width table, which used to push the actions column off-screen.
 */
export function WorkspaceDataSourcesSection({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["workspaces", workspaceId, "datasources"];
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<DataSource | null>(null);
  // Per row, so testing a second connection while the first is still
  // running does not steal the first one's spinner.
  const [status, setStatus] = useState<Record<string, ConnectionState>>({});
  const setRowStatus = (id: string, state: ConnectionState | undefined) =>
    setStatus((prev) => {
      const next = { ...prev };
      if (state === undefined) delete next[id];
      else next[id] = state;
      return next;
    });

  const {
    data: datasources,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<DataSource[]>({
    queryKey,
    queryFn: () => fetchWorkspaceDataSources(workspaceId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDataSource(id),
    onSuccess: () => {
      void invalidate();
      toast.success("Data source deleted");
    },
    onError: (error) => {
      if (isAuthExpiredError(error)) return;
      toast.error("Couldn't delete the data source");
    },
  });

  const testConnection = async (id: string) => {
    setRowStatus(id, "testing");
    try {
      const result = await testDataSourceConnection(id);
      setRowStatus(id, result.success ? "connected" : "failed");
      if (result.success) {
        toast.success("Connected");
      } else {
        toast.error(`Couldn't connect: ${result.error}`);
      }
    } catch (error) {
      if (isAuthExpiredError(error)) {
        setRowStatus(id, undefined);
        return;
      }
      setRowStatus(id, "failed");
      toast.error("Couldn't test the connection");
    }
  };

  return (
    <section id={DATASOURCES_SECTION_ID} className="scroll-mt-4 space-y-2">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Data sources</h2>
          <p className="text-sm text-muted-foreground">
            Database connections that SQL tabs in this workspace read from.
            Any member can use them; passwords are never shown again.
          </p>
        </div>
        {/* Outline, never primary: the page's main action is "Create invite
            link" for an owner and "Create API key" for a member (DESIGN.md,
            the One Accent Rule). */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowCreate(true)}
          className="flex shrink-0 items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          New data source
        </Button>
      </div>

      {/* A failed background refetch keeps the rows already on screen; the
          error state is only for a list that never loaded. */}
      {isLoading ? (
        <div className="space-y-3 rounded-md border p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : isError && !datasources ? (
        <p className="text-sm text-muted-foreground">
          Couldn't load data sources.{" "}
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </p>
      ) : datasources && datasources.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {datasources.map((ds) => (
            <li key={ds.id} className="flex items-center gap-3 px-4 py-3">
              <Database
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {ds.name}
                  </span>
                  {ds.sslEnabled && <Badge variant="secondary">SSL</Badge>}
                </div>
                <p
                  className="truncate text-sm text-muted-foreground"
                  title={`${ds.username}@${ds.host}:${ds.port}/${ds.database}`}
                >
                  {ds.username}@{ds.host}:{ds.port}/{ds.database}
                </p>
              </div>
              <ConnectionStatus state={status[ds.id]} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 shrink-0 p-0"
                    aria-label={`Actions for ${ds.name}`}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={status[ds.id] === "testing"}
                    onClick={() => void testConnection(ds.id)}
                  >
                    <Plug className="mr-2 h-4 w-4" />
                    Test connection
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setEditing(ds)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => deleteMutation.mutate(ds.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No data sources.</p>
      )}

      <DataSourceDialog
        workspaceId={workspaceId}
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={() => {
          setShowCreate(false);
          void invalidate();
        }}
      />

      <DataSourceEditDialog
        datasource={editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={() => {
          // The last test result described the old settings.
          if (editing) setRowStatus(editing.id, undefined);
          setEditing(null);
          void invalidate();
        }}
      />
    </section>
  );
}

type ConnectionState = "testing" | "connected" | "failed";

/** The last "Test connection" outcome for a row; nothing until one runs. */
function ConnectionStatus({ state }: { state: ConnectionState | undefined }) {
  if (state === "testing") {
    return (
      <Loader2
        className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
        aria-label="Testing connection"
      />
    );
  }
  if (state === "connected") {
    return (
      <CheckCircle2
        className="h-4 w-4 shrink-0 text-success"
        aria-label="Connected"
      />
    );
  }
  if (state === "failed") {
    return (
      <XCircle
        className="h-4 w-4 shrink-0 text-destructive"
        aria-label="Couldn't connect"
      />
    );
  }
  return null;
}
