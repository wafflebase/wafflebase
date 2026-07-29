import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  lakehouseHistoryRefKey,
  type LakehouseHistoryEntry,
  type LakehouseHistoryRef,
} from '@/types/lakehouse';

type TimeTravelSliderProps = {
  history: LakehouseHistoryEntry[];
  value?: LakehouseHistoryRef;
  /** History has been requested but has not arrived (or failed) yet. */
  loading?: boolean;
  disabled?: boolean;
  latestLabel?: string;
  onCommit: (value: LakehouseHistoryRef | undefined) => void;
};

function describeEntry(entry: LakehouseHistoryEntry): string {
  let label = describeRef(entry.ref);
  if (entry.timestamp) {
    const parsed = new Date(entry.timestamp);
    label = Number.isNaN(parsed.getTime())
      ? entry.timestamp
      : parsed.toLocaleString();
  }
  return entry.operation ? `${label} · ${entry.operation}` : label;
}

function describeRef(ref: LakehouseHistoryRef): string {
  return ref.kind === 'version'
    ? `Version ${ref.version}`
    : `Snapshot ${ref.snapshotId}`;
}

/**
 * A commit-discrete slider. Pointer movement changes only local preview state;
 * Yorkie persistence and the corresponding read happen once on value commit.
 */
export function TimeTravelSlider({
  history,
  value,
  loading = false,
  disabled = false,
  latestLabel = 'Latest',
  onCommit,
}: TimeTravelSliderProps) {
  const orderedHistory = history;
  const valueKey = lakehouseHistoryRefKey(value);
  const committedIndex =
    value === undefined
      ? orderedHistory.length
      : orderedHistory.findIndex(
          (entry) => lakehouseHistoryRefKey(entry.ref) === valueKey,
        );
  // Only meaningful once the history it is measured against has actually
  // loaded: before that every pinned commit is "not found", which would
  // announce a shared time-travel point as out of range while the first read
  // is still running (and forever if /history errors).
  const isOutsideLoadedHistory =
    value !== undefined && committedIndex < 0 && !loading;
  const resolvedCommittedIndex =
    committedIndex >= 0 ? committedIndex : orderedHistory.length;
  const [draftIndex, setDraftIndex] = useState(resolvedCommittedIndex);

  useEffect(() => {
    setDraftIndex(resolvedCommittedIndex);
  }, [resolvedCommittedIndex, valueKey]);

  const selectedEntry =
    draftIndex < orderedHistory.length ? orderedHistory[draftIndex] : undefined;
  const selectedLabel = isOutsideLoadedHistory
    ? `${describeRef(value)} · outside loaded history`
    : loading && value !== undefined && committedIndex < 0
      ? describeRef(value)
      : selectedEntry
        ? describeEntry(selectedEntry)
        : latestLabel;
  const sliderDisabled = disabled || orderedHistory.length === 0;

  const commitIndex = (nextIndex: number) => {
    const clamped = Math.max(0, Math.min(nextIndex, orderedHistory.length));
    setDraftIndex(clamped);
    onCommit(
      clamped === orderedHistory.length
        ? undefined
        : orderedHistory[clamped].ref,
    );
  };

  return (
    <div className="grid min-w-0 flex-1 gap-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">Time travel</span>
        <span className="truncate text-muted-foreground" title={selectedLabel}>
          {selectedLabel}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {isOutsideLoadedHistory ||
        (loading && value !== undefined && committedIndex < 0) ? (
          <div
            role="status"
            className="min-w-0 flex-1 truncate rounded-md border px-3 py-1.5 text-xs text-muted-foreground"
            title={selectedLabel}
          >
            {selectedLabel}
          </div>
        ) : (
          <Slider
            aria-label="Lakehouse commit"
            min={0}
            max={Math.max(orderedHistory.length, 1)}
            step={1}
            value={[draftIndex]}
            aria-valuetext={selectedLabel}
            disabled={sliderDisabled}
            onValueChange={([nextIndex]) => setDraftIndex(nextIndex)}
            onValueCommit={([nextIndex]) => commitIndex(nextIndex)}
          />
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || value === undefined}
          onClick={() => commitIndex(orderedHistory.length)}
        >
          {latestLabel}
        </Button>
      </div>
    </div>
  );
}
