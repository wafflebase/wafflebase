import { useMemo, useState } from "react";
import type { Document as YorkieDoc } from "yorkie-js-sdk";
import type { AggregateFunction, Grid } from "@wafflebase/sheet";
import {
  IconChevronDown,
  IconChevronRight,
  IconLayoutRows,
  IconPlus,
  IconRefresh,
  IconSortAscending,
  IconSortDescending,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SpreadsheetDocument } from "@/types/worksheet";
import { usePivotTable } from "./use-pivot-table";

type PivotEditorPanelProps = {
  doc: YorkieDoc<SpreadsheetDocument> | null;
  tabId: string;
  sourceGrid: Grid | null;
  onClose: () => void;
};

const AGGREGATE_OPTIONS: { value: AggregateFunction; label: string }[] = [
  { value: "SUM", label: "SUM" },
  { value: "COUNT", label: "COUNT" },
  { value: "COUNTA", label: "COUNTA" },
  { value: "AVERAGE", label: "AVERAGE" },
  { value: "MIN", label: "MIN" },
  { value: "MAX", label: "MAX" },
];

function CollapsibleSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="space-y-2">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        {title}
        {count > 0 && (
          <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {count}
          </span>
        )}
      </button>
      {open && children}
    </section>
  );
}

/**
 * Renders the PivotEditorPanel component.
 */
