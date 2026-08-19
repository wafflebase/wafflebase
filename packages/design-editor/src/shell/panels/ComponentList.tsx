import { useState } from 'react';
import { Search, Boxes, Plus } from 'lucide-react';
import { cn } from '../lib/cn.ts';
import type { ComponentMeta } from '../../types.ts';

interface ComponentListProps {
  components: ComponentMeta[];
  selected: string;
  onSelect: (name: string) => void;
}

/** Left pane: searchable list of components parsed from the AST metadata. */
export function ComponentList({ components, selected, onSelect }: ComponentListProps) {
  const [query, setQuery] = useState('');
  const filtered = components.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-1 pb-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Components
        </span>
        {/*
          Disabled rather than deleted: the row reserves the slot, and a control that looks
          active while doing nothing reads as a broken editor. `type` is not decoration —
          an untyped button inside a form defaults to `submit`.
        */}
        <button
          type="button"
          disabled
          aria-label="New component"
          title="Creating a component is not wired up yet"
          className="rounded-md p-1 text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search components"
          aria-label="Search components"
          className="w-full rounded-md border border-input bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      <nav className="flex flex-col gap-1 overflow-y-auto">
        {filtered.map((c) => {
          const isActive = c.name === selected;
          const axisCount = c.cva
            ? Object.values(c.cva.axes).reduce((n, vals) => n + Object.keys(vals).length, 0)
            : 0;
          return (
            <button
              key={c.name}
              onClick={() => onSelect(c.name)}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors',
                isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
              )}
            >
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-md border border-border',
                  isActive ? 'bg-background' : 'bg-muted',
                )}
              >
                {/*
                  ONE icon, not two. The prototype used `hasPreview()` to mark components
                  with a live preview — a distinction that only meant something while a
                  preview pane existed, and that pane is not part of this rollout (its
                  renderer map is hand-written per component and cannot be derived from
                  source). A marker for a capability nothing has is worse than no marker.
                */}
                <Boxes className="size-4 text-wb-accent" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{c.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {c.cva ? `${axisCount} variants` : 'No variants'}
                </span>
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground">No matches.</p>
        )}
      </nav>
    </div>
  );
}
