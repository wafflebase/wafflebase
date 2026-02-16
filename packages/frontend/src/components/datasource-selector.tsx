import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fetchDataSources } from "@/api/datasources";
import { DataSourceDialog } from "./datasource-dialog";
import { IconDatabase, IconPlus } from "@tabler/icons-react";
import type { DataSource } from "@/types/datasource";
import { cn } from "@/lib/utils";

type DataSourceSelectorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (ds: DataSource) => void;
};

export function DataSourceSelector({
  open,
  onOpenChange,
  onSelect,
}: DataSourceSelectorProps) {
  const [datasources, setDatasources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLoading(true);
      fetchDataSources()
        .then(setDatasources)
        .catch(() => setDatasources([]))
        .finally(() => setLoading(false));
    }
  }, [open]);

  const handleSelect = () => {
    const ds = datasources.find((d) => d.id === selectedId);
    if (ds) {
      onSelect(ds);
      onOpenChange(false);
    }
  };

  return (
    <>
      <Dialog open={open && !showCreate} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Select DataSource</DialogTitle>
            <DialogDescription>
              Choose an existing connection or create a new one.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {loading ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                Loading...
              </div>
            ) : datasources.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                No datasources yet. Create one to get started.
              </div>
            ) : (
              <div className="flex flex-col gap-1 max-h-60 overflow-y-auto">
                {datasources.map((ds) => (
                  <button
                    key={ds.id}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded text-sm text-left cursor-pointer",
                      "hover:bg-muted/50 transition-colors",
                      selectedId === ds.id && "bg-muted"
                    )}
                    onClick={() => setSelectedId(ds.id)}
                    onDoubleClick={() => {
                      onSelect(ds);
                      onOpenChange(false);
                    }}
                  >
                    <IconDatabase className="size-4 text-muted-foreground shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium truncate">{ds.name}</span>
                      <span className="text-xs text-muted-foreground truncate">
                        {ds.host}:{ds.port}/{ds.database}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCreate(true)}
            >
              <IconPlus className="size-4" />
              New Connection
            </Button>
            <Button
              size="sm"
              disabled={!selectedId}
              onClick={handleSelect}
            >
              Select
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DataSourceDialog
        open={showCreate}
        onOpenChange={(v) => {
          setShowCreate(v);
          if (!v) {
            // Refresh list after creating
            fetchDataSources()
              .then(setDatasources)
              .catch(() => {});
          }
        }}
        onCreated={(ds) => {
          onSelect(ds);
          onOpenChange(false);
          setShowCreate(false);
        }}
      />
    </>
  );
}
