import { useEffect, useState } from 'react';
import type { Element } from '@wafflebase/slides';
import { getCommonValue } from './units';

export interface AltTextSectionProps {
  /** Shape / image / text / table elements (each stores `data.alt`). */
  elements: readonly Element[];
  onCommit: (ids: readonly string[], alt: string) => void;
}

/** Read `data.alt` defensively — connectors (no `data`) never route here. */
function readAlt(el: Element): string {
  const data = (el as { data?: { alt?: string } }).data;
  return data?.alt ?? '';
}

export function AltTextSection({ elements, onCommit }: AltTextSectionProps) {
  const common = getCommonValue(elements, readAlt);
  const [draft, setDraft] = useState<string>(common ?? '');
  // Re-sync when the parent swaps elements or a remote change updates alt.
  useEffect(() => {
    setDraft(common ?? '');
  }, [common]);

  return (
    <section aria-labelledby="format-alt-text-label" className="p-3">
      <h3 id="format-alt-text-label" className="mb-2 text-xs font-semibold">
        Alt text
      </h3>
      <textarea
        rows={3}
        value={draft}
        placeholder={
          common === undefined
            ? 'Multiple values'
            : 'Describe this object for screen readers'
        }
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          // Blank draft on an "is-mixed" entry means the user didn't type
          // anything — leave each element alone.
          if (common === undefined && draft === '') return;
          // Single-value case: also no-op if unchanged.
          if (common !== undefined && draft === common) return;
          onCommit(
            elements.map((el) => el.id),
            draft,
          );
        }}
        className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border bg-transparent px-3 py-2 text-xs shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:opacity-50"
      />
    </section>
  );
}
