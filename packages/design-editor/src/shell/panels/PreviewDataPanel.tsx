/*
 * WHAT THE PREVIEW RENDERS WITH.
 *
 * An app component takes data — `NavMain` maps `items`, `NavUser` reads `user.username`
 * — and mounted bare it throws before it can be looked at, let alone styled. The
 * generator seeds a plausible shape from the declared type; this is where that shape
 * becomes editable, because a guess is a starting point and not an answer.
 *
 * ONE INPUT KIND FOR EVERYTHING. The children text and a `Document[]` are the same
 * question — "what should this render with" — and giving them different controls made
 * the pane feel like two features. Every field is JSON, with a bare string accepted
 * unquoted because typing `"Documents"` to set a title is friction with no payoff.
 *
 * Callbacks are absent on purpose: they cannot be JSON, the frame substitutes no-ops by
 * name, and nobody styles a handler.
 */
import { useEffect, useState } from 'react';
import { cn } from '../lib/cn.ts';
import { ICON_NAMES, ICON_SLOTS, PreviewIcon, type IconSlot } from '../../scenes/preview-icons.tsx';
import type { ComponentMeta } from '../../types.ts';

interface Props {
  component: ComponentMeta;
  /** Children for the preview. Empty falls back to the component's own name. */
  label: string;
  onLabelChange: (v: string) => void;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Where a stand-in glyph sits inside the component, and which one. */
  iconSlot: IconSlot;
  onIconSlotChange: (v: IconSlot) => void;
  icon: string;
  onIconChange: (v: string) => void;
}

/** JSON, or a bare string. Returns `undefined` when the text cannot be read as either. */
export function parseFieldValue(text: string): unknown | undefined {
  const t = text.trim();
  if (!t) return '';
  try {
    return JSON.parse(t);
  } catch {
    // A bare word is a string. Anything that OPENS a structure and fails to close it is
    // a typo mid-edit, not a string — reporting it is what lets the field say so.
    return /^[[{]/.test(t) ? undefined : text;
  }
}

export function PreviewDataPanel({
  component,
  label,
  onLabelChange,
  values,
  onChange,
  iconSlot,
  onIconSlotChange,
  icon,
  onIconChange,
}: Props) {
  const required = (component.props ?? []).filter((p) => !p.optional);
  const editable = required.filter((p) => p.name in values);

  return (
    <section className="mb-3 border-b border-wb-border pb-3">
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-wb-muted">
        Preview data
      </p>

      <Field
        name="children"
        hint="text inside the component"
        text={label}
        onText={onLabelChange}
        placeholder={component.name}
      />

      {/*
        THE ICON IS PART OF THE CHILDREN, so it sits with them.
        
        A `Button`'s variant table spends four rules on a glyph it does not own
        (`[&_svg]:size-4`, `shrink-0`, `pointer-events-none`, and the whole `size: icon`
        variant), and previewing with text alone exercised none of them. This is the
        smallest control that does: which slot, and which shape.
      */}
      <div className="mt-1.5 flex flex-col gap-0.5">
        <span className="font-mono text-[10px] text-wb-muted">
          icon <span className="opacity-60">a stand-in glyph, to size against</span>
        </span>
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5 rounded-md bg-wb-subtle p-0.5">
            {ICON_SLOTS.map((slot) => (
              <button
                key={slot}
                type="button"
                onClick={() => onIconSlotChange(slot)}
                className={cn(
                  'rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                  iconSlot === slot
                    ? 'bg-wb-bg text-wb-fg shadow-sm'
                    : 'text-wb-muted hover:text-wb-fg',
                )}
              >
                {slot}
              </button>
            ))}
          </div>
          {iconSlot !== 'none' && (
            <div className="flex items-center gap-0.5 rounded-md bg-wb-subtle p-0.5">
              {ICON_NAMES.map((n) => (
                <button
                  key={n}
                  type="button"
                  title={n}
                  aria-label={`Icon: ${n}`}
                  onClick={() => onIconChange(n)}
                  className={cn(
                    'rounded p-1 transition-colors [&_svg]:size-3.5',
                    icon === n ? 'bg-wb-bg text-wb-fg shadow-sm' : 'text-wb-muted hover:text-wb-fg',
                  )}
                >
                  <PreviewIcon name={n} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {editable.map((p) => (
        <Field
          key={p.name}
          name={p.name}
          hint={p.type}
          text={JSON.stringify(values[p.name])}
          onText={(t) => {
            const v = parseFieldValue(t);
            if (v !== undefined) onChange({ ...values, [p.name]: v });
          }}
        />
      ))}

      {!editable.length && (
        <p className="mt-1 text-[10px] leading-relaxed text-wb-muted">
          This component takes no required data.
        </p>
      )}
    </section>
  );
}

/**
 * One row. Holds its own text so a half-typed `[{` is not thrown away by a re-render
 * before it becomes valid — the committed value only moves when the text parses.
 */
function Field({
  name,
  hint,
  text,
  onText,
  placeholder,
}: {
  name: string;
  hint: string;
  text: string;
  onText: (t: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const bad = draft.trim() !== '' && parseFieldValue(draft) === undefined;

  return (
    <label className="mt-1.5 flex flex-col gap-0.5">
      <span className="font-mono text-[10px] text-wb-muted">
        {name} <span className="opacity-60">{hint}</span>
      </span>
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          onText(e.target.value);
        }}
        className={cn(
          'w-full rounded-sm border bg-wb-bg px-1.5 py-1 font-mono text-[10px] text-wb-fg outline-none',
          bad ? 'border-wb-danger' : 'border-wb-border focus:border-wb-accent',
        )}
      />
    </label>
  );
}
