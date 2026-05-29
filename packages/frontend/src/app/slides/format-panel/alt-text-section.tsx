import { useEffect, useState } from 'react';
import type { ImageElement } from '@wafflebase/slides';
import { getCommonValue } from './units';

export interface AltTextSectionProps {
  elements: readonly ImageElement[];
  onCommit: (ids: readonly string[], alt: string) => void;
}

export function AltTextSection({ elements, onCommit }: AltTextSectionProps) {
  const common = getCommonValue(elements, (el) => el.data.alt ?? '');
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
            : 'Describe this image for screen readers'
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