export function PivotEditorPanel({
  doc,
  tabId,
  sourceGrid,
  onClose,
}: PivotEditorPanelProps) {
  const {
    definition,
    addRowField,
    addColumnField,
    addValueField,
    addFilterField,
    removeField,
    setAggregation,
    toggleSort,
    setShowTotals,
    refresh,
    getSourceHeaders,
  } = usePivotTable({ doc, tabId, sourceGrid });

  const headers = useMemo(() => getSourceHeaders(), [getSourceHeaders]);

  // Collect all used source columns to prevent duplicates
  const usedColumns = useMemo(() => {
    if (!definition) return new Set<number>();
    const used = new Set<number>();
    for (const f of definition.rowFields) used.add(f.sourceColumn);
    for (const f of definition.columnFields) used.add(f.sourceColumn);
    for (const f of definition.valueFields) used.add(f.sourceColumn);
    for (const f of definition.filterFields) used.add(f.sourceColumn);
    return used;
  }, [definition]);

  const availableColumns = useMemo(
    () =>
      headers
        .map((label, index) => ({ label, sourceColumn: index }))
        .filter(({ sourceColumn }) => !usedColumns.has(sourceColumn)),
    [headers, usedColumns],
  );

  if (!definition) {
    return null;
  }

  const sourceTabName = (() => {
    if (!doc) return definition.sourceTabId;
    const root = doc.getRoot();
    return root.tabs[definition.sourceTabId]?.name ?? definition.sourceTabId;
  })();

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-80 flex-col overflow-hidden border-l bg-background shadow-lg">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconLayoutRows size={16} className="text-primary" />
            <p className="text-sm font-semibold">Pivot table editor</p>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            Source: {sourceTabName} ({definition.sourceRange})
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onClose}
          aria-label="Close pivot editor"
        >
          <IconX size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 pb-6">
        {/* Filters */}
        <CollapsibleSection
          title="Filters"
          count={definition.filterFields.length}
        >
          {definition.filterFields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No filters applied.
            </p>
          ) : (
            <div className="space-y-1.5">
              {definition.filterFields.map((field, index) => (
                <div
                  key={`filter-${field.sourceColumn}`}
                  className="flex items-center justify-between rounded-md border px-2 py-1.5"
                >
                  <span className="truncate text-sm">{field.label}</span>
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-destructive"
                    onClick={() => removeField("filterFields", index)}
                    aria-label={`Remove filter ${field.label}`}
                  >
                    <IconX size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <AddFieldDropdown
            available={availableColumns}
            onAdd={(col) =>
              addFilterField({
                sourceColumn: col.sourceColumn,
                label: col.label,
                hiddenValues: [],
              })
            }
          />
        </CollapsibleSection>

        {/* Rows */}
        <CollapsibleSection
          title="Rows"
          count={definition.rowFields.length}
        >
          {definition.rowFields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No row fields.
            </p>
          ) : (
            <div className="space-y-1.5">
              {definition.rowFields.map((field, index) => (
                <div
                  key={`row-${field.sourceColumn}`}
                  className="flex items-center justify-between rounded-md border px-2 py-1.5"
                >
                  <span className="truncate text-sm">{field.label}</span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
                      onClick={() => toggleSort("rowFields", index)}
                      aria-label={`Toggle sort for ${field.label}`}
                    >
                      {field.sort === "desc" ? (
                        <IconSortDescending size={14} />
                      ) : (
                        <IconSortAscending size={14} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-destructive"
                      onClick={() => removeField("rowFields", index)}
                      aria-label={`Remove row ${field.label}`}
                    >
                      <IconX size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <AddFieldDropdown
            available={availableColumns}
            onAdd={(col) =>
              addRowField({
                sourceColumn: col.sourceColumn,
                label: col.label,
                sort: "asc",
              })
            }
          />
        </CollapsibleSection>

        {/* Columns */}
        <CollapsibleSection
          title="Columns"
          count={definition.columnFields.length}
        >
          {definition.columnFields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No column fields.
            </p>
          ) : (
            <div className="space-y-1.5">
              {definition.columnFields.map((field, index) => (
                <div
                  key={`col-${field.sourceColumn}`}
                  className="flex items-center justify-between rounded-md border px-2 py-1.5"
                >
                  <span className="truncate text-sm">{field.label}</span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
                      onClick={() => toggleSort("columnFields", index)}
                      aria-label={`Toggle sort for ${field.label}`}
                    >
                      {field.sort === "desc" ? (
                        <IconSortDescending size={14} />
                      ) : (
                        <IconSortAscending size={14} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-destructive"
                      onClick={() => removeField("columnFields", index)}
                      aria-label={`Remove column ${field.label}`}
                    >
                      <IconX size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <AddFieldDropdown
            available={availableColumns}
            onAdd={(col) =>
              addColumnField({
                sourceColumn: col.sourceColumn,
                label: col.label,
                sort: "asc",
              })
            }
          />
        </CollapsibleSection>

        {/* Values */}
        <CollapsibleSection
          title="Values"
          count={definition.valueFields.length}
        >
          {definition.valueFields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No value fields.
            </p>
          ) : (
            <div className="space-y-1.5">
              {definition.valueFields.map((field, index) => (
                <div
                  key={`val-${field.sourceColumn}`}
                  className="space-y-1.5 rounded-md border px-2 py-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate text-sm">{field.label}</span>
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-destructive"
                      onClick={() => removeField("valueFields", index)}
                      aria-label={`Remove value ${field.label}`}
                    >
                      <IconX size={14} />
                    </button>
                  </div>
                  <Select
                    value={field.aggregation}
                    onValueChange={(value) =>
                      setAggregation(index, value as AggregateFunction)
                    }
                  >
                    <SelectTrigger className="h-7 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGGREGATE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
          <AddFieldDropdown
            available={availableColumns}
            onAdd={(col) =>
              addValueField({
                sourceColumn: col.sourceColumn,
                label: col.label,
                aggregation: "SUM",
              })
            }
          />
        </CollapsibleSection>

        {/* Show Totals */}
        <section className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Totals
          </Label>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={definition.showTotals.rows}
                onCheckedChange={(checked) =>
                  setShowTotals("rows", checked === true)
                }
              />
              <span className="text-sm">Show row totals</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={definition.showTotals.columns}
                onCheckedChange={(checked) =>
                  setShowTotals("columns", checked === true)
                }
              />
              <span className="text-sm">Show column totals</span>
            </label>
          </div>
        </section>

        {/* Refresh */}
        <Button
          type="button"
          className="w-full gap-2"
          onClick={refresh}
          disabled={definition.valueFields.length === 0}
        >
          <IconRefresh size={16} />
          Refresh pivot table
        </Button>
      </div>
    </aside>
  );
}

function AddFieldDropdown({
  available,
  onAdd,
}: {
  available: { label: string; sourceColumn: number }[];
  onAdd: (col: { label: string; sourceColumn: number }) => void;
}) {
  if (available.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
        >
          <IconPlus size={14} />
          Add
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {available.map((col) => (
          <DropdownMenuItem
            key={col.sourceColumn}
            onSelect={() => onAdd(col)}
          >
            {col.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
