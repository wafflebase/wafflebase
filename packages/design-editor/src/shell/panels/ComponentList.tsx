import { Fragment, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../lib/cn.ts';
import type { ComponentMeta } from '../../types.ts';

/** A catalogue entry: the analysed component plus the module it came from. */
export interface CatalogueEntry extends ComponentMeta {
  module: string;
  file: string;
}

interface ComponentListProps {
  components: CatalogueEntry[];
  selected: string;
  onSelect: (name: string) => void;
}

/** One thing you can set out to design. */
interface Subject {
  entry: CatalogueEntry;
}

/**
 * A PRIMITIVE takes its content as children and renders anywhere: Button, Badge, Card.
 * An APP COMPONENT reads data and context — `DocumentList` needs rows, `NavUser` a user.
 *
 * Told apart by what the analyser already knows: a component with REQUIRED PROPS is the
 * second kind. That is the same fact that predicts whether a bare mount succeeds, which
 * is why it is the honest line to draw rather than a hand-kept list of names.
 */
const isPrimitive = (c: ComponentMeta) => !(c.props ?? []).some((pr) => !pr.optional);

/**
 * Left pane: the project's components, as SUBJECTS.
 *
 * Two collapses happen before anything is drawn, and both exist because the manifest now
 * names every `components/ui/*` file — 123 exports, where it used to name eight.
 *
 * A COMPOSITE IS ONE SUBJECT. `dropdown-menu.tsx` exports `DropdownMenu` and fourteen
 * `DropdownMenu…` parts; `card.tsx` exports `Card` and six. Listing them as peers said
 * they were fifteen things to look at when they are one thing and its anatomy — and the
 * parts cannot even mount alone, so most of the list was unclickable. The test is
 * structural rather than a hand-kept list: the SHORTEST export whose name prefixes every
 * other one in its module is the root. `document-list.tsx` (`DateCell`, `DocumentList`)
 * has no such name, so both stay top-level — the right answer for a file that happens to
 * hold two unrelated components.
 *
 * The parts are not here at all any more, not even folded: they are the ROOT'S LAYOUT,
 * and the Layout tab is where a reader looks for what something is made of. A SEARCH
 * still surfaces them, because "find me `DropdownMenuItem`" is a real thing to type and
 * a list that cannot answer it is worse than one carrying a few extra rows.
 *
 * THE MODULE IS NOT A LEVEL. Grouping by file was the first attempt and it collapsed to
 * one component per group the moment the parts folded away, so every subject sat alone
 * inside a heading that repeated its name. What the two headings below say instead is
 * the thing the list cannot show you: whether mounting it needs data.
 */
export function ComponentList({ components, selected, onSelect }: ComponentListProps) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byModule = new Map<string, CatalogueEntry[]>();
    for (const c of components) {
      if (q && !c.name.toLowerCase().includes(q) && !c.module.toLowerCase().includes(q)) continue;
      const list = byModule.get(c.module);
      if (list) list.push(c);
      else byModule.set(c.module, [c]);
    }

    const subjects: Subject[] = [];
    for (const members of byModule.values()) {
      const shortest = members.reduce((a, b) => (b.name.length < a.name.length ? b : a));
      const composite = members.length > 1 && members.every((m) => m.name.startsWith(shortest.name));
      // A part is listed when the query named it, or when it is the CURRENT SELECTION —
      // otherwise the root stands for the whole module and the parts live in the Layout
      // tab. Showing the selected one matters: previewing a part with nothing marked in
      // the list reads as having lost your place.
      const shown = composite
        ? [
            shortest,
            ...members.filter(
              (m) =>
                m !== shortest &&
                (m.name === selected || (q && m.name.toLowerCase().includes(q))),
            ),
          ]
        : members;
      for (const m of shown) subjects.push({ entry: m });
    }

    /*
     * CVA SUBJECTS FIRST within each group, because they are the only ones the bindings
     * panel can act on. Sorted rather than filtered: the list is also the answer to "what
     * components does this project have", and dropping the others would replace one wrong
     * impression with another. Ties keep manifest order.
     */
    const rank = (list: Subject[]) =>
      list
        .map((s, i) => [s, i] as const)
        .sort(([a, ai], [b, bi]) => Number(!!b.entry.cva) - Number(!!a.entry.cva) || ai - bi)
        .map(([s]) => s);

    return [
      { label: 'Primitives', subjects: rank(subjects.filter((s) => isPrimitive(s.entry))) },
      { label: 'App components', subjects: rank(subjects.filter((s) => !isPrimitive(s.entry))) },
    ];
  }, [components, query, selected]);

  const empty = groups.every((g) => g.subjects.length === 0);

  return (
    <div className="flex h-full flex-col">
      {/*
        NO "Components" HEADING. The mode switch directly above this pane already says
        `COMPONENTS`, so a title one line down repeated it — and the "add a component"
        button it used to sit beside is gone, so the row it anchored has nothing left in
        it. The two group headings below carry the structure.
      */}
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

      {/*
        NO SCROLLER AND REAL PADDING.
        
        `overflow-y-auto` here made this a second scroll container inside a pane that
        already scrolls, which is where the phantom gutter came from — and it clipped the
        selected row's `ring-1`, because a ring is painted outside the border box and an
        overflow container has nowhere to put it. The padding gives the ring its pixel
        back on every side.
      */}
      <nav className="flex flex-col gap-0.5 p-1">
        {groups.map(({ label, subjects }) => (
          <Fragment key={label}>
            {subjects.length > 0 && (
              <p className="mt-3 px-1 pb-0.5 font-mono text-[10px] uppercase tracking-wide text-wb-muted first:mt-0">
                {label}
              </p>
            )}
            {subjects.map(({ entry }) => (
              <Row key={entry.name} entry={entry} selected={selected} onSelect={onSelect} />
            ))}
          </Fragment>
        ))}
        {empty && <p className="px-2 py-4 text-xs text-muted-foreground">No matches.</p>}
      </nav>
    </div>
  );
}

/** One selectable component. */
function Row({
  entry,
  selected,
  onSelect,
}: {
  entry: CatalogueEntry;
  selected: string;
  onSelect: (name: string) => void;
}) {
  const isActive = entry.name === selected;
  const axisCount = entry.cva
    ? Object.values(entry.cva.axes).reduce((n, vals) => n + Object.keys(vals).length, 0)
    : 0;
  const needsData = (entry.props ?? []).some((pr) => !pr.optional);
  return (
    <button
      onClick={() => onSelect(entry.name)}
      title={entry.module}
      className={cn(
        'flex w-full items-center gap-2 rounded-md py-1.5 pl-2 pr-2 text-left text-xs transition-colors',
        isActive
          ? 'bg-wb-accent/12 text-wb-accent ring-1 ring-wb-accent/25'
          : 'text-wb-fg hover:bg-wb-subtle',
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{entry.name}</span>
        {/*
          ONLY WHEN THERE IS SOMETHING TO SAY. Every row used to carry a subtitle, and for
          most components it read "No variants" — a second line per row to state an
          absence, on a list where the absence is the common case.
        */}
        {axisCount > 0 && (
          <span className="truncate text-[10px] text-muted-foreground">{axisCount} variants</span>
        )}
      </span>
      {needsData && (
        <span
          title="Takes required props — the preview mounts it with generated stand-ins you can edit"
          className="ml-auto shrink-0 rounded-full bg-wb-subtle px-1.5 text-[9px] text-wb-muted"
        >
          data
        </span>
      )}
    </button>
  );
}
