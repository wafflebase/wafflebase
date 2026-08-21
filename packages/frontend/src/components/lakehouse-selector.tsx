import { useCallback, useEffect, useRef, useState } from 'react';
import { IconDatabase, IconPlus } from '@tabler/icons-react';
import { fetchWorkspaceLakehouseSources } from '@/api/lakehouse';
import { isAuthExpiredError } from '@/api/auth';
import { LakehouseDialog } from '@/components/lakehouse-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { LakehouseSource } from '@/types/lakehouse';

type LakehouseSelectorProps = {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (source: LakehouseSource) => void;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Selects a direct-metadata lakehouse source for a new tab. Catalog table
 * browsing is intentionally separate; this first path derives the table
 * reference from the source's configured base path.
 */
export function LakehouseSelector({
  workspaceId,
  open,
  onOpenChange,
  onSelect,
}: LakehouseSelectorProps) {
  const [sources, setSources] = useState<LakehouseSource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const sourceCreatedRef = useRef(false);
  const loadSequenceRef = useRef(0);

  const loadSources = useCallback(
    (signal?: AbortSignal) => {
      const sequence = ++loadSequenceRef.current;
      setLoading(true);
      setLoadError(null);
      return fetchWorkspaceLakehouseSources(workspaceId, signal)
        .then((nextSources) => {
          if (signal?.aborted || loadSequenceRef.current !== sequence) return;
          setSources(nextSources);
          setSelectedId((current) =>
            current && nextSources.some((source) => source.id === current)
              ? current
              : null,
          );
        })
        .catch((error: unknown) => {
          if (
            signal?.aborted ||
            loadSequenceRef.current !== sequence ||
            isAbortError(error) ||
            isAuthExpiredError(error)
          ) {
            return;
          }
          setSources([]);
          setSelectedId(null);
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Failed to load lakehouse sources',
          );
        })
        .finally(() => {
          if (!signal?.aborted && loadSequenceRef.current === sequence) {
            setLoading(false);
          }
        });
    },
    [workspaceId],
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void loadSources(controller.signal);
    return () => controller.abort();
  }, [loadSources, open]);

  useEffect(
    () => () => {
      loadSequenceRef.current += 1;
    },
    [],
  );

  const chooseSource = (source: LakehouseSource) => {
    onSelect(source);
    setSelectedId(null);
    onOpenChange(false);
  };

  const handleSelect = () => {
    const source = sources.find((candidate) => candidate.id === selectedId);
    if (source) chooseSource(source);
  };

  return (
    <>
      <Dialog
        open={open && !showCreate}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !showCreate) {
            setSelectedId(null);
            onOpenChange(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Select Lakehouse</DialogTitle>
            <DialogDescription>
              Choose an Iceberg or Delta connection for this read-only tab.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {loading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Loading...
              </div>
            ) : loadError ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {loadError}
              </div>
            ) : sources.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No lakehouse connections yet. Create one to get started.
              </div>
            ) : (
              <div className="grid gap-2">
                <Label id="lakehouse-connections-label">Connections</Label>
                <div
                  role="group"
                  aria-labelledby="lakehouse-connections-label"
                  className="flex max-h-72 flex-col gap-1 overflow-y-auto"
                >
                  {sources.map((source) => {
                    return (
                      <button
                        type="button"
                        key={source.id}
                        aria-pressed={selectedId === source.id}
                        className={cn(
                          'flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                          'hover:bg-muted/50',
                          selectedId === source.id && 'border-primary bg-muted',
                        )}
                        onClick={() => setSelectedId(source.id)}
                        onDoubleClick={() => chooseSource(source)}
                      >
                        <IconDatabase className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">
                            {source.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {source.format} · {source.storage}
                          </span>
                          <span
                            className="truncate text-xs text-muted-foreground"
                            title={source.basePath}
                          >
                            {source.basePath}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowCreate(true)}
            >
              <IconPlus className="size-4" />
              New Connection
            </Button>
            <Button
              type="button"
              disabled={!selectedId || loading}
              onClick={handleSelect}
            >
              Select
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <LakehouseDialog
        workspaceId={workspaceId}
        open={showCreate}
        onOpenChange={(nextOpen) => {
          setShowCreate(nextOpen);
          if (!nextOpen && sourceCreatedRef.current) {
            sourceCreatedRef.current = false;
          } else if (!nextOpen && open) {
            void loadSources();
          }
        }}
        onCreated={(source) => {
          sourceCreatedRef.current = true;
          setShowCreate(false);
          chooseSource(source);
        }}
      />
    </>
  );
}
